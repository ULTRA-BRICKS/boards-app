// Real-DOM proof of the action-probe-v2 event-end boundary (scripts/benchmark-compiled-board-actions-probe.mjs).
// SYNTHETIC PAGE: a tiny stand-in for the Boards editor wiring (row markup, delegated #app click and
// keydown handlers, an editor whose onkeydown commits on Enter), not the product. Every case uses
// trusted Playwright input and the exact installProbe the matrix installs, and is judged with the
// matrix's judgeSample. Correctness only: prints pass/fail per case, never timings.
// Run: node tests/benchmark-action-probe-browser.mjs [chromium,webkit]
import assert from 'node:assert/strict';
import { chromium, webkit, firefox } from 'playwright';
import { installProbe } from '../scripts/benchmark-compiled-board-actions-probe.mjs';
import { PROBE_VERSION, judgeSample } from '../scripts/benchmark-compiled-board-actions-lib.mjs';

const PAGE = `<!doctype html><title>Synthetic probe proof (not Boards)</title>
<main id="app"><ul>
<li class="task selected" id="item-r1" data-item="r1" data-col="c1"><button class="task-check" data-done aria-pressed="false">o</button><div class="task-text" data-edit="item" tabindex="0">Alpha</div></li>
<li class="task" id="item-r2" data-item="r2" data-col="c1"><button class="task-check" data-done aria-pressed="false">o</button><div class="task-text" data-edit="item" tabindex="0">Beta</div></li>
</ul></main><div class="save-state"></div>`;

// Synthetic app: mode flags choose the editor handler variant. Runs as a page script.
function syntheticApp(mode) {
  const app = document.getElementById('app');
  window.__log = [];
  window.__appEnd = null;
  const markEnd = (what) => {
    window.__log.push(what);
    window.__appEnd = performance.now();
  };
  const busy = () => {
    const until = performance.now() + 3;
    while (performance.now() < until);
  };
  const commit = (el) => {
    el.contentEditable = 'false';
    el.removeAttribute('contenteditable');
    el.textContent = el.textContent.trim();
    busy();
    if (mode.replace) {
      const li = el.closest('li');
      li.outerHTML = li.outerHTML; // detaches the focused editor, like a full board render
    }
  };
  const handler = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (mode.stop) e.stopPropagation();
    if (mode.stopImmediate) e.stopImmediatePropagation();
    commit(e.currentTarget);
    markEnd('editor-onkeydown');
    if (mode.throwAfterCommit) throw Error('synthetic handler error after commit');
  };
  const startEdit = (el) => {
    el.contentEditable = 'plaintext-only';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    if (mode.lateListener) window.__registerLate = () => el.addEventListener('keydown', handler);
    else el.onkeydown = handler;
    if (mode.reassign) el.oninput = () => (el.onkeydown = (e) => handler(e)); // like the mentions popover
  };
  app.onclick = (e) => {
    const t = e.target.closest('[data-edit],[data-done]');
    if (!t) return;
    if (t.hasAttribute('data-done')) {
      t.setAttribute('aria-pressed', 'true');
      busy();
      return markEnd('delegated-click');
    }
    startEdit(t);
  };
  app.onkeydown = (e) => {
    if (e.target.matches('[data-edit]') && !e.target.isContentEditable && e.key === 'Enter') {
      window.__log.push('delegated-reentry');
      startEdit(e.target);
    }
  };
}

const enterCheck = (id, text) => ({ kind: 'text', id, text, editing: false, selected: id === 'r1', noOpenEditor: true });
// expect: 'pass' = judgeSample clean; 'fail' = judgeSample must report problems; 'none' = no sample may be recorded.
const CASES = [
  { name: 'stopPropagation, editor detached by full render', mode: { stop: true, replace: true }, expect: 'pass', bubble: false, log: ['editor-onkeydown'] },
  { name: 'stopPropagation, editor kept (row-local patch)', mode: { stop: true }, expect: 'pass', bubble: false, log: ['editor-onkeydown'] },
  { name: 'no stopPropagation, editor detached (old baseline)', mode: { replace: true }, expect: 'pass', bubble: true, log: ['editor-onkeydown', 'delegated-reentry'] },
  { name: 'onkeydown reassigned after the probe attached', mode: { stop: true, reassign: true }, expect: 'pass', bubble: false, log: ['editor-onkeydown'] },
  { name: 'handler throws after commit: error still reported', mode: { stop: true, throwAfterCommit: true }, expect: 'pass', bubble: false, log: ['editor-onkeydown'], pageError: /synthetic handler error/ },
  { name: 'NEGATIVE re-entry reopens the kept editor', mode: {}, expect: 'fail', bubble: true, log: ['editor-onkeydown', 'delegated-reentry'], problem: /did not complete/ },
  { name: 'NEGATIVE app listener registered after the probe', mode: { stop: true, lateListener: true }, expect: 'fail', problem: /not committed|handler/ },
  { name: 'NEGATIVE early observer (document capture)', mode: { stop: true }, negative: 'early-observer', expect: 'fail', problem: /not committed/ },
  { name: 'NEGATIVE microtask queued from capture', mode: { stop: true }, negative: 'capture-microtask', expect: 'fail', problem: /not committed/ },
  { name: 'NEGATIVE wrong row', mode: { stop: true }, row: 'r2', expect: 'fail', problem: /wrong row/ },
  { name: 'NEGATIVE stopImmediatePropagation hides the end: no sample', mode: { stopImmediate: true }, expect: 'none' },
  { name: 'NEGATIVE v1 window-bubble end with stopPropagation: no sample', mode: { stop: true }, boundary: 'window-bubble', expect: 'none' },
];

