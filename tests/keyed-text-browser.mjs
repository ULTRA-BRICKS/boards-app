// Real-browser differential for text commits and Undo/Redo of text (HYP-1740).
// The same scripted user session runs against the original full renderer (stateBackend=baseline, which never takes a
// keyed path) and the state-lib backend (row-local patch). After every step the serialised board, focus, selection,
// scroll and the PUT /api/state payloads must be identical; a `.paper` expando set before the step shows which steps
// really took the patch path (survives) and which fell back to the full render (replaced).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const port = Number(process.env.KEYED_TEXT_PORT || 6951);
const origin = `http://127.0.0.1:${port}`;
const TEXT = 'See ABC-12 and acme/app#5 <b>x</b> & "q"';

async function session(backend) {
  const server = spawn(process.execPath, ['scripts/dev.mjs'], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LOCAL_TEST_MODE: '1',
      LOCAL_DATABASE_PATH: ':memory:',
      PORT: String(port),
      APP_ORIGIN: origin,
      AUTH_SECRET: 'synthetic-not-a-secret',
    },
    stdio: 'ignore',
  });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        ready = (await fetch(origin + '/api/status')).ok;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert(ready, 'server starts');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [],
      puts = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith('/api/state')) puts.push(JSON.parse(r.postData()).value);
    });
    // KEYED_COMPILED_ROOT=<dir prefix> serves the fixed compiled entries <prefix>-baseline / <prefix>-state-lib instead.
    if (process.env.KEYED_COMPILED_ROOT) {
      const root = resolve(process.env.KEYED_COMPILED_ROOT + '-' + backend);
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.html': 'text/html', '.json': 'application/json' };
      await page.route(origin + '/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith('/api/')) return route.continue();
        const file = resolve(root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
        if (!file.startsWith(root + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: 'Not in compiled entry' });
        return route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
      });
    }
    await page.goto(origin + '/?stateBackend=' + backend);
    await page.getByRole('button', { name: 'Open local test workspace', exact: true }).click();
    await page.locator('.paper').waitFor();
    const settle = () => page.waitForFunction(() => document.querySelector('.save-state')?.textContent === '');
    const marker = () => page.evaluate(() => (document.querySelector('.paper').__keep = true));
    let id = '';
    const snap = async (name, { patched = null, editors = 0, ignore = [] } = {}) => {
      await page.waitForTimeout(260);
      if (process.env.KEYED_SHOTS && ['type-enter', 'no-change-enter', 'composition-enter', 'undo-text', 'redo-text'].includes(name))
        await page.screenshot({ path: `${process.env.KEYED_SHOTS}/${backend}-${name}.png` });
      const state = await page.evaluate(() => {
        const a = document.activeElement,
          s = getSelection();
        return {
          columns: document.querySelector('.columns').outerHTML,
          title: document.title,
          active: a === document.body ? 'BODY' : `${a.tagName}.${a.className}[${a.dataset.edit ?? ''}]`,
          editors: document.querySelectorAll('[contenteditable="plaintext-only"]').length,
          selection: s.rangeCount ? (s.isCollapsed ? 'collapsed' : 'range') : 'none',
          // Raw anchor differs by design: the full renderer detaches the edited node (the browser relocates the caret to the
          // first text of the page), the patch keeps it inside the row. Reported, not compared.
          selectionRaw: s.rangeCount ? `${s.anchorNode?.nodeName} in ${s.anchorNode?.parentElement?.tagName}.${s.anchorNode?.parentElement?.className}:${s.anchorOffset}-${s.focusOffset} ${s.anchorNode?.isConnected}` : 'none',
          scrollY,
          kept: document.querySelector('.paper')?.__keep === true,
          popovers: document.querySelectorAll('.popover').length,
        };
      });
      const last = puts.at(-1);
      // New row ids are random uuids; every other id is a stable fixture id.
      const anonymous = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'NEW');
      state.payload = last ? anonymous(JSON.stringify(last)) : null;
      state.columns = anonymous(state.columns);
      if (patched !== null && backend !== 'baseline')
        assert.equal(state.kept, patched, `${name}: ${patched ? 'row-local patch' : 'full render'} expected`);
      assert.equal(state.editors, editors, `${name}: ${editors ? 'the editor stays open' : 'every inline editor is closed (no Enter re-entry)'}`);
      state.ignore = ignore;
      steps[name] = state;
    };
    const steps = {};
    const row = () => page.locator(`[data-item="${id}"]`);
    const text = () => row().locator('[data-edit="item"]');
    const press = async (key) => {
      await page.keyboard.press(key);
      await settle().catch(() => {});
    };
    await settle();

    // 1. add an item (structural, full render) then type linked text and commit with Enter
    await page.locator('[data-add-item]').first().click();
    id = await page.locator('[contenteditable="plaintext-only"]').evaluate((el) => el.closest('[data-item]').dataset.item);
    await page.locator('[contenteditable="plaintext-only"]').fill(TEXT);
    await marker();
    await press('Enter');
    await snap('type-enter', { patched: true });
    steps['type-enter'].enterErrors = errors.splice(0);

    // 2. edit and commit by blur (170 ms timer)
    await text().click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('End');
    await page.keyboard.type(' more');
    await marker();
    await page.mouse.click(2, 450);
    await page.waitForTimeout(300);
    await settle().catch(() => {});
    await snap('blur', { patched: true });

    // 3. no-change Enter restores linked HTML and drops editing residue the browser left on the editor element
    await text().click({ position: { x: 3, y: 3 } });
    await text().evaluate((el) => el.setAttribute('style', ''));
    await marker();
    await press('Enter');
    await snap('no-change-enter', { patched: true });

    // 4. cancel with Escape
    await text().click({ position: { x: 3, y: 3 } });
    await page.keyboard.type('zzz');
    await marker();
    await press('Escape');
    await snap('escape', { patched: true });

    // 5. whitespace-only change trims back to the old text
    await text().click({ position: { x: 3, y: 3 } });
    await page.keyboard.type('   ');
    await marker();
    await press('Enter');
    await snap('whitespace-only', { patched: true });

    // 6. empty text
    await text().click({ position: { x: 3, y: 3 } });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await marker();
    await press('Enter');
    await snap('empty-text', { patched: true });

    // 7. IME composition keeps the editor open and untouched until committed. Enter or Escape pressed while the
    // composition is active (Chromium reports isComposing) belongs to the IME: it must neither commit nor cancel the edit.
    await text().click({ position: { x: 3, y: 3 } });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ね', selectionStart: 1, selectionEnd: 1 });
    await marker();
    await snap('composition-open', { patched: true, editors: 1 });
    await page.keyboard.press('Enter');
    await snap('composition-enter', { patched: true, editors: 1 });
    await page.keyboard.press('Escape');
    await snap('composition-escape', { patched: true, editors: 1 });
    await cdp.send('Input.insertText', { text: 'ねこ ABC-9' });
    await press('Enter');
    await snap('composition-commit', { patched: true });
    const composed = await text().innerText();
    assert(composed.endsWith('ねこ ABC-9') && !composed.includes('ねね'), `the confirmed composition is committed once: ${composed}`);

    // 8. Undo and Redo of that text, through the real More dialog
    const more = async (name) => {
      await page.getByRole('button', { name: 'Notebook settings and profile', exact: true }).click();
      await marker();
      await page.getByRole('button', { name, exact: true }).click();
      await settle().catch(() => {});
    };
    await more('Undo ↶');
    await snap('undo-text', { patched: true });
    await more('Redo ↷');
    await snap('redo-text', { patched: true });

    // 9. fallbacks keep the full renderer: board title edit, and a structural Undo (removing the added item)
    await page.locator('[data-edit="title"]').click();
    await page.keyboard.type('!');
    await marker();
    await press('Enter');
    await snap('title-edit', { patched: false });
    await page.locator('[data-add-item]').nth(1).click();
    await page.locator('[contenteditable="plaintext-only"]').fill('second');
    await press('Enter');
    await more('Undo ↶');
    await snap('undo-second-text', { patched: true });
    await more('Undo ↶');
    await snap('undo-structural', { patched: false });

    // 10. completion keeps its row-local path; with an editor open, or after a dialog closed an editor, the DOM no
    // longer equals the last rendered root, so the full renderer must run (stale-witness guard)
    await marker();
    await page.locator('.task [data-done]').first().click();
    await settle().catch(() => {});
    // Existing HYP-1737 behaviour, unchanged here: the completion patch leaves focus on the pressed button, the full render drops it.
    await snap('complete', { patched: true, ignore: ['active'] });
    const first = page.locator('.task [data-edit="item"]').first();
    await first.click({ position: { x: 3, y: 3 } });
    await page.keyboard.type('q');
    await marker();
    await page.locator('.task [data-done]').nth(1).click();
    await settle().catch(() => {});
    await snap('complete-while-editing', { patched: false });
    await first.click({ position: { x: 3, y: 3 } });
    await page.keyboard.type('w');
    await more('Undo ↶');
    await snap('dialog-commit-then-undo', { patched: false });

    // 11. (candidate only: the baseline never patches) a row write that throws after earlier writes of the same row:
    // the view must be rebuilt by the full renderer, the actual error must still surface, and the next commit must take
    // the row-local path again rather than trust a half-written view
    if (backend !== 'baseline') {
      const known = errors.length;
      await first.click({ position: { x: 3, y: 3 } });
      await page.keyboard.press('End');
      await page.keyboard.type(' failing');
      await first.evaluate((el) =>
        Object.defineProperty(el, 'outerHTML', {
          configurable: true,
          set() {
            throw Error('injected row write failure');
          },
        }),
      );
      await marker();
      await press('Enter');
      await page.waitForTimeout(260);
      const failed = await page.evaluate(() => ({
        kept: document.querySelector('.paper').__keep === true,
        editors: document.querySelectorAll('[contenteditable="plaintext-only"]').length,
        text: document.querySelector('.task [data-edit="item"]').innerText,
        ownSetter: Object.hasOwn(document.querySelector('.task [data-edit="item"]'), 'outerHTML'),
      }));
      assert.deepEqual(errors.splice(known), ['injected row write failure'], 'the write failure is exposed, not swallowed');
      assert.equal(failed.kept, false, 'a failed row patch is replaced by the full renderer');
      assert.equal(failed.ownSetter, false, 'the half-written row node is gone');
      assert.equal(failed.editors, 0);
      assert(failed.text.endsWith(' failing'), `the committed text is shown: ${failed.text}`);
      await first.click({ position: { x: 3, y: 3 } });
      await page.keyboard.type('!');
      await marker();
      await press('Enter');
      await page.waitForTimeout(260);
      assert.equal(await page.evaluate(() => document.querySelector('.paper').__keep === true), true, 'the next commit patches again');
      assert.deepEqual(errors.splice(known), []);
    }
    return { steps, errors };
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
  }
}

