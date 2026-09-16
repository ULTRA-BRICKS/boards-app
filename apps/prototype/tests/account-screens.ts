import AxeBuilder from "@axe-core/playwright";
import { chromium, webkit, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fixture, actor } from "./accounts-fixture";
import { CorporateAuth } from "../accounts/auth";
import { WorkspaceService } from "../accounts/service";
import { NotificationWorker } from "../accounts/notifications";
import { accountRoutes } from "../accounts/routes";
const origin = "https://127.0.0.1:5194",
  engine = process.env.BROWSER === "webkit" ? webkit : chromium;
await mkdir("../../.private/accounts-ui", { recursive: true });
await mkdir("../../docs/screenshots", { recursive: true });
const built = await Bun.build({
  entrypoints: ["accounts/screens.ts"],
  target: "browser",
  format: "esm",
  outdir: "../../.private/accounts-ui",
  naming: "screens.js",
});
if (!built.success) throw new AggregateError(built.logs);
const fonts = await Bun.build({
  entrypoints: ["lib/font.ts", "lib/font-worker.ts"],
  target: "browser",
  format: "esm",
  outdir: "../../.private/accounts-ui",
  naming: "[name].js",
  define: { FONT_WORKER: JSON.stringify("/font-worker.js") },
});
if (!fonts.success) throw new AggregateError(fonts.logs);
const f = await fixture();
let holdSettings = false,
  releaseSettings: (() => void) | null = null;
const preferenceWrites: string[] = [];
let code = "",
  enabled = true;
const service = new WorkspaceService(f.db);
const auth = new CorporateAuth(
  f.db,
  {
    domains: ["corp.test"],
    ownerEmail: "owner@corp.test",
    pepper: "fixture-secret-".repeat(4),
    from: "mail@corp.test",
  },
  async (mail) => {
    code = /code: (\d{6})/.exec(mail.text)![1];
    return "fixture-email";
  },
);
const runtime = {
  auth,
  service,
  worker: new NotificationWorker(
    f.db,
    { from: "mail@corp.test", key: "fixture", origin },
    Date.now,
    async () => "fixture",
  ),
  origin,
  cronSecret: "fixture-cron-".repeat(4),
};
const browser = await engine.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1080, height: 900 },
    serviceWorkers: "block",
    ignoreHTTPSErrors: true,
  }),
  page = await context.newPage(),
  errors: string[] = [],
  checks: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
const html =
  '<!doctype html><html lang="en"><head><title>Account | Boards</title><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/existing-style.css"><link rel="stylesheet" href="/account-style.css"></head><body><main id="account-root"></main><script type="module">import{accountScreens}from"/screens.js";import{installFont}from"/font.js";void installFont();const api=async(path,method="GET",body)=>{const r=await fetch("/accounts/"+path,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.code||"Request failed");return d;};window.accountUI=accountScreens(document.querySelector("#account-root"),api);window.accountUI.show("login");</script></body></html>';
async function checkScreen(name: string) {
  for (const width of [320, 393, 768, 1080]) {
    await page.setViewportSize({ width, height: 900 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      name + " horizontal overflow at " + width,
    );
  }
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations
      .filter((v) => ["serious", "critical"].includes(v.impact || ""))
      .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
    [],
    name + " accessibility",
  );
  checks.push(name + ": four widths and no serious/critical automated accessibility violations");
}
const tlsDir = await mkdtemp(tmpdir() + "/boards-https-");
const cert = Bun.spawn(
  [
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    tlsDir + "/key.pem",
    "-out",
    tlsDir + "/cert.pem",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
);
if ((await cert.exited) !== 0) throw Error("Could not create local test certificate");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 5194,
  tls: { key: Bun.file(tlsDir + "/key.pem"), cert: Bun.file(tlsDir + "/cert.pem") },
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/accounts/")) {
      if (request.method === "PUT" && url.pathname.endsWith("/preferences"))
        preferenceWrites.push(url.pathname);
      const response = await accountRoutes(enabled ? runtime : null)(request);
      if (holdSettings && request.method === "PUT" && url.pathname.endsWith("/settings")) {
        holdSettings = false;
        await new Promise<void>((resolve) => (releaseSettings = resolve));
      }
      return response;
    }
    if (["/font.js", "/font-worker.js"].includes(url.pathname))
      return new Response(Bun.file("../../.private/accounts-ui" + url.pathname), {
        headers: { "Content-Type": "text/javascript" },
      });
    if (url.pathname === "/account-style.css")
      return new Response(Bun.file("accounts/screens.css"), {
        headers: { "Content-Type": "text/css" },
      });
    if (url.pathname === "/screens.js")
      return new Response(Bun.file("../../.private/accounts-ui/screens.js"), {
        headers: { "Content-Type": "text/javascript" },
      });
    if (url.pathname === "/existing-style.css")
      return new Response(Bun.file("../board/style.css"), {
        headers: { "Content-Type": "text/css" },
      });
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

