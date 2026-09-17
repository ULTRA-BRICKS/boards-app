import { resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
import { mkdir } from "node:fs/promises";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium,
  browser = await engine.launch({ headless: true }),
  ctx = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 393, height: 852 },
  }),
  page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
let broken = true,
  slow = false,
  loadCalls = 0;
await ctx.route("**/assets/app-*.js", (route) => (broken ? route.abort() : route.continue()));
await ctx.route("**/cloud/**", async (route) => {
  loadCalls++;
  if (slow) await new Promise((r) => setTimeout(r, 7000));
  const url = route.request().url();
  return route.fulfill({
    json: url.includes("/token/")
      ? {
          token:
            "x." + btoa(JSON.stringify({ role: "anonymous", exp: Date.now() / 1000 + 300 })) + ".x",
        }
      : { version: 1, value: createWorkspace() },
  });
});
const checks: string[] = [];
try {
  await page.goto("http://127.0.0.1:5183/#key=" + "r".repeat(43));
  await expect(page.getByRole("button", { name: "Retry opening", exact: true })).toBeVisible({
    timeout: 2500,
  });
  assert.equal(loadCalls, 0);
  checks.push(
    "Missing application JavaScript shows a recovery control instead of an infinite skeleton",
  );
  broken = false;
  await page.getByRole("button", { name: "Retry opening", exact: true }).click();
  await expect(page.locator(".task")).toHaveCount(15);
  checks.push(
    "Retry preserves the address and successfully boots when the application file is available",
  );
  const second = await ctx.newPage();
  slow = true;
  await second.goto("http://127.0.0.1:5183/#key=" + "s".repeat(43));
  await expect(second.getByRole("button", { name: "Retry opening", exact: true })).toBeVisible({
    timeout: 6800,
  });
  await expect(second.locator(".task")).toHaveCount(15, { timeout: 4000 });
  await expect(second.locator("#boot-recovery")).toHaveCount(0);
  checks.push(
    "A slow cold read explains the wait, and recovery UI disappears automatically when real tasks arrive",
  );
  const output = resolve(import.meta.dir, "../../../docs/metrics");
  await mkdir(output, { recursive: true });
  const report = {
    browser: engine.name(),
    mode: "Native browser with deliberately failed JS and delayed fixture cloud, not real device/server latency",
    checks,
  };
  await Bun.write(
    resolve(output, "boot-recovery-" + engine.name() + ".json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        title: document.title,
        text: document.body.innerText.slice(0, 700),
        metrics: typeof window.boardsMetrics,
      })),
    ),
  );
  throw error;
} finally {
  await browser.close();
}
