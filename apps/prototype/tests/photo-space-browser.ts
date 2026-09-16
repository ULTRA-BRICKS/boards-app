import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
import { photoDraft } from "../photo/contract";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium,
  browser = await engine.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1360, height: 980 },
    serviceWorkers: "block",
  }),
  page = await context.newPage(),
  checks: string[] = [],
  errors: string[] = [];
const first = "a".repeat(43),
  states = new Map([[first, { version: 1, value: createWorkspace() }]]);
let configured = false,
  reads = 0,
  writes = 0,
  failSave = false,
  loseCreation = false;
states.get(first)!.value.boards[0].tagline = "A real board tagline";
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const stats = { opens: 0, images: 0, texts: 0 };
  (window as any).photoIO = stats;
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = ((...args: Parameters<IDBFactory["open"]>) => {
    stats.opens++;
    return open(...args);
  }) as IDBFactory["open"];
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    if (this.name === "photos") {
      if (typeof value === "string") stats.images++;
      else stats.texts++;
    }
    return put.call(this, value, key!);
  };
});
await context.route("**/cloud/**", async (route) => {
  const r = route.request();
  if (r.url().includes("/token/"))
    return route.fulfill({
      json: {
        token:
          "x." + btoa(JSON.stringify({ role: "anonymous", exp: Date.now() / 1000 + 300 })) + ".x",
      },
    });
  const body = r.postDataJSON(),
    stored = states.get(body.capability);
  if (body.document) {
    if (failSave) return route.fulfill({ status: 503, json: { code: "UPSTREAM_ERROR" } });
    if ((stored?.version || 0) !== body.expected_version)
      return route.fulfill({ status: 409, json: { code: "40001" } });
    const version = (stored?.version || 0) + 1;
    states.set(body.capability, { version, value: structuredClone(body.document) });
    writes++;
    if (loseCreation && body.expected_version === 0) {
      loseCreation = false;
      return route.abort("failed");
    }
    return route.fulfill({ json: { version } });
  }
  return stored
    ? route.fulfill({ json: stored })
    : route.fulfill({ status: 404, json: { code: "42501" } });
});
await context.route("**/photo/**", async (route) => {
  if (route.request().url().endsWith("/status")) return route.fulfill({ json: { configured } });
  reads++;
  return route.fulfill({
    json: photoDraft({
      title: "Планы с листка",
      columns: [
        {
          title: "Сегодня",
          items: [
            { text: "Проверить счета (D)", done: true, assigneeHint: "D" },
            { text: "Доделать поиск", done: false },
          ],
        },
      ],
      warnings: ["Проверьте вторую строку"],
    }),
  });
});
await mkdir("../../docs/screenshots", { recursive: true });
await mkdir("../../docs/metrics", { recursive: true });
try {
  await page.goto("http://127.0.0.1:5183/#key=" + first);
  await expect(page.locator("#status")).toHaveText("Saved");
  await expect(page.locator(".tagline")).toHaveText("A real board tagline");
  await page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
  );
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 700;
    const x = c.getContext("2d")!;
    x.fillStyle = "#fcf9ed";
    x.fillRect(0, 0, 900, 700);
    x.fillStyle = "#243e5e";
    x.font = '52px "Conloca Sans"';
    x.fillText("Планы с листка", 55, 90);
    x.font = '40px "Conloca Sans"';
    x.fillText("Сегодня", 55, 170);
    x.fillText("✓ Проверить счета (D)", 55, 250);
    x.fillText("○ Доделать поиск", 55, 325);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.evaluate(() => {
    (window as any).photoEntries = 0;
    new MutationObserver((entries) => {
      for (const entry of entries)
        for (const n of entry.addedNodes)
          if (n instanceof Element && n.matches(".photo-workspace")) (window as any).photoEntries++;
    }).observe(document.querySelector("#app")!, { childList: true });
    const button = document.querySelector<HTMLButtonElement>("#photo-page")!;
    button.click();
    button.click();
  });
  await expect(page.locator(".photo-workspace")).toBeVisible();
  assert.equal(await page.evaluate(() => (window as any).photoEntries), 1);
  checks.push("Double tapping photo creation initializes only one editor");
  await page.locator("#sheet-photo").setInputFiles({
    name: "handwritten-sheet.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page.locator("#photo-status")).toContainText("Ready to read");
  assert.equal(writes, 0);
  await page.locator("#read-photo").click();
  await expect(page.locator("#photo-status")).toContainText("not connected");
  assert.equal(reads, 0);
  await expect(page.locator("#source-photo")).toBeVisible();
  checks.push("Unconfigured recognition never uploads a photo or creates a board");
  await page.locator("#photo-back").click();
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "New page from a photo" }).click();
  await expect(page.locator("#photo-status")).toContainText("restored");
  checks.push("Photo draft survives leaving and reopening the screen");
  configured = true;
  await page.locator("#read-photo").click();
  await expect(page.locator("#photo-title")).toHaveValue("Планы с листка");
  assert.equal(writes, 0);
  await page.locator('[data-photo-task="0:1"]').fill("Доделать поиск и фильтры");
  await page.locator("#photo-title").fill("Планы — проверено");
  const io = await page.evaluate(() => (window as any).photoIO);
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>("#photo-title")!;
    for (let i = 0; i < 30; i++) {
      field.value = "Temporary " + i;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.value = "Планы — проверено";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => (window as any).photoIO);
  assert.equal(after.images, io.images);
  assert.equal(after.opens, io.opens);
  assert(after.texts - io.texts <= 2);
  checks.push("Thirty draft edits do not rewrite the photo or reopen IndexedDB");
  await page.screenshot({
    path: "../../docs/screenshots/photo-review-desktop.png",
    fullPage: true,
  });
  for (const width of [320, 393, 768, 1360]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Photo overflow at " + width,
    );
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: "../../docs/screenshots/photo-review-mobile.png", fullPage: true });
  await page.locator("#photo-back").click();
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "New page from a photo" }).click();
  await expect(page.locator("#photo-title")).toHaveValue("Планы — проверено");
  await expect(page.locator('[data-photo-task="0:1"]')).toHaveValue("Доделать поиск и фильтры");
  checks.push("Corrected draft text is persistent and the sheet is responsive at four widths");
  await page.locator("#save-photo-page").click();
  await expect(page.locator(".board-title")).toHaveText("Планы — проверено");
  await expect(page.locator("#status")).toHaveText("Saved");
  assert.equal(states.get(first)!.value.boards.length, 2);
  assert.equal(states.get(first)!.value.boards[1].columns[0].items[0].done, true);
  assert.equal(states.get(first)!.value.boards[1].columns[0].items[0].assignees.length, 0);
  checks.push(
    "Only confirmed corrected page reaches the space, preserving completion without guessing identities",
  );
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.getByLabel("New space name", { exact: true }).fill("Design space");
  loseCreation = true;
  await page.getByRole("button", { name: "New space", exact: true }).click();
  await expect(page.locator("#space-status")).not.toBeEmpty();
  assert.equal(states.size, 2);
  await page.getByLabel("New space name", { exact: true }).fill("Design Space Final");
  await page.getByRole("button", { name: "New space", exact: true }).click();
  await expect(page.locator("#status")).toHaveText("Saved");
  await expect(page.getByRole("button", { name: "Switch space" })).toContainText(
    "Design Space Final",
  );
  assert.equal(states.size, 2);
  checks.push("A lost space-creation response reuses its key instead of creating duplicates");
  const second = new URLSearchParams(new URL(page.url()).hash.slice(1)).get("key")!;
  assert.notEqual(first, second);
  assert.equal(states.get(second)!.value.name, "Design Space Final");
  assert.equal(states.get(second)!.value.boards.length, 1);
  assert.equal(states.get(first)!.value.boards.length, 2);
  await page.getByRole("button", { name: "Switch space" }).click();
  await page.locator(".space-option").filter({ hasText: "Launch workspace" }).click();
  await expect(page.getByRole("button", { name: "Switch space" })).toContainText(
    "Launch workspace",
  );
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await expect(page.locator("[data-page]")).toHaveCount(2);
  checks.push(
    "Space creation and return use separate cloud documents without copying or overwriting boards",
  );
  assert.deepEqual(errors, []);
  const result = {
    browser: engine.name(),
    mode: "Native image decoding, IndexedDB and live application UI; explicit fixture cloud and vision responses. This is not a successful real model call.",
    checks,
    errors,
  };
  await Bun.write(
    "../../docs/metrics/photo-spaces-" + engine.name() + ".json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: "../../.private/photo-space-failure.png", fullPage: true });
  console.error(error);
  throw error;
} finally {
  await browser.close();
}
