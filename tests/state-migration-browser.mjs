// Real-browser proof that the migrated event handlers read/write the board-state owners
// (HYP-1490). Not part of `npm test` (needs Playwright browsers). Runs the same scenarios on
// the baseline and state-lib builds against the synthetic in-memory dev server.
//   node tests/state-migration-browser.mjs      (env: MIGRATION_PORT, MIGRATION_EVIDENCE)
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,openSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const port = Number(process.env.MIGRATION_PORT || 6571), base = `http://127.0.0.1:${port}`;
const output = resolve(process.env.MIGRATION_EVIDENCE || 'test-results/state-migration');
mkdirSync(output, {recursive: true});

async function startServer(backend) {
  const log = openSync(`${output}/${backend}-server.log`, 'w');
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    env: {PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LOCAL_TEST_MODE: '1', LOCAL_DATABASE_PATH: ':memory:',
      PORT: String(port), APP_ORIGIN: base, AUTH_SECRET: 'synthetic-not-a-secret', BOARDS_STATE_BACKEND: backend},
    stdio: ['ignore', log, log],
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/status')).ok) return child; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill('SIGKILL');
  throw new Error('dev server did not start');
}

const texts = (page, selector) => page.locator(selector).allTextContents();
const order = (page, col) => page.locator(`.column[data-col="${col}"] .task`).evaluateAll((els) => els.map((e) => e.dataset.item));
const login = async (page) => { await page.getByRole('button', {name: 'Open local test workspace', exact: true}).click(); await page.locator('.paper').waitFor(); };
const settle = (page) => page.waitForFunction(() => document.querySelector('.save-state')?.textContent === '');

async function scenarioSelectionAndMenus(page) {
  const row = page.locator('.task[data-item="l2"]');
  await row.locator('[data-item-menu]').click();
  assert.equal(await page.locator('.popover').count(), 1, 'menu opens as the popover resource');
  await page.getByRole('button', {name: 'Select for sharing', exact: true}).click();
  assert.equal(await page.locator('.popover').count(), 0, 'choosing an action disposes the popover');
  assert.match(await row.getAttribute('class'), /\bselected\b/);
  await row.locator('[data-item-menu]').click();
  assert.equal(await page.getByRole('button', {name: 'Deselect', exact: true}).count(), 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.popover').count(), 0, 'Escape closes the popover');
  await row.locator('[data-item-menu]').click();
  await page.mouse.click(5, 5);
  assert.equal(await page.locator('.popover').count(), 0, 'outside pointerdown closes the popover');
  await row.locator('[data-item-menu]').click();
  await page.getByRole('button', {name: 'Share this item', exact: true}).click();
  assert.equal(await page.locator('#share-kind').inputValue(), 'item', 'share dialog reads the selection owner');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[role=dialog]').count(), 0);
}

async function scenarioMoves(page) {
  const before = await order(page, 'landing');
  await page.locator('.task[data-item="l2"] [data-item-menu]').click();
  await page.getByRole('button', {name: 'Move up ↑', exact: true}).click();
  await settle(page);
  const after = await order(page, 'landing');
  assert.deepEqual(after.slice(0, 2), [before[1], before[0]]);
  const columns = await page.locator('.column').evaluateAll((els) => els.map((e) => e.dataset.col));
  await page.locator('.column[data-col="landing"] [data-column-menu]').click();
  await page.getByRole('button', {name: 'Move right ↓', exact: true}).click();
  await settle(page);
  const moved = await page.locator('.column').evaluateAll((els) => els.map((e) => e.dataset.col));
  assert.deepEqual(moved.slice(0, 2), [columns[1], columns[0]]);
  await page.locator('.task[data-item="l1"] [data-done]').click();
  assert.equal(await page.locator('.task[data-item="l1"] [data-done]').getAttribute('aria-pressed'), 'true');
}

async function scenarioEditor(page) {
  const el = page.locator('.task[data-item="l3"] [data-edit="item"]');
  await el.click();
  assert.equal(await el.getAttribute('contenteditable'), 'plaintext-only');
  await page.keyboard.insertText(' (edited)');
  await page.keyboard.press('Escape');
  assert.ok(!(await page.locator('.task[data-item="l3"] [data-edit="item"]').textContent()).includes('(edited)'), 'Escape reverts');
  await page.locator('.task[data-item="l3"] [data-edit="item"]').click();
  await page.keyboard.insertText(' (edited)');
  await page.locator('[data-edit="title"]').click();
  await settle(page);
  assert.match(await page.locator('.task[data-item="l3"] [data-edit="item"]').textContent(), /\(edited\)$/, 'caret at end, blur commits');
  await page.locator('[data-edit="title"]').click();
  await page.keyboard.press('Escape');
  const mention = page.locator('.task[data-item="l4"] [data-edit="item"]');
  await mention.click();
  await page.keyboard.type(' @');
  await page.locator('.popover.mentions').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.popover.mentions').count(), 0);
  assert.equal(await mention.getAttribute('contenteditable'), 'plaintext-only', 'Escape in the mention list keeps editing');
  await page.keyboard.press('Escape');
}

async function scenarioSearchCancellation(page) {
  let slow = true;
  await page.route('**/api/search', async (route) => {
    const query = JSON.parse(route.request().postData()).query;
    if (query === 'Fix' && slow) await new Promise((r) => setTimeout(r, 900));
    const hit = {title: `hit for ${query}`, boardTitle: 'B', columnTitle: 'C', boardId: 'roadmap', itemId: 'l1'};
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({mode: 'words', hits: [hit]})});
  });
  await page.keyboard.press('Control+k');
  const input = page.locator('#search-query');
  await input.fill('Fix');
  await page.waitForTimeout(450);
  await input.fill('Optimize');
  await page.locator('.search-hit', {hasText: 'hit for Optimize'}).waitFor();
  await page.waitForTimeout(1000);
  assert.deepEqual(await texts(page, '.search-hit .text'), ['hit for Optimize'], 'a superseded slow search never renders');
  await input.fill('Fix');
  await page.waitForTimeout(450);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('[role=dialog]').count(), 0, 'closing the dialog cancels the pending search');
  slow = false;
  await page.unroute('**/api/search');
}

