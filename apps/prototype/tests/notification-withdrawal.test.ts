import { test, expect } from "bun:test";
import { fixture, actor, other } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { NotificationWorker } from "../accounts/notifications";
test("Other-assignment withdrawn before a self-assignment does not notify the user about their own action", async () => {
  const f = await fixture();
  let now = Date.parse("2026-09-15T12:00:00Z");
  const service = new WorkspaceService(f.db, () => now);
  try {
    for (const [who, people] of [
      [actor, ["danny"]],
      [actor, []],
      [other, ["danny"]],
    ] as const) {
      const r = await service.read(who, "space-one");
      r.value.boards[0].columns[1].items[1].assignees = [...people];
      await service.save(who, "space-one", r.version, r.value);
    }
    now += 300000;
    let sends = 0;
    await new NotificationWorker(
      f.db,
      { from: "mail@corp.test", origin: "https://boards.test", key: "fixture" },
      () => now,
      async () => {
        sends++;
        return "mail";
      },
    ).run();
    expect(sends).toBe(0);
  } finally {
    await f.pg.close();
  }
});
