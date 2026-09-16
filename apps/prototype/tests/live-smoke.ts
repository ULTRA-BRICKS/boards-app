import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, chmod } from "node:fs/promises";
const base = "https://boards-app-gamma.vercel.app/";
if (process.env.BOARDS_LIVE_WRITE !== "1")
  throw Error(
    "This check creates and edits its own isolated test notebook. Set BOARDS_LIVE_WRITE=1 explicitly.",
  );
const manifest = await (await fetch(base + "build.json", { cache: "no-store" })).json();
assert.equal(
  manifest.version,
  process.env.EXPECTED_BUILD,
  "Public deployment is not the tested build",
);
const browser = await chromium.launch({ headless: true }),
  errors: string[] = [],
  checks: string[] = [];
const context = await browser.newContext({ viewport: { width: 1448, height: 1086 } });
await context.addInitScript(() => localStorage.setItem("boards:sound", "off"));
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.name));
const ready = async (p: any) =>
  expect(p.locator("#status")).toHaveText("Saved", { timeout: 30000 });
const report: any = {
  build: manifest.version,
  mode: "Unmocked public HTTPS; isolated test notebook for writes; provided user notebook only read",
  checks,
};
await mkdir("../../.private", { recursive: true });
await mkdir("../../docs/metrics", { recursive: true });
try {
  await page.goto(base);
  await ready(page);
  assert.equal(await page.locator(".task").count(), 15);
  report.cold = await page.evaluate(() => (window as any).boardsMetrics());
  checks.push("Public cloud creation and fifteen seed tasks");
  const ownLink = page.url();
  await Bun.write("../../.private/live-test-notebook-0915.txt", ownLink);
  await chmod("../../.private/live-test-notebook-0915.txt", 0o600);
  const field = page.locator("#i-p2 .task-text"),
    original = await field.innerText(),
    probe = "Проверка сохранения · Live regression 🙂";
  await field.click();
  await field.fill(probe);
  const save = page.waitForResponse(
    (r) => r.url().includes("/cloud/rpc/notebook") && !!r.request().postDataJSON()?.document,
  );
  await page.keyboard.press("Enter");
  assert.equal((await save).status(), 200);
  await ready(page);
  const second = await browser.newContext(),
    reader = await second.newPage();
  reader.on("pageerror", (e) => errors.push(e.name));
  await reader.goto(ownLink);
  await ready(reader);
  await expect(reader.locator("#i-p2 .task-text")).toHaveText(probe);
  checks.push("Unicode save and independent-session cloud read");
  await field.click();
  await field.fill(original);
  await page.keyboard.press("Enter");
  await ready(page);
  await page.locator("#i-p2 .add-person").click();
  await page.locator('[data-pick="niko"]').click();
  await expect(page.locator('[data-pick="niko"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-pick="niko"]').click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await ready(page);
  checks.push("Multiple assignment picker remains interactive");
  await page.locator("#i-p2 [data-check]").click();
  await expect(page.locator("#i-p2")).toHaveClass(/done/);
  assert((await page.locator("#i-p2 .ink-strike path").count()) > 0);
  await page.locator("#i-p2 [data-check]").click();
  await ready(page);
  checks.push("Completion strike appears and reopens without a reload");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.locator("#make-share").click();
  await page.locator("#share-url").waitFor();
  const shareURL = await page.locator("#share-url").inputValue(),
    publicContext = await browser.newContext(),
    view = await publicContext.newPage();
  await view.goto(shareURL);
  await expect(view.locator(".task")).toHaveCount(15, { timeout: 30000 });
  await page.locator("#revoke-share").click();
  await expect(page.locator("#share-result")).toHaveText("Link revoked.", { timeout: 15000 });
  const revokedResponse = await view.reload();
  assert.equal(revokedResponse?.status(), 404);
  await expect(view.locator("body")).toContainText("This shared page is unavailable.");
  await expect(view.locator(".task")).toHaveCount(0);
  await publicContext.close();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  checks.push("Public share loads and revocation does not retain stale task data");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await ready(page);
  report.repeat = await page.evaluate(() => (window as any).boardsMetrics());
  assert.equal(report.repeat.serviceWorker, true);
  const cached = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const n of await caches.keys())
      if (n.startsWith("boards-public-"))
        for (const r of await (await caches.open(n)).keys()) paths.push(new URL(r.url).pathname);
    return paths;
  });
  assert(cached.includes("/index.html"));
  assert(!cached.some((p) => p.startsWith("/cloud/") || p.startsWith("/api/")));
  checks.push("Public service worker controls reload; cloud responses not cached");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Cannot connect to cloud" })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("heading", { name: "Your last changes are not saved." })).toHaveCount(
    0,
  );
  await context.setOffline(false);
  await page.getByRole("button", { name: "Retry connection", exact: true }).click();
  await ready(page);
  checks.push("Real offline repeat load recovers without a false unsaved-edit loop");
  await expect(page).toHaveTitle("Product roadmap | Boards");
  await reader.reload();
  await ready(reader);
  await expect(reader.locator("#i-p2 .task-text")).toHaveText(original);
  await second.close();
  await page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
  );
  await page.screenshot({
    path: "../../docs/screenshots/boards-live-0915-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 393, height: 852 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "../../docs/screenshots/boards-live-0915-mobile.png" });
  checks.push("Mobile page does not overflow");
  const type = await context.newPage();
  assert.equal((await type.goto(base + "type.html"))?.status(), 200);
  await expect(type).toHaveTitle("Conloca Sans | Boards");
  await type.locator("#weight").fill("700");
  checks.push("Separate font page and service title");
  const userFile = process.env.BOARDS_USER_LINK_FILE;
  if (userFile) {
    const userURL = (await Bun.file(userFile).text()).trim();
    assert.equal(new URL(userURL).origin, new URL(base).origin);
    const userContext = await browser.newContext({ viewport: { width: 393, height: 852 } }),
      userPage = await userContext.newPage();
    let userWrites = 0;
    userPage.on("request", (r) => {
      if (r.url().includes("/cloud/rpc/notebook") && r.postDataJSON()?.document) userWrites++;
    });
    userPage.on("pageerror", (e) => errors.push(e.name));
    await userPage.goto(userURL);
    await ready(userPage);
    report.providedBoard = {
      tasks: await userPage.locator(".task").count(),
      titleHasService: await userPage.title().then((t) => t.endsWith(" | Boards")),
      writes: userWrites,
    };
    assert(report.providedBoard.tasks > 0);
    assert.equal(userWrites, 0);
    assert.equal(report.providedBoard.titleHasService, true);
    await expect(userPage.getByRole("alertdialog")).toHaveCount(0);
    checks.push("The exact user-provided board opens without edits or recovery loop");
    await userContext.close();
  }
  assert.deepEqual(errors, []);
  report.errors = errors;
  report.timestamp = new Date().toISOString();
  await Bun.write("../../docs/metrics/live-smoke-0915.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: "../../.private/live-smoke-0915-failure.png", fullPage: true });
  console.error("Live check stopped: " + (error as Error).name);
  process.exitCode = 1;
} finally {
  await browser.close();
}