async function scenarioDuplicateSuggestion(page) {
  const hit = {title: 'Same thought', boardTitle: 'B', columnTitle: 'C', boardId: 'roadmap', itemId: 'l1'};
  await page.route('**/api/search', (route) => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({mode: 'words', hits: [hit]})}));
  const el = page.locator('.task[data-item="l5"] [data-edit="item"]');
  await el.click();
  await page.keyboard.insertText(' with a longer sentence');
  await page.locator('.popover [data-dismiss]').waitFor();
  assert.equal(await page.locator('.popover [data-hit]').count(), 1, 'debounced task committed and the suggestion popover opened');
  await page.locator('.popover [data-dismiss]').click();
  assert.equal(await page.locator('.popover').count(), 0);
  await page.keyboard.insertText(' more words here');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.popover').count(), 0, 'finishing the edit cancels the pending suggestion');
  await page.unroute('**/api/search');
}

async function scenarioNavigationAndReset(page) {
  await page.getByRole('button', {name: 'Boards and columns', exact: true}).click();
  await page.locator('#new-board').click();
  await page.locator('#name-form input').fill('Second page');
  await page.locator('#name-form button').click();
  await settle(page);
  assert.equal((await page.locator('.board-title').textContent()).toLowerCase(), 'second page', 'new board and boardId change in one action');
  await page.getByRole('button', {name: 'Boards and columns', exact: true}).click();
  await page.locator('[data-board]').first().click();
  assert.notEqual((await page.locator('.board-title').textContent()).toLowerCase(), 'second page');
  await page.getByRole('button', {name: 'Notebook settings and profile', exact: true}).click();
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await page.getByRole('button', {name: 'Open local test workspace', exact: true}).waitFor();
  assert.equal(await page.locator('.popover, .hover-card').count(), 0);
  await login(page);
}

const scenarios = [scenarioSelectionAndMenus, scenarioMoves, scenarioEditor, scenarioSearchCancellation, scenarioDuplicateSuggestion, scenarioNavigationAndReset];
const results = [];
for (const backend of ['baseline', 'state-lib']) {
  const server = await startServer(backend);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${base}/`);
    await page.waitForFunction(() => document.documentElement.dataset.documentBackend);
    assert.equal(await page.locator('html').getAttribute('data-document-backend'), backend, 'explicit build config, not the URL, picks the backend');
    await login(page);
    for (const scenario of scenarios) { await scenario(page); results.push(`PASS ${backend} ${scenario.name}`); }
    await page.goto(`${base}/?stateBackend=state-lib-cow`);
    await page.waitForFunction(() => document.documentElement.dataset.documentBackend);
    assert.equal(await page.locator('html').getAttribute('data-document-backend'), backend, 'a frozen build ignores the URL override');
    assert.deepEqual(errors, [], `${backend} page errors`);
    await page.screenshot({path: `${output}/${backend}.png`, animations: 'disabled'});
  } finally { await browser.close(); server.kill('SIGKILL'); }
}
console.log(results.join('\n'));
