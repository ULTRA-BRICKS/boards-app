import { test, expect } from "bun:test";
import { fixture, actor } from "./accounts-fixture";
import { CorporateAuth } from "../accounts/auth";
import { WorkspaceService } from "../accounts/service";
import { NotificationWorker } from "../accounts/notifications";
import { accountRoutes } from "../accounts/routes";
test("Oversized JSON stream is cancelled before buffering the complete upload", async () => {
  const f = await fixture();
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
    const origin = "https://boards.example",
      route = accountRoutes({
        auth,
        service: new WorkspaceService(f.db),
        worker: new NotificationWorker(f.db, { origin, from: "mail@corp.test", key: "fixture" }),
        origin,
        cronSecret: "",
      });
    let generated = 0,
      cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (generated === 12) return controller.close();
        generated++;
        controller.enqueue(new Uint8Array(1_000_000).fill(120));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await route(
      new Request(origin + "/accounts/auth/start", {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(generated).toBeLessThan(12);
  } finally {
    await f.pg.close();
  }
});
test("An unauthorized board save never examines the submitted boards", async () => {
  const f = await fixture();
  try {
    let touched = 0;
    const candidate = {
      ...f.document,
      get boards() {
        touched++;
        throw Error("Unexpected document traversal");
      },
    };
    await expect(
      new WorkspaceService(f.db).save(actor, "space-other", 1, candidate),
    ).rejects.toThrow("SPACE_FORBIDDEN");
    expect(touched).toBe(0);
  } finally {
    await f.pg.close();
  }
});
test("Authorized board content is validated once against the real server directory", async () => {
  const f = await fixture();
  try {
    let reads = 0;
    const candidate = {
      ...f.document,
      get boards() {
        reads++;
        return f.document.boards;
      },
    };
    const result = await new WorkspaceService(f.db).save(actor, "space-one", 1, candidate);
    expect(result.version).toBe(2);
    expect(reads).toBe(1);
  } finally {
    await f.pg.close();
  }
});
