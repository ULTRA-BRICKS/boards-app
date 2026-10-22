// Fail-closed contract of scripts/benchmark-action-correctness-receipt.mjs (HYP-1740). The receipt is
// the correctness acceptance of a driver output directory: it must reject everything it cannot prove
// (no data, omitted families/engines/sizes/backends/pages, missing stages or saves, non-numeric
// samples, unknown artifacts, negative-control output) instead of printing PASS for what it skipped.
// SYNTHETIC FIXTURE: the valid directory below is written by this test from the lib oracle and two
// tiny temporary artifact trees; it is not a measurement and proves nothing about Boards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FAMILIES,
  PROBE_VERSION,
  END_BOUNDARIES,
  buildActionDocument,
  planAction,
  expectedStages,
  documentDigest,
  summarizeRuns,
} from '../scripts/benchmark-compiled-board-actions-lib.mjs';
import { hashTree } from '../scripts/benchmark-artifact-tree.mjs';
import { HARNESS_FILES, fixtureServerFiles, artifactFile, checkEvidence } from '../scripts/benchmark-action-correctness-receipt.mjs';

const RECEIPT = resolve('scripts/benchmark-action-correctness-receipt.mjs');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const SERVER_FILES = fixtureServerFiles(process.cwd());
const template = {
  boards: [{ id: 'b0', title: 'Board', columns: [{ id: 'c0', title: 'One', note: '', subtitle: '', items: [] }] }],
};
// Timed samples per family as the driver records them (stage, end event, awaits a save).
const SAMPLE_PLAN = {
  completion: () => [['toggle', 'window-bubble', true]],
  edit: (typed) => [...[...typed].map(() => ['keystroke', 'window-bubble', false]), ['commit', 'editor-target', true]],
  move: () => [['move', 'window-bubble', true]],
  history: () => [
    ['undo', 'window-bubble', true],
    ['redo', 'window-bubble', true],
  ],
  'field-history': () => [
    ['commit', 'editor-target', true],
    ['undo', 'window-bubble', true],
    ['redo', 'window-bubble', true],
  ],
  load: () => [['load', null, false]],
};

function sampleFor([stage, boundary, awaitSave], rowId) {
  if (stage === 'load')
    return {
      stage,
      metricKind: 'navigation-load',
      trusted: true,
      expectedId: rowId,
      id: rowId,
      committedAtHandlerEnd: true,
      correct: true,
      startupMs: 1,
      lastResponseMs: 20,
      postResponseRenderMs: 3,
      nextFrameMs: 5,
      totalToFrameMs: 30,
    };
  return {
    stage,
    start: 100,
    trusted: true,
    id: rowId,
    expectedId: rowId,
    expectAsync: awaitSave,
    probeVersion: PROBE_VERSION,
    expectedBoundary: boundary,
    appHandlerBeforeProbe: boundary === 'editor-target' ? true : null,
    windowBubbleMs: null,
    done: true,
    handlerMs: 2,
    boundary,
    committedAtHandlerEnd: true,
    nextFrameMs: 8,
    correct: true,
    ...(awaitSave ? { asyncSettledMs: 400 } : {}),
  };
}

function recordFor(family, count, trial, backend) {
  const seeded = buildActionDocument(template, count);
  const plan = planAction(family, seeded);
  plan.actRowId = seeded.boards[0].columns[0].items[1]?.id ?? plan.rowId;
  const stages = expectedStages(family, seeded, plan);
  const mutating = stages.filter((s) => s.mutates);
  const saves = mutating.map((s, i) => ({ version: i, digest: s.digest, status: 200, startMs: 100 + i, endMs: 200 + i }));
  return {
    family,
    backend,
    count,
    trial,
    problems: [],
    samples: SAMPLE_PLAN[family](FAMILIES[family].settings.typed).map((spec) => sampleFor(spec, plan.rowId)),
    load: [0, 0, 0],
    saves,
    fetches: [],
    finalDigest: stages.at(-1).digest,
    stageDigests: Object.fromEntries(stages.map((s) => [s.name, s.digest])),
    domOrder: [],
    selectedIds: family === 'field-history' ? [plan.rowId] : [],
    plan,
    topology: seeded.boards.map((b) => ({ id: b.id, columnRows: b.columns.map((c) => c.items.length) })),
    stageExpected: stages.map(({ name, digest }) => ({ name, digest })),
    fixtureTemplate: template,
  };
}

