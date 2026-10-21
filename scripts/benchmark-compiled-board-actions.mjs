// Action matrix for the equally compiled Boards entries (baseline vs state-lib). Sibling of
// benchmark-compiled-board.mjs, which stays the untouched completion benchmark; this script reuses
// its real app/server fixture shape and adds text edit/commit, column move, Undo/Redo after a
// structural move, and cold load. Every action is driven by real (trusted) Playwright input on the
// real DOM; nothing calls a test-only setter.
//
// Timing boundaries (all in-page performance.now):
//  - start: capture-phase listener on the real event (click/keydown) or navigation start for load
//  - handlerMs: a window bubble listener after the app handlers, with a committed-output assertion
//  - nextFrameMs: first requestAnimationFrame after that point (not painted-frame/INP)
//  - load family reports lastResponseMs/postResponseRenderMs instead (metricKind navigation-load)
//  - asyncSettledMs: from start until the save request answered, no pending fetch, idle save state
// Environment: BENCH_ENGINE, BENCH_PORT, BENCH_EVIDENCE, BENCH_FAMILIES, BENCH_COUNTS,
// BENCH_TRIALS (measured pages per backend/cell), BENCH_WARMUP (discarded pages, default 0).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSync, closeSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { loadavg, cpus } from 'node:os';
import { chromium, webkit, firefox } from 'playwright';
import {
  FAMILIES,
  buildActionDocument,
  planAction,
  expectedStages,
  documentDigest,
  verifyInitialState,
  judgeSample,
  judgeAsync,
  compareRuns,
  summarizeRuns,
} from './benchmark-compiled-board-actions-lib.mjs';

const engineName = process.env.BENCH_ENGINE ?? 'chromium';
const engine = { chromium, webkit, firefox }[engineName];
assert(engine, 'Unknown browser engine');
const port = Number(process.env.BENCH_PORT ?? 6983),
  base = 'http://127.0.0.1:' + port;
const output = resolve(process.env.BENCH_EVIDENCE ?? 'test-results/compiled-board-actions');
mkdirSync(output, { recursive: true });
const families = (process.env.BENCH_FAMILIES ?? Object.keys(FAMILIES).join(',')).split(',');
assert(families.every((f) => f in FAMILIES), 'Unknown family in BENCH_FAMILIES');
const counts = (process.env.BENCH_COUNTS ?? '30').split(',').map(Number);
assert(counts.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 10000));
const trials = Number(process.env.BENCH_TRIALS ?? 1);
assert(Number.isSafeInteger(trials) && trials >= 1 && trials <= 17);
const warmups = Number(process.env.BENCH_WARMUP ?? 0);
assert(Number.isSafeInteger(warmups) && warmups >= 0 && warmups <= 3);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const artifactRoot = resolve('dist/specialized-test');
const variants = ['baseline', 'state-lib'].map((name) => ({
  name,
  root: artifactRoot + '-' + name,
  sha256: hash(readFileSync(artifactRoot + '-' + name + '/app.js')),
}));
const sourceHashes = Object.fromEntries(
  ['scripts/benchmark-compiled-board-actions.mjs', 'scripts/benchmark-compiled-board-actions-lib.mjs'].map((f) => [
    f,
    hash(readFileSync(resolve(f))),
  ]),
);
// Negative controls: BENCH_NEGATIVE=wrong-row makes the UI act on the second row while the
// expectations name the first; BENCH_NEGATIVE=stale expects a different seeded fixture. A correct
// harness must report problems and exit non-zero for both.
const negative = process.env.BENCH_NEGATIVE ?? '';
assert(['', 'wrong-row', 'stale'].includes(negative), 'Unknown BENCH_NEGATIVE');
assert(negative !== 'wrong-row' || counts.every((n) => n >= 2), 'wrong-row control needs a second row; use counts of at least 2');
const STEP_TIMEOUT = 15000;
const settle = { timeout: STEP_TIMEOUT };

