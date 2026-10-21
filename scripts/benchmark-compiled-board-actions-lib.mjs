// Pure helpers for scripts/benchmark-compiled-board-actions.mjs: fixture shape, independently
// computed expected documents, and the judgements that stop a number from being reported when the
// operation hit the wrong row, did not complete, saved something else, or differs between backends.
// No browser or filesystem access here so tests/benchmark-compiled-board-actions.test.mjs can pin
// every failure mode.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

export const MAX_ROWS_PER_COLUMN = 200;
export const MAX_ROWS_PER_BOARD = 1200;
// One row of headroom below the unchanged 200-row product limit so a column move never creates
// an over-limit document; the limits themselves are not changed.
const FIXTURE_ROWS_PER_COLUMN = MAX_ROWS_PER_COLUMN - 1;

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
  assert(family in FAMILIES, 'Unknown family ' + family);
  const board = document.boards[0],
    from = board.columns[0],
    row = from.items[0];
  assert(row, 'first column has no row to act on');
  const plan = { family, boardId: board.id, rowId: row.id, fromColumnId: from.id, originalText: row.text };
  if (family === 'move' || family === 'history') {
    assert(board.columns[1], 'a column move needs a second column');
    plan.toColumnId = board.columns[1].id;
  }
  if (family === 'edit') {
    plan.typed = FAMILIES.edit.settings.typed;
    plan.expectedText = (row.text + plan.typed).trim();
  }
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
