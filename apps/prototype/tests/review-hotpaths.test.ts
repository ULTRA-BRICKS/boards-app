import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { fixture, actor } from "./accounts-fixture";
import { CorporateAuth } from "../accounts/auth";
import { WorkspaceService } from "../accounts/service";
import { NotificationWorker } from "../accounts/notifications";
import type { Database } from "../accounts/database";
const now = Date.parse("2026-09-16T09:00:00Z");
function metered(db: Database, calls: string[]): Database {
  return {
    async query<T>(sql: string, args?: unknown[]) {
      calls.push(sql);
      return db.query<T>(sql, args);
    },
    transaction: (run) => db.transaction((tx) => run(metered(tx, calls))),
  };
}
test("Throttled requests persist both limiter counters without sending an OTP", async () => {
  const f = await fixture();
  let messages = 0;
  try {
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    await f.db.query(
      "INSERT INTO boards_accounts.rate_limits(key,count,expires_at) VALUES($1,20,$2)",
      [hash("network:limited"), new Date(now + 3600000).toISOString()],
    );
    const auth = new CorporateAuth(
      f.db,
      {
        domains: ["corp.test"],
        ownerEmail: actor.email,
        pepper: "fixture-pepper-".repeat(4),
        from: "mail@corp.test",
      },
      async () => {
        messages++;
        return "fixture";
      },
      () => now,
    );
    for (let i = 0; i < 3; i++)
      await expect(auth.challenge(actor.email, "limited")).rejects.toThrow("TRY_LATER");
    expect(messages).toBe(0);
    expect((await f.db.query("SELECT id FROM boards_accounts.email_challenges")).rows).toHaveLength(
      0,
    );
    const email = await f.db.query("SELECT count FROM boards_accounts.rate_limits WHERE key=$1", [
      hash("email:" + actor.email),
    ]);
    expect(email.rows[0]?.count).toBe(3);
    const network = await f.db.query("SELECT count FROM boards_accounts.rate_limits WHERE key=$1", [
      hash("network:limited"),
    ]);
    expect(network.rows[0].count).toBe(23);
  } finally {
    await f.pg.close();
  }
});
test("Forty simultaneous assignments require at most nine SQL calls and preserve all audit events", async () => {
  const f = await fixture();
  try {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: "bulk-" + i,
      text: "Task " + i,
      done: false,
      assignees: [],
      tag: "",
    }));
    f.document.boards[0].columns[1].items = items;
    await f.db.query("UPDATE boards_accounts.spaces SET document=$2::jsonb WHERE id=$1", [
      "space-one",
      JSON.stringify(f.document),
    ]);
    const next = structuredClone(f.document);
    next.boards[0].columns[1].items.forEach((item: any) => (item.assignees = ["danny"]));
    const calls: string[] = [];
    await new WorkspaceService(metered(f.db, calls), () => now).save(actor, "space-one", 1, next);
    expect(
      (await f.db.query("SELECT id FROM boards_accounts.history WHERE space_id=$1", ["space-one"]))
        .rows,
    ).toHaveLength(40);
    const batches = (
      await f.db.query("SELECT events FROM boards_accounts.batches WHERE state='pending'")
    ).rows;
    expect(batches).toHaveLength(1);
    expect(batches[0].events).toHaveLength(40);
    expect(calls.length).toBeLessThanOrEqual(9);
  } finally {
    await f.pg.close();
  }
});
test("Weekly enqueue uses two SQL calls independent of recipient count", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 30; i++) {
      await f.db.query(
        "INSERT INTO boards_accounts.users(id,email,name,verified) VALUES($1,$2,$3,true)",
        ["digest-" + i, "digest-" + i + "@corp.test", "Recipient " + i],
      );
      await f.db.query(
        "INSERT INTO boards_accounts.members(space_id,account_id,person_id,role) VALUES('space-one',$1,$1,'member')",
        ["digest-" + i],
      );
    }
    const calls: string[] = [];
    const worker = new NotificationWorker(
      metered(f.db, calls),
      { from: "mail@corp.test", origin: "https://boards.example", key: "fixture" },
      () => now,
      async () => "fixture",
    );
    expect(await worker.enqueueWeekly()).toBe(33);
    expect(calls.length).toBeLessThanOrEqual(2);
    calls.length = 0;
    expect(await worker.enqueueWeekly()).toBe(0);
    expect(calls.length).toBeLessThanOrEqual(2);
  } finally {
    await f.pg.close();
  }
});
test("A notification-write failure rolls back the bulk audit and the board together", async () => {
  const f = await fixture();
  try {
    const faulty = (db: Database): Database => ({
      async query<T>(sql: string, args?: unknown[]) {
        if (sql.includes("INSERT INTO boards_accounts.batches"))
          throw Error("Injected outbox storage failure");
        return db.query<T>(sql, args);
      },
      transaction: (run) => db.transaction((tx) => run(faulty(tx))),
    });
    const next = structuredClone(f.document);
    next.boards[0].columns[1].items[1].assignees = ["danny"];
    await expect(
      new WorkspaceService(faulty(f.db), () => now).save(actor, "space-one", 1, next),
    ).rejects.toThrow("Injected outbox");
    expect((await f.db.query("SELECT id FROM boards_accounts.history")).rows).toHaveLength(0);
    expect((await f.db.query("SELECT id FROM boards_accounts.batches")).rows).toHaveLength(0);
    const state = await new WorkspaceService(f.db).read(actor, "space-one");
    expect(state.version).toBe(1);
    expect(state.value.boards[0].columns[1].items[1].assignees).toHaveLength(0);
  } finally {
    await f.pg.close();
  }
});
