// Action matrix for the equally compiled Boards entries (baseline vs state-lib). Sibling of
// benchmark-compiled-board.mjs, which stays the untouched completion benchmark; this script reuses
// its real app/server fixture shape and adds text edit/commit, column move, Undo/Redo after a
// structural move, and cold load. Every action is driven by real (trusted) Playwright input on the
// real DOM; nothing calls a test-only setter.
//
// Timing boundaries (all in-page performance.now; probe action-probe-v2, see
// benchmark-compiled-board-actions-probe.mjs and PROBE_VERSION/END_BOUNDARIES in the lib):
//  - start: capture-phase listener on the real event (click/keydown) or navigation start for load
//  - handlerMs: keydown ends on the focused editor after its onkeydown (survives stopPropagation);
//    click/input end at a window bubble listener after the app handlers; both assert committed output
//  - nextFrameMs: first requestAnimationFrame after that point (not painted-frame/INP)
//  - load family reports lastResponseMs/postResponseRenderMs instead (metricKind navigation-load)
//  - asyncSettledMs: from start until the save request answered, no pending fetch, idle save state
// HYP-1740 adds field-history (commit text, Undo it, Redo it); history stays the structural
// move+Undo/Redo family. The API is the synthetic local fixture server (scripts/dev.mjs with
// LOCAL_TEST_MODE and an in-memory store); static files are served from an in-memory snapshot of
// the read-only artifact roots, the same bytes that were hashed.
// Environment: BENCH_ENGINE, BENCH_PORT, BENCH_EVIDENCE, BENCH_FAMILIES, BENCH_COUNTS,
// BENCH_TRIALS (measured pages per backend/cell), BENCH_WARMUP (discarded pages, default 0),
// BENCH_ARTIFACT_BASELINE + BENCH_ARTIFACT_STATE (absolute build roots; default dist/specialized-test-*),
// BENCH_NEGATIVE (negative control, see NEGATIVE_MODES).
// Acceptance of an output directory is scripts/benchmark-action-correctness-receipt.mjs with the
// same families/engines/counts/BENCH_TRIALS named explicitly; it fails closed on anything omitted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openSync, closeSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { loadavg, cpus } from 'node:os';
import { chromium, webkit, firefox } from 'playwright';
import {
  FAMILIES,
  PROBE_VERSION,
  END_BOUNDARIES,
  NEGATIVE_MODES,
  endBoundaryFor,
  expectedSelection,
  judgeStageSaves,
  parseArtifactRoots,
  buildActionDocument,
  planAction,
  expectedStages,
  expectedSampleSpecs,
  fixtureTemplate,
  documentDigest,
  verifyInitialState,
  judgeSample,
  judgeAsync,
  compareRuns,
  summarizeRuns,
} from './benchmark-compiled-board-actions-lib.mjs';
import { installProbe } from './benchmark-compiled-board-actions-probe.mjs';
import { hashTree, snapshotTree, compareTrees } from './benchmark-artifact-tree.mjs';
import { HARNESS_ROOT, HARNESS_FILES, fixtureServerFiles, artifactFile } from './benchmark-action-correctness-receipt.mjs';

// Relative paths below (scripts/dev.mjs, hashed sources, default dist roots) must be this checkout's.
assert.equal(process.cwd(), HARNESS_ROOT, 'run from the harness checkout root ' + HARNESS_ROOT);

const engineName = process.env.BENCH_ENGINE ?? 'chromium';
const engine = { chromium, webkit, firefox }[engineName];
assert(engine, 'Unknown browser engine');
const port = Number(process.env.BENCH_PORT ?? 6983),
  base = 'http://127.0.0.1:' + port;
