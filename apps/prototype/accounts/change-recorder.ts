import type { Database } from "./database";
import { newlyAssigned, type ItemChange } from "./history";
export const ASSIGNMENT_WINDOW_MS = 5 * 60_000;
type AuditRow = { id: string; board_id: string; item_id: string };
type Recipient = { account_id: string; person_id: string };
type Entry = {
  historyId: string;
  boardId: string;
  itemId: string;
  personId: string;
  actorId: string;
};
type Batch = {
  id: string;
  recipient_id: string;
  due_at: string | Date;
  events: Entry[];
  state: "pending" | "cancelled";
};
const itemKey = (board: string, item: string) => JSON.stringify([board, item]);
const assignmentKey = (board: string, item: string, person: string) =>
  JSON.stringify([board, item, person]);
/** Called within the version-checked space transaction. Audit and outbox remain atomic. */
export async function recordChanges(
  db: Database,
  space: string,
  actorId: string,
  actorName: string,
  events: ItemChange[],
  now: number,
): Promise<void> {
  if (!events.length) return;
  const iso = new Date(now).toISOString();
  const records = (
    await db.query<AuditRow>(
      `INSERT INTO boards_accounts.history(space_id,board_id,item_id,actor_id,actor_name,kind,changes,occurred_at)
 SELECT $2,e->>'boardId',e->>'itemId',$3,$4,e->>'kind',e,$5::timestamptz
 FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS source(e,n) ORDER BY n
 RETURNING id::text,board_id,item_id`,
      [JSON.stringify(events), space, actorId, actorName, iso],
    )
  ).rows;
  const historyIds = new Map(records.map((row) => [itemKey(row.board_id, row.item_id), row.id]));
  const removed = new Set<string>(),
    additions: Entry[] = [];
  for (const event of events) {
    for (const person of event.before?.assignees || [])
      if (event.after?.done || !event.after?.assignees.includes(person))
        removed.add(assignmentKey(event.boardId, event.itemId, person));
    if (!event.after || event.after.done) continue;
    for (const personId of newlyAssigned(event)) {
      const historyId = historyIds.get(itemKey(event.boardId, event.itemId));
      if (!historyId) throw Error("Missing committed audit record");
      additions.push({
        historyId,
        boardId: event.boardId,
        itemId: event.itemId,
        personId,
        actorId,
      });
    }
  }
  if (!removed.size && !additions.length) return;
  const pending = (
    await db.query<Batch>(
      "SELECT id,recipient_id,due_at,events,state FROM boards_accounts.batches WHERE space_id=$1 AND kind='assignment' AND state='pending' AND payload IS NULL ORDER BY due_at,id FOR UPDATE",
      [space],
    )
  ).rows;
  const updates = new Map<string, Batch>();
  for (const batch of pending) {
    const remaining = batch.events.filter(
      (entry) => !removed.has(assignmentKey(entry.boardId, entry.itemId, entry.personId)),
    );
    if (remaining.length !== batch.events.length) {
      batch.events = remaining;
      batch.state = remaining.length ? "pending" : "cancelled";
      updates.set(batch.id, batch);
    }
  }
  const recipients = additions.length
    ? (
        await db.query<Recipient>(
          "SELECT m.account_id,m.person_id FROM boards_accounts.members m JOIN boards_accounts.users u ON u.id=m.account_id WHERE m.space_id=$1 AND m.person_id=ANY($2::text[]) AND m.account_id<>$3 AND m.assignment_mail=true AND u.verified=true",
          [space, [...new Set(additions.map((entry) => entry.personId))], actorId],
        )
      ).rows
    : [];
  const byPerson = new Map(recipients.map((row) => [row.person_id, row.account_id]));
  const available = new Map<string, Batch>();
  for (const batch of pending)
    if (
      batch.state === "pending" &&
      new Date(batch.due_at).getTime() > now &&
      !available.has(batch.recipient_id)
    )
      available.set(batch.recipient_id, batch);
  const inserts = new Map<string, Batch>();
  for (const entry of additions) {
    const recipient = byPerson.get(entry.personId);
    if (!recipient) continue;
    let batch = available.get(recipient);
    if (!batch) {
      batch = {
        id: crypto.randomUUID(),
        recipient_id: recipient,
        due_at: new Date(now + ASSIGNMENT_WINDOW_MS).toISOString(),
        events: [],
        state: "pending",
      };
      available.set(recipient, batch);
      inserts.set(batch.id, batch);
    }
    batch.events.push(entry);
    if (!inserts.has(batch.id)) updates.set(batch.id, batch);
  }
  if (updates.size)
    await db.query(
      `UPDATE boards_accounts.batches b SET events=x.events,state=x.state
 FROM jsonb_to_recordset($1::jsonb) AS x(id text,events jsonb,state text)
 WHERE b.id=x.id AND b.space_id=$2`,
      [
        JSON.stringify(
          [...updates.values()].map(({ id, events, state }) => ({ id, events, state })),
        ),
        space,
      ],
    );
  if (inserts.size)
    await db.query(
      `INSERT INTO boards_accounts.batches(id,space_id,recipient_id,kind,events,due_at)
 SELECT x.id,$2,x.recipient_id,'assignment',x.events,x.due_at
 FROM jsonb_to_recordset($1::jsonb) AS x(id text,recipient_id text,events jsonb,due_at timestamptz)`,
      [JSON.stringify([...inserts.values()]), space],
    );
}
