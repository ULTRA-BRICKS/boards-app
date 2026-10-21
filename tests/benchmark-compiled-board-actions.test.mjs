// Harness contract for scripts/benchmark-compiled-board-actions.mjs. These tests pin the failure
// modes a measured number must never hide: wrong row, failed operation, missed async completion,
// stale initial state, and baseline/state output that does not match.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FAMILIES,
  buildActionDocument,
  assertProductLimits,
  planAction,
  expectedStages,
  documentDigest,
  verifyInitialState,
  judgeSample,
  judgeAsync,
  compareRuns,
  summarizeRuns,
} from '../scripts/benchmark-compiled-board-actions-lib.mjs';

const template = {
  boards: [
    {
      id: 'b0',
      title: 'Board',
      columns: [{ id: 'c0', title: 'One', note: '', subtitle: '', items: [] }],
    },
  ],
};
const doc = (count) => buildActionDocument(template, count);
const itemsOf = (d, b = 0, c = 0) => d.boards[b].columns[c].items;

test('fixture respects unchanged product limits and always has a move target', () => {
  for (const count of [1, 30, 1200, 10000]) {
    const d = doc(count);
    assertProductLimits(d);
    const total = d.boards.flatMap((b) => b.columns.flatMap((c) => c.items)).length;
    assert.equal(total, count);
    assert(d.boards[0].columns.length >= 2, 'a second column must exist for a column move');
    assert(d.boards[0].columns.every((c) => c.items.length <= 199), 'headroom for one moved row');
    const ids = d.boards.flatMap((b) => b.columns.flatMap((c) => c.items.map((i) => i.id)));
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.throws(() => doc(0));
  assert.throws(() => doc(10001));
  const over = doc(30);
  itemsOf(over).push(...Array.from({ length: 200 }, (_, i) => ({ id: 'x' + i, text: '', done: false })));
  assert.throws(() => assertProductLimits(over), /200/);
});

test('every family is declared with its own artifact and settings identity', () => {
  assert.deepEqual(Object.keys(FAMILIES).sort(), ['completion', 'edit', 'history', 'load', 'move']);
  const names = new Set(Object.values(FAMILIES).map((f) => f.artifact));
  assert.equal(names.size, 5, 'one artifact file per family');
  for (const f of Object.values(FAMILIES)) assert(f.settings && f.description);
});

test('plan targets the first row and the next column deterministically', () => {
  const d = doc(30);
  const plan = planAction('move', d);
  assert.equal(plan.rowId, itemsOf(d)[0].id);
  assert.equal(plan.fromColumnId, d.boards[0].columns[0].id);
  assert.equal(plan.toColumnId, d.boards[0].columns[1].id);
  assert.deepEqual(planAction('move', d), plan);
  const edit = planAction('edit', d);
  assert.equal(edit.rowId, plan.rowId);
  assert.match(edit.typed, /\S/);
  assert.equal(edit.expectedText, (itemsOf(d)[0].text + edit.typed).trim());
});

test('expected stages are computed independently of the application', () => {
  const d = doc(30);
  const before = documentDigest(d);
  const move = expectedStages('move', d, planAction('move', d));
  assert.equal(documentDigest(d), before, 'input is not mutated');
  const moved = move.at(-1).document;
  assert.equal(itemsOf(moved, 0, 0).length, 29);
  assert.equal(itemsOf(moved, 0, 1).at(-1).id, itemsOf(d)[0].id);

  const history = expectedStages('history', d, planAction('history', d));
  assert.deepEqual(
    history.map((s) => s.name),
    ['move', 'undo', 'redo'],
  );
  assert.equal(history[1].digest, before, 'undo returns the original document');
  assert.equal(history[2].digest, history[0].digest, 'redo repeats the move');

  const edit = expectedStages('edit', d, planAction('edit', d));
  assert.equal(itemsOf(edit.at(-1).document)[0].text, planAction('edit', d).expectedText);

  const done = expectedStages('completion', d, planAction('completion', d));
  assert.equal(itemsOf(done.at(-1).document)[0].done, true);
});

test('stale initial state is rejected before any timing is trusted', () => {
  const d = doc(30);
  const good = {
    storedDigest: documentDigest(d),
    expectedDigest: documentDigest(d),
    domRowIds: itemsOf(d).map((i) => i.id),
    expectedRowIds: itemsOf(d).map((i) => i.id),
    backend: 'state-lib',
    expectedBackend: 'state-lib',
  };
  verifyInitialState(good);
  assert.throws(() => verifyInitialState({ ...good, storedDigest: 'old' }), /stale|stored/i);
  assert.throws(() => verifyInitialState({ ...good, domRowIds: good.domRowIds.slice(1) }), /row/i);
  assert.throws(() => verifyInitialState({ ...good, domRowIds: [...good.domRowIds].reverse() }), /row/i);
  assert.throws(() => verifyInitialState({ ...good, backend: 'baseline' }), /backend/i);
});

const goodSample = {
  stage: 'move',
  trusted: true,
  id: 'measured-0',
  expectedId: 'measured-0',
  handlerMs: 1.2,
  nextFrameMs: 9,
  committedAtHandlerEnd: true,
  correct: true,
};

test('a sample on the wrong row, untrusted, failed, or unmeasured is a problem', () => {
  assert.deepEqual(judgeSample(goodSample), []);
  assert.match(judgeSample({ ...goodSample, id: 'measured-1' }).join(), /wrong row/);
  assert.match(judgeSample({ ...goodSample, trusted: false }).join(), /untrusted/);
  assert.match(judgeSample({ ...goodSample, correct: false }).join(), /operation did not complete/);
  assert.match(judgeSample({ ...goodSample, committedAtHandlerEnd: false }).join(), /not committed/);
  assert.match(judgeSample({ ...goodSample, handlerMs: NaN }).join(), /handler/);
  assert.match(judgeSample({ ...goodSample, nextFrameMs: undefined }).join(), /next frame/);
  assert.match(judgeSample(null).join(), /no sample/);
  assert.deepEqual(judgeSample({ ...goodSample, expectAsync: true, asyncSettledMs: 12 }), []);
  assert.match(judgeSample({ ...goodSample, expectAsync: true, asyncSettledMs: null }).join(), /async completion was missed/);
});

test('missed async completion and mismatching save payloads are problems', () => {
  const d = doc(30);
  const stages = expectedStages('move', d, planAction('move', d));
  const final = stages.at(-1).digest;
  const ok = {
    pendingFetches: 0,
    saveState: '',
    finalStoredDigest: final,
    saves: [{ method: 'PUT', status: 200, digest: final, startMs: 1, endMs: 5 }],
  };
  assert.deepEqual(judgeAsync(ok, stages), []);
  assert.match(judgeAsync({ ...ok, saves: [] }, stages).join(), /no save/i);
  assert.match(judgeAsync({ ...ok, saveState: 'Saving…' }, stages).join(), /still/i);
  assert.match(judgeAsync({ ...ok, pendingFetches: 1 }, stages).join(), /pending/i);
  assert.match(
    judgeAsync({ ...ok, saves: [{ ...ok.saves[0], endMs: null }] }, stages).join(),
    /never finished/i,
  );
  assert.match(
    judgeAsync({ ...ok, saves: [{ ...ok.saves[0], status: 500 }] }, stages).join(),
    /status/i,
  );
  assert.match(
    judgeAsync({ ...ok, saves: [{ ...ok.saves[0], digest: 'other' }] }, stages).join(),
    /payload/i,
  );
  assert.match(judgeAsync({ ...ok, finalStoredDigest: 'other' }, stages).join(), /stored/i);
});

const run = (backend) => ({
  backend,
  finalDigest: 'D',
  domOrder: ['measured-1', 'measured-0'],
  selectedIds: ['measured-0'],
  saves: [{ digest: 'S1', version: 2 }],
  stageDigests: { move: 'M' },
});

test('baseline and state output must match document, order, selection and saves', () => {
  assert.deepEqual(compareRuns(run('baseline'), run('state-lib')), []);
  assert.match(compareRuns(run('baseline'), { ...run('state-lib'), finalDigest: 'X' }).join(), /document/);
  assert.match(compareRuns(run('baseline'), { ...run('state-lib'), domOrder: ['measured-0'] }).join(), /order/);
  assert.match(compareRuns(run('baseline'), { ...run('state-lib'), selectedIds: [] }).join(), /selection/);
  assert.match(
    compareRuns(run('baseline'), { ...run('state-lib'), saves: [{ digest: 'S2', version: 2 }] }).join(),
    /save/,
  );
  assert.match(
    compareRuns(run('baseline'), { ...run('state-lib'), saves: [{ digest: 'S1', version: 2 }, { digest: 'S1', version: 3 }] }).join(),
    /save/,
  );
  assert.match(
    compareRuns(run('baseline'), { ...run('state-lib'), stageDigests: { move: 'N' } }).join(),
    /stage/,
  );
});

test('summary keeps keystroke/commit, async wait and next frame separate and keeps failures', () => {
  const runs = [1, 2, 3].map((n) => ({
    backend: 'baseline',
    family: 'edit',
    count: 30,
    samples: [
      { stage: 'keystroke', handlerMs: n, nextFrameMs: 10 + n },
      { stage: 'commit', handlerMs: 10 * n, nextFrameMs: 20 * n, asyncSettledMs: 100 + n },
    ],
    problems: n === 3 ? ['wrong row'] : [],
  }));
  const rows = summarizeRuns(runs);
  const commit = rows.find((r) => r.stage === 'commit');
  assert.equal(commit.handlerMedianMs, 20);
  assert.equal(commit.nextFrameMedianMs, 40);
  assert.equal(commit.asyncSettledMedianMs, 102);
  assert.equal(commit.failedPages, 1);
  assert.equal(commit.pages, 3);
  assert(rows.find((r) => r.stage === 'keystroke'));
  assert(!('asyncSettledMedianMs' in rows.find((r) => r.stage === 'keystroke')) ||
    rows.find((r) => r.stage === 'keystroke').asyncSettledMedianMs === null);
});

test('load rows carry a distinct metric kind and never expose event-handler or save fields', () => {
  const runs = [1, 2, 3].map((n) => ({
    backend: 'state-lib',
    family: 'load',
    count: 30,
    samples: [
      { stage: 'load', metricKind: 'navigation-load', postResponseRenderMs: n, nextFrameMs: 5 + n, lastResponseMs: 300 + n },
    ],
    problems: [],
  }));
  const [row] = summarizeRuns(runs);
  assert.equal(row.metricKind, 'navigation-load');
  assert.equal(row.postResponseRenderMedianMs, 2);
  assert.equal(row.lastResponseMedianMs, 302);
  assert.equal(row.nextFrameMedianMs, 7);
  for (const key of ['handlerMedianMs', 'handlerP95Ms', 'asyncSettledMedianMs', 'asyncSettledP95Ms'])
    assert(!(key in row), key + ' would let a consumer rank load render time as an event handler');
  const [event] = summarizeRuns([
    { backend: 'baseline', family: 'edit', count: 30, samples: [{ stage: 'commit', handlerMs: 1, nextFrameMs: 2, asyncSettledMs: 3 }], problems: [] },
  ]);
  assert.equal(event.metricKind, 'event-handler');
  assert(!('postResponseRenderMedianMs' in event));
  assert.equal(event.frameKind, 'next-rAF-not-paint');
  assert.equal(row.frameKind, 'next-rAF-not-paint');
});

test('a load sample is judged on its own fields, not on event-handler fields', () => {
  const load = {
    stage: 'load', metricKind: 'navigation-load', trusted: true, id: 'measured-0', expectedId: 'measured-0',
    committedAtHandlerEnd: true, correct: true, postResponseRenderMs: 3, nextFrameMs: 1, lastResponseMs: 300, expectAsync: true,
  };
  assert.deepEqual(judgeSample(load), []);
  assert.match(judgeSample({ ...load, postResponseRenderMs: NaN }).join(), /post-response render/);
  assert.match(judgeSample({ ...load, lastResponseMs: undefined }).join(), /last response/);
});
