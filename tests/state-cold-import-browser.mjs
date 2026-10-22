// Real-browser parity for the cold-import change (HYP-1737). Not part of `npm test` (needs Playwright browsers and
// a "before" checkout). For Chromium and WebKit, each of baseline/state-lib in the uncompiled and the fixed (compiled)
// entry, it runs the same cold load, first edit + save, Undo + save, stale reload and three load-error cases against
// the BEFORE sources and the AFTER sources, and requires identical rendered DOM, PUT bodies and error text.
// /api/state is served from one captured fixture so every variant sees the same document and PUT bodies are comparable.
//   COLD_IMPORT_BEFORE=<checkout of the previous commit with dist/fixed-{baseline,state-lib}>
//   COLD_IMPORT_AFTER_FIXED=dist/cold-import-fixed   (prefix; -baseline / -state-lib appended)
//   node tests/state-cold-import-browser.mjs        (env: COLD_IMPORT_PORT, COLD_IMPORT_EVIDENCE)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium, webkit } from 'playwright';

const before = resolve(process.env.COLD_IMPORT_BEFORE ?? '');
assert(process.env.COLD_IMPORT_BEFORE && existsSync(before + '/apps/board/app.mjs'), 'Set COLD_IMPORT_BEFORE');
const after = resolve('.');
const afterFixed = resolve(process.env.COLD_IMPORT_AFTER_FIXED ?? 'dist/cold-import-fixed');
const port = Number(process.env.COLD_IMPORT_PORT ?? 7613),
  base = 'http://127.0.0.1:' + port;
