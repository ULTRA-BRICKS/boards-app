import { test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import type { Database } from "../accounts/database";
test("Explicitly inviting a directory person fills an empty email without changing their name or identity", async () => {
  const f = await fixture();
  try {
    const service = new WorkspaceService(f.db),
      before = await service.read(actor, "space-one"),
      person = before.value.people.find((p: any) => p.id === "mariam");
    expect(person.email).toBe("");
    await service.invite(actor, "space-one", {
      email: "new@corp.test",
      name: "Invitation name",
      role: "member",
      personId: person.id,
    });
    const after = await service.read(actor, "space-one"),
      updated = after.value.people.find((p: any) => p.id === person.id);
    expect(updated.email).toBe("new@corp.test");
    expect(updated.name).toBe(person.name);
    expect(updated.avatar).toBe(person.avatar);
    expect(after.version).toBe(before.version + 1);
    expect(
      (await service.people(actor, "space-one")).some((p: any) => p.email === "new@corp.test"),
    ).toBe(false);
  } finally {
    await f.pg.close();
  }
});
test("An assignment change does not lock unrelated outbox batches", async () => {
  const f = await fixture(),
    now = Date.parse("2026-09-16T12:00:00Z");
  try {
    for (let i = 0; i < 12; i++)
      await f.db.query(
        "INSERT INTO boards_accounts.batches(id,space_id,recipient_id,kind,events,due_at) VALUES($1,'space-one','actor','assignment',$2::jsonb,$3)",
        [
          "unrelated-" + i,
          JSON.stringify([
            {
              boardId: "roadmap",
              itemId: "p4",
              personId: "niko",
              actorId: "recipient",
              historyId: "1",
            },
          ]),
          new Date(now + 300000).toISOString(),
        ],
      );
    let locked = 0;
    const meter = (db: Database): Database => ({
      async query<T>(sql: string, values?: unknown[]) {
        const r = await db.query<T>(sql, values);
        if (sql.includes("FROM boards_accounts.batches") && sql.includes("FOR UPDATE"))
          locked += r.rows.length;
        return r;
      },
      transaction: (run) => db.transaction((tx) => run(meter(tx))),
    });
    const input = structuredClone(f.document);
    input.boards[0].columns[1].items[1].assignees = ["danny"];
    await new WorkspaceService(meter(f.db), () => now).save(actor, "space-one", 1, input);
    expect(locked).toBe(0);
    expect(
      (
        await f.db.query(
          "SELECT id FROM boards_accounts.batches WHERE recipient_id='actor' AND state='pending'",
        )
      ).rows,
    ).toHaveLength(12);
  } finally {
    await f.pg.close();
  }
});
test("Withdrawal matching can use the partial GIN index instead of a per-row correlated subquery", async () => {
  const f = await fixture();
  try {
    await f.db.transaction(async (db) => {
      await db.query(
        "INSERT INTO boards_accounts.batches(id,space_id,recipient_id,kind,events,due_at) SELECT 'planner-'||n,'space-one','recipient','assignment',jsonb_build_array(jsonb_build_object('boardId','roadmap','itemId','p'||n,'personId','danny')),now() FROM generate_series(1,2000) n",
      );
      await db.query("SELECT gin_clean_pending_list('boards_accounts.batches_pending_event_keys')");
      await db.query("ANALYZE boards_accounts.batches");
      const plan = await db.query(
        "EXPLAIN (FORMAT JSON) SELECT * FROM boards_accounts.batches WHERE space_id=$1 AND kind='assignment' AND state='pending' AND payload IS NULL AND events @> ANY($2::jsonb[])",
        ["space-one", [JSON.stringify([{ boardId: "roadmap", itemId: "p2", personId: "danny" }])]],
      );
      expect(JSON.stringify(plan.rows)).toContain("batches_pending_event_keys");
    });
  } finally {
    await f.pg.close();
  }
});
