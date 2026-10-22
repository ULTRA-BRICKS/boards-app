// Pure helpers for scripts/benchmark-compiled-board-actions.mjs: fixture shape, independently
// computed expected documents, and the judgements that stop a number from being reported when the
// operation hit the wrong row, did not complete, saved something else, or differs between backends.
// No browser or filesystem access here so tests/benchmark-compiled-board-actions.test.mjs can pin
// every failure mode.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';

export const MAX_ROWS_PER_COLUMN = 200;
export const MAX_ROWS_PER_BOARD = 1200;
// One row of headroom below the unchanged 200-row product limit so a column move never creates
// an over-limit document; the limits themselves are not changed.
const FIXTURE_ROWS_PER_COLUMN = MAX_ROWS_PER_COLUMN - 1;

// v1 (phase-2 records at eb53692) ended every event at a window bubble listener. An editor handler
// that calls stopPropagation() never reaches it, so v2 ends a keydown on the focused editor itself,
// with a listener added after the app's onkeydown was assigned. Same-target listeners run in
// registration order and stopPropagation() does not skip them (stopImmediatePropagation would, and
// then no sample is recorded, which fails the page). Clicks and input keep the v1 window boundary.
export const PROBE_VERSION = 'action-probe-v2-editor-target-keydown';
export const END_BOUNDARIES = {
  'editor-target':
    'keydown: bubble listener on the focused editor element, added after its onkeydown handler was assigned; runs after that handler even when it calls stopPropagation()',
  'window-bubble':
    'click/input: window bubble listener, after every delegated and same-target app handler on the propagation path (v1 boundary)',
};
const BOUNDARY_BY_EVENT = { keydown: 'editor-target', click: 'window-bubble', input: 'window-bubble' };
export function endBoundaryFor(endEvent) {
  assert(Object.hasOwn(BOUNDARY_BY_EVENT, endEvent), 'no end boundary for ' + endEvent);
  return BOUNDARY_BY_EVENT[endEvent];
}

// '' measures. Every other mode must make the run report problems and exit non-zero:
// wrong-row acts on the second row; stale expects another seeded fixture; early-observer ends at a
// window capture listener (before the app handler); capture-microtask ends in a microtask queued
// from window capture; no-save holds every state PUT unanswered.
export const NEGATIVE_MODES = new Set(['', 'wrong-row', 'stale', 'early-observer', 'capture-microtask', 'no-save']);

/** Explicit read-only artifact roots (BENCH_ARTIFACT_BASELINE + BENCH_ARTIFACT_STATE) or the old dist defaults. */
export function parseArtifactRoots(env, cwd) {
  const baseline = env.BENCH_ARTIFACT_BASELINE,
    state = env.BENCH_ARTIFACT_STATE;
  if (baseline === undefined && state === undefined)
    return {
      baseline: resolve(cwd, 'dist/specialized-test-baseline'),
      'state-lib': resolve(cwd, 'dist/specialized-test-state-lib'),
      explicit: false,
    };
  assert(baseline && state, 'set both BENCH_ARTIFACT_BASELINE and BENCH_ARTIFACT_STATE, or neither');
  assert(isAbsolute(baseline) && isAbsolute(state), 'artifact roots must be absolute paths');
  const roots = { baseline: resolve(baseline), 'state-lib': resolve(state), explicit: true };
  assert.notEqual(roots.baseline, roots['state-lib'], 'artifact roots must be distinct');
  return roots;
}