const output = resolve(process.env.COLD_IMPORT_EVIDENCE ?? 'test-results/cold-import');
mkdirSync(output, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const BOARD_FILES = new Set(['/app.mjs', '/boot.mjs', '/state-config.mjs', '/board-state.mjs', '/board-commands.mjs', '/document-action.mjs', '/board-row-view.mjs', '/style.css', '/refinements.css', '/photo-review.mjs']);

/** Maps a non-API URL path to a file of one variant, mirroring scripts/dev.mjs for source trees. */
function staticFile(variant, path) {
  if (variant.fixed) return resolve(variant.root, '.' + (path === '/' ? '/index.html' : path));
  if (path === '/' || path === '/index.html') return resolve(variant.root, 'apps/board/index.html');
  if (BOARD_FILES.has(path)) return resolve(variant.root, 'apps/board' + path);
  if (/^\/packages\/(font|core|state-lib)\//.test(path)) return resolve(variant.root, '.' + path);
  return null;
}
const variants = [];
for (const [side, root, fixedRoot] of [
  ['before', before, before + '/dist/fixed'],
  ['after', after, afterFixed],
])
  for (const backend of ['baseline', 'state-lib']) {
    variants.push({ side, backend, entry: 'uncompiled', fixed: false, root });
    variants.push({ side, backend, entry: 'fixed', fixed: true, root: fixedRoot + '-' + backend });
  }
for (const v of variants.filter((v) => v.fixed)) v.appJs = hash(readFileSync(v.root + '/app.js'));

const titleOf = (text) => JSON.parse(text).value.boards[0].title;
const withTitle = (text, title) => {
  const envelope = JSON.parse(text);
  envelope.value.boards[0].title = title;
  return JSON.stringify(envelope);
};

async function run(engineName, engine) {
  // Refuse a port another harness already serves; otherwise readiness would silently test that foreign server.
  const occupied = await fetch(base + '/api/status').then(() => true, () => false);
  assert.equal(occupied, false, `Port ${port} is already in use; set COLD_IMPORT_PORT`);
  const log = openSync(`${output}/${engineName}-server.log`, 'w');
  const server = spawn(process.execPath, ['scripts/dev.mjs'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LOCAL_TEST_MODE: '1', LOCAL_DATABASE_PATH: ':memory:', PORT: String(port), APP_ORIGIN: base, AUTH_SECRET: 'cold-import-browser-fixture' },
    stdio: ['ignore', log, log],
  });
  let browser;
  const results = [];
  let fixture;
  try {
    for (let n = 0; ; n++) {
      try {
        if ((await fetch(base + '/api/status')).ok) break;
      } catch {}
      if (n >= 100) throw Error('Synthetic API did not start');
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(server.exitCode, null, 'The ready server must be the one this harness started');
    browser = await engine.launch();
    for (const variant of variants) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage(),
        errors = [],
        puts = [],
        steps = {};
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('dialog', (dialog) => dialog.accept());
      // Counts whole-call structuredClone use so the eliminated load copy is observed in the real page, not inferred.
      await page.addInitScript(() => {
        const clone = globalThis.structuredClone;
        globalThis.__coldImportClones = 0;
        globalThis.structuredClone = function (value, options) {
          globalThis.__coldImportClones++;
          return clone.call(this, value, options);
        };
      });
      // GET /api/state behavior queue; PUT is answered locally so the server document never drifts.
      const plan = [];
      let rejectPut = 0;
      await page.route(base + '/**', async (route) => {
        const url = new URL(route.request().url()),
          method = route.request().method();
        if (url.pathname === '/api/state' && method === 'GET') {
          if (!fixture) fixture = await (await route.fetch()).text();
          const next = plan.shift() ?? { body: fixture };
          if (next.hold) await next.hold;
          return route.fulfill({ status: next.status ?? 200, contentType: 'application/json', body: next.body });
        }
        if (url.pathname === '/api/state' && method === 'PUT') {
          const input = route.request().postData();
          if (rejectPut > 0) {
            rejectPut--;
            return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic stale version' }) });
          }
          puts.push(hash(input));
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: JSON.parse(input).version + 1 }) });
        }
        if (url.pathname.startsWith('/api/') || url.pathname === '/placeholder.svg') return route.continue();
        const file = staticFile(variant, url.pathname);
        if (!file || !(file === variant.root || file.startsWith(variant.root + sep)) || !existsSync(file)) return route.fulfill({ status: 404, body: 'Not found' });
        return route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'text/plain', body: readFileSync(file) });
      });
      const saved = () => page.waitForResponse((r) => r.url() === base + '/api/state' && r.request().method() === 'PUT');
      const settle = () => page.waitForFunction(() => document.querySelector('.save-state')?.textContent === '');
      const paper = async () => hash(await page.locator('.paper').evaluate((el) => el.outerHTML));
      const more = async (action) => {
        await page.getByRole('button', { name: 'Notebook settings and profile', exact: true }).click();
        const response = saved();
        await page.getByRole('button', { name: action, exact: true }).click();
        await response;
        await settle();
      };
      try {
        await page.goto(base + (variant.fixed ? '/' : '/?stateBackend=' + variant.backend));
        await page.getByRole('button', { name: 'Open local test workspace', exact: true }).click();
        await page.locator('.paper').waitFor();
        assert.equal(await page.locator('html').getAttribute('data-document-backend'), variant.backend);
        steps.load = await paper();
        const loadClones = await page.evaluate(() => globalThis.__coldImportClones);
        steps.tasks = await page.locator('.task').count();
        const first = page.locator('.task').first(),
          id = await first.getAttribute('data-item');
        const was = await first.locator('[data-done]').getAttribute('aria-pressed'),
          flipped = was === 'true' ? 'false' : 'true';
        let response = saved();
        await first.locator('[data-done]').click();
        await response;
        await settle();
        assert.equal(await page.locator(`[data-item="${id}"] [data-done]`).getAttribute('aria-pressed'), flipped);
        steps.edit = await paper();
        await more('Undo ↶');
        assert.equal(await page.locator(`[data-item="${id}"] [data-done]`).getAttribute('aria-pressed'), was);
        steps.undo = await paper();
        // Stale: two overlapping reloads; the first response is held and arrives last, and must not win.
        let release;
        plan.push({ hold: new Promise((r) => (release = r)), body: withTitle(fixture, 'Stale title') }, { body: withTitle(fixture, 'Fresh title') });
        rejectPut = 1;
        await page.locator(`[data-item="${id}"] [data-done]`).click();
        await page.getByRole('dialog', { name: 'Your last edits are not saved', exact: true }).waitFor();
        await page.evaluate(() => {
          const button = document.querySelector('#reload-cloud');
          button.click();
          button.click();
        });
        await page
          .waitForFunction(() => document.querySelector('[data-edit="title"]')?.textContent === 'Fresh title', null, { timeout: 10000 })
          .catch(async (error) => {
            const seen = await page.evaluate(() => ({ title: document.querySelector('[data-edit="title"]')?.textContent, dialog: !!document.querySelector('#reload-cloud'), gate: document.querySelector('.gate')?.textContent?.slice(0, 200) }));
            throw Error(`stale reload did not render the fresh document: ${JSON.stringify({ seen, pendingPlan: plan.length, errors })}`, { cause: error });
          });
        release();
        await page.waitForTimeout(300);
        steps.stale = { title: await page.locator('[data-edit="title"]').textContent(), paper: await paper(), plan: plan.length };
        assert.equal(steps.stale.title, 'Fresh title');
        assert.equal(titleOf(fixture) === 'Fresh title', false);
        // Load errors at cold start: the setup screen shows the loader's message.
        steps.errors = {};
        for (const [kind, status, body] of [
          ['http', 500, JSON.stringify({ error: 'Synthetic load failure' })],
          ['syntax', 200, '{"version":1,"value":'],
          ['nonfinite', 200, fixture.replace('"title":', '"limit":1e999,"title":')],
        ]) {
          plan.push({ status, body });
          await page.reload();
          await page.locator('.gate .form-error, .paper').first().waitFor();
          steps.errors[kind] = (await page.locator('.paper').count())
            ? 'rendered:' + (await paper())
            : 'error:' + (await page.locator('.gate .form-error').textContent());
        }
        await page.screenshot({ path: `${output}/${engineName}-${variant.side}-${variant.entry}-${variant.backend}.png`, animations: 'disabled' });
        results.push({ engine: engineName, ...variant, root: undefined, steps, puts, errors, loadClones });
        console.info('DONE', engineName, variant.side, variant.entry, variant.backend, 'loadClones=' + loadClones, JSON.stringify(steps.errors));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    // A server killed by a signal keeps exitCode null and has already emitted 'exit'.
    if (server.exitCode === null && server.signalCode === null) {
      const exit = once(server, 'exit');
      server.kill('SIGTERM');
      await exit;
    }
    closeSync(log);
  }
  return results;
}

