import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium,
  browser = await engine.launch({ headless: true }),
  ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    serviceWorkers: "block",
  });
let state = createWorkspace(),
  version = 1,
  delay = 0,
  writes = 0,
  deny = false;
const key = "d".repeat(43),
  errors: string[] = [],
  checks: string[] = [];
await ctx.route("**/cloud/**", async (route) => {
  const r = route.request();
  if (r.url().includes("/token/"))
    return route.fulfill({
      json: {
        token:
          "x." + btoa(JSON.stringify({ role: "anonymous", exp: Date.now() / 1000 + 300 })) + ".x",
      },
    });
  const p = r.postDataJSON();
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  if (deny) return route.fulfill({ status: 403, json: { code: "42501" } });
  if (p.document) {
    writes++;
    if (p.expected_version !== version)
      return route.fulfill({ status: 409, json: { code: "40001" } });
    state = structuredClone(p.document);
    version++;
    return route.fulfill({ json: { version } });
  }
  return route.fulfill({ json: { version, value: state } });
});
const visit = async () => {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5183/?__boards_build=fixture#key=" + key);
  return page;
};
try {
  const first = await visit();
  await expect(first.locator("#status")).toHaveText("Saved");
  await first.waitForFunction(
    () =>
      (window as any)
        .boardsMetrics()
        .measurements.some((e: any) => e.name === "device-cache-saved"),
    {},
    { timeout: 2000 },
  );
  await first.close();
  delay = 1800;
  const next = await visit();
  await expect(next.locator(".task")).toHaveCount(15, { timeout: 750 });
  assert.equal(writes, 0);
  assert(
    (await next.evaluate(() => (window as any).boardsMetrics().measurements)).some(
      (m: any) => m.name === "device-render",
    ),
  );
  checks.push(
    "Closing the first tab still permits a new tab to show the confirmed board before slow cloud revalidation",
  );
  await next.locator("#i-p2 .task-text").click();
  await next.locator("#i-p2 .task-text").fill("Typed while checking cloud");
  await next.keyboard.press("Enter");
  await expect(next.locator("#status")).toHaveText("Saved", { timeout: 7000 });
  assert.equal(state.boards[0].columns[1].items[1].text, "Typed while checking cloud");
  checks.push("Typing over a cached copy waits for a successful version check then saves");
  const draft = await visit();
  await expect(draft.locator("#status")).toHaveText("Saved", { timeout: 5000 });
  delay = 0;
  await draft.locator("#i-p2 .task-text").click();
  await draft.locator("#i-p2 .task-text").fill("Uncommitted private tab draft");
  const separate = await visit();
  await expect(separate.locator("#i-p2 .task-text")).toHaveText("Typed while checking cloud", {
    timeout: 750,
  });
  checks.push("Uncommitted tab input is not shared as an acknowledged device snapshot");
  await separate.waitForFunction(() => document.querySelector("#status")?.textContent === "Saved");
  await separate.close();
  await draft.close({ runBeforeUnload: false });
  await next.close();
  state.boards[0].columns[1].items[1].text = "Changed by another browser";
  version++;
  delay = 1400;
  const refresh = await visit();
  await expect(refresh.locator("#i-p2 .task-text")).toHaveText("Typed while checking cloud", {
    timeout: 750,
  });
  await expect(refresh.locator("#i-p2 .task-text")).toHaveText("Changed by another browser", {
    timeout: 4000,
  });
  checks.push(
    "SWR displays the confirmed previous revision then replaces it with the newer cloud revision",
  );
  await refresh.close();
  deny = true;
  delay = 0;
  const rejected = await visit();
  await expect(rejected.getByRole("heading", { name: "Cannot connect to cloud" })).toBeVisible();
  await rejected.waitForFunction(
    () =>
      (window as any)
        .boardsMetrics()
        .measurements.some((e: any) => e.name === "device-cache-cleared"),
    {},
    { timeout: 2000 },
  );
  await rejected.close();
  delay = 1400;
  const afterDenial = await visit();
  await afterDenial.waitForTimeout(350);
  assert.equal(await afterDenial.locator(".task").count(), 0);
  checks.push(
    "Permission rejection clears the device snapshot rather than reusing it on the next visit",
  );
  assert.deepEqual(errors, []);
  await mkdir("../../docs/metrics", { recursive: true });
  const report = {
    browser: engine.name(),
    mode: "Native browser + IndexedDB, same-origin cloud routes are explicit fixtures; SW navigation tested separately",
    checks,
    errors,
  };
  await Bun.write(
    "../../docs/metrics/device-loading-" + engine.name() + ".json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  await ctx
    .pages()
    .at(-1)
    ?.screenshot({ path: "../../.private/device-loading-failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}