function makeArtifacts(root) {
  const out = {};
  for (const name of ['baseline', 'state-lib']) {
    const dir = join(root, 'artifacts', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'app.js'), 'console.log(' + JSON.stringify(name) + ')');
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    const tree = hashTree(dir);
    out[name] = { name, root: dir, sha256: sha(readFileSync(join(dir, 'app.js'))), treeDigest: tree.digest, files: tree.files };
  }
  return out;
}

function docFor(family, engine, counts, pages, variants) {
  const raw = [],
    comparisons = [];
  for (const count of counts)
    for (let trial = 0; trial < pages; trial++) {
      for (const backend of trial % 2 ? ['state-lib', 'baseline'] : ['baseline', 'state-lib']) raw.push(recordFor(family, count, trial, backend));
      comparisons.push({ family, count, trial, differences: [] });
    }
  return {
    date: '2026-10-22T00:00:00.000Z',
    node: process.version,
    engine,
    browser: engine === 'webkit' ? '26.6' : '153.0.8010.12',
    logicalCPUs: 4,
    variants: [variants.baseline, variants['state-lib']],
    artifactRootsExplicit: true,
    fixtureServer: {
      label: 'SYNTHETIC LOCAL FIXTURE SERVER: receipt unit test',
      sourceHashes: Object.fromEntries(SERVER_FILES.map((f) => [f, sha(readFileSync(resolve(f)))])),
      seedPeople: 'absent',
    },
    probe: { version: PROBE_VERSION, boundaries: END_BOUNDARIES },
    negative: '',
    sourceHashes: Object.fromEntries(HARNESS_FILES.map((f) => [f, sha(readFileSync(resolve(f)))])),
    counts,
    measuredPagesPerBackend: pages,
    warmupPagesPerBackend: 1,
    family,
    description: FAMILIES[family].description,
    settings: FAMILIES[family].settings,
    settingsSha256: sha(JSON.stringify(FAMILIES[family])),
    limits: [],
    comparisons,
    summary: summarizeRuns(raw),
    raw,
  };
}

const fileOf = artifactFile;
const EXPECT = { families: ['field-history', 'edit'], engines: ['chromium', 'webkit'], counts: [1, 30], pages: 2 };
const args = (e = EXPECT) => ['--families', e.families.join(','), '--engines', e.engines.join(','), '--counts', e.counts.join(','), '--pages', String(e.pages)];

/** Writes a complete valid directory, lets `mutate(docs)` damage it, runs the receipt. */
function run(mutate = () => {}, { expect = EXPECT, argv } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bench-receipt-'));
  try {
    const evidence = join(root, 'evidence');
    mkdirSync(evidence);
    const variants = makeArtifacts(root);
    const docs = {};
    for (const family of expect.families)
      for (const engine of expect.engines) docs[fileOf(family, engine)] = docFor(family, engine, expect.counts, expect.pages, variants);
    mutate(docs, { root, evidence, variants });
    for (const [name, doc] of Object.entries(docs))
      writeFileSync(join(evidence, name), typeof doc === 'string' ? doc : JSON.stringify(doc));
    const before = Object.fromEntries(readdirSync(evidence).map((f) => [f, readFileSync(join(evidence, f), 'utf8')]));
    const result = spawnSync(process.execPath, [RECEIPT, evidence, ...(argv ?? args(expect))], { encoding: 'utf8' });
    const after = Object.fromEntries(readdirSync(evidence).map((f) => [f, readFileSync(join(evidence, f), 'utf8')]));
    assert.deepEqual(after, before, 'the receipt never writes into or repairs the evidence directory');
    // Only problem lines and usage errors count as the reason; the header always names every dimension.
    const reasons = [...result.stdout.split('\n').filter((l) => l.startsWith('problem: ')), result.stderr].join('\n');
    return { code: result.status, out: result.stdout + result.stderr, reasons };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const rejects = (result, pattern) => {
  assert.notEqual(result.code, 0, 'receipt must exit non-zero:\n' + result.out);
  assert.doesNotMatch(result.out, /RECEIPT: PASS/);
  assert.match(result.reasons, pattern, 'rejected for the wrong reason:\n' + result.out);
};
const each = (docs, fn) => Object.values(docs).forEach(fn);
const fh = (docs, engine = 'chromium') => docs[fileOf('field-history', engine)];

test('a complete synthetic directory passes and prints no timing value', () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RECEIPT: PASS/);
  assert.doesNotMatch(r.out, /handlerMs|nextFrameMs|asyncSettled|\b400\b/);
});

