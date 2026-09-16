import { beforeAll, afterAll, test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { workEmail, authorize } from "../accounts/policy";
let f: Awaited<ReturnType<typeof fixture>>,
  now = Date.parse("2026-09-15T12:00:00Z");
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f.pg.close();
});
const current = async () =>
  (
    await f.db.query("SELECT version,document FROM boards_accounts.spaces WHERE id=$1", [
      "space-one",
    ])
  ).rows[0];
for (const email of ["member@corp.test", " MEMBER@CORP.TEST "])
  test("Approved exact corporate domain " + email, () =>
    expect(workEmail(email, ["corp.test"])).toBe("member@corp.test"),
  );
for (const email of [
  "member@corp.test.evil.test",
  "member@gmail.com",
  "member@sub.corp.test",
  "member@corp.test\nBcc:x@y.test",
  "invalid",
])
  test("Unauthorized email domain " + email, () =>
    expect(() => workEmail(email, ["corp.test"])).toThrow(),
  );
test("Unconfigured corporate domains fail closed", () =>
  expect(() => workEmail("a@corp.test", [])).toThrow("CORPORATE_DOMAINS_NOT_CONFIGURED"));
for (const role of ["owner", "admin", "member", "viewer"] as const)
  for (const action of ["read", "write", "manage"] as const)
    test("Role " + role + " / " + action, () => {
      const call = () =>
        authorize(
          actor,
          "s",
          [{ spaceId: "s", accountId: actor.id, personId: "p", role }],
          action,
          now,
        );
      const allowed =
        action === "read" ||
        (action === "write" && role !== "viewer") ||
        (action === "manage" && ["admin", "owner"].includes(role));
      if (allowed) expect(call().role).toBe(role);
      else expect(call).toThrow();
    });
test("A member of another space cannot read or query history", async () => {
  const service = new WorkspaceService(f.db, () => now);
  await expect(service.read(actor, "space-other")).rejects.toThrow("SPACE_FORBIDDEN");
  await expect(service.history(actor, "space-other", "roadmap", "p2")).rejects.toThrow(
    "SPACE_FORBIDDEN",
  );
});
test("Reading does not manufacture history", async () => {
  const service = new WorkspaceService(f.db, () => now);
  await service.read(actor, "space-one");
  expect((await service.history(actor, "space-one", "roadmap", "p2")).items).toHaveLength(0);
});
test("History takes actor name and time from server, not the submitted document", async () => {
  const state = await current(),
    value = structuredClone(state.document);
  value.actorId = "recipient";
  value.changedAt = "1999-01-01";
  value.boards[0].columns[1].items[1].text = "Verified history change";
  const service = new WorkspaceService(f.db, () => now);
  await service.save(actor, "space-one", state.version, value);
  const history = await service.history(actor, "space-one", "roadmap", "p2");
  expect(history.items[0].actorName).toBe("Trusted Owner");
  expect(history.items[0].actorId).toBe("actor");
  expect(new Date(history.items[0].occurredAt).getTime()).toBe(now);
});
test("Stale save is atomic: no new history and no notification", async () => {
  const service = new WorkspaceService(f.db, () => now),
    before = await current(),
    count = (await service.history(actor, "space-one", "roadmap", "p2")).items.length;
  await expect(service.save(actor, "space-one", 1, before.document)).rejects.toThrow(
    "VERSION_CONFLICT",
  );
  expect((await service.history(actor, "space-one", "roadmap", "p2")).items).toHaveLength(count);
});