// Runs in every page before app code. Installs the fetch ledger and the armed-sample recorder. Measures; never mutates app state.
function installProbe() {
  const win = window;
  win.__fetchLog = [];
  win.__pending = 0;
  win.__samples = [];
  const realFetch = win.fetch.bind(win);
  win.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const entry = { url, method: init?.method ?? 'GET', startMs: performance.now(), endMs: null, status: null };
    if (entry.method === 'PUT' && url.includes('/api/state') && typeof init?.body === 'string') entry.body = init.body;
    win.__fetchLog.push(entry);
    win.__pending++;
    return realFetch(input, init).then(
      (response) => {
        entry.endMs = performance.now();
        entry.status = response.status;
        win.__pending--;
        return response;
      },
      (error) => {
        entry.endMs = performance.now();
        entry.error = String(error);
        win.__pending--;
        throw error;
      },
    );
  };
  const rowOf = (id) => document.getElementById('item-' + id);
  const checks = {
    pressed: ({ id, value }) => rowOf(id)?.querySelector('.task-check')?.getAttribute('aria-pressed') === String(value),
    text: ({ id, text, editing }) => {
      const el = rowOf(id)?.querySelector('.task-text');
      return Boolean(el) && el.textContent === text && el.isContentEditable === editing;
    },
    placed: ({ id, column, index }) => {
      const li = rowOf(id);
      if (!li || li.dataset.col !== column) return false;
      const list = [...document.querySelectorAll('#column-' + CSS.escape(column) + ' .task')];
      return (index === -1 ? list.at(-1) : list[index]) === li;
    },
  };
  let armed = null,
    current = null;
  win.__arm = (spec) => {
    armed = spec;
    current = null;
  };
  const begin = (event) => {
    if (!armed || current || event.type !== armed.event) return;
    if (armed.key && event.key !== armed.key) return;
    if (armed.selector && !event.target.closest?.(armed.selector)) return;
    const row = event.target.closest?.('[data-item]') ?? document.activeElement?.closest?.('[data-item]');
    current = {
      stage: armed.stage,
      start: performance.now(),
      trusted: event.isTrusted,
      id: row?.dataset.item ?? armed.rowId,
      expectedId: armed.rowId,
      expectAsync: Boolean(armed.awaitSave),
      done: false,
    };
  };
  const finish = (event) => {
    if (!armed || !current || current.done || event.type !== armed.endEvent) return;
    const sample = current,
      spec = armed;
    sample.done = true;
    sample.handlerMs = performance.now() - sample.start;
    sample.committedAtHandlerEnd = checks[spec.check.kind](spec.check);
    requestAnimationFrame(() => {
      sample.nextFrameMs = performance.now() - sample.start;
      sample.correct = checks[spec.check.kind](spec.check);
      if (!spec.awaitSave) return void win.__samples.push(sample);
      const deadline = performance.now() + 15000;
      const poll = () => {
        const saves = win.__fetchLog.filter(
          (f) => f.method === 'PUT' && f.startMs >= sample.start && Number.isFinite(f.endMs),
        );
        if (saves.length && win.__pending === 0 && document.querySelector('.save-state')?.textContent === '') {
          sample.asyncSettledMs = performance.now() - sample.start;
          return void win.__samples.push(sample);
        }
        if (performance.now() > deadline) {
          sample.asyncSettledMs = null;
          return void win.__samples.push(sample);
        }
        setTimeout(poll, 1);
      };
      poll();
    });
  };
  document.addEventListener('click', begin, true);
  document.addEventListener('keydown', begin, true);
  win.addEventListener('click', finish);
  win.addEventListener('keydown', finish);
  win.addEventListener('input', finish);

}

