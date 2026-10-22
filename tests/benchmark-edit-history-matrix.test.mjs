// Contract for the field-history family, the versioned event-end probe, explicit read-only artifact
// roots, artifact tree freezing and the extra live negative controls added to
// scripts/benchmark-compiled-board-actions.mjs (HYP-1740). The older families keep their own tests in
// benchmark-compiled-board-actions.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  FAMILIES,
  PROBE_VERSION,
  END_BOUNDARIES,
  NEGATIVE_MODES,
  buildActionDocument,
  planAction,
  expectedStages,
  expectedSelection,
  stageNames,
  fixtureTemplate,
  expectedSampleSpecs,
  endBoundaryFor,
  documentDigest,
  judgeSample,
  judgeStageSaves,
  summarizeRuns,
  parseArtifactRoots,
} from '../scripts/benchmark-compiled-board-actions-lib.mjs';
import { hashTree, snapshotTree, compareTrees } from '../scripts/benchmark-artifact-tree.mjs';

const template = {
  boards: [{ id: 'b0', title: 'Board', columns: [{ id: 'c0', title: 'One', note: '', subtitle: '', items: [] }] }],
};
const doc = (count) => buildActionDocument(template, count);
const itemsOf = (d, b = 0, c = 0) => d.boards[b].columns[c].items;