export const FAMILIES = {
  completion: {
    artifact: 'completion-control.json',
    description: 'Control: complete the first row with its real checkbox (same events as benchmark-compiled-board.mjs).',
    settings: { events: 'click .task-check', rowsPerColumn: FIXTURE_ROWS_PER_COLUMN },
  },
  edit: {
    artifact: 'text-edit-commit.json',
    description: 'Open the first row text editor, type with real keystrokes, commit with Enter.',
    settings: { events: 'click .task-text; keydown characters; keydown Enter', typed: '-edited', rowsPerColumn: FIXTURE_ROWS_PER_COLUMN },
  },
  move: {
    artifact: 'column-move.json',
    description: 'Move the first row to the next column through its row menu and the move dialog.',
    settings: { events: 'click .task-more; click [data-a=move]; click [data-move]', rowsPerColumn: FIXTURE_ROWS_PER_COLUMN },
  },
  history: {
    artifact: 'move-undo-redo.json',
    description: 'After a structural move, Undo then Redo from the notebook margins dialog.',
    settings: { events: 'click [data-nav=more]; click #undo; click [data-nav=more]; click #redo', rowsPerColumn: FIXTURE_ROWS_PER_COLUMN },
  },
  'field-history': {
    artifact: 'field-edit-undo-redo.json',
    description:
      'Select the first row through its menu, edit its text with real keystrokes, commit with Enter, then Undo and Redo that text from the notebook margins dialog.',
    settings: {
      events: 'click .task-more; click [data-a=select]; click .task-text; type; keydown Enter; click [data-nav=more]; click #undo; click [data-nav=more]; click #redo',
      typed: '-edited',
      timedStages: ['commit', 'undo', 'redo'],
      probeVersion: PROBE_VERSION,
      rowsPerColumn: FIXTURE_ROWS_PER_COLUMN,
    },
  },
  load: {
    artifact: 'cold-load.json',
    description: 'Fresh page load of the saved workspace: state and people requests, then the first board render.',
    settings: { events: 'navigation reload', rowsPerColumn: FIXTURE_ROWS_PER_COLUMN },
  },
};

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
      : value;
export const documentDigest = (document) =>
  createHash('sha256').update(JSON.stringify(canonical(document))).digest('hex');

/** The only parts of a stored workspace buildActionDocument reads: top level, first board, its first column without rows. */
export function fixtureTemplate(document) {
  const [board] = document.boards,
    [column] = board.columns;
  return structuredClone({ ...document, boards: [{ ...board, columns: [{ ...column, items: [] }] }] });
}

export function buildActionDocument(template, count) {
  assert(Number.isSafeInteger(count) && count >= 1 && count <= 10000, 'count must be 1..10000');
  const board = template.boards[0],
    column = board.columns[0];
  const boards = Array.from({ length: Math.ceil(count / MAX_ROWS_PER_BOARD) }, (_, bi) => {
    const size = Math.min(MAX_ROWS_PER_BOARD, count - bi * MAX_ROWS_PER_BOARD);
    const columns = Math.max(2, Math.ceil(size / FIXTURE_ROWS_PER_COLUMN));
    return {
      ...structuredClone(board),
      id: bi ? 'measured-board-' + bi : board.id,
      columns: Array.from({ length: columns }, (_, ci) => {
        const start = ci * FIXTURE_ROWS_PER_COLUMN,
          length = Math.max(0, Math.min(FIXTURE_ROWS_PER_COLUMN, size - start));
        return {
          ...structuredClone(column),
          id: 'measured-' + bi + '-' + ci,
          title: 'Measured ' + ci,
          items: Array.from({ length }, (_, i) => {
            const n = bi * MAX_ROWS_PER_BOARD + start + i;
            return { id: 'measured-' + n, text: 'Synthetic task ' + n, tag: '', done: false, assignees: [] };
          }),
        };
      }),
    };
  });
  const document = { ...structuredClone(template), boards };
  assertProductLimits(document);
  return document;
}

export function assertProductLimits(document) {
  for (const board of document.boards) {
    let rows = 0;
    for (const column of board.columns) {
      assert(column.items.length <= MAX_ROWS_PER_COLUMN, `column ${column.id} exceeds ${MAX_ROWS_PER_COLUMN} rows`);
      rows += column.items.length;
    }
    assert(rows <= MAX_ROWS_PER_BOARD, `board ${board.id} exceeds ${MAX_ROWS_PER_BOARD} rows`);
  }
}

