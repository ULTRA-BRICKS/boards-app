import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkspace, newBoard } from "../../../packages/core/workspace.mjs";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium,
  baseline = process.env.MODE === "baseline";
const browser = await engine.launch({ headless: true }),
  results: any[] = [];
await mkdir("../../.private/stack", { recursive: true });
await mkdir("../../docs/metrics", { recursive: true });
try {
  for (const count of baseline ? [1, 3] : [1, 2, 3, 6]) {
    const state = createWorkspace();
    while (state.boards.length < count)
      state.boards.push(
        newBoard(
          ["Next week", "Ideas for later", "A longer readable board title"][
            state.boards.length - 1
          ] || "Other page",
        ),
      );
    const ctx = await browser.newContext({
        viewport: { width: 393, height: 852 },
        serviceWorkers: "block",
        reducedMotion: "reduce",
      }),
      page = await ctx.newPage(),
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await ctx.route("**/cloud/**", (route) =>
      route.fulfill({
        json: route.request().url().includes("/token/")
          ? {
              token:
                "x." +
                btoa(JSON.stringify({ role: "anonymous", exp: Date.now() / 1000 + 300 })) +
                ".x",
            }
          : { version: 1, value: state },
      }),
    );
    await page.goto("http://127.0.0.1:5183/#key=" + "s".repeat(43));
    await expect(page.locator("#status")).toHaveText("Saved");
    await page.waitForFunction(() =>
      [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
    );
    if (baseline) {
      for (const n of [1, 2]) {
        await page.screenshot({ path: `../../.private/stack/before-${count}-${n}.png` });
        if (n === 1) {
          await page.reload();
          await expect(page.locator("#status")).toHaveText("Saved");
          await page.waitForFunction(() =>
            [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
          );
        }
      }
      await ctx.close();
      continue;
    }
    await expect(page.locator(".stack-sheet")).toHaveCount(
      count === 1 ? 1 : Math.min(count - 1, 2),
    );
    assert.equal(
      (await page.locator(".paper-stack").innerText()).includes("A fresh page"),
      count === 1,
    );
    for (const width of [320, 393, 640, 768, 1024, 1448, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const layers = await page.evaluate(() => {
        const paper = document.querySelector(".paper")!,
          behind = document.querySelector(".stack-sheet.near")!,
          a = paper.getBoundingClientRect(),
          b = behind.getBoundingClientRect(),
          x = a.left + a.width / 2,
          y = a.top + 8;
        return {
          paper: { x: a.x, y: a.y, right: a.right },
          behind: { bottom: b.bottom, top: b.top },
          topIsActive: !!document.elementFromPoint(x, y)?.closest(".paper"),
          background: getComputedStyle(paper).backgroundColor,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert(layers.topIsActive, "A neighboring sheet captures the active sheet");
      assert(
        layers.behind.bottom > layers.paper.y + 20,
        "Neighbor must physically continue underneath active sheet",
      );
      assert(!layers.overflow, `Overflow at ${width}`);
      assert(
        !/rgba\(.*[, ]0\)$|transparent/.test(layers.background),
        "Active paper must be opaque",
      );
    }
    await page.setViewportSize({ width: 393, height: 852 });
    const tab = page.locator(".stack-sheet.near"),
      r = await tab.boundingBox();
    assert(r);
    await page.mouse.click(r.x + 40, r.y + 18);
    await expect(page.getByRole("dialog", { name: "Pages", exact: true })).toBeVisible();
    await expect(page.locator(".paper-stack")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('.page-thumb[aria-current="true"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".paper-stack")).toBeFocused();
    await expect(page.locator(".paper-stack")).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Pages", exact: true })).toBeVisible();
    if (count > 1) {
      await page.locator('[data-page="' + state.boards[1].id + '"]').click();
      await expect(page.locator(".board-title")).toHaveText("Next week");
      await page.getByRole("button", { name: "Pages", exact: true }).click();
      await page.locator("[data-page=roadmap]").click();
    } else await page.keyboard.press("Escape");
    await page.screenshot({ path: `../../.private/stack/after-${count}-mobile.png` });
    await page.setViewportSize({ width: 1448, height: 1086 });
    await page.screenshot({ path: `../../.private/stack/after-${count}-desktop.png` });
    assert.deepEqual(errors, []);
    results.push({ pages: count, widths: 7, layering: true, keyboard: true, errors });
    await ctx.close();
  }
  console.log(
    JSON.stringify({ engine: engine.name(), mode: baseline ? "baseline" : "verified", results }),
  );
  if (!baseline)
    await Bun.write(
      `../../docs/metrics/stack-${engine.name()}.json`,
      JSON.stringify(
        {
          engine: engine.name(),
          scope:
            "Native browser, fixture data; checks physical sheet overlap, hit testing, count and keyboard",
          results,
        },
        null,
        2,
      ),
    );
} finally {
  await browser.close();
}