test('usage: every expected dimension is required', () => {
  const r = run(() => {}, { argv: [] });
  assert.equal(r.code, 2, r.out);
  for (const missing of ['--families', '--engines', '--counts', '--pages']) {
    const argv = args();
    argv.splice(argv.indexOf(missing), 2);
    const m = run(() => {}, { argv });
    assert.equal(m.code, 2, missing + ':\n' + m.out);
    assert.match(m.reasons, new RegExp(missing));
  }
  rejects(run(() => {}, { argv: args({ ...EXPECT, pages: 0 }) }), /pages/);
  rejects(run(() => {}, { argv: args({ ...EXPECT, families: ['field-history', 'nope'] }) }), /family/);
});

test('no accepted data: empty directory or only files without raw/family', () => {
  rejects(run((docs) => Object.keys(docs).forEach((k) => delete docs[k])), /missing/);
  rejects(run((docs) => each(docs, (d) => delete d.raw)), /raw/);
  rejects(run((docs) => each(docs, (d) => delete d.family)), /family/);
  rejects(run((docs) => (docs[fileOf('edit', 'webkit')] = '{"truncated": ')), /parse|JSON/);
});

test('omitted expected condition: family, engine, size or page cannot silently pass', () => {
  rejects(run((docs) => delete docs[fileOf('edit', 'webkit')]), /text-edit-commit-webkit\.json: missing/);
  rejects(run((docs) => each(docs, (d) => (d.raw = d.raw.filter((r) => r.count !== 30)))), /30/);
  rejects(run((docs) => (fh(docs).raw = fh(docs).raw.filter((r) => r.trial !== 1))), /trial 1|pages/);
  rejects(run((docs) => (fh(docs).raw = [])), /no records|pages/);
  rejects(run((docs) => (fh(docs).comparisons = [])), /comparison/);
  rejects(run((docs) => (fh(docs).counts = [1])), /counts/);
  rejects(run((docs) => (fh(docs).measuredPagesPerBackend = 1)), /pages/);
  rejects(run((docs) => (fh(docs).engine = 'webkit')), /engine/);
  rejects(run((docs) => (fh(docs).family = 'edit')), /family/);
  rejects(run((docs) => (docs['extra-chromium.json'] = { ...fh(docs) })), /unexpected/);
});

test('truncated or missing backend in a pair', () => {
  rejects(run((docs) => (fh(docs).raw = fh(docs).raw.filter((r) => !(r.backend === 'state-lib' && r.count === 30 && r.trial === 0)))), /state-lib/);
  rejects(run((docs) => (fh(docs).raw = fh(docs).raw.map((r) => ({ ...r, backend: 'baseline' })))), /state-lib|backend/);
  rejects(run((docs) => (fh(docs).raw[0].backend = undefined)), /backend/);
  rejects(run((docs) => fh(docs).raw.push(structuredClone(fh(docs).raw[0]))), /duplicate|pages/);
});

test('malformed or missing expected stages, samples and saves', () => {
  rejects(run((docs) => (fh(docs).raw[0].samples = fh(docs).raw[0].samples.slice(0, 2))), /samples|redo/);
  rejects(run((docs) => (fh(docs).raw[0].samples[1].stage = 'redo')), /undo/);
  rejects(run((docs) => (fh(docs).raw[0].stageExpected = fh(docs).raw[0].stageExpected.slice(0, 2))), /stage/);
  rejects(run((docs) => delete fh(docs).raw[0].stageDigests.undo), /undo/);
  rejects(run((docs) => (fh(docs).raw[0].stageDigests.redo = fh(docs).raw[0].stageDigests.undo)), /redo/);
  rejects(run((docs) => (fh(docs).raw[0].saves = fh(docs).raw[0].saves.slice(0, 2))), /save/);
  rejects(run((docs) => (fh(docs).raw[0].saves[2].status = 409)), /status/);
  rejects(run((docs) => delete fh(docs).raw[0].saves), /save/);
  rejects(run((docs) => (fh(docs).raw[0].finalDigest = 'x')), /final/);
  // A self-consistent no-op (every stage "expected" to be the seeded document) proves nothing.
  rejects(
    run((docs) => {
      const r = fh(docs).raw[0],
        d = r.stageExpected[1].digest;
      r.stageExpected.forEach((s) => (s.digest = d));
      Object.keys(r.stageDigests).forEach((k) => (r.stageDigests[k] = d));
      r.saves.forEach((s) => (s.digest = d));
      r.finalDigest = d;
    }),
    /commit|differ/,
  );
  rejects(run((docs) => (fh(docs).raw[0].selectedIds = [])), /selected/);
  rejects(run((docs) => (fh(docs).raw[0].problems = ['harness failure: x'])), /harness failure/);
  rejects(run((docs) => delete fh(docs).raw[0].problems), /problems/);
});

