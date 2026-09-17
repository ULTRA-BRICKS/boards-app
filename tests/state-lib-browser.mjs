import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { chromium, webkit } from 'playwright';
const port = 6111, base = `http://127.0.0.1:${port}`;
const out = process.env.PILOT_EVIDENCE || 'docs/state-lib-browser-evidence';
mkdirSync(out, { recursive: true });
const log = openSync(`${out}/server.log`, 'w');
const server = spawn(process.execPath, ['scripts/dev.mjs'], {
  env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    LOCAL_TEST_MODE: '1', PORT: String(port), APP_ORIGIN: base,
    AUTH_SECRET: 'synthetic-pilot-secret-not-production' },
  stdio: ['ignore', log, log],
});
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(base + '/api/status')).ok; } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, 'Owned synthetic server must be reachable');
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch();
    try {
      for (const backend of ['baseline', 'state-lib']) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = []; page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(base + '/?stateBackend=' + backend);
        await page.getByRole('button', { name: 'Open local test workspace', exact: true }).click();
        await page.locator('.paper').waitFor();
        assert.equal(await page.locator('html').getAttribute('data-workspace-backend'), backend);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `${out}/${engine}-${backend}-desktop.png`, animations: 'disabled' });
        const checkbox = page.locator('.task-check').first();
        const original = await checkbox.getAttribute('aria-pressed');
        const saved = page.waitForResponse((r) => r.url().endsWith('/api/state') && r.request().method() === 'PUT');
        await checkbox.click(); assert.equal((await saved).status(), 200);
        assert.equal(await page.locator('.task-check').first().getAttribute('aria-pressed'), String(original !== 'true'));
        await page.getByRole('button', { name: 'Notebook settings and profile', exact: true }).click();
        const undoSaved = page.waitForResponse((r) => r.url().endsWith('/api/state') && r.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Undo ↶', exact: true }).click();
        assert.equal((await undoSaved).status(), 200);
        await page.reload(); await page.locator('.paper').waitFor();
        assert.equal(await page.locator('.task-check').first().getAttribute('aria-pressed'), original);
        await page.setViewportSize({ width: 393, height: 852 });
        await page.screenshot({ path: `${out}/${engine}-${backend}-mobile.png`, animations: 'disabled' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.getByRole('button', { name: 'Notebook settings and profile', exact: true }).click();
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('button', { name: 'Open local test workspace', exact: true }).waitFor();
        assert.deepEqual(errors, []);
        results.push({ engine, backend, passed: true, authenticatedCrud: true, undoReload: true, logout: true });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  console.info('PASS: real boards baseline/state-lib loading, edit/save/undo/reload, mobile and logout in both engines');
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2) + '\n');
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('exit', resolve));
  }
  closeSync(log);
}
