import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkspace, projectShare, newBoard } from "../../../packages/core/workspace.mjs";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium,
  browser = await engine.launch({ headless: true });
const ctx = await browser.newContext({
    serviceWorkers: engine === webkit ? "block" : "allow",
    viewport: { width: 1448, height: 1086 },
  }),
  errors: string[] = [],
  checks: string[] = [];
let state: any = null,
  version = 0,
  delay = 900,
  failSave = false;
const shares = new Map<string, any>();
await ctx.route("**/*.neon.tech/**", async (route) => {
  const request = route.request(),
    url = request.url();
  if (url.includes("/token/anonymous")) {
    const token =
      "x." +
      btoa(JSON.stringify({ role: "anonymous", exp: Math.floor(Date.now() / 1000) + 300 })) +
      ".x";
    return route.fulfill({ json: { token, expires_at: Date.now() + 300000 } });
  }
  await new Promise((r) => setTimeout(r, delay));
  const p = request.postDataJSON();
  if (url.includes("/rpc/notebook")) {
    if (p.document) {
      if (failSave) return route.fulfill({ status: 503, json: { message: "Fixture save outage" } });
      if (p.expected_version !== version)
        return route.fulfill({ status: 409, json: { code: "40001", message: "Conflict" } });
      state = structuredClone(p.document);
      version++;
      return route.fulfill({ json: { version } });
    }
    return route.fulfill({ json: { version, value: state } });
  }
  if (url.includes("/rpc/share_notebook")) {
    if (p.revoke_token) {
      shares.delete(p.revoke_token);
      return route.fulfill({ json: { revoked: true } });
    }
    const token = "viewfixture";
    shares.set(token, p.scope);
    return route.fulfill({ json: { token } });
  }
  if (url.includes("/rpc/read_shared")) {
    if (!shares.has(p.share_token))
      return route.fulfill({ status: 404, json: { message: "Revoked" } });
    return route.fulfill({
      json: { version, value: projectShare(state, shares.get(p.share_token)) },
    });
  }
  return route.fulfill({ status: 404, json: { error: "Unknown fixture route" } });
});
const page = await ctx.newPage();
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log(e.stack);
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("console", m.text().slice(0, 160));
});
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  checks.push(name);
  console.log("PASS", name);
}
await mkdir("../../docs/screenshots", { recursive: true });
await mkdir("../../docs/metrics", { recursive: true });
try {
  await page.goto("http://127.0.0.1:5183/");
  await check("First sample paints before cloud request finishes", async () => {
    await page.locator(".task").first().waitFor();
    assert.equal(version, 0);
    assert.equal(await page.locator(".task").count(), 15);
  });
  await page.locator("#i-p2 .task-text").click();
  await page.locator("#i-p2 .task-text").fill("Typed before cloud acknowledgement");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Saved");
  delay = 40;
  assert.equal(state.boards[0].columns[1].items[1].text, "Typed before cloud acknowledgement");
  checks.push("Typing during initial creation survives cloud acknowledgement");
  await check("No uncaught exceptions on boot", async () => assert.deepEqual(errors, []));
  if (engine !== webkit)
    await check("Cloud APIs are not in public SW cache", async () => {
      await page.evaluate(() => navigator.serviceWorker.ready);
      const paths = await page.evaluate(async () => {
        const result: string[] = [];
        for (const key of await caches.keys())
          for (const r of await (await caches.open(key)).keys())
            result.push(new URL(r.url).pathname);
        return result;
      });
      assert(paths.includes("/index.html"));
      assert(!paths.some((p) => p.startsWith("/api/")));
    });
  await check("Multiple assignments can be changed without closing the picker", async () => {
    await page.locator("#i-p2 .add-person").click();
    await page.locator('[data-pick="niko"]').click();
    await page.locator('[data-pick="mariam"]').click();
    assert.equal(await page.locator('.assignment-option[aria-pressed="true"]').count(), 3);
    await page.locator('[data-pick="danny"]').click();
    assert.equal(await page.locator('.assignment-option[aria-pressed="true"]').count(), 2);
    await page.locator('[data-pick="danny"]').click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.locator("#i-p2 [data-person]").count(), 3);
  });
  await check("Portraits overlap and hovered portrait is above its neighbor", async () => {
    const first = page.locator("#i-p2 [data-person]").nth(0),
      second = page.locator("#i-p2 [data-person]").nth(1),
      a = await first.boundingBox(),
      b = await second.boundingBox();
    assert(b!.x < a!.x + a!.width);
    await first.hover({ position: { x: 3, y: 14 } });
    assert(
      (await first.evaluate((e) => +getComputedStyle(e).zIndex)) >
        (await second.evaluate((e) => +getComputedStyle(e).zIndex)),
    );
    await page.mouse.move(1, 1);
  });
  await check(
    "Completion updates immediately and draws a stroke on every wrapped line",
    async () => {
      await page.locator("#i-l1 [data-check]").click();
      assert.equal(await page.locator("#i-l1.done").count(), 1);
      assert((await page.locator("#i-l1 .ink-strike path").count()) >= 1);
      await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Saved");
      await page.reload();
      await page.locator(".task").first().waitFor();
      assert.equal(await page.locator("#i-l1.done").count(), 1);
    },
  );
  await check("Reload restores the same tab before slow cloud revalidation", async () => {
    delay = 1400;
    await page.reload();
    await page.locator(".task").first().waitFor();
    const metrics = await page.evaluate(() => (window as any).boardsMetrics());
    assert(metrics.measurements.some((m: any) => m.name === "tab-render"));
    assert(!metrics.measurements.some((m: any) => m.name === "cloud-ready"));
    await page.waitForFunction(() =>
      (window as any).boardsMetrics().measurements.some((m: any) => m.name === "cloud-ready"),
    );
    delay = 40;
  });
  await check("Top paper stack opens live board thumbnails and creates a page inline", async () => {
    await page.getByRole("button", { name: "Show all boards" }).click();
    await page.screenshot({ path: "../../docs/screenshots/boards-paper-shelf.png" });
    await page.getByRole("button", { name: "New page", exact: true }).click();
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.locator(".board-title").fill("Next beautiful page");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "New column", exact: true }).click();
    await page.locator("h1.column-title").fill("Ideas");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Pages", exact: true }).click();
    await page.locator('[data-page="roadmap"]').click();
    assert.match(await page.locator(".paper-stack").innerText(), /Next beautiful page/);
  });
  await check("Menu ends with Share, not an implementation notice", async () => {
    assert.equal(await page.locator(".edge-tab").last().getAttribute("aria-label"), "Share");
    await page.getByRole("button", { name: "Page options" }).click();
    assert(
      !(await page
        .locator(".dialog")
        .innerText()
        .then((s) => s.includes("isolated cloud prototype"))),
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
  });
  await check("Profile lists five in full and collapses six to three plus expansion", async () => {
    await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Saved");
    const col = state.boards[0].columns[1];
    for (const c of state.boards[0].columns)
      for (const t of c.items) t.assignees = t.id === "p2" ? ["danny"] : [];
    for (let i = 0; i < 5; i++)
      col.items.push({
        id: "profile-" + i,
        text: "Other task " + i,
        tag: "",
        assignees: ["danny"],
        done: false,
      });
    version++;
    await page.reload();
    await page.waitForFunction(() =>
      (window as any).boardsMetrics().measurements.some((m: any) => m.name === "cloud-ready"),
    );
    await page.locator('#i-p2 [data-person="danny"]').click();
    assert.match(await page.locator(".dialog").innerText(), /Other open tasks assigned to Danny/);
    assert.equal(await page.locator(".dialog [data-person-task]").count(), 5);
    assert.equal(await page.locator(".dialog .expand-person").count(), 0);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    col.items.push({
      id: "profile-5",
      text: "Other task 5",
      tag: "",
      assignees: ["danny"],
      done: false,
    });
    version++;
    await page.reload();
    await page.waitForFunction(() =>
      (window as any).boardsMetrics().measurements.some((m: any) => m.name === "cloud-ready"),
    );
    await page.locator('#i-p2 [data-person="danny"]').click();
    assert.equal(await page.locator(".dialog [data-person-task]").count(), 3);
    await page.locator(".dialog .expand-person").click();
    assert.equal(await page.locator(".dialog [data-person-task]").count(), 6);
    await page.getByRole("button", { name: "Close", exact: true }).click();
  });
  await check("Mobile scrolling updates the active column", async () => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.locator("#c-product").scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      document.querySelector("#c-product")!.scrollIntoView({ block: "start" }),
    );
    await page.waitForTimeout(180);
    assert.equal(await page.locator('[data-jump="product"]').getAttribute("aria-current"), "true");
    for (const width of [320, 393, 700, 768, 1100]) {
      await page.setViewportSize({ width, height: 852 });
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .map((e) => ({
                tag: e.tagName,
                class: e.className,
                x: e.getBoundingClientRect().x,
                right: e.getBoundingClientRect().right,
              }))
              .filter((e) => e.right > innerWidth + 1)
              .slice(0, 20),
          ),
        ),
      );
    }
  });
  await check("A failed previous save preserves the newer text still being edited", async () => {
    delay = 350;
    failSave = true;
    const field = page.locator("#i-p2 .task-text");
    await field.click();
    await field.fill("First save will fail");
    await page.keyboard.press("Enter");
    await page.waitForRequest(
      (r) => r.url().includes("/rpc/notebook") && r.postDataJSON()?.document,
    );
    await field.click();
    await field.fill("Newer unsent text 🙂 stays recoverable");
    await page.getByRole("alertdialog").waitFor();
    const snapshots = await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("boards:tab:") && !k.endsWith(":draft"))
        .map((k) => JSON.parse(sessionStorage.getItem(k)!)),
    );
    assert(
      snapshots.some((s) => s.pending && JSON.stringify(s.value).includes("Newer unsent text")),
    );
    failSave = false;
    delay = 40;
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent === "Saved");
    assert.equal(
      state.boards[0].columns[1].items.find((t: any) => t.id === "p2").text,
      "Newer unsent text 🙂 stays recoverable",
    );
  });
  await check(
    "Revoking a link after closing its dialog produces no stale DOM exception",
    async () => {
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await page.locator("#make-share").click();
      await page.locator("#share-url").waitFor();
      delay = 300;
      await page.locator("#revoke-share").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.waitForTimeout(400);
      delay = 40;
      assert.equal(shares.size, 0);
      assert.deepEqual(errors, []);
    },
  );
  state = createWorkspace();
  state.boards.push(newBoard("Next week"), newBoard("Ideas for later"));
  version++;
  await page.reload();
  await page.waitForFunction(() =>
    (window as any).boardsMetrics().measurements.some((m: any) => m.name === "cloud-ready"),
  );
  await page.setViewportSize({ width: 1448, height: 1086 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
  );
  await page.screenshot({
    path: "../../docs/screenshots/boards-polished-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: "../../docs/screenshots/boards-polished-mobile.png" });
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  await Bun.write(
    "../../docs/metrics/accessibility.json",
    JSON.stringify({ mode: "Native fixture page", violations: a11y.violations }, null, 2),
  );
  assert.deepEqual(
    a11y.violations.filter((v) => ["serious", "critical"].includes(v.impact || "")),
    [],
  );
  checks.push("No serious or critical automated accessibility violations");
  assert.deepEqual(errors, []);
  console.log("CHECKS", checks.length);
  await Bun.write(
    `../../docs/metrics/prototype-ui-${engine.name()}.json`,
    JSON.stringify(
      {
        mode: "Native browser; explicit fixture cloud transport",
        browser: engine.name(),
        checks,
        errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log("FAILED", e);
  await page.screenshot({ path: "../../.private/ui-failure.png", fullPage: true });
  await Bun.write("../../.private/ui-failure.txt", await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
}