const output = resolve(process.env.BENCH_EVIDENCE ?? 'test-results/compiled-board-actions');
mkdirSync(output, { recursive: true });
const families = (process.env.BENCH_FAMILIES ?? Object.keys(FAMILIES).join(',')).split(',');
assert(families.every((f) => Object.hasOwn(FAMILIES, f)), 'Unknown family in BENCH_FAMILIES');
const counts = (process.env.BENCH_COUNTS ?? '30').split(',').map(Number);
assert(counts.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 10000));
const trials = Number(process.env.BENCH_TRIALS ?? 1);
assert(Number.isSafeInteger(trials) && trials >= 1 && trials <= 17);
const warmups = Number(process.env.BENCH_WARMUP ?? 0);
assert(Number.isSafeInteger(warmups) && warmups >= 0 && warmups <= 3);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const artifactRoots = parseArtifactRoots(process.env, process.cwd());
const variants = ['baseline', 'state-lib'].map((name) => {
  const root = artifactRoots[name];
  assert(existsSync(root + '/app.js') && existsSync(root + '/index.html'), 'not a built Boards entry: ' + root);
  const { bodies, ...tree } = snapshotTree(root);
  assert(bodies.has('app.js') && bodies.has('index.html'), 'app.js and index.html must be regular files: ' + root);
  // Only regular files can be served from the snapshot; a symlinked or special entry would 404.
  const unserved = tree.files.filter((f) => !bodies.has(f.path)).map((f) => f.path);
  assert.deepEqual(unserved, [], `artifact root ${root} has symlinks or special files: ${unserved.join(', ')}`);
  return { name, root, sha256: hash(bodies.get('app.js')), tree, bodies };
});
// Re-hashes every artifact file; any change, addition or removal invalidates the whole run.
const assertArtifactsFrozen = (when) => {
  for (const variant of variants) {
    const changes = compareTrees(variant.tree, hashTree(variant.root));
    assert.deepEqual(changes, [], `${variant.name} artifact tree changed ${when}: ${changes.join(', ')}`);
  }
};
const sourceHashes = Object.fromEntries(HARNESS_FILES.map((f) => [f, hash(readFileSync(resolve(f)))]));
const fixtureServer = {
  label: 'SYNTHETIC LOCAL FIXTURE SERVER: scripts/dev.mjs from this harness checkout, LOCAL_TEST_MODE=1, in-memory store, 127.0.0.1 only; serves /api/* only, never the measured static files; not a product deployment',
  sourceHashes: Object.fromEntries(fixtureServerFiles(HARNESS_ROOT).map((f) => [f, hash(readFileSync(resolve(f)))])),
  // scripts/dev.mjs seeds people from BOARDS_SEED_PEOPLE or .seed-people.json; the spawn env below
  // omits the variable and the file must not exist, so the fixture has no unrecorded data input.
  seedPeople: 'absent',
};
assert(!existsSync(resolve('.seed-people.json')), '.seed-people.json would seed the fixture server; move it away for the run');
// Negative controls (NEGATIVE_MODES): every non-empty mode must make the run report problems and
// exit non-zero. wrong-row acts on the second row while the expectations name the first.
const negative = process.env.BENCH_NEGATIVE ?? '';
assert(NEGATIVE_MODES.has(negative), 'Unknown BENCH_NEGATIVE');
assert(negative !== 'wrong-row' || counts.every((n) => n >= 2), 'wrong-row control needs a second row; use counts of at least 2');
// Load arms no event and saves nothing, so only the stale control can fail it.
assert(!negative || negative === 'stale' || !families.includes('load'), `negative control ${negative} cannot fail the load family; leave load out`);
const STEP_TIMEOUT = 15000;
const settle = { timeout: STEP_TIMEOUT };

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
  page
    .waitForFunction(
      (from) =>
        window.__pending === 0 &&
        document.querySelector('.save-state')?.textContent === '' &&
        window.__fetchLog.filter((f) => f.method === 'PUT' && f.startMs >= from).every((f) => Number.isFinite(f.endMs)),
      since,
      settle,
    )
    .catch((error) => {
      throw Error(`save never settled within ${STEP_TIMEOUT} ms (unanswered save request, pending fetch or busy save indicator): ${error.message}`);
    });
const sampleCount = (page, n) =>
  page.waitForFunction((count) => window.__samples.length >= count, n, settle).catch((error) => {
    throw Error(`sample ${n} was not recorded within ${STEP_TIMEOUT} ms (end listener never ran or its save never settled): ${error.message}`);
  });
const storedDocument = async (page) => (await (await page.request.get(base + '/api/state')).json()).value;

