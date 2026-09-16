import { recordChanges } from "./change-recorder";
import { first, type Database } from "./database";
import {
  AccessError,
  authorize,
  requireIdentity,
  workEmail,
  corporateDomains,
  type Identity,
  type Membership,
  type Role,
} from "./policy";
import { changedItems, historyLimit, type Document } from "./history";
import { validateWorkspace, createWorkspace, newBoard } from "../../../packages/core/workspace.mjs";
export class WorkspaceService {
  constructor(
    readonly db: Database,
    readonly now = () => Date.now(),
  ) {}
  async member(
    actor: Identity | null,
    space: string,
    action: "read" | "write" | "manage",
    db = this.db,
  ): Promise<Membership> {
    const identity = requireIdentity(actor, this.now());
    const rows = (
      await db.query(
        'SELECT m.space_id AS "spaceId",m.account_id AS "accountId",m.person_id AS "personId",m.role FROM boards_accounts.members m JOIN boards_accounts.users u ON u.id=m.account_id WHERE m.space_id=$1 AND m.account_id=$2 AND u.verified=true',
        [space, identity.id],
      )
    ).rows;
    return authorize(identity, space, rows, action, this.now());
  }
  async spaces(actor: Identity) {
    requireIdentity(actor, this.now());
    return (
      await this.db.query(
        "SELECT s.id,s.name,m.role FROM boards_accounts.spaces s JOIN boards_accounts.members m ON m.space_id=s.id WHERE m.account_id=$1 ORDER BY s.created_at,s.id",
        [actor.id],
      )
    ).rows;
  }
  async create(actor: Identity, input: { name: string; domains: string[]; timeZone?: string }) {
    requireIdentity(actor, this.now());
    if (typeof input?.name !== "string" || !input.name.trim() || input.name.length > 120)
      throw new AccessError("INVALID_NAME", 400);
    const domains = corporateDomains(input.domains),
      email = workEmail(actor.email, domains);
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone || "UTC" }).format();
    } catch {
      throw new AccessError("INVALID_TIME_ZONE", 400);
    }
    const id = crypto.randomUUID(),
      document = createWorkspace();
    document.name = input.name.trim();
    document.people = [
      { id: actor.id, name: actor.name, email, avatar: "", slackUserId: "", slackUrl: "" },
    ];
    document.id = id;
    document.boards = [newBoard("")];
    return this.db.transaction(async (db) => {
      const user = await first(
        db,
        "SELECT id FROM boards_accounts.users WHERE id=$1 AND verified=true FOR UPDATE",
        [actor.id],
      );
      if (!user) throw new AccessError("SIGN_IN_REQUIRED", 401);
      const count = await first(
        db,
        "SELECT count(*)::integer AS count FROM boards_accounts.members WHERE account_id=$1",
        [actor.id],
      );
      if (count.count >= 100) throw new AccessError("SPACE_LIMIT", 429);
      await db.query(
        "INSERT INTO boards_accounts.spaces(id,name,document,allowed_domains,time_zone) VALUES($1,$2,$3::jsonb,$4,$5)",
        [id, input.name.trim(), JSON.stringify(document), domains, input.timeZone || "UTC"],
      );
      await db.query(
        "INSERT INTO boards_accounts.members(space_id,account_id,person_id,role) VALUES($1,$2,$2,'owner')",
        [id, actor.id],
      );
      return { id, name: input.name.trim() };
    });
  }
  async getSettings(actor: Identity, space: string) {
    const member = await this.member(actor, space, "read");
    const settings = await first(
      this.db,
      'SELECT name,allowed_domains AS "allowedDomains",time_zone AS "timeZone" FROM boards_accounts.spaces WHERE id=$1',
      [space],
    );
    const preferences = await first(
      this.db,
      'SELECT assignment_mail AS "assignmentMail",weekly_mail AS "weeklyMail" FROM boards_accounts.members WHERE space_id=$1 AND account_id=$2',
      [space, actor.id],
    );
    const slack = await first(
      this.db,
      'SELECT slack_team_name AS name,last_synced_at AS "lastSyncedAt" FROM boards_accounts.integrations WHERE space_id=$1 AND slack_token_ciphertext IS NOT NULL',
      [space],
    );
    return { ...settings, role: member.role, preferences, slack: slack || null };
  }
  async getProfile(actor: Identity) {
    requireIdentity(actor, this.now());
    return first(
      this.db,
      "SELECT id,email,name,avatar FROM boards_accounts.users WHERE id=$1 AND verified=true",
      [actor.id],
    );
  }
  async people(actor: Identity, space: string) {
    await this.member(actor, space, "read");
    return (
      await this.db.query(
        'SELECT u.id,u.name,u.email,u.avatar,m.person_id AS "personId",m.role FROM boards_accounts.members m JOIN boards_accounts.users u ON u.id=m.account_id WHERE m.space_id=$1 ORDER BY u.name,u.id',
        [space],
      )
    ).rows;
  }
  async read(actor: Identity, space: string) {
    await this.member(actor, space, "read");
    return first(
      this.db,
      "SELECT version,document AS value FROM boards_accounts.spaces WHERE id=$1",
      [space],
    );
  }
  async history(
    actor: Identity,
    space: string,
    board: string,
    item: string,
    before?: string,
    limit = 30,
  ) {
    await this.member(actor, space, "read");
    const take = historyLimit(limit);
    if (before && !/^\d{1,19}$/.test(before)) throw new AccessError("INVALID_CURSOR", 400);
    const rows = (
      await this.db.query(
        'SELECT id::text,actor_name AS "actorName",actor_id AS "actorId",kind,changes,occurred_at AS "occurredAt" FROM boards_accounts.history WHERE space_id=$1 AND board_id=$2 AND item_id=$3 AND ($4::bigint IS NULL OR id<$4::bigint) ORDER BY boards_accounts.history.id DESC LIMIT $5',
        [space, board, item, before || null, take + 1],
      )
    ).rows;
    return {
      items: rows.slice(0, take),
      nextCursor: rows.length > take ? rows[take - 1].id : null,
    };
  }
  async save(actor: Identity, space: string, expected: number, input: unknown) {
    if (!Number.isInteger(expected) || expected < 1) throw new AccessError("INVALID_VERSION", 400);
    return this.db.transaction(async (db) => {
      await this.member(actor, space, "write", db);
      const current = await first<{
        version: number;
        document: Document & Record<string, unknown>;
      }>(db, "SELECT version,document FROM boards_accounts.spaces WHERE id=$1 FOR UPDATE", [space]);
      if (!current) throw new AccessError("SPACE_FORBIDDEN", 403);
      if (current.version !== expected) throw new AccessError("VERSION_CONFLICT", 409);
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new AccessError("INVALID_DOCUMENT", 400);
      const submittedBoards = (input as { boards?: unknown }).boards;
      // Space settings and directory membership are changed through their own permission checks.
      const value = validateWorkspace({ ...current.document, boards: submittedBoards }),
        events = changedItems(current.document, value);
      const profile = await first<{ name: string }>(
        db,
        "SELECT name FROM boards_accounts.users WHERE id=$1",
        [actor.id],
      );
      if (!profile) throw new AccessError("SIGN_IN_REQUIRED", 401);
      await recordChanges(db, space, actor.id, profile.name, events, this.now());
      const saved = await first<{ version: number }>(
        db,
        "UPDATE boards_accounts.spaces SET document=$2::jsonb,version=version+1 WHERE id=$1 RETURNING version",
        [space, JSON.stringify(value)],
      );
      if (!saved) throw Error("Space update returned no version");
      return { version: saved.version, value, changes: events.length };
    });
  }
  async settings(
    actor: Identity,
    space: string,
    input: { name: string; allowedDomains: string[]; timeZone: string },
  ) {
    await this.member(actor, space, "manage");
    if (typeof input?.name !== "string" || !input.name.trim() || input.name.length > 120)
      throw new AccessError("INVALID_NAME", 400);
    const domains = corporateDomains(input.allowedDomains);
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format();
    } catch {
      throw new AccessError("INVALID_TIME_ZONE", 400);
    }
    await this.db.query(
      "UPDATE boards_accounts.spaces SET name=$2,allowed_domains=$3,time_zone=$4 WHERE id=$1",
      [space, input.name.trim(), domains, input.timeZone],
    );
  }
  async preferences(actor: Identity, space: string, assignment: boolean, weekly: boolean) {
    await this.member(actor, space, "read");
    if (typeof assignment !== "boolean" || typeof weekly !== "boolean")
      throw new AccessError("INVALID_PREFERENCE", 400);
    await this.db.query(
      "UPDATE boards_accounts.members SET assignment_mail=$3,weekly_mail=$4 WHERE space_id=$1 AND account_id=$2",
      [space, actor.id, assignment, weekly],
    );
  }
  async profile(actor: Identity, input: { name: string; avatar?: string }) {
    requireIdentity(actor, this.now());
    if (
      typeof input?.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 120 ||
      (input.avatar &&
        (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.avatar) ||
          input.avatar.length > 100000))
    )
      throw new AccessError("INVALID_PROFILE", 400);
    await this.db.query(
      "UPDATE boards_accounts.users SET name=$2,avatar=COALESCE($3,avatar) WHERE id=$1",
      [actor.id, input.name.trim(), input.avatar ?? null],
    );
  }
  async invite(
    actor: Identity,
    space: string,
    input: { email: string; name: string; role: Role; personId: string },
  ) {
    if (
      !input ||
      !["member", "viewer"].includes(input.role) ||
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 120 ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(input.personId)
    )
      throw new AccessError("INVALID_INVITATION", 400);
    return this.db.transaction(async (db) => {
      await this.member(actor, space, "manage", db);
      const config = await first(
        db,
        "SELECT allowed_domains,document FROM boards_accounts.spaces WHERE id=$1 FOR UPDATE",
        [space],
      );
      const email = workEmail(input.email, config.allowed_domains);
      const previous = await first(
        db,
        "SELECT person_id FROM boards_accounts.invites WHERE space_id=$1 AND email=$2",
        [space, email],
      );
      const personId = previous?.person_id || input.personId;
      const linked = await first(
        db,
        "SELECT u.email FROM boards_accounts.members m JOIN boards_accounts.users u ON u.id=m.account_id WHERE m.space_id=$1 AND m.person_id=$2",
        [space, personId],
      );
      const reserved = await first(
        db,
        "SELECT email FROM boards_accounts.invites WHERE space_id=$1 AND person_id=$2",
        [space, personId],
      );
      if ((linked && linked.email !== email) || (reserved && reserved.email !== email))
        throw new AccessError("PERSON_ALREADY_LINKED", 409);
      const document = config.document,
        person = document.people.find((p: any) => p.id === personId);
      if (person?.email && person.email.toLowerCase() !== email)
        throw new AccessError("PERSON_ALREADY_LINKED", 409);
      if (!person) {
        document.people.push({
          id: personId,
          name: input.name.trim(),
          email,
          avatar: "",
          slackUserId: "",
          slackUrl: "",
        });
        validateWorkspace(document);
        await db.query(
          "UPDATE boards_accounts.spaces SET document=$2::jsonb,version=version+1 WHERE id=$1",
          [space, JSON.stringify(document)],
        );
      }
      await db.query(
        "INSERT INTO boards_accounts.invites(space_id,email,name,role,person_id,invited_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(space_id,email) DO UPDATE SET name=excluded.name,role=excluded.role,invited_by=excluded.invited_by",
        [space, email, input.name.trim(), input.role, personId, actor.id],
      );
      return { personId };
    });
  }
}