// Load family only: tracks navigation start to first full board render in the freshly loaded page.
function installLoadTracker(options) {
  const win = window;
  {
    const sample = { stage: 'load', metricKind: 'navigation-load', trusted: true, expectedId: options.firstRowId, id: null };
    const observer = new MutationObserver(() => {
      if (sample.renderCommitMs !== undefined || document.querySelectorAll('.task').length !== options.rows) return;
      observer.disconnect();
      sample.renderCommitMs = performance.now();
      sample.id = document.querySelector('.task')?.dataset.item ?? null;
      sample.committedAtHandlerEnd = true;
      requestAnimationFrame(() => {
        const log = win.__fetchLog;
        const ends = log
          .filter((f) => /\/api\/(state|people)$/.test(new URL(f.url, location.href).pathname))
          .map((f) => f.endMs);
        sample.startupMs = Math.min(...log.map((f) => f.startMs));
        sample.lastResponseMs = Math.max(...ends);
        sample.postResponseRenderMs = sample.renderCommitMs - sample.lastResponseMs;
        sample.nextFrameMs = performance.now() - sample.renderCommitMs;
        sample.totalToFrameMs = performance.now();
        sample.correct = document.querySelectorAll('.task').length === options.rows;
        win.__samples.push(sample);
      });
    });
    observer.observe(document, { childList: true, subtree: true });
  }
}

const log = openSync(output + '/server.log', 'w');
const server = spawn(process.execPath, ['scripts/dev.mjs'], {
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LOCAL_TEST_MODE: '1',
    LOCAL_DATABASE_PATH: ':memory:',
    PORT: String(port),
    APP_ORIGIN: base,
    AUTH_SECRET: 'local-benchmark-fixture',
  },
  stdio: ['ignore', log, log],
});

const stageFetches = (page) => page.evaluate(() => window.__fetchLog.filter((f) => f.method === 'PUT'));
const saveSettled = (page, since) =>
  page.waitForFunction(
    (from) =>
      window.__pending === 0 &&
      document.querySelector('.save-state')?.textContent === '' &&
      window.__fetchLog.filter((f) => f.method === 'PUT' && f.startMs >= from).every((f) => Number.isFinite(f.endMs)),
    since,
    settle,
  );
const sampleCount = (page, n) => page.waitForFunction((count) => window.__samples.length >= count, n, settle);
const storedDocument = async (page) => (await (await page.request.get(base + '/api/state')).json()).value;

