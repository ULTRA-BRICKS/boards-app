import { randomBytes, randomInt, createHmac, createHash, timingSafeEqual } from "node:crypto";
import { first, type Database } from "./database";
import { workEmail, normalizeEmail, AccessError, type Identity } from "./policy";
import type { Mail } from "./mail";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export class CorporateAuth {
  constructor(
    readonly db: Database,
    readonly config: { domains: string[]; ownerEmail: string; pepper: string; from: string },
    readonly send: (mail: Mail, id: string) => Promise<string>,
    readonly now = () => Date.now(),
  ) {}
  private proof(id: string, code: string) {
    if (this.config.pepper.length < 32) throw new AccessError("AUTH_NOT_CONFIGURED", 503);
    return createHmac("sha256", this.config.pepper)
      .update(id + ":" + code)
      .digest("hex");
  }
  async challenge(rawEmail: unknown, ip: string) {
    const email = workEmail(rawEmail, this.config.domains),
      now = this.now(),
      id = randomBytes(24).toString("base64url"),
      code = String(randomInt(100000, 1000000));
    const proof = this.proof(id, code);
    // Persist rejected attempts as well; no email/code creation occurs on a blocked request.
    const blocked = await this.db.transaction(async (db) => {
      let blocked = false;
      for (const [suffix, max] of [
        ["email:" + email, 3],
        ["network:" + ip, 20],
      ] as const) {
        const key = hash(suffix),
          limit = await first(
            db,
            "INSERT INTO boards_accounts.rate_limits(key,count,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN boards_accounts.rate_limits.expires_at<=$3 THEN 1 ELSE boards_accounts.rate_limits.count+1 END,expires_at=CASE WHEN boards_accounts.rate_limits.expires_at<=$3 THEN excluded.expires_at ELSE boards_accounts.rate_limits.expires_at END RETURNING count",
            [key, new Date(now + 3600000).toISOString(), new Date(now).toISOString()],
          );
        if (limit.count > max) blocked = true;
      }
      return blocked;
    });
    if (blocked) throw new AccessError("TRY_LATER", 429);
    const eligible = await this.db.transaction(async (db) => {
      const user = await first(db, "SELECT id FROM boards_accounts.users WHERE email=$1", [email]),
        invite = await first(
          db,
          "SELECT space_id FROM boards_accounts.invites WHERE email=$1 LIMIT 1",
          [email],
        );
      if (!user && !invite && email !== this.config.ownerEmail.toLowerCase()) return false;
      await db.query(
        "UPDATE boards_accounts.email_challenges SET consumed_at=$2 WHERE email=$1 AND consumed_at IS NULL",
        [email, new Date(now).toISOString()],
      );
      await db.query(
        "INSERT INTO boards_accounts.email_challenges(id,email,proof,expires_at) VALUES($1,$2,$3,$4)",
        [id, email, proof, new Date(now + 600000).toISOString()],
      );
      return true;
    });
    if (eligible)
      await this.send(
        {
          from: this.config.from,
          to: [email],
          subject: "Your Boards sign-in code",
          text: `Your sign-in code: ${code}\n\nThis code expires in 10 minutes. Do not forward it. Ignore this message if you did not request it.`,
          html: "",
        },
        "login/" + id,
      );
    return {
      challengeId: id,
      message: "If this address has access, a sign-in code has been sent.",
    };
  }
  async verify(id: unknown, rawCode: unknown) {
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9_-]{32}$/.test(id) ||
      typeof rawCode !== "string" ||
      !/^\d{6}$/.test(rawCode)
    )
      throw new AccessError("INVALID_CODE", 400);
    const now = this.now(),
      rawSession = randomBytes(32).toString("base64url");
    const result = await this.db.transaction(async (db) => {
      const challenge = await first(
        db,
        "SELECT * FROM boards_accounts.email_challenges WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (
        !challenge ||
        challenge.consumed_at ||
        new Date(challenge.expires_at).getTime() <= now ||
        challenge.attempts >= 5
      )
        return { invalid: true };
      const expected = Buffer.from(this.proof(id, rawCode)),
        stored = Buffer.from(challenge.proof);
      await db.query(
        "UPDATE boards_accounts.email_challenges SET attempts=attempts+1 WHERE id=$1",
        [id],
      );
      if (expected.length !== stored.length || !timingSafeEqual(expected, stored))
        return { invalid: true };
      workEmail(challenge.email, this.config.domains);
      await db.query("UPDATE boards_accounts.email_challenges SET consumed_at=$2 WHERE id=$1", [
        id,
        new Date(now).toISOString(),
      ]);
      const account = await first(
        db,
        "INSERT INTO boards_accounts.users(id,email,name,verified) VALUES($1,$2,$3,true) ON CONFLICT(email) DO UPDATE SET verified=true RETURNING id,email,name",
        [crypto.randomUUID(), normalizeEmail(challenge.email), challenge.email.split("@")[0]],
      );
      const invites = (
        await db.query(
          "SELECT i.* FROM boards_accounts.invites i JOIN boards_accounts.spaces s ON s.id=i.space_id WHERE i.email=$1",
          [account.email],
        )
      ).rows;
      for (const invite of invites) {
        const space = await first(
          db,
          "SELECT allowed_domains FROM boards_accounts.spaces WHERE id=$1",
          [invite.space_id],
        );
        try {
          workEmail(account.email, space.allowed_domains);
        } catch {
          continue;
        }
        await db.query(
          "INSERT INTO boards_accounts.members(space_id,account_id,person_id,role) VALUES($1,$2,$3,$4) ON CONFLICT(space_id,account_id) DO NOTHING",
          [invite.space_id, account.id, invite.person_id, invite.role],
        );
      }
      const expiresAt = now + 7 * 86400000;
      await db.query(
        "INSERT INTO boards_accounts.sessions(hash,account_id,expires_at) VALUES($1,$2,$3)",
        [hash(rawSession), account.id, new Date(expiresAt).toISOString()],
      );
      return { invalid: false, identity: { ...account, verified: true, expiresAt } };
    });
    if (result.invalid) throw new AccessError("INVALID_CODE", 401);
    return { identity: result.identity!, session: rawSession };
  }
  async session(raw: string | undefined): Promise<Identity | null> {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
    const row = await first(
      this.db,
      "SELECT u.id,u.email,u.name,u.verified,s.expires_at FROM boards_accounts.sessions s JOIN boards_accounts.users u ON u.id=s.account_id WHERE s.hash=$1 AND s.expires_at>$2 AND u.verified=true",
      [hash(raw), new Date(this.now()).toISOString()],
    );
    return row
      ? {
          id: row.id,
          email: row.email,
          name: row.name,
          verified: true,
          expiresAt: new Date(row.expires_at).getTime(),
        }
      : null;
  }
  async logout(raw: string | undefined) {
    if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw))
      await this.db.query("UPDATE boards_accounts.sessions SET expires_at=$2 WHERE hash=$1", [
        hash(raw),
        new Date(this.now()).toISOString(),
      ]);
  }
}
