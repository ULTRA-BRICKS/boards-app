// Real-browser proof that the migrated event handlers read/write the board-state owners
// (HYP-1490). Not part of `npm test` (needs Playwright browsers). Runs the same scenarios on
// the baseline and state-lib builds against the synthetic in-memory dev server.
//   node tests/state-migration-browser.mjs      (env: MIGRATION_PORT, MIGRATION_EVIDENCE)
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,openSync,readFileSync,existsSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
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
  await page.evaluate(()=>{window.__unchangedRow=document.querySelector('.task[data-item="l3"]');window.__completedRow=document.querySelector('.task[data-item="l1"]');});
  await page.locator('.task[data-item="l1"] [data-done]').click();
  assert.equal(await page.locator('.task[data-item="l1"] [data-done]').getAttribute('aria-pressed'), 'true');
  if(await page.locator('html').getAttribute('data-document-backend')==='state-lib'){
    assert.equal(await page.evaluate(()=>window.__unchangedRow===document.querySelector('.task[data-item="l3"]')),true,'Completion must not recreate unrelated immutable rows');
    assert.equal(await page.evaluate(()=>window.__completedRow===document.querySelector('.task[data-item="l1"]')),true,'The completed row and its control retain identity');
    const completion=page.locator('.task[data-item="l1"] [data-done]');
    await completion.focus();
    const scroll=await page.evaluate(()=>window.scrollY);
    await page.keyboard.press('Space');
    assert.equal(await completion.getAttribute('aria-pressed'),'false');
    assert.match(await completion.getAttribute('aria-label'),/^Complete /);
    assert.equal(await completion.evaluate(node=>document.activeElement===node),true,'Reopening preserves the keyboard target');
    await page.keyboard.press('Space');
    assert.equal(await completion.getAttribute('aria-pressed'),'true');
    assert.match(await completion.getAttribute('aria-label'),/^Reopen /);
    assert.equal(await completion.evaluate(node=>document.activeElement===node),true,'Consecutive Space activation works without refocusing');
    assert.equal(await page.evaluate(()=>window.scrollY),scroll,'Field-only completion preserves scroll');
  }
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

const openSettings = (page) => page.getByRole('button', {name: 'Notebook settings and profile', exact: true}).click();

// Undo/redo go through the shared Runtime history; the rendered order must follow it.
async function scenarioUndoRedo(page) {
  const before = await order(page, 'landing');
  await page.locator('.task[data-item="l3"] [data-item-menu]').click();
  await page.getByRole('button', {name: 'Move up ↑', exact: true}).click();
  await settle(page);
  const moved = await order(page, 'landing');
  assert.notDeepEqual(moved, before, 'the move changed the order');
  await openSettings(page);
  await page.locator('#undo').click();
  assert.deepEqual(await order(page, 'landing'), before, 'undo restores the previous order');
  await openSettings(page);
  await page.locator('#redo').click();
  assert.deepEqual(await order(page, 'landing'), moved, 'redo re-applies the move');
  await openSettings(page);
  await page.locator('#undo').click();
  await settle(page);
  assert.deepEqual(await order(page, 'landing'), before, 'final undo leaves the document as it started');
}

// Private UI state (selection, popovers) and in-flight async results must not survive sign-out/relogin.
async function scenarioSignoutRelogin(page) {
  const row = page.locator('.task[data-item="l4"]');
  await row.locator('[data-item-menu]').click();
  await page.getByRole('button', {name: 'Select for sharing', exact: true}).click();
  assert.match(await row.getAttribute('class'), /\bselected\b/);
  assert.ok(await page.locator('.task.selected').count() >= 2, 'earlier selection is still present before sign-out');
  let slow = true;
  await page.route('**/api/search', async (route) => {
    if (slow) await new Promise((r) => setTimeout(r, 900));
    const hit = {title: 'stale hit from the old session', boardTitle: 'B', columnTitle: 'C', boardId: 'roadmap', itemId: 'l1'};
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify({mode: 'words', hits: [hit]})});
  });
  await page.keyboard.press('Control+k');
  await page.locator('#search-query').fill('Stale');
  await page.waitForTimeout(450);
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await page.getByRole('button', {name: 'Open local test workspace', exact: true}).waitFor();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.search-hit').count(), 0, 'a search started before sign-out never renders');
  await login(page);
  slow = false;
  await page.unroute('**/api/search');
  assert.equal(await page.locator('.task.selected').count(), 0, 'selection did not leak into the next session');
  assert.equal(await page.locator('.popover, .hover-card, [role=dialog]').count(), 0, 'no chrome from the previous session');
  assert.equal(await page.locator('.search-hit').count(), 0);
}