export function planAction(family, document) {
  assert(Object.hasOwn(FAMILIES, family), 'Unknown family ' + family);
  const board = document.boards[0],
    from = board.columns[0],
    row = from.items[0];
  assert(row, 'first column has no row to act on');
  const plan = { family, boardId: board.id, rowId: row.id, fromColumnId: from.id, originalText: row.text };
  if (family === 'move' || family === 'history') {
    assert(board.columns[1], 'a column move needs a second column');
    plan.toColumnId = board.columns[1].id;
  }
  if (family === 'edit' || family === 'field-history') {
    plan.typed = FAMILIES[family].settings.typed;
    plan.expectedText = (row.text + plan.typed).trim();
  }
  if (family === 'field-history') plan.selectRow = true;
  return plan;
}

function moved(document, plan) {
  const next = structuredClone(document),
    board = next.boards.find((b) => b.id === plan.boardId),
    from = board.columns.find((c) => c.id === plan.fromColumnId),
    to = board.columns.find((c) => c.id === plan.toColumnId),
    at = from.items.findIndex((i) => i.id === plan.rowId);
  assert(at >= 0, 'row to move is missing from its source column');
  to.items.push(...from.items.splice(at, 1));
  return next;
}

/** Expected document after every UI step, derived from the plan alone and never from the app. */
export function expectedStages(family, document, plan) {
  const stage = (name, doc, mutates = true) => ({ name, document: doc, digest: documentDigest(doc), mutates });
  const original = structuredClone(document);
  switch (family) {
    case 'completion': {
      const next = structuredClone(document);
      next.boards[0].columns[0].items[0].done = true;
      return [stage('toggle', next)];
    }
    case 'edit': {
      const next = structuredClone(document);
      next.boards[0].columns[0].items[0].text = plan.expectedText;
      return [stage('commit', next)];
    }
    case 'field-history': {
      const next = structuredClone(document);
      next.boards[0].columns[0].items[0].text = plan.expectedText;
      return [stage('commit', next), stage('undo', original), stage('redo', structuredClone(next))];
    }
    case 'move':
      return [stage('move', moved(document, plan))];
    case 'history': {
      const after = moved(document, plan);
      return [stage('move', after), stage('undo', original), stage('redo', structuredClone(after))];
    }
    case 'load':
      return [stage('load', original, false)];
    default:
      throw Error('Unknown family ' + family);
  }
}

/** Stage names of expectedStages(family, ...) in order, without a document (the receipt has none). */
export function stageNames(family) {
  const names = {
    completion: ['toggle'],
    edit: ['commit'],
    'field-history': ['commit', 'undo', 'redo'],
    move: ['move'],
    history: ['move', 'undo', 'redo'],
    load: ['load'],
  }[family];
  assert(Object.hasOwn(FAMILIES, family) && names, 'Unknown family ' + family);
  return names;
}

/** Timed samples every page of a family records, in order: stage, end boundary, and whether it awaits a save. */
export function expectedSampleSpecs(family) {
  const spec = (stage, endEvent, awaitSave) => ({ stage, boundary: endBoundaryFor(endEvent), awaitSave });
  switch (family) {
    case 'completion':
      return [spec('toggle', 'click', true)];
    case 'edit':
      return [...FAMILIES.edit.settings.typed].map(() => spec('keystroke', 'input', false)).concat(spec('commit', 'keydown', true));
    case 'field-history':
      return [spec('commit', 'keydown', true), spec('undo', 'click', true), spec('redo', 'click', true)];
    case 'move':
      return [spec('move', 'click', true)];
    case 'history':
      return [spec('undo', 'click', true), spec('redo', 'click', true)];
    case 'load':
      return [{ stage: 'load', boundary: null, awaitSave: false }];
    default:
      throw Error('Unknown family ' + family);
  }
}

