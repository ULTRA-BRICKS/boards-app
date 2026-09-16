import { createWorkspace } from "../../../packages/core/workspace.mjs";
import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({ headless: true }),
  results: { name: string; passed: boolean; error?: string }[] = [];
async function fixture(run: (f: any) => Promise<void>) {
  const ctx = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 393, height: 852 },
  });
  const f = {
    ctx,
    page: await ctx.newPage(),
    state: null as any,
    version: 0,
    authFail: false,
    readFail: false,
    writeFail: false,
    loseCreate: false,
    calls: [] as string[],
    errors: [] as string[],
  };
  f.page.on("pageerror", (e) => f.errors.push(e.message));
  await ctx.route(/\.neon\.tech\/|\/cloud\//, async (route) => {
    const r = route.request();
    if (r.url().includes("/token/anonymous")) {
      f.calls.push("auth");
      if (f.authFail) return route.abort();
      return route.fulfill({
        json: {
          token:
            "x." + btoa(JSON.stringify({ role: "anonymous", exp: Date.now() / 1000 + 300 })) + ".x",
        },
      });
    }
    const p = r.postDataJSON();
    f.calls.push(p.document ? (p.expected_version === 0 ? "create" : "save") : "read");
    if ((!p.document && f.readFail) || (p.document && f.writeFail)) return route.abort();
    if (p.document) {
      if (p.expected_version !== f.version)
        return route.fulfill({ status: 409, json: { code: "40001", message: "Conflict" } });
      f.state = structuredClone(p.document);
      f.version++;
      if (f.loseCreate && f.version === 1) {
        f.loseCreate = false;
        return route.abort();
      }
      return route.fulfill({ json: { version: f.version } });
    }
    if (!f.state)
      return route.fulfill({
        status: 404,
        json: { code: "42501", message: "Notebook unavailable" },
      });
    return route.fulfill({ json: { version: f.version, value: f.state } });
  });
  try {
    await run(f);
    assert.deepEqual(f.errors, []);
  } finally {
    await ctx.close();
  }
}
async function test(name: string, run: (f: any) => Promise<void>) {
  try {
    await fixture(run);
    results.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, passed: false, error: String(e).slice(0, 600) });
    console.log("FAIL", name, String(e).slice(0, 350));
  }
}
const ready = async (f: any) =>
  expect(f.page.locator("#status")).toHaveText("Saved", { timeout: 8000 });
