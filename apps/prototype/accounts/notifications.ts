import { first, type Database } from "./database";
import { assignmentMail, deliverMail, MailFailure, type Mail } from "./mail";
import { itemIndex } from "./history";
export function weeklyPeriod(now: number, timeZone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "gregory",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)),
  );
  const weekday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - weekday);
  if (weekday === 0 && Number(values.hour) < 8) localDate.setUTCDate(localDate.getUTCDate() - 7);
  return localDate.toISOString().slice(0, 10);
}
export class NotificationWorker {
  constructor(
    readonly db: Database,
    readonly config: { from: string; origin: string; key: string },
    readonly now = () => Date.now(),
    readonly send = (mail: Mail, id: string) => deliverMail(config.key, mail, id),
    readonly monotonic = () => performance.now(),
  ) {}
  async enqueueWeekly() {
    const now = this.now();
    const members = (
      await this.db.query<{
        space_id: string;
        account_id: string;
        created_at: string | Date;
        time_zone: string;
      }>(
        "SELECT m.space_id,m.account_id,s.created_at,s.time_zone FROM boards_accounts.members m JOIN boards_accounts.spaces s ON s.id=m.space_id JOIN boards_accounts.users u ON u.id=m.account_id WHERE m.weekly_mail=true AND u.verified=true",
      )
    ).rows;
    const periods = new Map<string, string>(),
      due_at = new Date(now).toISOString();
    const rows = members
      .filter((member) => new Date(member.created_at).getTime() + 7 * 86400000 <= now)
      .map((member) => {
        if (!periods.has(member.time_zone))
          periods.set(member.time_zone, weeklyPeriod(now, member.time_zone));
        return {
          id: crypto.randomUUID(),
          space_id: member.space_id,
          recipient_id: member.account_id,
          events: { period: periods.get(member.time_zone) },
          due_at,
        };
      });
    if (!rows.length) return 0;
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO boards_accounts.batches(id,space_id,recipient_id,kind,events,due_at)
      SELECT x.id,x.space_id,x.recipient_id,'weekly',x.events,x.due_at
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,space_id text,recipient_id text,events jsonb,due_at timestamptz)
      ON CONFLICT DO NOTHING RETURNING id`,
      [JSON.stringify(rows)],
    );
    return inserted.rows.length;
  }
  async prepare() {
    return this.db.transaction(async (db) => {
      const now = this.now(),
        iso = new Date(now).toISOString(),
        lease = crypto.randomUUID();
      const batch = await first(
        db,
        "SELECT * FROM boards_accounts.batches WHERE (state='pending' AND due_at<=$1) OR (state='sending' AND lease_until<=$1) ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        [iso],
      );
      if (!batch) return null;
      const member = await first(
        db,
        "SELECT m.*,u.email,s.name,s.document FROM boards_accounts.members m JOIN boards_accounts.users u ON u.id=m.account_id JOIN boards_accounts.spaces s ON s.id=m.space_id WHERE m.space_id=$1 AND m.account_id=$2 AND u.verified=true",
        [batch.space_id, batch.recipient_id],
      );
      const cancel = async (state: string) => {
        await db.query("UPDATE boards_accounts.batches SET state=$2,lease_until=NULL WHERE id=$1", [
          batch.id,
          state,
        ]);
        return { skip: true as const, id: batch.id, state };
      };
      if (!member || (batch.kind === "weekly" ? !member.weekly_mail : !member.assignment_mail))
        return cancel("cancelled");
      if (
        batch.first_attempt_at &&
        now - new Date(batch.first_attempt_at).getTime() >= 23 * 3600000
      )
        return cancel("held");
      let payload: Mail = batch.payload;
      if (!payload) {
        const items = itemIndex(member.document),
          keys =
            batch.kind === "weekly"
              ? [...items.keys()]
              : [
                  ...new Set(
                    batch.events
                      .filter((e: any) => e.actorId !== member.account_id)
                      .map((e: any) => JSON.stringify([e.boardId, e.itemId])),
                  ),
                ];
        const tasks = keys
          .map((key: any) => ({ key, item: items.get(key) }))
          .filter(({ item }) => item && !item.done && item.assignees.includes(member.person_id))
          .map(({ key, item }) => {
            const [boardId, itemId] = JSON.parse(key);
            return {
              boardId,
              itemId,
              text: item!.text,
              boardTitle:
                member.document.boards.find((b: any) => b.id === boardId)?.title || "Untitled",
            };
          });
        if (!tasks.length) return cancel("cancelled");
        payload = assignmentMail({
          kind: batch.kind,
          from: this.config.from,
          recipient: member.email,
          space: member.name,
          spaceId: batch.space_id,
          origin: this.config.origin,
          tasks,
        });
      }
      await db.query(
        "UPDATE boards_accounts.batches SET state='sending',payload=$2::jsonb,lease_until=$3,lease_token=$5,attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,$4) WHERE id=$1",
        [batch.id, JSON.stringify(payload), new Date(now + 120000).toISOString(), iso, lease],
      );
      return { skip: false as const, id: batch.id, payload, lease, attempts: batch.attempts + 1 };
    });
  }
  async run(maximum = 20, budgetMs = 25_000) {
    if (!Number.isFinite(budgetMs) || budgetMs < 0 || budgetMs > 300_000)
      throw Error("Invalid execution budget");
    const started = this.monotonic();
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 100)
      throw Error("Invalid batch limit");
    let sent = 0,
      skipped = 0,
      failed = 0;
    for (let i = 0; i < maximum; i++) {
      // 12-second send timeout plus 3 seconds to settle database state.
      if (this.monotonic() - started + 15_000 > budgetMs) break;
      const job = await this.prepare();
      if (!job) break;
      if (job.skip) {
        skipped++;
        continue;
      }
      try {
        const providerId = await this.send(job.payload!, job.id);
        await this.db.query(
          "UPDATE boards_accounts.batches SET state='sent',provider_id=$2,lease_until=NULL WHERE id=$1 AND state='sending' AND lease_token=$3",
          [job.id, providerId, job.lease],
        );
        sent++;
      } catch (error) {
        const hold = error instanceof MailFailure && !error.retryable;
        await this.db.query(
          "UPDATE boards_accounts.batches SET state=$2,due_at=$3,lease_until=NULL WHERE id=$1 AND state='sending' AND lease_token=$4",
          [
            job.id,
            hold ? "held" : "pending",
            new Date(
              this.now() + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts!, 6)),
            ).toISOString(),
            job.lease,
          ],
        );
        failed++;
      }
    }
    return { sent, skipped, failed };
  }
}
