import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { photoDraft } from "../../server/ai.mjs";
import { createWorkspace } from "../../packages/core/workspace.mjs";
const origin = "http://127.0.0.1:5173";
test.beforeEach(async ({ page }) => {
  const request = page.request;
  const login = await request.post("/api/auth/test", { headers: { Origin: origin }, data: {} });
  expect(login.ok()).toBeTruthy();
  const { version } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        headers: { Origin: origin },
        data: { version, value: createWorkspace() },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.locator(".task")).toHaveCount(15);
});
test("paper layout, navigation, actual screenshots and accessibility", async ({ page }) => {
  await expect(page.locator("header")).toHaveCount(0);
  await page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
  );
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/board-desktop.png", fullPage: true });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/accessibility.json", JSON.stringify(result, null, 2));
  expect(result.violations.filter((v) => ["serious", "critical"].includes(v.impact || ""))).toEqual(
    [],
  );
});
test("edit, toggle, saved reload and keyboard caret", async ({ page }) => {
  const editor = page.locator("#item-p2 .task-text");
  await editor.click();
  await editor.fill("Биллинг проверен 🙂");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/api/state") && r.request().method() === "PUT",
  );
  await page.locator("#item-p2 [data-done]").click();
  expect((await saved).ok()).toBeTruthy();
  await expect(editor).toHaveText("Биллинг проверен 🙂");
  await page.reload();
  await expect(editor).toHaveText("Биллинг проверен 🙂");
  await expect(page.locator("#item-p2")).toHaveClass(/done/);
});
test("avatar chain overlap and hover elevation; no loss of text after mention", async ({
  page,
}) => {
  const editor = page.locator("#item-p2 .task-text");
  for (const name of ["Niko", "Mariam"]) {
    await editor.click();
    await editor.fill("Finish and test billing @" + name);
    await expect(page.locator(".mentions [data-pick]")).toHaveCount(1);
    await page.keyboard.press("Enter");
  }
  const avatars = page.locator("#item-p2 [data-person]");
  await expect(avatars).toHaveCount(3);
  const a = await avatars.nth(0).boundingBox(),
    b = await avatars.nth(1).boundingBox();
  expect(b!.x).toBeLessThan(a!.x + a!.width);
  await avatars.nth(0).hover({ position: { x: 3, y: 12 } });
  expect(await avatars.nth(0).evaluate((e) => Number(getComputedStyle(e).zIndex))).toBeGreaterThan(
    await avatars.nth(1).evaluate((e) => Number(getComputedStyle(e).zIndex)),
  );
  await expect(editor).toHaveText("Finish and test billing");
});
test("page thumbnail creates final editable sheet, without creation dialog", async ({ page }) => {
  await page.getByRole("button", { name: "Boards and columns", exact: true }).click();
  await page.screenshot({ path: "docs/screenshots/page-thumbnails.png" });
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const title = page.locator(".board-title");
  await expect(title).toHaveAttribute("contenteditable", "plaintext-only");
  await title.fill("My new page");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "New column", exact: true }).click();
  const heading = page.locator('[data-edit="column-title"]');
  await heading.fill("Ideas");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Add a thought" }).click();
  const item = page.locator(".task-text");
  await item.fill("First useful thought");
  await page.keyboard.press("Enter");
  await expect(item).toHaveText("First useful thought");
});
test("duplicate and workspace search are contextual, not auto-merge", async ({ page }) => {
  const item = page.locator("#item-p2 .task-text");
  await item.click();
  await item.fill("Replace PNGs with Lottie animations");
  await expect(page.getByText("Possible text duplicate", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search workspace", exact: true }).click();
  await page.getByRole("searchbox").fill("billing");
  await expect(page.locator(".search-hit").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#item-p2")).toHaveClass(/focused/);
});
test("current state share, least privilege and revoke in independent context", async ({
  page,
  browser,
}) => {
  await page.locator("#item-p2 [data-item-menu]").click();
  await page.getByRole("button", { name: "Share this item", exact: true }).click();
  await page.getByRole("button", { name: "Create view link", exact: true }).click();
  const url = page.locator("#share-url");
  await expect(url).toBeVisible();
  const link = await url.inputValue(),
    reader = await browser.newContext(),
    view = await reader.newPage();
  await view.goto(link);
  await expect(view.locator(".task")).toHaveCount(1);
  await expect(view.locator("#item-p2")).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("Link revoked.", { exact: true })).toBeVisible();
  expect((await view.request.get(link)).status()).toBe(404);
  await reader.close();
});
test("mobile layout 320–1100px and persistent visible touch actions", async ({ page }) => {
  for (const width of [320, 393, 700, 768, 1100]) {
    await page.setViewportSize({ width, height: 852 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(page.locator(".column-tabs")).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/board-mobile-viewport.png" });
});
test("shell service worker cache contains no authentication, task or share response", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Separate worker lifecycle checks run in Chromium");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator(".task")).toHaveCount(15);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (n) =>
          (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname),
        ),
      )
    ).flat();
  });
  expect(cached).toContain("/index.html");
  expect(cached.some((p) => p.startsWith("/api/") || p.startsWith("/s/"))).toBeFalsy();
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".paper")).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/connect|offline/i);
  await context.setOffline(false);
});
test("independent type site, real axes and screenshot", async ({ page }) => {
  await page.goto("http://127.0.0.1:5174/");
  await page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
  );
  await page.locator("#weight").fill("780");
  await page.locator("#width").fill("120");
  expect(
    await page.locator(".editable").evaluate((e) => getComputedStyle(e).fontVariationSettings),
  ).toContain("780");
  await page.screenshot({ path: "docs/screenshots/type-site.png", fullPage: true });
});
test("performance budgets record local load and next-frame reaction", async ({ page }) => {
  await page.reload();
  await expect(page.locator(".task")).toHaveCount(15);
  const load = await page.evaluate(
    () =>
      performance.getEntriesByType("navigation").map((n) => ({
        dom: (n as PerformanceNavigationTiming).domContentLoadedEventEnd,
        transfer: (n as PerformanceNavigationTiming).transferSize,
      }))[0],
  );
  const click = await page.locator('[data-nav="boards"]').evaluate(async (el) => {
    const begin = performance.now();
    (el as HTMLElement).click();
    await new Promise(requestAnimationFrame);
    return performance.now() - begin;
  });
  await writeFile(
    "test-results/performance.json",
    JSON.stringify(
      {
        environment: "local CI, unthrottled, not production field metrics",
        load,
        clickToNextFrame: click,
      },
      null,
      2,
    ),
  );
  expect(click).toBeLessThan(150);
  expect(load!.dom).toBeLessThan(2500);
});
test("photo transcription is an editable draft sheet, not a modal wizard", async ({ page }) => {
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch(),
      status = await response.json();
    await route.fulfill({ json: { ...status, ai: { ...status.ai, vision: true } } });
  });
  await page.route("**/api/photo", (route) =>
    route.fulfill({
      json: photoDraft({
        title: "Launch notes",
        columns: [
          {
            title: "Product",
            items: [
              { text: "Review onboarding", assigneeHint: "N" },
              { text: "Test billing", assigneeHint: "D" },
            ],
          },
        ],
        warnings: ["Fixture transcription: review the text before keeping it."],
      }),
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "Boards and columns", exact: true }).click();
  await page.getByRole("button", { name: "Page from a photo", exact: true }).click();
  await page.locator("#photo-file").setInputFiles({
    name: "notebook.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3cAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Read the handwriting ↗", exact: true }).click();
  await expect(page.locator(".draft-paper")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Page title", exact: true })
    .fill("Reviewed launch notes");
  await page
    .getByRole("textbox", { name: "Thought", exact: true })
    .first()
    .fill("Check the real onboarding flow");
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: "docs/screenshots/photo-review.png", fullPage: true });
  await page.getByRole("button", { name: "Keep this page ↗", exact: true }).click();
  await expect(page.locator(".board-title")).toHaveText("Reviewed launch notes");
  await expect(page.locator(".task")).toHaveCount(2);
  await page.getByRole("button", { name: "Boards and columns", exact: true }).click();
  await expect(page.locator('.page-thumbnail[data-page="roadmap"]')).toHaveCount(1);
});
