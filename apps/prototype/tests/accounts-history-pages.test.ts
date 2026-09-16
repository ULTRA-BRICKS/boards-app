import { test, expect } from "bun:test";
import { fixture, actor, other } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
test("History pagination is complete, ordered and never crosses item or space boundaries", async () => {
  const f = await fixture();
  let now = Date.parse("2026-09-15T12:00:00Z");
  try {
    const service = new WorkspaceService(f.db, () => now);
    let record = await service.read(actor, "space-one");
    for (let n = 0; n < 35; n++) {
      record.value.boards[0].columns[1].items[1].text = "Revision " + n;
      now += 1000;
      record = await service.save(actor, "space-one", record.version, record.value);
    }
    const first = await service.history(actor, "space-one", "roadmap", "p2"),
      next = await service.history(actor, "space-one", "roadmap", "p2", first.nextCursor!);
    expect(first.items).toHaveLength(30);
    expect(next.items).toHaveLength(5);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...first.items, ...next.items].map((row) => row.id)).size).toBe(35);
    expect(first.items[0].changes.after.text).toBe("Revision 34");
    expect(next.items.at(-1).changes.after.text).toBe("Revision 0");
    expect((await service.history(actor, "space-one", "roadmap", "p1")).items).toHaveLength(0);
    await expect(service.history(actor, "space-other", "roadmap", "p2")).rejects.toThrow(
      "SPACE_FORBIDDEN",
    );
  } finally {
    await f.pg.close();
  }
});
test("Viewer writes fail before changing content, audit rows or assignment email batches", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "UPDATE boards_accounts.members SET role='viewer' WHERE account_id='recipient'",
    );
    const service = new WorkspaceService(f.db),
      record = await service.read(other, "space-one");
    record.value.boards[0].columns[1].items[1].text = "Forbidden write";
    await expect(service.save(other, "space-one", record.version, record.value)).rejects.toThrow(
      "SPACE_FORBIDDEN",
    );
    expect((await service.read(actor, "space-one")).version).toBe(1);
    expect((await service.history(actor, "space-one", "roadmap", "p2")).items).toHaveLength(0);
    expect((await f.db.query("SELECT id FROM boards_accounts.batches")).rows).toHaveLength(0);
  } finally {
    await f.pg.close();
  }
});