test('field history is a distinct family; the structural history family is unchanged', () => {
  assert(FAMILIES['field-history'], 'field-history family exists');
  assert.notEqual(FAMILIES['field-history'].artifact, FAMILIES.history.artifact);
  assert.match(FAMILIES.history.settings.events, /#undo/);
  assert.equal(FAMILIES.history.artifact, 'move-undo-redo.json');
  assert.match(FAMILIES['field-history'].settings.events, /Enter/);
  assert.equal(FAMILIES['field-history'].settings.probeVersion, PROBE_VERSION);
  for (const name of ['completion', 'edit', 'move', 'history', 'load']) assert(FAMILIES[name], name + ' is kept');
});

test('field-history plan edits the first row and selects it through the real menu', () => {
  const d = doc(30);
  const plan = planAction('field-history', d);
  assert.equal(plan.rowId, itemsOf(d)[0].id);
  assert.equal(plan.selectRow, true);
  assert.equal(plan.expectedText, (itemsOf(d)[0].text + plan.typed).trim());
  assert.equal(plan.originalText, itemsOf(d)[0].text, 'Undo is checked against the seeded text');
  assert.notEqual(plan.expectedText, plan.originalText, 'the commit must change the text, or Undo proves nothing');
  assert.equal(plan.toColumnId, undefined, 'field history never moves the row');
});

test('field-history expected documents: commit, Undo to the original, Redo to the commit', () => {
  const d = doc(30);
  const before = documentDigest(d);
  const plan = planAction('field-history', d);
  const stages = expectedStages('field-history', d, plan);
  assert.equal(documentDigest(d), before, 'input is not mutated');
  assert.deepEqual(stages.map((s) => s.name), ['commit', 'undo', 'redo']);
  assert(stages.every((s) => s.mutates));
  assert.equal(itemsOf(stages[0].document)[0].text, plan.expectedText);
  assert.equal(stages[1].digest, before, 'Undo restores the seeded document exactly');
  assert.equal(stages[2].digest, stages[0].digest, 'Redo restores the committed text exactly');
  // Only the text field of one row differs: order, columns and every other field stay put.
  const ids = (x) => x.boards.flatMap((b) => b.columns.flatMap((c) => c.items.map((i) => i.id)));
  assert.deepEqual(ids(stages[0].document), ids(d));
  const changed = structuredClone(stages[0].document);
  itemsOf(changed)[0].text = itemsOf(d)[0].text;
  assert.equal(documentDigest(changed), before);
});

test('selection oracle is independent of the app and only declared for field history', () => {
  const d = doc(30);
  const plan = planAction('field-history', d);
  assert.deepEqual(expectedSelection('field-history', plan), [plan.rowId]);
  assert.equal(expectedSelection('history', planAction('history', d)), null, 'old family keeps pairwise comparison only');
  assert.equal(expectedSelection('edit', planAction('edit', d)), null);
});

test('event-end boundary: Enter commit ends on the editor target, clicks and input on window bubble', () => {
  assert.equal(endBoundaryFor('keydown'), 'editor-target');
  assert.equal(endBoundaryFor('click'), 'window-bubble');
  assert.equal(endBoundaryFor('input'), 'window-bubble');
  assert.throws(() => endBoundaryFor('pointerup'), /boundary/);
  for (const name of Object.keys(END_BOUNDARIES)) assert(END_BOUNDARIES[name].length > 40, name + ' is described');
  assert.match(PROBE_VERSION, /^action-probe-v2/);
});

const sample = {
  stage: 'commit',
  trusted: true,
  id: 'measured-0',
  expectedId: 'measured-0',
  handlerMs: 4,
  nextFrameMs: 9,
  asyncSettledMs: 600,
  expectAsync: true,
  committedAtHandlerEnd: true,
  correct: true,
  probeVersion: PROBE_VERSION,
  expectedBoundary: 'editor-target',
  boundary: 'editor-target',
  appHandlerBeforeProbe: true,
};

test('a versioned sample must end at its declared boundary after a registered app handler', () => {
  assert.deepEqual(judgeSample(sample), []);
  assert.match(judgeSample({ ...sample, boundary: 'window-bubble' }).join(), /boundary/);
  assert.match(judgeSample({ ...sample, boundary: 'window-capture' }).join(), /boundary/);
  assert.match(judgeSample({ ...sample, appHandlerBeforeProbe: false }).join(), /handler/);
  assert.match(judgeSample({ ...sample, probeVersion: 'action-probe-v1' }).join(), /probe version/);
  // Observer before the commit (negative control) is caught by the commit check, not hidden.
  assert.match(judgeSample({ ...sample, committedAtHandlerEnd: false }).join(), /not committed/);
  // Old unversioned samples (historical phase-2 records, helper tests) keep the old judgement.
  const { probeVersion, expectedBoundary, boundary, appHandlerBeforeProbe, ...old } = sample;
  assert.deepEqual(judgeSample(old), []);
});

test('field-history saves: exactly one answered save per stage, in order, with consecutive versions', () => {
  const d = doc(30);
  const stages = expectedStages('field-history', d, planAction('field-history', d));
  const saves = stages.map((s, i) => ({ digest: s.digest, version: i, status: 200, endMs: 10 + i }));
  assert.deepEqual(judgeStageSaves(saves, stages), []);
  assert.match(judgeStageSaves(saves.slice(0, 2), stages).join(), /expected 3 save/);
  assert.match(judgeStageSaves([...saves, saves[2]], stages).join(), /expected 3 save/);
  assert.match(judgeStageSaves([saves[0], saves[2], saves[1]], stages).join(), /undo/);
  assert.match(judgeStageSaves(saves.map((s, i) => ({ ...s, version: i + 1 })), stages).join(), /version/);
  assert.match(judgeStageSaves(saves.map((s, i) => (i === 1 ? { ...s, version: 3 } : s)), stages).join(), /version/);
  assert.match(judgeStageSaves(saves.map((s, i) => (i === 2 ? { ...s, endMs: null } : s)), stages).join(), /never finished/);
  assert.match(judgeStageSaves(saves.map((s, i) => (i === 0 ? { ...s, status: 409 } : s)), stages).join(), /status/);
  assert.match(judgeStageSaves([null, saves[1], saves[2]], stages).join(), /not a save record/);
});

test('summary rows name the probe version and end boundary of their samples', () => {
  const runs = [1, 2].map((n) => ({
    backend: 'state-lib',
    family: 'field-history',
    count: 30,
    samples: [{ ...sample, handlerMs: n }, { ...sample, stage: 'undo', expectedBoundary: 'window-bubble', boundary: 'window-bubble' }],
    problems: [],
  }));
  const rows = summarizeRuns(runs);
  const commit = rows.find((r) => r.stage === 'commit');
  assert.equal(commit.probeVersion, PROBE_VERSION);
  assert.equal(commit.endBoundary, 'editor-target');
  assert.equal(rows.find((r) => r.stage === 'undo').endBoundary, 'window-bubble');
  const [old] = summarizeRuns([{ backend: 'baseline', family: 'edit', count: 1, samples: [{ stage: 'commit', handlerMs: 1, nextFrameMs: 2 }], problems: [] }]);
  assert.equal(old.probeVersion, null);
});

test('negative modes cover wrong row, stale fixture, early observer, capture microtask and unsettled save', () => {
  assert.deepEqual([...NEGATIVE_MODES].sort(), ['', 'capture-microtask', 'early-observer', 'no-save', 'stale', 'wrong-row']);
});

test('artifact roots are explicit absolute read-only inputs or the old default build roots', () => {
  const defaults = parseArtifactRoots({}, '/w');
  assert.deepEqual(defaults, { baseline: '/w/dist/specialized-test-baseline', 'state-lib': '/w/dist/specialized-test-state-lib', explicit: false });
  const explicit = parseArtifactRoots({ BENCH_ARTIFACT_BASELINE: '/a/base', BENCH_ARTIFACT_STATE: '/a/state' }, '/w');
  assert.deepEqual(explicit, { baseline: '/a/base', 'state-lib': '/a/state', explicit: true });
  assert.throws(() => parseArtifactRoots({ BENCH_ARTIFACT_BASELINE: '/a/base' }, '/w'), /both/);
  assert.throws(() => parseArtifactRoots({ BENCH_ARTIFACT_BASELINE: 'rel', BENCH_ARTIFACT_STATE: '/a/state' }, '/w'), /absolute/);
  assert.throws(() => parseArtifactRoots({ BENCH_ARTIFACT_BASELINE: '/a/same', BENCH_ARTIFACT_STATE: '/a/same/' }, '/w'), /distinct/);
});

test('artifact tree hash covers every file and detects any change, addition or removal', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-tree-'));
  try {
    mkdirSync(join(root, 'packages/x'), { recursive: true });
    writeFileSync(join(root, 'app.js'), 'one');
    writeFileSync(join(root, 'packages/x/a.mjs'), 'two');
    const before = hashTree(root);
    assert.deepEqual(before.files.map((f) => f.path), ['app.js', 'packages/x/a.mjs']);
    assert.match(before.digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(compareTrees(before, hashTree(root)), []);
    writeFileSync(join(root, 'packages/x/a.mjs'), 'changed');
    assert.match(compareTrees(before, hashTree(root)).join(), /changed: packages\/x\/a.mjs/);
    writeFileSync(join(root, 'packages/x/a.mjs'), 'two');
    writeFileSync(join(root, 'extra.js'), '');
    assert.match(compareTrees(before, hashTree(root)).join(), /added: extra.js/);
    rmSync(join(root, 'extra.js'));
    rmSync(join(root, 'app.js'));
    assert.match(compareTrees(before, hashTree(root)).join(), /removed: app.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('receipt oracle: stage names and timed sample specs agree with the expected stages and family settings', () => {
  const d = doc(30);
  for (const family of Object.keys(FAMILIES)) {
    assert.deepEqual(stageNames(family), expectedStages(family, d, planAction(family, d)).map((s) => s.name), family);
    const specs = expectedSampleSpecs(family);
    assert(specs.length >= 1, family);
    for (const s of specs) assert(s.boundary === null ? family === 'load' : s.boundary in END_BOUNDARIES, family + ' ' + s.stage);
  }
  assert.equal(expectedSampleSpecs('edit').length, FAMILIES.edit.settings.typed.length + 1);
  assert.deepEqual(expectedSampleSpecs('field-history').map((s) => [s.stage, s.boundary, s.awaitSave]), [
    ['commit', 'editor-target', true],
    ['undo', 'window-bubble', true],
    ['redo', 'window-bubble', true],
  ]);
  assert.throws(() => stageNames('nope'), /Unknown family/);
  assert.throws(() => expectedSampleSpecs('nope'), /Unknown family/);
  assert.throws(() => stageNames('__proto__'), /Unknown family/);
  assert.throws(() => planAction('constructor', doc(2)), /Unknown family/);
  assert.throws(() => endBoundaryFor('__proto__'), /boundary/);
});

test('the recorded fixture template rebuilds exactly the fixture of the full stored workspace', () => {
  // A previous page's final workspace: several boards, rows, extra fields at every level.
  const stored = buildActionDocument(template, 2500);
  stored.settings = { theme: 'paper' };
  stored.boards[0].note = 'kept';
  stored.boards[0].columns[0].subtitle = 'kept too';
  const reduced = fixtureTemplate(stored);
  assert.equal(reduced.boards.length, 1);
  assert.equal(reduced.boards[0].columns.length, 1);
  assert.deepEqual(reduced.boards[0].columns[0].items, []);
  assert.deepEqual(fixtureTemplate(reduced), reduced, 'reduction is idempotent');
  for (const n of [1, 30, 1200, 2500]) assert.equal(documentDigest(buildActionDocument(reduced, n)), documentDigest(buildActionDocument(stored, n)), n + ' rows');
  assert.equal(stored.boards.length, 3, 'input is not mutated');
});

test('served artifact bytes are the hashed snapshot, unaffected by a later rewrite of the directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-snapshot-'));
  try {
    writeFileSync(join(root, 'app.js'), 'original');
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    const snap = snapshotTree(root);
    const { bodies, ...manifest } = snap;
    assert.deepEqual(manifest, hashTree(root), 'hashTree is the snapshot manifest');
    writeFileSync(join(root, 'app.js'), 'swapped mid-run');
    assert.equal(bodies.get('app.js').toString(), 'original');
    assert.equal(createHash('sha256').update(bodies.get('app.js')).digest('hex'), manifest.files.find((f) => f.path === 'app.js').sha256);
    assert.match(compareTrees(manifest, hashTree(root)).join(), /changed: app.js/, 'the directory re-hash still reports the swap');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('field-history settings name exactly the oracle stages as timed stages', () => {
  assert.deepEqual(FAMILIES['field-history'].settings.timedStages, stageNames('field-history'));
  assert.deepEqual(FAMILIES['field-history'].settings.timedStages, expectedSampleSpecs('field-history').map((s) => s.stage));
});