test('nonfinite, missing, untrusted or wrong-boundary samples', () => {
  rejects(run((docs) => (fh(docs).raw[0].samples[0].handlerMs = null)), /handler/);
  rejects(run((docs) => delete fh(docs).raw[0].samples[1].nextFrameMs), /next frame/);
  rejects(run((docs) => (fh(docs).raw[0].samples[2].asyncSettledMs = null)), /async/);
  rejects(run((docs) => (fh(docs).raw[0].samples[0].handlerMs = -1)), /handler/);
  rejects(run((docs) => (fh(docs).raw[0].samples[0].trusted = false)), /untrusted/);
  rejects(run((docs) => (fh(docs).raw[0].samples[0].committedAtHandlerEnd = false)), /committed/);
  rejects(run((docs) => (fh(docs).raw[0].samples[0].boundary = fh(docs).raw[0].samples[0].expectedBoundary = 'window-bubble')), /boundary/);
  rejects(run((docs) => delete fh(docs).raw[0].samples[0].probeVersion), /probe/);
  rejects(run((docs) => (fh(docs).raw[0].samples[0].id = fh(docs).raw[0].samples[0].expectedId = 'measured-1')), /row/);
  rejects(run((docs) => (fh(docs).raw[0].samples[0].expectAsync = false)), /async|save/);
});

test('artifact identities, harness source and run metadata', () => {
  rejects(run((docs) => each(docs, (d) => (d.variants = d.variants.slice(0, 1)))), /state-lib|variant/);
  rejects(run((docs) => (fh(docs).variants[0].sha256 = '0'.repeat(64))), /app.js|sha256/);
  rejects(run((docs) => (fh(docs).variants[1].treeDigest = 'n/a')), /tree/);
  rejects(run((docs) => (fh(docs).variants[1].files = [])), /manifest/);
  rejects(run((docs, { variants }) => each(docs, (d) => (d.variants[1] = { ...variants.baseline, name: 'state-lib' }))), /distinct|same/);
  rejects(run((docs, { variants }) => writeFileSync(join(variants['state-lib'].root, 'app.js'), 'changed')), /on disk|changed/);
  rejects(
    run((docs, { variants }) => {
      const other = docFor('edit', 'webkit', EXPECT.counts, EXPECT.pages, variants);
      other.variants[0] = { ...other.variants[0], sha256: 'f'.repeat(64) };
      docs[fileOf('edit', 'webkit')] = other;
    }),
    /app.js|sha256|differ/,
  );
  rejects(run((docs) => each(docs, (d) => (d.artifactRootsExplicit = false))), /explicit/);
  rejects(run((docs) => (fh(docs).sourceHashes[HARNESS_FILES[1]] = '0'.repeat(64))), /source/);
  rejects(run((docs) => delete fh(docs).sourceHashes), /source/);
  rejects(run((docs) => (fh(docs).probe.version = 'action-probe-v1')), /probe/);
  rejects(run((docs) => (fh(docs).settingsSha256 = '0'.repeat(64))), /settings/);
  rejects(run((docs) => (fh(docs).browser = '')), /browser/);
});

test('negative-control and pairwise-difference output is never acceptance data', () => {
  rejects(run((docs) => each(docs, (d) => (d.negative = 'no-save'))), /negative/);
  rejects(run((docs) => (fh(docs).comparisons[0].differences = ['final document differs'])), /differ/);
  rejects(run((docs) => (fh(docs).raw.find((r) => r.backend === 'state-lib').selectedIds = ['measured-1'])), /differ|selected/);
  rejects(run((docs) => (fh(docs).comparisons = fh(docs).comparisons.slice(1))), /comparison/);
});

test('a raw observation is never rewritten to make the receipt pass', () => {
  const r = run((docs) => (fh(docs).raw[0].samples[0].handlerMs = 'NaN'));
  rejects(r, /handler/);
  // run() itself asserts every evidence file is byte-identical after the receipt.
});