/** Performs the family's real UI sequence. Returns the stages with their observed stored digests. */
async function perform(page, family, plan, stages, count, seededRows) {
  const observed = [];
  const actId = negative === 'wrong-row' ? plan.actRowId : plan.rowId;
  const row = () => page.locator('#item-' + actId);
  const arm = (spec) => page.evaluate((s) => window.__arm(s), { rowId: plan.rowId, ...spec });
  const expectStored = async (stage, since) => {
    await saveSettled(page, since);
    const digest = documentDigest(await storedDocument(page));
    observed.push({ stage: stage.name, storedDigest: digest });
  };
  const now = () => page.evaluate(() => performance.now());
  const select = async () => {
    await row().locator('.task-more').click(settle);
    await page.locator('.popover [data-a="select"]').click(settle);
    await page.locator('#item-' + actId + '.selected').waitFor(settle);
  };
  const moveRow = async (stage, timed) => {
    await row().locator('.task-more').click(settle);
    await page.locator('.popover [data-a="move"]').click(settle);
    const target = page.locator(`.dialog [data-move="${plan.toColumnId}"]`);
    await target.waitFor(settle);
    const since = await now();
    if (timed)
      await arm({
        stage: stage.name,
        event: 'click',
        endEvent: 'click',
        selector: '[data-move]',
        awaitSave: true,
        check: { kind: 'placed', id: plan.rowId, column: plan.toColumnId, index: -1 },
      });
    await target.click(settle);
    return since;
  };
  const samplesSoFar = () => page.evaluate(() => window.__samples.length);
  switch (family) {
    case 'completion': {
      const since = await now();
      await arm({
        stage: 'toggle',
        event: 'click',
        endEvent: 'click',
        selector: '.task-check',
        awaitSave: true,
        check: { kind: 'pressed', id: plan.rowId, value: true },
      });
      await row().locator('.task-check').click(settle);
      await sampleCount(page, 1);
      await expectStored(stages[0], since);
      break;
    }
    case 'edit': {
      await row().locator('.task-text').click(settle);
      assert(await row().locator('.task-text').evaluate((el) => el.isContentEditable), 'editor did not open');
      let typed = plan.originalText;
      for (const character of plan.typed) {
        typed += character;
        const before = await samplesSoFar();
        await arm({
          stage: 'keystroke',
          event: 'keydown',
          endEvent: 'input',
          check: { kind: 'text', id: plan.rowId, text: typed, editing: true },
        });
        await page.keyboard.type(character);
        await sampleCount(page, before + 1);
      }
      const before = await samplesSoFar(),
        since = await now();
      await arm({
        stage: 'commit',
        event: 'keydown',
        key: 'Enter',
        endEvent: 'keydown',
        awaitSave: true,
        check: { kind: 'text', id: plan.rowId, text: plan.expectedText, editing: false },
      });
      await page.keyboard.press('Enter');
      await sampleCount(page, before + 1);
      await expectStored(stages[0], since);
      break;
    }
    case 'move': {
      await select();
      const since = await moveRow(stages[0], true);
      await sampleCount(page, 1);
      await expectStored(stages[0], since);
      break;
    }
    case 'history': {
      await select();
      const since = await moveRow(stages[0], false);
      await expectStored(stages[0], since);
      for (const [index, kind] of [
        [1, 'undo'],
        [2, 'redo'],
      ]) {
        await page.locator('.edge-tab[data-nav="more"]').click(settle);
        const button = page.locator('#' + kind);
        await button.waitFor(settle);
        const before = await samplesSoFar(),
          sinceStage = await now();
        await arm({
          stage: kind,
          event: 'click',
          endEvent: 'click',
          selector: '#' + kind,
          awaitSave: true,
          check:
            kind === 'undo'
              ? { kind: 'placed', id: plan.rowId, column: plan.fromColumnId, index: 0 }
              : { kind: 'placed', id: plan.rowId, column: plan.toColumnId, index: -1 },
        });
        await button.click(settle);
        await sampleCount(page, before + 1);
        await expectStored(stages[index], sinceStage);
      }
      break;
    }
    case 'load': {
      await page.addInitScript(installLoadTracker, { rows: seededRows, firstRowId: plan.rowId });
      await page.reload();
      await page.locator('.paper').waitFor(settle);
      await sampleCount(page, 1);
      await page.waitForFunction(() => window.__pending === 0, null, settle);
      observed.push({ stage: 'load', storedDigest: documentDigest(await storedDocument(page)) });
      break;
    }
    default:
      throw Error('Unknown family ' + family);
  }
  return observed;
}

let browser;
const raw = [],
  comparisons = [],
  startLoad = loadavg();