import { writeFileSync } from 'node:fs';
const only = process.env.KEYED_ONLY;
const baseline = await session('baseline');
if (only === 'baseline') {
  if (process.env.KEYED_DUMP) writeFileSync(process.env.KEYED_DUMP, JSON.stringify(baseline, null, 1));
  console.log('baseline observed:', Object.keys(baseline.steps).join(', '));
  console.log('Enter re-entry observation (baseline backend):', JSON.stringify(baseline.steps['type-enter'].enterErrors), 'editors:', baseline.steps['type-enter'].editors, 'active:', baseline.steps['type-enter'].active);
  process.exit(0);
}
const candidate = await session('state-lib');
if (process.env.KEYED_DUMP) writeFileSync(process.env.KEYED_DUMP, JSON.stringify({ baseline, candidate }, null, 1));
for (const name of Object.keys(baseline.steps)) {
  const a = baseline.steps[name],
    b = candidate.steps[name];
  assert(b, `${name} ran in both backends`);
  for (const key of ['columns', 'title', 'active', 'editors', 'selection', 'scrollY', 'popovers', 'payload', 'enterErrors'].filter(
    (key) => !b.ignore.includes(key),
  ))
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      const x = JSON.stringify(a[key]) ?? '',
        y = JSON.stringify(b[key]) ?? '';
      let i = 0;
      while (i < x.length && x[i] === y[i]) i++;
      assert.fail(`${name}: ${key} differs between full renderer and row-local patch\n full : ...${x.slice(Math.max(0, i - 90), i + 160)}\n patch: ...${y.slice(Math.max(0, i - 90), i + 160)}`);
    }
}
assert.deepEqual(candidate.errors, baseline.errors, 'page errors are identical');
console.log('Enter re-entry observation (baseline backend):', JSON.stringify(baseline.steps['type-enter'].enterErrors), 'editors:', baseline.steps['type-enter'].editors, 'active:', baseline.steps['type-enter'].active);
console.log(`PASS: ${Object.keys(baseline.steps).length} steps are identical between the full renderer and the row-local patch`);