test('every family has a passing synthetic shape and its own fail-closed stage checks', () => {
  const all = { families: Object.keys(FAMILIES), engines: ['chromium'], counts: [2], pages: 1 };
  const ok = run(() => {}, { expect: all });
  assert.equal(ok.code, 0, ok.out);
  const file = (f) => fileOf(f, 'chromium');
  // Structural history whose move changed nothing, a load that saved, a completion without its save.
  rejects(
    run(
      (docs) => {
        const r = docs[file('history')].raw[0],
          d = r.stageExpected[1].digest;
        r.stageExpected[0].digest = r.stageExpected[2].digest = r.stageDigests.move = r.stageDigests.redo = r.finalDigest = d;
        r.saves.forEach((s) => (s.digest = d));
      },
      { expect: all },
    ),
    /differ from the oracle/,
  );
  rejects(run((docs) => docs[file('load')].raw[0].saves.push({ version: 0, digest: 'x', status: 200, endMs: 1 }), { expect: all }), /expected 0 save requests/);
  rejects(run((docs) => (docs[file('completion')].raw[0].saves = []), { expect: all }), /expected 1 save/);
  rejects(run((docs) => (docs[file('load')].raw[0].samples[0].metricKind = 'event-handler'), { expect: all }), /navigation-load/);
  rejects(run((docs) => (docs[file('edit')].raw[0].samples = docs[file('edit')].raw[0].samples.slice(1)), { expect: all }), /samples/);
});

test('review round 1: expected documents are recomputed from the recorded fixture, not trusted', () => {
  const all = { families: ['completion', 'edit', 'move', 'field-history'], engines: ['chromium'], counts: [2], pages: 1 };
  const file = (f) => fileOf(f, 'chromium');
  // The app did nothing but PUT the seed; every recorded digest is the seed, so the file is self-consistent.
  const noop = (family) => (docs) => {
    const r = docs[file(family)].raw[0],
      seed = documentDigest(buildActionDocument(template, 2));
    r.stageExpected.forEach((x) => (x.digest = seed));
    Object.keys(r.stageDigests).forEach((k) => (r.stageDigests[k] = seed));
    r.saves.forEach((x) => (x.digest = seed));
    r.finalDigest = seed;
  };
  for (const family of ['completion', 'edit', 'move']) rejects(run(noop(family), { expect: all }), /oracle/);
  // Undo landing on a third document that is neither the seed nor the commit.
  rejects(
    run(
      (docs) => {
        const r = docs[file('field-history')].raw[0],
          third = 'a'.repeat(64);
        r.stageExpected[1].digest = r.stageDigests.undo = r.saves[1].digest = third;
      },
      { expect: all },
    ),
    /oracle/,
  );
  rejects(run((docs) => delete docs[file('edit')].raw[0].fixtureTemplate, { expect: all }), /fixture template/);
  rejects(run((docs) => (docs[file('edit')].raw[0].fixtureTemplate = { boards: [] }), { expect: all }), /fixture template/);
  rejects(run((docs) => (docs[file('edit')].raw[0].plan.rowId = 'measured-1'), { expect: all }), /row/);
});

test('review round 1: the fixture server sources are pinned to this checkout', () => {
  rejects(run((docs) => (fh(docs).fixtureServer.sourceHashes['scripts/dev.mjs'] = '0'.repeat(64))), /fixture server source scripts\/dev.mjs/);
  rejects(run((docs) => (fh(docs).fixtureServer.sourceHashes = {})), /fixture server source/);
});

test('review round 1: malformed input is a FAIL line, never a crash', () => {
  const crashFree = (r, pattern) => {
    rejects(r, pattern);
    assert.match(r.out, /RECEIPT: FAIL/, 'prints a verdict instead of a stack trace');
    assert.equal(r.code, 1);
  };
  crashFree(run((docs) => (fh(docs).raw[0].saves = [null, null, null])), /save/);
  crashFree(run((docs) => (fh(docs).raw[0] = null)), /record/);
  crashFree(run((docs) => (fh(docs).raw[0].samples = [null, null, null])), /sample/);
  crashFree(
    run((docs, { root }) => {
      writeFileSync(join(root, 'plain-file'), 'x');
      fh(docs).variants[0] = { ...fh(docs).variants[0], root: join(root, 'plain-file') };
    }),
    /re-hash|artifact root/,
  );
  const proto = run(() => {}, { argv: ['--families', '__proto__', '--engines', 'chromium', '--counts', '1', '--pages', '1'] });
  assert.equal(proto.code, 2, proto.out);
  assert.match(proto.reasons, /unknown family __proto__/);
});