const unionProblems = [];
try {
  for (let n = 0; ; n++) {
    try {
      if ((await fetch(base + '/api/status')).ok) break;
    } catch {}
    if (n >= 100) throw Error('Synthetic API did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await engine.launch();
  for (const family of families)
    for (const count of counts) {
      for (let trial = -warmups; trial < trials; trial++) {
        const pair = {};
        for (const variant of trial % 2 ? [...variants].reverse() : variants) {
          const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
            page = await context.newPage(),
            errors = [],
            record = {
              family,
              backend: variant.name,
              count,
              trial,
              problems: [],
              samples: [],
              load: loadavg(),
            };
          page.on('pageerror', (error) => errors.push(error.message));
          page.setDefaultTimeout(STEP_TIMEOUT);
          try {
            await page.route(base + '/**', (route) => {
              const path = new URL(route.request().url()).pathname;
              if (path.startsWith('/api/')) return route.continue();
              const file = resolve(variant.root, '.' + (path === '/' ? '/index.html' : decodeURIComponent(path)));
              if (!file.startsWith(variant.root + sep) || !existsSync(file))
                return route.fulfill({ status: 404, body: 'Not a compiled asset' });
              const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
              return route.fulfill({
                status: 200,
                contentType: types[extname(file)] ?? 'application/octet-stream',
                body: readFileSync(file),
              });
            });
            await page.addInitScript(installProbe);
            await page.goto(base);
            await page.getByRole('button', { name: 'Open local test workspace', exact: true }).click();
            await page.locator('.paper').waitFor();
            const old = await (await page.request.get(base + '/api/state')).json();
            const seeded = buildActionDocument(old.value, count);
            const plan = planAction(family, seeded);
            plan.actRowId = seeded.boards[0].columns[0].items[1]?.id ?? plan.rowId;
            const stages = expectedStages(family, seeded, plan);
            const seed = await page.request.put(base + '/api/state', {
              headers: { Origin: base },
              data: { version: old.version, value: seeded },
            });
            assert.equal(seed.status(), 200, await seed.text());
            // The server version counter is shared by all pages; compare versions relative to the seed.
            const versionBase = (await seed.json()).version;
            assert(Number.isSafeInteger(versionBase), 'seed response has no numeric version');
            await page.reload();
            await page.locator('.paper').waitFor();
            const visible = Math.min(count, 1200);
            assert.equal(await page.locator('.task').count(), visible);
            await page.evaluate(() => document.fonts.ready);
            const firstBoardIds = seeded.boards[0].columns.flatMap((c) => c.items.map((i) => i.id));
            verifyInitialState({
              backend: await page.locator('html').getAttribute('data-document-backend'),
              expectedBackend: variant.name,
              storedDigest: documentDigest(await storedDocument(page)),
              expectedDigest: negative === 'stale' ? documentDigest(buildActionDocument(old.value, count + 1)) : documentDigest(seeded),
              domRowIds: await page.locator('.task').evaluateAll((els) => els.map((e) => e.dataset.item)),
              expectedRowIds: firstBoardIds,
            });
            await page.evaluate(() => {
              window.__fetchLog.length = 0;
              window.__samples.length = 0;
            });
            const observed = await perform(page, family, plan, stages, count, visible);
            const samples = await page.evaluate(() => window.__samples);
            const fetchLog = await page.evaluate(() => window.__fetchLog);
            const saves = fetchLog
              .filter((f) => f.method === 'PUT' && f.url.includes('/api/state'))
              .map((f) => {
                const body = JSON.parse(f.body);
                return {
                  version: body.version - versionBase,
                  digest: documentDigest(body.value),
                  status: f.status,
                  startMs: f.startMs,
                  endMs: f.endMs,
                };
              });
            const stored = await storedDocument(page);
            const asyncState = {
              pendingFetches: await page.evaluate(() => window.__pending),
              saveState: await page.locator('.save-state').textContent(),
              saves,
              finalStoredDigest: documentDigest(stored),
            };
            record.samples = samples;
            record.saves = saves;
            record.fetches = fetchLog.map(({ body, ...f }) => f);
            record.finalDigest = asyncState.finalStoredDigest;
            record.stageDigests = Object.fromEntries(observed.map((o) => [o.stage, o.storedDigest]));
            record.domOrder = await page.locator('.task').evaluateAll((els) => els.map((e) => e.dataset.item));
            record.selectedIds = await page.locator('.task.selected').evaluateAll((els) => els.map((e) => e.dataset.item));
            record.plan = plan;
            record.topology = seeded.boards.map((b) => ({ id: b.id, columnRows: b.columns.map((c) => c.items.length) }));
            record.stageExpected = stages.map(({ name, digest }) => ({ name, digest }));
            const expectedSamples = { completion: 1, edit: plan.typed?.length + 1, move: 1, history: 2, load: 1 }[family];
            if (samples.length !== expectedSamples)
              record.problems.push(`expected ${expectedSamples} samples, recorded ${samples.length}`);
            for (const sample of samples) record.problems.push(...judgeSample(sample).map((p) => `${sample.stage}: ${p}`));
            record.problems.push(...judgeAsync(asyncState, stages));
            for (const stage of stages)
              if (stage.mutates && record.stageDigests[stage.name] !== stage.digest)
                record.problems.push(`stored document after ${stage.name} differs from the expected document`);
            if (!stages.at(-1).mutates && record.stageDigests.load !== stages[0].digest)
              record.problems.push('stored document changed during load');
            record.problems.push(...errors.map((e) => 'pageerror: ' + e));
          } catch (error) {
            record.problems.push('harness failure: ' + (error?.message ?? String(error)));
          }
          if (trial >= 0) {
            raw.push(record);
            pair[variant.name] = record;
            if (record.problems.length) unionProblems.push(`${family}/${count}/${variant.name}/trial ${trial}: ${record.problems.join('; ')}`);
          }
          await context.close();
        }
        if (trial >= 0 && pair.baseline && pair['state-lib'] && !pair.baseline.problems.length && !pair['state-lib'].problems.length) {
          const differences = compareRuns(pair.baseline, pair['state-lib']);
          comparisons.push({ family, count, trial, differences });
          if (differences.length) unionProblems.push(`${family}/${count}/trial ${trial}: baseline vs state differ: ${differences.join('; ')}`);
        }
      }
      console.log('Finished', family, count, 'rows');
    }
  for (const variant of variants)
    assert.equal(hash(readFileSync(variant.root + '/app.js')), variant.sha256, 'Build changed during measurement');
  const common = {
    date: new Date().toISOString(),
    node: process.version,
    engine: engineName,
    browser: browser.version(),
    logicalCPUs: cpus().length,
    startLoad,
    endLoad: loadavg(),
    variants,
    sourceHashes,
    counts,
    measuredPagesPerBackend: trials,
    warmupPagesPerBackend: warmups,
  };
  const limits = [
    'Product limits unchanged: 200 rows per column and 1200 rows per board. The fixture uses at most 199 rows per column so one moved row never exceeds the limit; sizes above 1200 spill into extra boards in the same document.',
    'This cold first-action series is NOT comparable with the release warmed, repeated completion series (benchmark-compiled-board.mjs); never subtract or rank across them.',
    'Fixture topology (recorded per page in topology): at most 199 rows per column, identical for both backends in a pair; the 1200-row board has 7 columns, unlike the six 200-row columns of the release series.',
    'Fresh page per sample: the recorded action is the first interaction of that action after load (JIT-cold for the action path), not a warmed steady state.',
    'Events are trusted Playwright input; nextFrameMs is the first animation frame after the handler, not painted-frame completion, field INP, or peak memory.',
    'asyncSettledMs is event start to answered save request, no pending fetch and idle save indicator; it includes the sync queue debounce and local server time.',
    'Load family (metricKind navigation-load, no event handler): start is navigation start; lastResponseMs is the last state/people response; postResponseRenderMs is render commit after that response (not an event-handler duration); nextFrameMs is the first frame after commit. Static files are fulfilled from exact build artifacts, so this is not network download timing.',
    'The in-page fetch ledger and a Playwright route are identical for both backends.',
  ];
  for (const family of families) {
    const records = raw.filter((r) => r.family === family);
    writeFileSync(
      output + '/' + FAMILIES[family].artifact.replace(/\.json$/, '') + '-' + engineName + '.json',
      JSON.stringify(
        {
          ...common,
          family,
          description: FAMILIES[family].description,
          settings: FAMILIES[family].settings,
          settingsSha256: hash(JSON.stringify(FAMILIES[family])),
          limits,
          comparisons: comparisons.filter((c) => c.family === family),
          summary: summarizeRuns(records),
          raw: records,
        },
        null,
        2,
      ) + '\n',
    );
  }
  console.log(JSON.stringify(summarizeRuns(raw)));
  if (unionProblems.length) {
    console.error('PROBLEMS:\n' + unionProblems.join('\n'));
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  closeSync(log);
}