/** Selected row ids after every field-history stage: the row selected before editing stays selected. */
export function expectedSelection(family, plan) {
  return family === 'field-history' ? [plan.rowId] : null;
}

export function verifyInitialState({ storedDigest, expectedDigest, domRowIds, expectedRowIds, backend, expectedBackend }) {
  assert.equal(backend, expectedBackend, `backend mismatch: page runs ${backend}, expected ${expectedBackend}`);
  assert.equal(storedDigest, expectedDigest, 'stale initial state: stored document is not the seeded fixture');
  assert.deepEqual(domRowIds, expectedRowIds, 'initial rendered rows differ from the fixture row order');
}

export function judgeSample(sample) {
  if (!sample) return ['no sample was recorded'];
  const problems = [];
  if (sample.id !== sample.expectedId) problems.push(`wrong row: acted on ${sample.id}, expected ${sample.expectedId}`);
  if (sample.trusted !== true) problems.push('untrusted (synthetic) event');
  if (sample.committedAtHandlerEnd !== true) problems.push('result not committed when the handler returned');
  if (sample.correct !== true) problems.push('operation did not complete with the expected visible result');
  if ('probeVersion' in sample || 'expectedBoundary' in sample) {
    if (sample.probeVersion !== PROBE_VERSION) problems.push(`probe version ${sample.probeVersion}, expected ${PROBE_VERSION}`);
    if (sample.boundary !== sample.expectedBoundary)
      problems.push(`end boundary ${sample.boundary}, expected ${sample.expectedBoundary}`);
    if (sample.expectedBoundary === 'editor-target' && sample.appHandlerBeforeProbe !== true)
      problems.push('no app onkeydown handler was registered on the editor before the probe listener');
  }
  const load = sample.metricKind === 'navigation-load';
  if (load) {
    if (!Number.isFinite(sample.postResponseRenderMs)) problems.push('post-response render time is not a number');
    if (!Number.isFinite(sample.lastResponseMs)) problems.push('last response time is not a number');
  } else {
    if (!Number.isFinite(sample.handlerMs)) problems.push('handler time is not a number');
    if (sample.expectAsync && !Number.isFinite(sample.asyncSettledMs)) problems.push('async completion was missed');
  }
  if (!Number.isFinite(sample.nextFrameMs)) problems.push('next frame time is not a number');
  return problems;
}

export function judgeAsync(run, stages) {
  const problems = [];
  const mutating = stages.filter((s) => s.mutates);
  const final = stages.at(-1).digest;
  if (run.pendingFetches > 0) problems.push(`${run.pendingFetches} pending fetches at the end`);
  if (run.saveState !== '') problems.push(`save indicator still shows ${JSON.stringify(run.saveState)}`);
  if (mutating.length === 0) {
    if (run.saves.length) problems.push(`unexpected save requests: ${run.saves.length}`);
    return problems;
  }
  if (run.saves.length === 0) problems.push('no save request was sent');
  const known = new Set(stages.map((s) => s.digest));
  for (const save of run.saves) {
    if (!Number.isFinite(save.endMs)) problems.push('save request never finished');
    else if (save.status !== 200) problems.push(`save status ${save.status}`);
    if (!known.has(save.digest)) problems.push('save payload matches no expected document');
  }
  if (run.saves.length && run.saves.at(-1).digest !== final) problems.push('last save payload is not the final expected document');
  if (run.finalStoredDigest !== final) problems.push('stored document differs from the expected final document');
  return problems;
}