test('review round 2: fixture server pin follows the import graph; loose cells and empty list items fail', () => {
  const files = fixtureServerFiles(process.cwd());
  for (const f of ['scripts/dev.mjs', 'api/index.js', 'server/app.mjs', 'server/store.mjs', 'scripts/state-config-source.mjs', 'packages/core/workspace.mjs'])
    assert(files.includes(f), f + ' is pinned');
  assert(files.every((f) => !f.startsWith('..') && !f.startsWith('/')), 'only repository files');
  // A recorded difference on a non-integer trial is neither matched nor ignored.
  rejects(run((docs) => fh(docs).comparisons.push({ family: 'field-history', count: 30, trial: '1', differences: ['final document differs'] })), /outside the expected cells/);
  rejects(run((docs) => fh(docs).comparisons.push({ family: 'field-history', count: 30, trial: 0.5, differences: [] })), /outside the expected cells/);
  const empty = run(() => {}, { argv: ['--families', 'field-history,', '--engines', 'chromium', '--counts', '1,,30', '--pages', '2'] });
  assert.equal(empty.code, 2, empty.out);
  assert.match(empty.reasons, /empty item/);
  // A harness root without the pinned sources is a FAIL verdict, not a stack trace.
  const bare = mkdtempSync(join(tmpdir(), 'bench-receipt-root-'));
  try {
    const { problems } = checkEvidence(bare, { families: ['edit'], engines: ['chromium'], counts: [1], pages: 1 }, { harnessRoot: bare });
    assert.match(problems.join('\n'), /cannot be hashed/);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test('review round 4: a symlinked invocation still checks; non-decimal numbers and special files are handled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-receipt-link-'));
  try {
    const link = join(dir, 'receipt-link.mjs');
    symlinkSync(RECEIPT, link);
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const r = spawnSync(process.execPath, [link, empty, ...args()], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /RECEIPT: FAIL/);
    for (const bad of [['--pages', '1e1'], ['--counts', '0x10']]) {
      const argv = args();
      argv[argv.indexOf(bad[0]) + 1] = bad[1];
      const u = spawnSync(process.execPath, [RECEIPT, empty, ...argv], { encoding: 'utf8' });
      assert.equal(u.status, 2, bad.join(' ') + ': ' + u.stdout + u.stderr);
    }
    const tree = join(dir, 'tree');
    mkdirSync(tree);
    writeFileSync(join(tree, 'app.js'), 'x');
    const fifo = spawnSync('mkfifo', [join(tree, 'pipe')]);
    if (fifo.status === 0) {
      const manifest = hashTree(tree);
      assert.match(manifest.files.find((f) => f.path === 'pipe').sha256, /^special:/, 'a FIFO is recorded, never read');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('review round 6: unreadable evidence path, repeated flags, seed input and failed pairs', () => {
  const file = spawnSync(process.execPath, [RECEIPT, resolve('package.json'), ...args()], { encoding: 'utf8' });
  assert.equal(file.status, 1, file.stdout + file.stderr);
  assert.match(file.stdout, /cannot be read[\s\S]*RECEIPT: FAIL/);
  const twice = run(() => {}, { argv: [...args(), '--counts', '5'] });
  assert.equal(twice.code, 2, twice.out);
  assert.match(twice.reasons, /--counts is given twice/);
  rejects(run((docs) => delete fh(docs).fixtureServer.seedPeople), /seed-people/);
  const pairOnly = run((docs) => (fh(docs).comparisons[0].differences = ['selection differs']));
  rejects(pairOnly, /differ/);
  assert.match(pairOnly.out, /FAIL 1 rows: 4\/4 pages found, 0 failed, 1 failed pairs/);
});

test('review round 5: unknown stored-document stages and edited settings are failures', () => {
  rejects(run((docs) => (fh(docs).raw[0].stageDigests.bogus = 'a'.repeat(64))), /not exactly the oracle stages/);
  rejects(run((docs) => (fh(docs).settings = { ...fh(docs).settings, events: 'something else' })), /settings or description/);
  rejects(run((docs) => (fh(docs).description = 'another benchmark')), /settings or description/);
});

test('review round 3: the summary must be the summary of the raw records; manifests must be sorted', () => {
  rejects(run((docs) => (fh(docs).summary = [])), /summary is not the summary/);
  rejects(run((docs) => (fh(docs).summary[0].handlerMedianMs = 0.001)), /summary is not the summary/);
  rejects(run((docs) => delete fh(docs).summary), /summary/);
  rejects(
    run((docs) => {
      const v = fh(docs).variants[0];
      fh(docs).variants[0] = { ...v, files: [...v.files].reverse() };
    }),
    /not sorted/,
  );
});
