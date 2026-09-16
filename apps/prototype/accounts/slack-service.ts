import { randomBytes, createHash } from "node:crypto";
import { WorkspaceService } from "./service";
import { first, type Database } from "./database";
import { AccessError, type Identity } from "./policy";
import {
  openSlackToken,
  sealSlackToken,
  slackDirectory,
  allowedUnfurl,
  verifySlackRequest,
} from "./slack";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export type SlackConfig = {
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  signingSecret: string;
  origin: string;
};
export class SlackService {
  constructor(
    readonly db: Database,
    readonly spaces: WorkspaceService,
    readonly config: SlackConfig,
    readonly transport: typeof fetch = fetch,
    readonly now = () => Date.now(),
    readonly monotonic = () => performance.now(),
  ) {}
  async begin(actor: Identity, space: string) {
    await this.spaces.member(actor, space, "manage");
    if (
      !this.config.clientId ||
      !this.config.clientSecret ||
      Buffer.from(this.config.encryptionKey, "base64").length !== 32
    )
      throw new AccessError("SLACK_NOT_CONFIGURED", 503);
    const state = randomBytes(32).toString("base64url");
    await this.db.query(
      "INSERT INTO boards_accounts.oauth_states(hash,space_id,account_id,expires_at) VALUES($1,$2,$3,$4)",
      [hash(state), space, actor.id, new Date(this.now() + 600000).toISOString()],
    );
    const url = new URL("https://slack.com/oauth/v2/authorize");
    for (const [key, value] of Object.entries({
      client_id: this.config.clientId,
      scope: "users:read,users:read.email,links:read,links:write",
      state,
      redirect_uri: this.config.origin + "/accounts/slack/callback",
    }))
      url.searchParams.set(key, value);
    return { url: url.href };
  }
  async callback(actor: Identity, state: string, code: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4000)
      throw new AccessError("INVALID_SLACK_CALLBACK", 400);
    const flow = await this.db.transaction(async (db) => {
      const r = await first(
        db,
        "SELECT * FROM boards_accounts.oauth_states WHERE hash=$1 FOR UPDATE",
        [hash(state)],
      );
      if (
        !r ||
        r.account_id !== actor.id ||
        r.consumed_at ||
        new Date(r.expires_at).getTime() <= this.now()
      )
        throw new AccessError("INVALID_SLACK_STATE", 403);
      await this.spaces.member(actor, r.space_id, "manage", db);
      await db.query("UPDATE boards_accounts.oauth_states SET consumed_at=$2 WHERE hash=$1", [
        hash(state),
        new Date(this.now()).toISOString(),
      ]);
      return r;
    });
    const response = await this.transport("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.origin + "/accounts/slack/callback",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.access_token || !/^T[A-Z0-9]+$/.test(data.team?.id))
      throw new AccessError("SLACK_EXCHANGE_FAILED", 502);
    const required = ["users:read", "users:read.email", "links:read", "links:write"];
    if (required.some((s) => !String(data.scope).split(",").includes(s)))
      throw new AccessError("SLACK_SCOPES_MISSING", 403);
    await this.db.query(
      "INSERT INTO boards_accounts.integrations(space_id,slack_team_id,slack_team_name,slack_token_ciphertext,connected_by,connected_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(space_id) DO UPDATE SET slack_team_id=excluded.slack_team_id,slack_team_name=excluded.slack_team_name,slack_token_ciphertext=excluded.slack_token_ciphertext,connected_by=excluded.connected_by,connected_at=excluded.connected_at",
      [
        flow.space_id,
        data.team.id,
        String(data.team.name || "Slack"),
        sealSlackToken(data.access_token, this.config.encryptionKey),
        actor.id,
        new Date(this.now()).toISOString(),
      ],
    );
    return { spaceId: flow.space_id };
  }
  async sync(actor: Identity, space: string) {
    await this.spaces.member(actor, space, "manage");
    const connection = await first(
      this.db,
      "SELECT * FROM boards_accounts.integrations WHERE space_id=$1",
      [space],
    );
    if (!connection?.slack_token_ciphertext) throw new AccessError("SLACK_NOT_CONNECTED", 503);
    const directory = await slackDirectory(
      openSlackToken(connection.slack_token_ciphertext, this.config.encryptionKey),
      connection.slack_team_id,
      this.transport,
    );
    return this.db.transaction(async (db) => {
      await this.spaces.member(actor, space, "manage", db);
      const row = await first(
        db,
        "SELECT document FROM boards_accounts.spaces WHERE id=$1 FOR UPDATE",
        [space],
      );
      let added = 0,
        updated = 0;
      const bySlackId = new Map<string, (typeof row.document.people)[number]>(
        row.document.people.filter((p: any) => p.slackUserId).map((p: any) => [p.slackUserId, p]),
      );
      for (const user of directory) {
        const existing = bySlackId.get(user.id);
        if (existing) {
          if (!existing.avatar) existing.avatar = user.avatar;
          existing.slackUrl = user.slackUrl;
          updated++;
        } else if (row.document.people.length < 200) {
          row.document.people.push({
            id: "slack_" + user.id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            slackUserId: user.id,
            slackUrl: user.slackUrl,
          });
          bySlackId.set(user.id, row.document.people.at(-1));
          added++;
        }
      }
      await db.query(
        "UPDATE boards_accounts.spaces SET document=$2::jsonb,version=version+1 WHERE id=$1",
        [space, JSON.stringify(row.document)],
      );
      await db.query(
        "UPDATE boards_accounts.integrations SET last_synced_at=$2 WHERE space_id=$1",
        [space, new Date(this.now()).toISOString()],
      );
      // Directory import is not account linking, invitation acceptance or membership admission.
      return { added, updated, total: directory.length };
    });
  }
  async event(raw: string, headers: Headers) {
    if (
      raw.length > 1000000 ||
      !verifySlackRequest(raw, headers, this.config.signingSecret, this.now())
    )
      throw new AccessError("INVALID_SLACK_SIGNATURE", 401);
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new AccessError("INVALID_EVENT", 400);
    }
    if (data.type === "url_verification") return { challenge: data.challenge };
    if (data.type !== "event_callback" || data.event?.type !== "link_shared") return { ok: true };
    if (typeof data.event_id !== "string" || data.event_id.length > 128)
      throw new AccessError("INVALID_EVENT", 400);
    const connection = await first(
      this.db,
      "SELECT space_id FROM boards_accounts.integrations WHERE slack_team_id=$1 AND slack_token_ciphertext IS NOT NULL",
      [data.team_id],
    );
    if (!connection) return { ok: true };
    const links = (data.event.links || [])
      .filter((l: any) => typeof l.url === "string" && allowedUnfurl(l.url, this.config.origin))
      .slice(0, 5);
    if (!links.length) return { ok: true };
    const payload = {
      team_id: data.team_id,
      event: { channel: data.event.channel, message_ts: data.event.message_ts, links },
    };
    await this.db.query(
      "INSERT INTO boards_accounts.event_receipts(event_id,payload) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",
      [data.event_id, JSON.stringify(payload)],
    );
    return { ok: true };
  }
  async processEvents(maximum = 10, budgetMs = 25_000) {
    if (
      !Number.isInteger(maximum) ||
      maximum < 1 ||
      maximum > 100 ||
      !Number.isFinite(budgetMs) ||
      budgetMs < 0 ||
      budgetMs > 300_000
    )
      throw Error("Invalid Slack execution limit");
    const started = this.monotonic();
    let processed = 0;
    for (let index = 0; index < maximum; index++) {
      if (this.monotonic() - started + 13_000 > budgetMs) break;
      const now = this.now(),
        lease = crypto.randomUUID(),
        iso = new Date(now).toISOString();
      const event = await this.db.transaction(async (db) => {
        const row = await first(
          db,
          "SELECT * FROM boards_accounts.event_receipts WHERE (state='pending' AND (lease_until IS NULL OR lease_until<=$1)) OR (state='sending' AND lease_until<=$1) ORDER BY received_at,event_id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [iso],
        );
        if (!row) return null;
        if (row.attempts >= 5) {
          await db.query(
            "UPDATE boards_accounts.event_receipts SET state='held',lease_until=NULL WHERE event_id=$1",
            [row.event_id],
          );
          return { skip: true };
        }
        await db.query(
          "UPDATE boards_accounts.event_receipts SET state='sending',attempts=attempts+1,lease_until=$2,lease_token=$3 WHERE event_id=$1",
          [row.event_id, new Date(now + 120000).toISOString(), lease],
        );
        return { ...row, attempts: row.attempts + 1, lease, skip: false };
      });
      if (!event) break;
      if (event.skip) continue;
      try {
        await this.unfurl(event.payload);
        await this.db.query(
          "UPDATE boards_accounts.event_receipts SET state='sent',lease_until=NULL WHERE event_id=$1 AND state='sending' AND lease_token=$2",
          [event.event_id, event.lease],
        );
        processed++;
      } catch {
        const held = event.attempts >= 5;
        await this.db.query(
          "UPDATE boards_accounts.event_receipts SET state=$2,lease_until=$3 WHERE event_id=$1 AND state='sending' AND lease_token=$4",
          [
            event.event_id,
            held ? "held" : "pending",
            held
              ? null
              : new Date(this.now() + Math.min(3600000, 30000 * 2 ** event.attempts)).toISOString(),
            event.lease,
          ],
        );
      }
    }
    return { processed };
  }
  private async unfurl(data: any) {
    const connection = await first(
      this.db,
      "SELECT * FROM boards_accounts.integrations WHERE slack_team_id=$1",
      [data.team_id],
    );
    if (!connection?.slack_token_ciphertext) return { ok: true };
    const urls = (data.event.links || [])
      .map((l: any) => l.url)
      .filter((u: any) => typeof u === "string" && allowedUnfurl(u, this.config.origin))
      .slice(0, 5);
    const unfurls: Record<string, unknown> = {};
    // At most five independent probes to our own allowlisted share endpoint.
    // Slack API posts stay sequential, respecting its per-method rate limits.
    const available = await Promise.all(
      [...new Set<string>(urls)].map(async (href: string) => {
        const response = await this.transport(href, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { Accept: "text/html" },
        });
        const ok = response.ok;
        if (response.body) await response.body.cancel().catch(() => {});
        return ok ? href : null;
      }),
    );
    for (const href of available) {
      if (!href) continue;
      unfurls[href] = {
        title: "Shared board",
        title_link: href,
        image_url: href.replace(/\/$/, "") + "/og.png",
        text: "Open this shared page in Boards",
      };
    }
    if (Object.keys(unfurls).length) {
      const response = await this.transport("https://slack.com/api/chat.unfurl", {
        method: "POST",
        headers: {
          Authorization:
            "Bearer " +
            openSlackToken(connection.slack_token_ciphertext, this.config.encryptionKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: data.event.channel, ts: data.event.message_ts, unfurls }),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new AccessError("SLACK_UNFURL_FAILED", 502);
    }
    return { ok: true };
  }
}