/** Every family: one answered save per mutating stage, in stage order, request versions 0, 1, 2… relative to the seed. */
export function judgeStageSaves(saves, stages) {
  const mutating = stages.filter((s) => s.mutates);
  if (saves.length !== mutating.length) return [`expected ${mutating.length} save requests (one per stage), recorded ${saves.length}`];
  const problems = [];
  mutating.forEach((stage, i) => {
    const save = saves[i];
    if (!save || typeof save !== 'object') return void problems.push(`save ${i + 1} (${stage.name}) is not a save record`);
    if (save.digest !== stage.digest) problems.push(`save ${i + 1} is not the expected ${stage.name} document`);
    if (save.version !== i) problems.push(`save ${i + 1} (${stage.name}) sent version ${save.version}, expected ${i}`);
    if (!Number.isFinite(save.endMs)) problems.push(`save ${i + 1} (${stage.name}) never finished`);
    else if (save.status !== 200) problems.push(`save ${i + 1} (${stage.name}) status ${save.status}`);
  });
  return problems;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function compareRuns(a, b) {
  const out = [];
  if (a.finalDigest !== b.finalDigest) out.push('final document differs');
  if (!same(a.domOrder, b.domOrder)) out.push('rendered row order differs');
  if (!same(a.selectedIds, b.selectedIds)) out.push('selection differs');
  if (!same(a.saves.map((s) => [s.digest, s.version]), b.saves.map((s) => [s.digest, s.version])))
    out.push('save request payloads differ');
  if (!same(a.stageDigests, b.stageDigests)) out.push('per-stage documents differ');
  return out;
}

export const quantile = (values, q) =>
  values.length ? [...values].sort((x, y) => x - y)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)] : null;

export function summarizeRuns(runs) {
  const keys = new Map();
  for (const run of runs)
    for (const stage of new Set(run.samples.map((s) => s.stage))) {
      const key = [run.family, run.count, stage, run.backend].join('|');
      if (!keys.has(key)) keys.set(key, { family: run.family, count: run.count, stage, backend: run.backend, runs: [] });
      keys.get(key).runs.push(run);
    }
  return [...keys.values()].map(({ family, count, stage, backend, runs: group }) => {
    const samples = group.flatMap((r) => r.samples.filter((s) => s.stage === stage));
    const col = (name) => samples.map((s) => s[name]).filter(Number.isFinite);
    const load = samples.length > 0 && samples.every((x) => x.metricKind === 'navigation-load');
    const head = {
      family,
      count,
      stage,
      backend,
      // 'event-handler': handler/async fields are measured from a real input event.
      // 'navigation-load': measured from navigation start; the render interval starts at the last
      // state/people response and is not an event handler. Never rank the two kinds together.
      metricKind: load ? 'navigation-load' : 'event-handler',
      frameKind: 'next-rAF-not-paint',
      probeVersion: [...new Set(samples.map((x) => x.probeVersion ?? 'unversioned'))].join(',').replace(/^unversioned$/, '') || null,
      endBoundary: [...new Set(samples.map((x) => x.boundary).filter(Boolean))].join(',') || null,
      pages: group.length,
      failedPages: group.filter((r) => r.problems.length).length,
      events: samples.length,
    };
    const frame = {
      nextFrameMedianMs: quantile(col('nextFrameMs'), 0.5),
      nextFrameP95Ms: quantile(col('nextFrameMs'), 0.95),
    };
    if (load)
      return {
        ...head,
        postResponseRenderMedianMs: quantile(col('postResponseRenderMs'), 0.5),
        postResponseRenderP95Ms: quantile(col('postResponseRenderMs'), 0.95),
        lastResponseMedianMs: quantile(col('lastResponseMs'), 0.5),
        lastResponseP95Ms: quantile(col('lastResponseMs'), 0.95),
        ...frame,
      };
    return {
      ...head,
      handlerMedianMs: quantile(col('handlerMs'), 0.5),
      handlerP95Ms: quantile(col('handlerMs'), 0.95),
      ...frame,
      asyncSettledMedianMs: quantile(col('asyncSettledMs'), 0.5),
      asyncSettledP95Ms: quantile(col('asyncSettledMs'), 0.95),
    };
  });
}