const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const openBoards = (page) => page.getByRole('button', {name: 'Boards and columns', exact: true}).click();
const json = (body, status = 200) => ({status, contentType: 'application/json', body: JSON.stringify(body)});

// Real IME: CDP drives a genuine composition session (not insertText alone). Composition events must fire and the text must survive.
async function composeIme(page, steps, commit) {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    if (window.__imeInstalled) { window.__ime.length = 0; return; }
    window.__imeInstalled = true; window.__ime = [];
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(type, (e) => window.__ime.push(`${type}:${e.data}`), true);
  });
  const midTexts = [];
  for (const text of steps) {
    await cdp.send('Input.imeSetComposition', {text, selectionStart: text.length, selectionEnd: text.length});
    midTexts.push(await page.evaluate(() => document.activeElement.value ?? document.activeElement.textContent));
  }
  await cdp.send('Input.insertText', {text: commit});
  const events = await page.evaluate(() => [...window.__ime]);
  await cdp.detach();
  return {events, midTexts};
}

async function scenarioImeComposition(page) {
  const el = page.locator('.task[data-item="l5"] [data-edit="item"]');
  const original = await el.textContent();
  await el.click();
  assert.equal(await el.getAttribute('contenteditable'), 'plaintext-only');
  const {events, midTexts} = await composeIme(page, ['に', 'にほ', 'にほん'], '日本');
  assert.ok(events.some((e) => e.startsWith('compositionstart')), `compositionstart fired: ${events}`);
  assert.ok(events.filter((e) => e.startsWith('compositionupdate')).length >= 2, `compositionupdate fired: ${events}`);
  assert.ok(events.some((e) => e.startsWith('compositionend')), `compositionend fired: ${events}`);
  assert.ok(midTexts.at(-1).includes('にほん'), `the in-progress composition is in the field: ${midTexts}`);
  assert.equal(await el.getAttribute('contenteditable'), 'plaintext-only', 'composition does not end the edit session');
  const text = await el.textContent();
  assert.ok(text.startsWith(original) && text.endsWith('日本'), `original text kept and committed text appended: ${text}`);
  assert.ok(!text.includes('にほん'), 'the composition string was replaced by the committed text');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.task[data-item="l5"] [data-edit="item"]').textContent(), original, 'Escape still reverts after IME');
}

// The label of the save status must survive the re-render that every change triggers (baseline lost it).
async function scenarioSaveStatusSurvivesRerender(page) {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await gate;
    return route.fallback();
  });
  const status = page.locator('.save-state');
  await page.locator('.task[data-item="l2"] [data-done]').click();
  assert.equal(await status.textContent(), 'Ink drying…', 'the label painted by the change survives its own re-render');
  await page.waitForFunction(() => document.querySelector('.save-state')?.textContent === 'Saving…');
  await openBoards(page);
  await page.locator('[data-board]').first().click();
  assert.equal(await status.textContent(), 'Saving…', 'a navigation re-render while saving keeps the current label');
  release();
  await page.unroute('**/api/state');
  await settle(page);
  await page.locator('.task[data-item="l2"] [data-done]').click();
  await settle(page);
}

