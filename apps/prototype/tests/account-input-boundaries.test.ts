import { test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { WorkspaceService } from "../accounts/service";
import { CorporateAuth } from "../accounts/auth";
import { NotificationWorker } from "../accounts/notifications";
import { accountRoutes } from "../accounts/routes";
test("Malformed JSON shapes fail with 400, not an internal error", async () => {
  const f = await fixture(),
    origin = "https://boards.example";
  try {
    const auth = new CorporateAuth(
      f.db,
      {
        domains: ["corp.test"],
        ownerEmail: actor.email,
        pepper: "fixture-".repeat(8),
        from: "mail@corp.test",
      },
      async () => {
        throw Error("Must not send");
      },
    );
    const handler = accountRoutes({
      auth,
      service: new WorkspaceService(f.db),
      worker: new NotificationWorker(f.db, { key: "fixture", origin, from: "mail@corp.test" }),
      origin,
      cronSecret: "",
    });
    for (const value of [null, [], true, 42, "text"]) {
      const response = await handler(
        new Request(origin + "/accounts/auth/start", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        }),
      );
      expect(response.status).toBe(400);
    }
  } finally {
    await f.pg.close();
  }
});
test("Space creation rejects invalid domains and normalizes valid ones like settings", async () => {
  const f = await fixture();
  try {
    const service = new WorkspaceService(f.db);
    for (const domains of [["corp.test", "BAD!!"], null, 42, "corp.test"])
      await expect(service.create(actor, { name: "Space", domains } as any)).rejects.toThrow(
        "INVALID_DOMAINS",
      );
    const created = await service.create(actor, {
      name: "Space",
      domains: [" CORP.TEST ", "corp.test"],
    });
    expect((await service.getSettings(actor, created.id)).allowedDomains).toEqual(["corp.test"]);
  } finally {
    await f.pg.close();
  }
});
test("Non-string names and absent domain arrays have user-correctable validation errors", async () => {
  const f = await fixture();
  try {
    const service = new WorkspaceService(f.db);
    await expect(
      service.create(actor, { name: 42, domains: ["corp.test"] } as any),
    ).rejects.toThrow("INVALID_NAME");
    await expect(service.profile(actor, { name: 42 } as any)).rejects.toThrow("INVALID_PROFILE");
    await expect(
      service.settings(actor, "space-one", {
        name: "Space",
        allowedDomains: null,
        timeZone: "UTC",
      } as any),
    ).rejects.toThrow("INVALID_DOMAINS");
  } finally {
    await f.pg.close();
  }
});