/** Performs the family's real UI sequence. Returns the stages with their observed stored digests. */
async function perform(page, family, plan, stages, count, seededRows) {
  const observed = [];
  const actId = negative === 'wrong-row' ? plan.actRowId : plan.rowId;
  const row = () => page.locator('#item-' + actId);
  const arm = (spec) =>
    page.evaluate((s) => window.__arm(s), { rowId: plan.rowId, boundary: endBoundaryFor(spec.endEvent), ...spec });
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
        check: { kind: 'text', id: plan.rowId, text: plan.expectedText, editing: false, noOpenEditor: true },
      });
      await page.keyboard.press('Enter');
      await sampleCount(page, before + 1);
      await expectStored(stages[0], since);
      break;
    }
    case 'field-history': {
      await select();
      await row().locator('.task-text').click(settle);
      assert(await row().locator('.task-text').evaluate((el) => el.isContentEditable), 'editor did not open');
      const shown = await row().locator('.task-text').textContent();
      await page.keyboard.type(plan.typed);
      await page.waitForFunction(
        ({ id, text }) => document.getElementById('item-' + id)?.querySelector('.task-text')?.textContent === text,
        { id: actId, text: shown + plan.typed },
        settle,
      );
      const textCheck = (text) => ({ kind: 'text', id: plan.rowId, text, editing: false, selected: true, noOpenEditor: true });
      let since = await now();
      await arm({ stage: 'commit', event: 'keydown', key: 'Enter', endEvent: 'keydown', awaitSave: true, check: textCheck(plan.expectedText) });
      await page.keyboard.press('Enter');
      await sampleCount(page, 1);
      await expectStored(stages[0], since);
      for (const [index, kind, text] of [
        [1, 'undo', plan.originalText],
        [2, 'redo', plan.expectedText],
      ]) {
        await page.locator('.edge-tab[data-nav="more"]').click(settle);
        const button = page.locator('#' + kind);
        await button.waitFor(settle);
        assert(await button.isEnabled(), kind + ' is disabled after the text commit');
        since = await now();
        await arm({ stage: kind, event: 'click', endEvent: 'click', selector: '#' + kind, awaitSave: true, check: textCheck(text) });
        await button.click(settle);
        await sampleCount(page, index + 1);
        await expectStored(stages[index], since);
      }
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
              // Served from the in-memory snapshot whose bytes were hashed; only manifest paths exist.
              let file;
              try {
                file = path === '/' ? 'index.html' : decodeURIComponent(path).slice(1);
              } catch {
                file = null;
              }
              const body = file === null ? undefined : variant.bodies.get(file);
              if (!body) return route.fulfill({ status: 404, body: 'Not a compiled asset' });
              const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };
              return route.fulfill({
                status: 200,
                contentType: types[extname(file)] ?? 'application/octet-stream',
                body,
              });
            });
            await page.addInitScript(installProbe, { negative, probeVersion: PROBE_VERSION });
            await page.goto(base);
            await page.getByRole('button', { name: 'Open local test workspace', exact: true }).click();
            await page.locator('.paper').waitFor();
            const old = await (await page.request.get(base + '/api/state')).json();
            const template = fixtureTemplate(old.value);
            const seeded = buildActionDocument(template, count);
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
              expectedDigest: negative === 'stale' ? documentDigest(buildActionDocument(template, count + 1)) : documentDigest(seeded),
              domRowIds: await page.locator('.task').evaluateAll((els) => els.map((e) => e.dataset.item)),
              expectedRowIds: firstBoardIds,
            });
            await page.evaluate(() => {
              window.__fetchLog.length = 0;
              window.__samples.length = 0;
            });
            // Holds every app save unanswered from here on (the seed above went through page.request).
            if (negative === 'no-save')
              await page.route(
                (url) => url.pathname === '/api/state',
                (route) => {
                  if (route.request().method() !== 'PUT') return route.fallback();
                  // Deliberately neither fulfilled nor continued: the save stays unanswered.
                },
              );
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
            record.fixtureTemplate = template;
            const expectedSamples = expectedSampleSpecs(family).length;
            if (samples.length !== expectedSamples)
              record.problems.push(`expected ${expectedSamples} samples, recorded ${samples.length}`);
            for (const sample of samples) record.problems.push(...judgeSample(sample).map((p) => `${sample.stage}: ${p}`));
            record.problems.push(...judgeAsync(asyncState, stages));
            // One answered save per mutating stage for every family, the same rule the receipt applies.
            record.problems.push(...judgeStageSaves(saves, stages));
            const selection = expectedSelection(family, plan);
            if (selection && JSON.stringify(record.selectedIds) !== JSON.stringify(selection))
              record.problems.push(`selected rows ${JSON.stringify(record.selectedIds)}, expected ${JSON.stringify(selection)}`);
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
      assertArtifactsFrozen(`after ${family} ${count}`);
    }
  for (const variant of variants)
    assert.equal(hash(readFileSync(variant.root + '/app.js')), variant.sha256, 'Build changed during measurement');
  assertArtifactsFrozen('at the end');
  const common = {
    date: new Date().toISOString(),
    node: process.version,
    engine: engineName,
    browser: browser.version(),
    logicalCPUs: cpus().length,
    startLoad,
    endLoad: loadavg(),
    variants: variants.map(({ tree, bodies, ...v }) => ({ ...v, treeDigest: tree.digest, files: tree.files })),
    artifactRootsExplicit: artifactRoots.explicit,
    fixtureServer,
    probe: { version: PROBE_VERSION, boundaries: END_BOUNDARIES },
    negative,
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
    `Probe ${PROBE_VERSION}: keydown handlerMs ends on the focused editor after its onkeydown handler (it survives stopPropagation); click/input end at a window bubble listener. Phase-2 records from eb53692 used the v1 window-bubble end for every event and are historical, not mixed with v2 rows.`,
    'field-history: commit is the Enter keydown on the edited row; undo/redo are the margins dialog buttons; each stage must produce exactly one answered save with consecutive request versions, the stored document of that stage, and the row selected beforehand still selected.',
    'Artifact roots are read and hashed file by file once before the run and served from that in-memory snapshot; the directories are re-hashed after every family and at the end, and any change aborts the run.',
  ];
  for (const family of families) {
    const records = raw.filter((r) => r.family === family);
    writeFileSync(
      output + '/' + artifactFile(family, engineName),
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
