import { beforeAll, afterAll, test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { NotificationWorker } from "../accounts/notifications";
let f: Awaited<ReturnType<typeof fixture>>,
  now = Date.parse("2026-09-15T12:00:00Z");
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f.pg.close();
});
const config = {
  from: "Boards <mail@corp.test>",
  origin: "https://boards.example",
  key: "fixture-not-a-secret",
};
async function assign(id: string, assignees: string[]) {
  const r = (
    await f.db.query("SELECT version,document FROM boards_accounts.spaces WHERE id=$1", [
      "space-one",
    ])
  ).rows[0];
  r.document.boards[0].columns[1].items.find((t: any) => t.id === id).assignees = assignees;
  return new WorkspaceService(f.db, () => now).save(actor, "space-one", r.version, r.document);
}
const batches = async () =>
  (
    await f.db.query(
      "SELECT * FROM boards_accounts.batches WHERE kind='assignment' ORDER BY created_at,id",
    )
  ).rows;
test("Self-assignment sends nothing", async () => {
  await assign("p1", ["niko"]);
  expect(await batches()).toHaveLength(0);
});
test("First other-assignment opens exactly a five-minute window", async () => {
  await assign("p2", ["danny"]);
  const rows = await batches();
  expect(rows).toHaveLength(1);
  expect(new Date(rows[0].due_at).getTime()).toBe(now + 300000);
});
test("More assignments aggregate without extending the window", async () => {
  now += 120000;
  await assign("p3", ["danny"]);
  const rows = await batches();
  expect(rows).toHaveLength(1);
  expect(rows[0].events).toHaveLength(2);
  expect(new Date(rows[0].due_at).getTime()).toBe(now + 180000);
});
test("Unrelated saves do not create duplicate assignment events", async () => {
  await assign("p3", ["danny"]);
  expect((await batches())[0].events).toHaveLength(2);
});
test("No delivery before five minutes", async () => {
  let sends = 0;
  const worker = new NotificationWorker(
    f.db,
    config,
    () => now,
    async () => {
      sends++;
      return "mail";
    },
  );
  expect(await worker.run()).toEqual({ sent: 0, skipped: 0, failed: 0 });
  expect(sends).toBe(0);
});
test("Unassigned-before-delivery item is removed from the aggregate", async () => {
  await assign("p2", []);
  now += 180000;
  let mail: any;
  const worker = new NotificationWorker(
    f.db,
    config,
    () => now,
    async (value) => {
      mail = value;
      return "delivered-1";
    },
  );
  expect((await worker.run()).sent).toBe(1);
  expect(mail.to).toEqual(["member@corp.test"]);
  expect(mail.text).toContain("Test and improve onboarding");
  expect(mail.text).not.toContain("Finish and test billing");
  expect(mail.text).not.toContain("#key=");
});
test("Two workers cannot deliver the same leased batch", async () => {
  await assign("p4", ["danny"]);
  now += 300000;
  let finish: (id: string) => void = () => {},
    started: () => void = () => {};
  const ready = new Promise<void>((resolve) => (started = resolve));
  const one = new NotificationWorker(
    f.db,
    config,
    () => now,
    async () => {
      started();
      return new Promise((resolve) => (finish = resolve));
    },
  );
  const first = one.run(1);
  await ready;
  const two = new NotificationWorker(
    f.db,
    config,
    () => now,
    async () => {
      throw Error("Duplicate send");
    },
  );
  expect(await two.run()).toEqual({ sent: 0, skipped: 0, failed: 0 });
  finish("delivered-2");
  expect((await first).sent).toBe(1);
});
test("Retry after an ambiguous network result preserves payload and idempotency key", async () => {
  await assign("p2", ["danny"]);
  now += 300000;
  const calls: any[] = [];
  let succeeds = false;
  const worker = new NotificationWorker(
    f.db,
    config,
    () => now,
    async (mail, id) => {
      calls.push({ mail, id });
      if (!succeeds) throw Error("Lost provider response");
      return "delivered-3";
    },
  );
  expect((await worker.run(1)).failed).toBe(1);
  now += 120000;
  succeeds = true;
  expect((await worker.run(1)).sent).toBe(1);
  expect(calls[1]).toEqual(calls[0]);
});
test("A retry beyond Resend deduplication retention is held, never resent blindly", async () => {
  await assign("p2", []);
  await assign("p2", ["danny"]);
  now += 300000;
  const worker = new NotificationWorker(
    f.db,
    config,
    () => now,
    async () => {
      throw Error("Unknown delivery result");
    },
  );
  await worker.run(1);
  now += 24 * 3600000;
  let calls = 0;
  const recovery = new NotificationWorker(
    f.db,
    config,
    () => now,
    async () => {
      calls++;
      return "duplicate";
    },
  );
  await recovery.run();
  expect(calls).toBe(0);
  expect((await batches()).some((b) => b.state === "held")).toBe(true);
});
test("Notification preferences are checked at delivery, not just assignment", async () => {
  await assign("p2", []);
  await assign("p2", ["danny"]);
  await f.db.query("UPDATE boards_accounts.members SET assignment_mail=false WHERE account_id=$1", [
    "recipient",
  ]);
  now += 300000;
  let calls = 0;
  expect(
    (
      await new NotificationWorker(
        f.db,
        config,
        () => now,
        async () => {
          calls++;
          return "bad";
        },
      ).run()
    ).skipped,
  ).toBe(1);
  expect(calls).toBe(0);
});
test("Weekly digest is deduplicated per space/person/period across repeated ticks", async () => {
  const worker = new NotificationWorker(
    f.db,
    config,
    () => now,
    async () => "weekly",
  );
  const first = await worker.enqueueWeekly(),
    second = await worker.enqueueWeekly();
  expect(first).toBe(3);
  expect(second).toBe(0);
  expect(
    (await f.db.query("SELECT * FROM boards_accounts.batches WHERE kind='weekly'")).rows,
  ).toHaveLength(3);
});