async function scenarioSearchAndMentionCursors(page) {
  const hits = [0, 1, 2].map((n) => ({title: `cursor hit ${n}`, boardTitle: 'B', columnTitle: 'C', boardId: 'roadmap', itemId: 'l1'}));
  await page.route('**/api/search', (route) => route.fulfill(json({mode: 'words', hits})));
  await page.keyboard.press('Control+k');
  await page.locator('#search-query').fill('cursor');
  await page.locator('.search-hit').nth(2).waitFor();
  const activeIndex = () => page.locator('.search-hit').evaluateAll((els) => els.findIndex((e) => e.classList.contains('active')));
  assert.equal(await activeIndex(), 0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await activeIndex(), 2, 'the cursor owner clamps at the last hit');
  await page.keyboard.press('ArrowUp');
  assert.equal(await activeIndex(), 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await page.locator('#search-query').fill('cursor');
  await page.locator('.search-hit').nth(2).waitFor();
  assert.equal(await activeIndex(), 0, 'a reopened search starts at the first hit');
  await page.keyboard.press('Escape');
  await page.unroute('**/api/search');

  const el = page.locator('.task[data-item="l5"] [data-edit="item"]');
  await el.click();
  await page.keyboard.type(' @');
  await page.locator('.popover.mentions').waitFor();
  const options = await page.locator('.popover.mentions [data-pick]').count();
  const mentionActive = () => page.locator('.popover.mentions [data-pick]').evaluateAll((els) => els.findIndex((e) => e.classList.contains('active')));
  assert.equal(await mentionActive(), 0);
  if (options > 1) {
    await page.keyboard.press('ArrowDown');
    assert.equal(await mentionActive(), 1, 'mention cursor moves down');
    await page.keyboard.press('ArrowUp');
    assert.equal(await mentionActive(), 0, 'and back up');
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

async function scenarioDialogDraftsAndSettings(page) {
  await openSettings(page);
  await page.locator('#workspace-settings').click();
  const space = page.locator('#settings-form input[name=space]');
  const original = await space.inputValue();
  await space.fill('Draft name, not saved');
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.locator('#workspace-settings').click();
  assert.equal(await page.locator('#settings-form input[name=space]').inputValue(), original, 'a cancelled draft never leaks into the next dialog');
  await page.locator('#settings-form input[name=space]').fill('Renamed space');
  await page.locator('#settings-form button').click();
  await settle(page);
  await openSettings(page);
  await page.locator('#workspace-settings').click();
  assert.equal(await page.locator('#settings-form input[name=space]').inputValue(), 'Renamed space', 'submitting reads the live inputs');
  await page.locator('#settings-form input[name=space]').fill(original);
  await page.locator('#settings-form button').click();
  await settle(page);
}

// Photo review: edit, confirm and cancel through the owned session, with real IME composition in the review form.
async function scenarioPhotoReview(page) {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill(json({...body, ai: {...body.ai, vision: true}}));
  });
  await page.reload();
  await page.locator('.paper').waitFor();
  const draft = {board: {id: 'photo', title: 'From photo', columns: [{id: 'c1', title: 'Launch', items: [
    {id: 'i1', text: 'Ship it', tag: 'D', assignees: ['someone']}, {id: 'i2', text: 'Drop me', tag: '', assignees: []}]}]}, warnings: []};
  let imported;
  await page.route('**/api/photo', (route) => route.fulfill(json(draft)));
  await page.route('**/api/import', (route) => { imported = JSON.parse(route.request().postData()).board; return route.fulfill(json({boardId: 'roadmap'})); });
  const openReview = async () => {
    await openBoards(page);
    await page.locator('#photo-import').click();
    await page.locator('#photo-file').setInputFiles({name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64')});
    await page.locator('.preview-photo').waitFor();
    await page.locator('#read-photo').click();
    await page.locator('form.photo-review').waitFor();
  };
  await openReview();
  await page.locator('form.photo-review label:has-text("Page title") input').fill('  Edited title ');
  const thought = page.locator('form.photo-review textarea').first();
  await thought.click();
  await page.keyboard.press('End');
  const {events} = await composeIme(page, ['に', 'にほ'], '日本');
  assert.ok(events.some((e) => e.startsWith('compositionstart')) && events.some((e) => e.startsWith('compositionend')), `review form IME events: ${events}`);
  assert.equal(await thought.inputValue(), 'Ship it日本', 'composition text is preserved in the review textarea');
  await page.locator('form.photo-review textarea').nth(1).locator('xpath=ancestor::div[contains(@class,"review-row")]').locator('input[type=checkbox]').uncheck();
  await page.locator('form.photo-review .review-consent input').check();
  await page.locator('form.photo-review button[type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('form.photo-review'));
  assert.equal(imported.title, 'Edited title');
  assert.equal(imported.columns.length, 1);
  assert.deepEqual(imported.columns[0].items.map((i) => i.text), ['Ship it日本'], 'unchecked thought dropped, composed text kept');
  assert.deepEqual(imported.columns[0].items[0].assignees, [], 'a hint never becomes an assignee');
  assert.equal(imported.columns[0].items[0].tag, 'D');

  // Closing the dialog while the transcription is still being read must leave nothing behind.
  await page.unroute('**/api/photo');
  await page.route('**/api/photo', async (route) => { await new Promise((r) => setTimeout(r, 700)); return route.fulfill(json(draft)); });
  await openBoards(page);
  await page.locator('#photo-import').click();
  await page.locator('#photo-file').setInputFiles({name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64')});
  await page.locator('.preview-photo').waitFor();
  await page.locator('#read-photo').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('form.photo-review, [role=dialog]').count(), 0, 'a stale transcription never renders into a closed dialog');
  await page.unroute('**/api/photo'); await page.unroute('**/api/import'); await page.unroute('**/api/status');
  await page.reload();
  await page.locator('.paper').waitFor();
}

// A ticket lookup that finishes after sign-out must not seed the next session's cache.
async function scenarioStaleTicketAfterSignout(page) {
  const el = page.locator('.task[data-item="l5"] [data-edit="item"]');
  await el.click();
  await page.keyboard.insertText(' ABC-123');
  await page.locator('[data-edit="title"]').click();
  await settle(page);
  await openBoards(page);
  await page.locator('[data-board]').first().click();
  let session = 'old';
  await page.route('**/api/ticket', async (route) => {
    const answering = session;
    if (answering === 'old') await new Promise((r) => setTimeout(r, 900));
    return route.fulfill(json({title: `${answering} session ticket`, label: 'ABC-123', kind: 'issue', state: 'open', provider: 'linear', url: 'https://linear.app/x', description: ''}));
  });
  await page.locator('a[data-ticket="ABC-123"]').first().click();
  await page.locator('[role=dialog]').waitFor();
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.getByRole('button', {name: 'Sign out', exact: true}).click();
  await page.getByRole('button', {name: 'Open local test workspace', exact: true}).waitFor();
  await page.waitForTimeout(1300);
  session = 'new';
  await login(page);
  await page.locator('a[data-ticket="ABC-123"]').first().click();
  await page.getByRole('heading', {name: 'new session ticket'}).waitFor({timeout: 5000});
  await page.keyboard.press('Escape');
  await page.unroute('**/api/ticket');
}

const all = [scenarioSelectionAndMenus, scenarioMoves, scenarioEditor, scenarioImeComposition, scenarioSearchCancellation, scenarioSearchAndMentionCursors,
  scenarioDuplicateSuggestion, scenarioDialogDraftsAndSettings, scenarioUndoRedo, scenarioSignoutRelogin, scenarioStaleTicketAfterSignout, scenarioSaveStatusSurvivesRerender, scenarioPhotoReview, scenarioNavigationAndReset];
const only = (process.env.MIGRATION_ONLY || '').split(',').filter(Boolean);
const scenarios = only.length ? all.filter((fn) => only.includes(fn.name)) : all;
const results = [];
for (const backend of ['baseline', 'state-lib']) {
  const server = await startServer(backend);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 900}});
    if(process.env.MIGRATION_COMPILED_ROOT){
      const root=resolve(process.env.MIGRATION_COMPILED_ROOT+'-'+backend);
      const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.json':'application/json'};
      if(!existsSync(root+'/state.manifest.json'))throw Error('Missing compiled entry '+root);
      await page.route(base+'/**',route=>{
        const path=new URL(route.request().url()).pathname;
        if(path.startsWith('/api/'))return route.continue();
        const file=resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));
        if(!file.startsWith(root+sep)||!existsSync(file))return route.fulfill({status:404,body:'Not in compiled entry'});
        return route.fulfill({status:200,contentType:types[extname(file)]??'application/octet-stream',body:readFileSync(file)});
      });
    }
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