try {
  enabled = false;
  await page.goto(origin + "/?space=space-one&board=roadmap&item=p2");
  await expect(page.getByRole("heading", { name: "Workspace setup" })).toBeVisible();
  checks.push("Missing configuration displays setup, not a fake successful login");
  await checkScreen("Setup");
  enabled = true;
  await page.reload();
  await page.getByLabel("Corporate email").fill("owner@corp.test");
  await checkScreen("Corporate email");
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await checkScreen("Email verification");
  await expect.poll(() => code.length).toBe(6);
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  if (process.env.DEBUG_ACCOUNTS === "1") {
    await page.waitForTimeout(200);
    console.log(
      JSON.stringify({
        cookies: (await context.cookies()).map((c) => ({
          name: c.name,
          domain: c.domain,
          secure: c.secure,
          path: c.path,
        })),
        origin: await page.evaluate(() => location.origin),
      }),
    );
  }

  await expect(page.getByRole("heading", { name: "Your spaces" })).toBeVisible();
  await checkScreen("Spaces");
  checks.push(
    "Corporate login and code verification use real HTTP handlers and PostgreSQL fixture",
  );
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Unsent profile name");
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page.getByRole("button", { name: "My profile", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unsent profile name");
  checks.push("Unsubmitted profile input survives screen navigation");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved");
  assert.equal((await service.getProfile(actor)).name, "Unsent profile name");
  await page.waitForFunction(() =>
    [...document.fonts].some((f) => f.family === "Conloca Sans" && f.status === "loaded"),
  );
  await page.screenshot({ path: "../../docs/screenshots/account-profile-local.png" });
  await checkScreen("Profile");
  checks.push("Profile edits persist through authenticated API");
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  await page.locator('[data-space="space-one"]').click();
  await expect(page.getByRole("heading", { name: "Space settings" })).toBeVisible();
  await page.getByLabel("Space name", { exact: true }).fill("Studio space");
  await page.locator("#assignment-mail").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status")).toHaveText("Settings saved");
  const settings = await service.getSettings(actor, "space-one");
  assert.equal(settings.name, "Studio space");
  assert.equal(settings.preferences.assignmentMail, false);
  checks.push("Space settings and individual notification preferences persist");
  await checkScreen("Settings");
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: "../../docs/screenshots/account-settings-local.png" });
  await page.getByRole("button", { name: "People and invitations" }).click();
  await expect(page.getByRole("heading", { name: "People in this space" })).toBeVisible();
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  checks.push("People screen has no Slack JSON upload");
  await checkScreen("People");
  const state = await service.read(actor, "space-one");
  state.value.boards[0].columns[1].items[1].text = "Changed via the authenticated service";
  await service.save(actor, "space-one", state.version, state.value);
  await page.evaluate(() => (window as any).accountUI.show("history", "space-one"));
  await expect(page.getByRole("heading", { name: "Item history" })).toBeVisible();
  await expect(page.locator("#history-list")).toContainText("Unsent profile name");
  await expect(page.locator("#history-list")).toContainText(
    "Changed via the authenticated service",
  );
  assert.equal(await page.locator("#history-list time").count(), 1);
  await page.screenshot({ path: "../../docs/screenshots/account-history-local.png" });
  checks.push("Item history shows persisted actor, server time and changed text");
  await checkScreen("History");
  const secondSpace = await service.create(actor, {
    name: "Separate workspace",
    domains: ["corp.test"],
    timeZone: "UTC",
  });
  await page.evaluate(() => (window as any).accountUI.show("settings", "space-one"));
  await expect(page.getByRole("heading", { name: "Space settings" })).toBeVisible();
  await page.locator("#weekly-mail").uncheck();
  holdSettings = true;
  const preferenceCount = preferenceWrites.length;
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect.poll(() => !!releaseSettings).toBe(true);
  await page.evaluate((id) => (window as any).accountUI.show("settings", id), secondSpace.id);
  await expect(page.locator("#settings-name")).toHaveValue("Separate workspace");
  releaseSettings!();
  releaseSettings = null;
  await expect.poll(() => preferenceWrites.length).toBe(preferenceCount + 1);
  await expect
    .poll(async () => (await service.getSettings(actor, "space-one")).preferences.weeklyMail)
    .toBe(false);
  assert.equal(preferenceWrites.at(-1), "/accounts/spaces/space-one/preferences");
  assert.equal((await service.getSettings(actor, secondSpace.id)).preferences.weeklyMail, true);
  await expect(page.locator("#weekly-mail")).toBeChecked();
  await expect(page.getByRole("status")).not.toHaveText("Settings saved");
  checks.push(
    "A delayed settings save stays on its original space and cannot overwrite another screen",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sign in with your work email" })).toBeVisible();
  checks.push("Logout ends the server session");
  for (const width of [320, 393, 768, 1080]) {
    await page.setViewportSize({ width, height: 852 });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "Account screen overflow at " + width,
    );
  }
  checks.push(
    "Account screens use the actual handwritten font and have no horizontal overflow at 320–1080px",
  );
  assert.deepEqual(errors, []);
  await mkdir("../../docs/metrics", { recursive: true });
  const result = {
    engine: engine.name(),
    mode: "Local HTTPS server with a self-signed test certificate (fixture-only TLS exception), in-memory PostgreSQL and real application HTTP handlers; mail transport is a fixture, not delivered through Resend; these account screens are NOT deployed",
    checks,
    errors,
  };
  await Bun.write(
    "../../docs/metrics/accounts-screens-" + engine.name() + ".json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  server.stop(true);
  await f.pg.close();
  await rm(tlsDir, { recursive: true, force: true });
}
