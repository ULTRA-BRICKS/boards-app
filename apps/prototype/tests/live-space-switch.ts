import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const origin = "https://boards-app-gamma.vercel.app";
if (process.env.BOARDS_LIVE_WRITE !== "1")
  throw Error("Enable isolated test-space creation with BOARDS_LIVE_WRITE=1.");
const manifest = await (await fetch(origin + "/build.json", { cache: "no-store" })).json();
assert.equal(manifest.version, process.env.EXPECTED_BUILD);
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 1280, height: 960 } }),
  page = await context.newPage(),
  errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
let photoUploads = 0;
page.on("request", (r) => {
  if (r.url().includes("/photo/read")) photoUploads++;
});
try {
  await page.goto(origin + "/?__boards_build=" + manifest.version);
  await expect(page.locator("#status")).toHaveText("Saved", { timeout: 30000 });
  const firstLink = page.url();
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.getByLabel("New space name", { exact: true }).fill("Isolated release check");
  await page.getByRole("button", { name: "New space", exact: true }).click();
  await expect(page.getByRole("button", { name: "Switch space" })).toContainText(
    "Isolated release check",
    { timeout: 30000 },
  );
  await expect(page.locator("#status")).toHaveText("Saved");
  const secondLink = page.url();
  assert.notEqual(new URL(firstLink).hash, new URL(secondLink).hash);
  checks.push("Created a separate cloud space and opened it");
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "New page from a photo" }).click();
  await page.locator("#manual-photo").click();
  await page.locator("#photo-title").fill("Verified paper draft");
  await page.locator('[data-photo-task="0:0"]').fill("Проверка новой страницы · ✓");
  await page.locator("#photo-back").click();
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "New page from a photo" }).click();
  await expect(page.locator('[data-photo-task="0:0"]')).toHaveValue("Проверка новой страницы · ✓");
  await page.locator("#save-photo-page").click();
  await expect(page.locator(".board-title")).toHaveText("Verified paper draft");
  await expect(page.locator("#status")).toHaveText("Saved", { timeout: 30000 });
  checks.push("Manual photo-sheet draft survives leaving and saves a real cloud page");
  const readerContext = await browser.newContext(),
    reader = await readerContext.newPage();
  await reader.goto(page.url());
  await expect(reader.locator("#status")).toHaveText("Saved", { timeout: 30000 });
  await expect(reader.locator(".task-text")).toHaveText("Проверка новой страницы · ✓");
  await readerContext.close();
  checks.push("Independent browser session reads the saved page from the cloud");
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.locator(".space-option").filter({ hasText: "Launch workspace" }).click();
  await expect(page.locator("#status")).toHaveText("Saved", { timeout: 30000 });
  assert.equal(await page.locator(".task").count(), 15);
  checks.push("Returning to the first space preserves its original 15 tasks");
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.locator(".space-option").filter({ hasText: "Isolated release check" }).click();
  await expect(page.locator("#status")).toHaveText("Saved", { timeout: 30000 });
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await expect(page.locator("[data-page]")).toHaveCount(2);
  await page.keyboard.press("Escape");
  checks.push("Space list survives reload and reopens the isolated second space");
  assert.equal(photoUploads, 0);
  assert.deepEqual(errors, []);
  await mkdir("../../docs/metrics", { recursive: true });
  const report = {
    build: manifest.version,
    mode: "Unmocked public HTTPS and cloud database, isolated test notebooks. Photo text was entered manually; no real recognition or Slack connection is claimed.",
    checks,
    photoUploads,
    errors,
  };
  await Bun.write("../../docs/metrics/live-space-switch.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch (error) {
  await page.screenshot({ path: "../../.private/live-space-switch-failure.png", fullPage: true });
  throw error;
} finally {
  await browser.close();
}