// Served from a fulfilled route on a reserved origin so init scripts run; nothing leaves the process.
const SYNTHETIC_URL = 'http://synthetic-probe.invalid/';
async function openSynthetic(page) {
  await page.route(SYNTHETIC_URL + '**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto(SYNTHETIC_URL);
}

async function runCase(browser, c) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(installProbe, { negative: c.negative ?? '', probeVersion: PROBE_VERSION });
    await openSynthetic(page);
    await page.evaluate(syntheticApp, c.mode);
    const row = c.row ?? 'r1';
    await page.locator(`#item-${row} .task-text`).click();
    await page.evaluate(
      (spec) => window.__arm(spec),
      { rowId: 'r1', stage: 'commit', event: 'keydown', key: 'Enter', endEvent: 'keydown', boundary: c.boundary ?? 'editor-target', check: enterCheck('r1', 'Alpha-x') },
    );
    if (c.mode.lateListener) await page.evaluate(() => window.__registerLate());
    await page.keyboard.type('-x');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const samples = await page.evaluate(() => window.__samples);
    const state = await page.evaluate(() => ({ log: window.__log, appEnd: window.__appEnd }));
    const out = [];
    if (c.expect === 'none') {
      if (samples.length) out.push('a sample was recorded although the end listener must not run');
      return out;
    }
    if (samples.length !== 1) return [`expected 1 sample, got ${samples.length}`];
    const [s] = samples;
    const problems = judgeSample(s);
    if (c.expect === 'pass') {
      if (problems.length) out.push('judge: ' + problems.join('; '));
      if (!(state.appEnd <= s.start + s.handlerMs)) out.push('probe end precedes the end of the app handler');
      if (s.boundary !== 'editor-target') out.push('boundary ' + s.boundary);
    } else if (!problems.length || (c.problem && !c.problem.test(problems.join('; ')))) {
      out.push(`negative control not caught as expected: ${JSON.stringify(problems)}`);
    }
    if (c.bubble !== undefined && (s.windowBubbleMs !== null) !== c.bubble)
      out.push(`window bubble reached=${s.windowBubbleMs !== null}, expected ${c.bubble} (propagation must stay as the app decides)`);
    if (c.log) assert.deepEqual(state.log, c.log, 'app handler sequence changed');
    if (c.pageError ? !errors.some((e) => c.pageError.test(e)) : errors.length) out.push('page errors: ' + JSON.stringify(errors));
    return out;
  } catch (error) {
    return ['harness failure: ' + error.message];
  } finally {
    await page.close();
  }
}

// Delegated click keeps the v1 window-bubble boundary: it must end after the #app click handler.
async function runClickCase(browser) {
  const page = await browser.newPage();
  try {
    await page.addInitScript(installProbe, { probeVersion: PROBE_VERSION });
    await openSynthetic(page);
    await page.evaluate(syntheticApp, {});
    await page.evaluate((spec) => window.__arm(spec), {
      rowId: 'r1', stage: 'toggle', event: 'click', endEvent: 'click', selector: '.task-check', boundary: 'window-bubble',
      check: { kind: 'pressed', id: 'r1', value: true },
    });
    await page.locator('#item-r1 .task-check').click();
    await page.waitForTimeout(100);
    const [s] = await page.evaluate(() => window.__samples);
    const appEnd = await page.evaluate(() => window.__appEnd);
    const out = judgeSample(s ?? null);
    if (s && !(appEnd <= s.start + s.handlerMs)) out.push('click end precedes the delegated handler end');
    return out;
  } finally {
    await page.close();
  }
}

const engines = (process.argv[2] ?? 'chromium,webkit').split(',');
let failed = 0;
for (const name of engines) {
  const browser = await { chromium, webkit, firefox }[name].launch();
  try {
    console.log(`# ${name} ${browser.version()} probe ${PROBE_VERSION}`);
    for (const c of [...CASES, { name: 'delegated click ends at window bubble', click: true }]) {
      const problems = c.click ? await runClickCase(browser) : await runCase(browser, c);
      if (problems.length) failed++;
      console.log(`${problems.length ? 'FAIL' : 'PASS'} ${name}: ${c.name}${problems.length ? ' :: ' + problems.join(' | ') : ''}`);
    }
  } finally {
    await browser.close();
  }
}
console.log(failed ? `${failed} case(s) failed` : 'all cases passed');
process.exitCode = failed ? 1 : 0;
