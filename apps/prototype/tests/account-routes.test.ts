import { test, expect, beforeAll, afterAll } from "bun:test";
import { fixture } from "./accounts-fixture";
import { CorporateAuth } from "../accounts/auth";
import { WorkspaceService } from "../accounts/service";
import { NotificationWorker } from "../accounts/notifications";
import { accountRoutes } from "../accounts/routes";
let f: Awaited<ReturnType<typeof fixture>>,
  handler: ReturnType<typeof accountRoutes>,
  cookie = "",
  code = "",
  challenge = "";
const origin = "https://boards.example";
beforeAll(async () => {
  f = await fixture();
  const auth = new CorporateAuth(
    f.db,
    {
      domains: ["corp.test"],
      ownerEmail: "owner@corp.test",
      pepper: "test-only-".repeat(8),
      from: "Boards <mail@corp.test>",
    },
    async (mail) => {
      code = /code: (\d{6})/.exec(mail.text)![1];
      return "test-message";
    },
  );
  handler = accountRoutes({
    auth,
    service: new WorkspaceService(f.db),
    worker: new NotificationWorker(
      f.db,
      { key: "fixture", from: "mail@corp.test", origin },
      Date.now,
      async () => "fixture",
    ),
    origin,
    cronSecret: "test-cron-".repeat(6),
  });
});
afterAll(async () => {
  await f.pg.close();
});
const call = (path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  handler(
    new Request(origin + "/accounts/" + path, {
      method,
      headers: {
        Origin: origin,
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
test("Missing infrastructure fails closed without seeding test users", async () => {
  const r = await accountRoutes(null)(
    new Request(origin + "/accounts/auth/start", { method: "POST" }),
  );
  expect(r.status).toBe(503);
});
test("Anonymous callers cannot query private spaces or profile", async () => {
  expect((await call("spaces")).status).toBe(401);
  expect((await call("profile")).status).toBe(401);
});
test("Untrusted origin cannot request login or mutation", async () => {
  expect(
    (
      await call(
        "auth/start",
        "POST",
        { email: "owner@corp.test" },
        { Origin: "https://evil.example" },
      )
    ).status,
  ).toBe(403);
});
test("HTTP corporate code verification issues a protected session cookie", async () => {
  challenge = (await (await call("auth/start", "POST", { email: "owner@corp.test" })).json())
    .challengeId;
  const response = await call("auth/verify", "POST", { challengeId: challenge, code });
  expect(response.status).toBe(200);
  const value = response.headers.get("set-cookie")!;
  expect(value).toContain("HttpOnly");
  expect(value).toContain("Secure");
  expect(value).toContain("SameSite=Lax");
  cookie = value.split(";")[0];
  expect((await (await call("session")).json()).user.id).toBe("actor");
});
test("Space listing is membership-scoped and profile edit persists", async () => {
  expect((await (await call("spaces")).json()).spaces.map((s: any) => s.id)).toEqual(["space-one"]);
  expect((await call("profile", "PUT", { name: "Updated Profile" })).status).toBe(200);
  expect((await (await call("profile")).json()).profile.name).toBe("Updated Profile");
  expect((await call("spaces/space-other")).status).toBe(403);
});
test("Create a space with a valid initial empty page and owner membership", async () => {
  const r = await call("spaces", "POST", {
    name: "New space",
    domains: ["corp.test"],
    timeZone: "Europe/Belgrade",
  });
  expect(r.status).toBe(201);
  const space = (await r.json()).id;
  const read = await (await call("spaces/" + space)).json();
  expect(read.value.boards).toHaveLength(1);
  expect(read.value.boards[0].columns).toHaveLength(0);
  expect((await (await call("spaces/" + space + "/settings")).json()).role).toBe("owner");
});
