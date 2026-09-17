import { test, expect, spyOn, afterEach } from "bun:test";
import { cloudJSON, hasUnsaved, pageTitle } from "../lib/cloud";
import { journal } from "../lib/diagnostics";
let fetchSpy: ReturnType<typeof spyOn> | undefined;
afterEach(() => fetchSpy?.mockRestore());
test("Connection without edits is not an unsaved draft", () => {
  expect(hasUnsaved()).toBe(false);
  expect(hasUnsaved({ sequence: 0, ack: 0 })).toBe(false);
  expect(hasUnsaved({ sequence: 1, ack: 1 })).toBe(false);
  expect(hasUnsaved({ sequence: 2, ack: 1 })).toBe(true);
});
for (const name of ["", null, undefined, "Заметки", "Release notes", "<script>"])
  test("Title includes service for " + name, () => {
    expect(pageTitle(name)).toEndWith(" | Boards");
  });
test("Logs use a bounded allowlist instead of request data", () => {
  const log = journal(3);
  for (let i = 0; i < 9; i++)
    log.record("request.failed", {
      operation: "auth",
      code: "NETWORK",
      ms: i,
      key: "SECRET",
      text: "PRIVATE",
      url: "https://secret.example/#key=SECRET",
    });
  expect(log.snapshot()).toHaveLength(3);
  expect(JSON.stringify(log.snapshot())).not.toContain("SECRET");
  expect(JSON.stringify(log.snapshot())).not.toContain("PRIVATE");
  log.record("PRIVATE_EVENT");
  expect(log.snapshot()).toHaveLength(3);
});
test("Unknown metadata cannot inject text into the log", () => {
  const log = journal();
  log.record("request.failed", { operation: "SECRET", code: "PRIVATE", status: 999, ms: NaN });
  const row = log.snapshot()[0];
  expect(row.operation).toBeUndefined();
  expect(row.code).toBeUndefined();
  expect(row.status).toBeUndefined();
  expect(row.ms).toBeUndefined();
});
test("Generic Safari Load failed becomes structured NETWORK, without automatic write retry", async () => {
  let calls = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    throw new TypeError("Load failed secret");
  });
  await expect(
    cloudJSON("/cloud/rpc/notebook", { method: "POST" }, "create"),
  ).rejects.toMatchObject({ code: "NETWORK", operation: "create" });
  expect(calls).toBe(1);
});
test("Version conflict has a distinct code", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({ code: "40001" }, { status: 409 }),
  );
  await expect(cloudJSON("/cloud/rpc/notebook", { method: "POST" }, "save")).rejects.toMatchObject({
    code: "40001",
    status: 409,
  });
});
test("A login HTML response is not mistaken for cloud JSON", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response("<title>Login</title>", { status: 200 }),
  );
  await expect(cloudJSON("/cloud/token/anonymous", {}, "auth")).rejects.toMatchObject({
    code: "BAD_RESPONSE",
  });
});
test("Only four fixed same-origin cloud routes are exposed and none can be cached", async () => {
  const config = await Bun.file("vercel.json").json();
  expect(
    config.rewrites.filter((r: any) => r.source.startsWith("/cloud/")).map((r: any) => r.source),
  ).toEqual([
    "/cloud/token/anonymous",
    "/cloud/rpc/notebook",
    "/cloud/rpc/share_notebook",
    "/cloud/rpc/read_shared",
    "/cloud/open",
  ]);
  for (const r of config.rewrites.filter((r: any) => r.source.startsWith("/cloud/"))) {
    expect(r.source).not.toContain("*");
    expect(r.destination).toMatch(
      /^\/api\/cloud\?operation=(auth|notebook|share_notebook|read_shared|open)$/,
    );
  }
  const h = config.headers.find((r: any) => r.source === "/cloud/:path*").headers;
  for (const key of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"])
    expect(h.find((v: any) => v.key === key)?.value).toBe("no-store");
});