const all = [];
for (const [name, engine] of [
  ['chromium', chromium],
  ['webkit', webkit],
])
  all.push(...(await run(name, engine)));
writeFileSync(`${output}/results.json`, JSON.stringify(all, null, 2) + '\n');
for (const result of all) assert.deepEqual(result.errors, [], `${result.engine} ${result.side} ${result.entry} ${result.backend}: page errors`);
// Before/after parity for every engine, entry and backend: identical DOM, PUT bodies and error outcomes.
for (const result of all.filter((r) => r.side === 'after')) {
  const prior = all.find((r) => r.side === 'before' && r.engine === result.engine && r.entry === result.entry && r.backend === result.backend);
  assert.deepEqual(result.steps, prior.steps, `${result.engine} ${result.entry} ${result.backend}: UI differs from before`);
  assert.deepEqual(result.puts, prior.puts, `${result.engine} ${result.entry} ${result.backend}: PUT bodies differ from before`);
  // Exactly the replace() load copy disappears on state-lib; the baseline path is untouched.
  assert.equal(result.loadClones, prior.loadClones - (result.backend === 'state-lib' ? 1 : 0), `${result.engine} ${result.entry} ${result.backend}: load clone count`);
}
// The ordinary flow is also identical across backends and entries (the non-finite document is a known baseline gap).
for (const result of all) {
  const reference = all.find((r) => r.engine === result.engine && r.side === 'before' && r.entry === 'uncompiled' && r.backend === 'baseline');
  for (const step of ['load', 'tasks', 'edit', 'undo', 'stale']) assert.deepEqual(result.steps[step], reference.steps[step], `${result.engine} ${result.side} ${result.entry} ${result.backend}: ${step}`);
  assert.deepEqual(result.puts, reference.puts);
  assert.equal(result.steps.errors.http, 'error:Synthetic load failure');
  assert.equal(result.steps.errors.syntax, 'error:The server did not return a valid response.');
}
console.info('PASS cold-import browser parity', all.length, 'runs');