await test("First-load network failure is not mislabeled as unsaved user edits", async (f) => {
  f.authFail = true;
  await f.page.goto("http://127.0.0.1:5183/");
  await expect(f.page.getByRole("heading", { name: "Cannot connect to cloud" })).toBeVisible({
    timeout: 2000,
  });
  await expect(f.page.getByRole("button", { name: "Load the cloud version" })).toHaveCount(0);
  const key = await f.page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("key"));
  f.authFail = false;
  await f.page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await ready(f);
  assert.equal(f.version, 1);
  assert.equal(
    await f.page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("key")),
    key,
  );
});
await test("Repeated connection retries recover without duplicate notebook creation", async (f) => {
  f.writeFail = true;
  await f.page.goto("http://127.0.0.1:5183/");
  await expect(f.page.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible({
    timeout: 2000,
  });
  for (let i = 0; i < 2; i++) {
    await f.page.getByRole("button", { name: "Retry connection", exact: true }).click();
    await expect(f.page.getByRole("heading", { name: "Cannot connect to cloud" })).toBeVisible();
  }
  f.writeFail = false;
  await f.page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await ready(f);
  assert.equal(f.version, 1);
});
await test("Lost creation response is recovered by versioned read, not a second notebook", async (f) => {
  f.loseCreate = true;
  await f.page.goto("http://127.0.0.1:5183/");
  await expect(f.page.getByRole("button", { name: "Retry connection", exact: true })).toBeVisible({
    timeout: 2000,
  });
  await f.page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await ready(f);
  assert.equal(f.version, 1);
  assert(f.calls.includes("read"));
});
await test("A clean cached page with failed revalidation is not a save conflict", async (f) => {
  await f.page.goto("http://127.0.0.1:5183/");
  await ready(f);
  f.readFail = true;
  await f.page.reload();
  await expect(f.page.getByRole("heading", { name: "Cannot connect to cloud" })).toBeVisible({
    timeout: 2000,
  });
  f.readFail = false;
  await f.page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await ready(f);
  assert.equal(f.version, 1);
});
await test("Load cloud version after an actual failed save exits the recovery screen", async (f) => {
  await f.page.goto("http://127.0.0.1:5183/");
  await ready(f);
  f.writeFail = true;
  await f.page.locator("#i-p2 .task-text").click();
  await f.page.locator("#i-p2 .task-text").fill("Keep this private draft");
  await f.page.keyboard.press("Enter");
  await expect(
    f.page.getByRole("button", { name: "Load the cloud version", exact: true }),
  ).toBeVisible({ timeout: 3000 });
  f.writeFail = false;
  f.page.once("dialog", (d) => d.accept());
  await f.page.getByRole("button", { name: "Load the cloud version", exact: true }).click();
  await ready(f);
  await expect(f.page.locator("#i-p2 .task-text")).toHaveText("Finish and test billing");
  await expect(f.page.getByRole("alertdialog")).toHaveCount(0);
});
await test("Title always names the service after the separator", async (f) => {
  await f.page.goto("http://127.0.0.1:5183/");
  await ready(f);
  await expect(f.page).toHaveTitle("Product roadmap | Boards");
  await f.page.locator(".board-title").click();
  await f.page.locator(".board-title").fill("Release notes");
  await f.page.keyboard.press("Enter");
  await ready(f);
  await expect(f.page).toHaveTitle("Release notes | Boards");
});
await test("Diagnostics identify failing operation without recording keys or document text", async (f) => {
  f.authFail = true;
  await f.page.goto("http://127.0.0.1:5183/#title=PRIVATE_TITLE");
  await f.page.getByRole("alertdialog").waitFor();
  const report = await f.page.evaluate(() =>
    typeof (window as any).boardsDiagnostics === "function"
      ? (window as any).boardsDiagnostics()
      : null,
  );
  assert(report, "Missing diagnostics");
  assert(
    report.events.some(
      (e: any) => e.event === "request.failed" && e.operation === "auth" && e.code === "NETWORK",
    ),
  );
  const key = await f.page.evaluate(() => new URLSearchParams(location.hash.slice(1)).get("key"));
  assert(!JSON.stringify(report).includes("PRIVATE_TITLE"));
  if (key) assert(!JSON.stringify(report).includes(key));
});
await test("Existing link failure keeps its board and never creates a replacement", async (f) => {
  f.state = createWorkspace();
  f.version = 4;
  f.authFail = true;
  const key = "k".repeat(43);
  await f.page.goto("http://127.0.0.1:5183/#key=" + key + "&title=Existing%20page");
  await expect(f.page).toHaveTitle("Existing page | Boards");
  await expect(f.page.getByRole("heading", { name: "Cannot connect to cloud" })).toBeVisible();
  f.authFail = false;
  await f.page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await ready(f);
  assert.equal(f.version, 4);
  assert(!f.calls.includes("create"));
});
await test("Failed cloud reload preserves the draft until a read succeeds and Undo remains available", async (f) => {
  await f.page.goto("http://127.0.0.1:5183/");
  await ready(f);
  f.writeFail = true;
  const draft = "Unsent recovery text 🙂";
  await f.page.locator("#i-p2 .task-text").click();
  await f.page.locator("#i-p2 .task-text").fill(draft);
  await f.page.keyboard.press("Enter");
  await f.page.locator("#reload").waitFor();
  f.readFail = true;
  f.page.once("dialog", (d) => d.accept());
  await f.page.locator("#reload").click();
  await expect(f.page.locator("#retry")).toBeVisible();
  await expect(f.page.locator("#i-p2 .task-text")).toHaveText(draft);
  f.readFail = false;
  f.writeFail = false;
  f.page.once("dialog", (d) => d.accept());
  await f.page.locator("#reload").click();
  await ready(f);
  await expect(f.page.locator("#i-p2 .task-text")).toHaveText("Finish and test billing");
  await f.page.getByRole("button", { name: "Page options" }).click();
  await f.page.locator("#undo").click();
  await ready(f);
  await expect(f.page.locator("#i-p2 .task-text")).toHaveText(draft);
  assert.equal(f.state.boards[0].columns[1].items[1].text, draft);
});
await Bun.write(
  "../../docs/metrics/loading-regressions-" + engine.name() + ".json",
  JSON.stringify(
    { mode: "Native browser with explicit simulated cloud failures", results },
    null,
    2,
  ),
);
await browser.close();
if (results.some((r) => !r.passed)) process.exit(1);
