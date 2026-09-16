import { test, expect } from "bun:test";
import { fixture } from "./accounts-fixture";
import { NotificationWorker } from "../accounts/notifications";
test("Mail worker stops before leasing another job when its execution budget is nearly spent", async () => {
  const f = await fixture(),
    now = Date.parse("2026-09-16T09:00:00Z");
  let elapsed = 0,
    sends = 0;
  try {
    f.document.boards[0].columns[1].items[1].assignees = ["danny"];
    await f.db.query("UPDATE boards_accounts.spaces SET document=$2::jsonb WHERE id=$1", [
      "space-one",
      JSON.stringify(f.document),
    ]);
    for (let i = 0; i < 3; i++)
      await f.db.query(
        "INSERT INTO boards_accounts.batches(id,space_id,recipient_id,kind,events,due_at) VALUES($1,'space-one','recipient','assignment',$2::jsonb,$3)",
        [
          "budget-" + i,
          JSON.stringify([
            { boardId: "roadmap", itemId: "p2", actorId: "actor", personId: "danny" },
          ]),
          new Date(now - 1000).toISOString(),
        ],
      );
    const worker = new NotificationWorker(
      f.db,
      { from: "mail@corp.test", origin: "https://boards.example", key: "fixture" },
      () => now,
      async () => {
        sends++;
        elapsed += 12000;
        return "sent-" + sends;
      },
      () => elapsed,
    );
    expect(await worker.run(20, 25000)).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(sends).toBe(1);
    expect(
      (await f.db.query("SELECT id FROM boards_accounts.batches WHERE state='pending'")).rows,
    ).toHaveLength(2);
  } finally {
    await f.pg.close();
  }
});
