// Correctness receipt for an output directory of scripts/benchmark-compiled-board-actions.mjs.
// Fail closed: the caller names the expected dimensions (families, engines, counts, measured pages
// per backend) and every one of them must be present, complete and correct; anything missing,
// unknown, malformed or produced by a negative control is a failure, never a skip. Per page it
// proves the trusted event happened on the planned row at the declared probe boundary, that the
// visible result was committed when the handler returned, that each stage saved exactly the
// expected document (one answered save per mutating stage, consecutive versions) and that both
// backends agree. The expected documents are recomputed with the lib oracle from the reduced fixture
// template each page records; recorded expectations are only compared with that, never trusted.
// Artifact identities are recomputed from the recorded manifests and, by default, re-hashed on disk;
// the recorded harness and fixture-server source hashes must equal this checkout's. A file written
// to look like a run can still be forged consistently; these checks bind it to this exact harness,
// server and artifact bytes, they do not sign it. It reads only and prints no timing value, so it
// can be shared before a numerical GO.
// Run: node scripts/benchmark-action-correctness-receipt.mjs <evidence-dir> --families f1,f2
//      --engines chromium,webkit --counts 1,30,1200,10000 --pages 7 [--no-artifact-rehash]
// Exit 0 PASS, 1 any problem, 2 usage error.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FAMILIES,
  PROBE_VERSION,
  END_BOUNDARIES,
  stageNames,
  expectedSampleSpecs,
  expectedSelection,
  fixtureTemplate,
  buildActionDocument,
  planAction,
  expectedStages,
  judgeSample,
  judgeStageSaves,
  compareRuns,
  summarizeRuns,
} from './benchmark-compiled-board-actions-lib.mjs';
import { hashTree, treeDigest } from './benchmark-artifact-tree.mjs';

export const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HARNESS_FILES = [
  'scripts/benchmark-compiled-board-actions.mjs',
  'scripts/benchmark-compiled-board-actions-lib.mjs',
  'scripts/benchmark-compiled-board-actions-probe.mjs',
  'scripts/benchmark-artifact-tree.mjs',
  'scripts/benchmark-action-correctness-receipt.mjs',
];
/**
 * Sources of the synthetic local API the driver starts: scripts/dev.mjs, api/index.js and every
 * repository module they import through a relative static or dynamic specifier, transitively.
 * Bare specifiers (node_modules) are not followed. require and dynamic imports whose specifier is
 * not a string literal throw instead of shrinking the pin. Not followed either: files read with fs,
 * workers and spawned scripts; the current graph has none (checked 2026-10-22), keep it that way.
 */
export function fixtureServerFiles(root) {
  const seen = new Set(),
    queue = ['scripts/dev.mjs', 'api/index.js'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(root, file), 'utf8');
    const dynamicImports = source.match(/\bimport\s*\(/g)?.length ?? 0,
      literalImports = source.match(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g)?.length ?? 0;
    if (/\brequire\s*\(/.test(source) || dynamicImports !== literalImports)
      throw Error(`cannot pin fixture server sources: ${file} loads a module through require or a non-literal dynamic import`);
    for (const [, spec] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.\.?\/[^'"]+)['"]/g))
      queue.push(relative(root, resolve(root, dirname(file), spec)).split(sep).join('/'));
  }
  return [...seen].sort();
}
const ENGINES = ['chromium', 'webkit', 'firefox'];
const BACKENDS = ['baseline', 'state-lib'];
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (value) => value !== null && typeof value === 'object';
export const artifactFile = (family, engine) => FAMILIES[family].artifact.replace(/\.json$/, '') + '-' + engine + '.json';

const USAGE =
  'usage: benchmark-action-correctness-receipt.mjs <evidence-dir> --families f1,f2 --engines chromium,webkit --counts 1,30 --pages 7 [--no-artifact-rehash]';

/** Parses argv into {dir, expect, rehash}; throws a usage error naming the missing or bad argument. */
export function parseArgs(argv) {
  const [dir, ...rest] = argv;
  if (!dir || dir.startsWith('--')) throw Error('evidence directory is required');
  const opts = {},
    flags = new Set();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--no-artifact-rehash') flags.add(arg);
    else if (['--families', '--engines', '--counts', '--pages'].includes(arg) && rest[i + 1] !== undefined) {
      if (arg in opts) throw Error(arg + ' is given twice');
      opts[arg] = rest[++i];
    }
    else throw Error('unknown or incomplete argument ' + arg);
  }
  for (const name of ['--families', '--engines', '--counts', '--pages']) if (!opts[name]) throw Error(name + ' is required');
  const list = (v) => {
    const items = v.split(',');
    if (items.some((item) => !item)) throw Error(`empty item in list ${JSON.stringify(v)}`);
    return items;
  };
  const families = list(opts['--families']),
    engines = list(opts['--engines']),
    decimal = (v) => (/^\d+$/.test(v) ? Number(v) : NaN),
    counts = list(opts['--counts']).map(decimal),
    pages = decimal(opts['--pages']);
  for (const f of families) if (!Object.hasOwn(FAMILIES, f)) throw Error('unknown family ' + f);
  for (const e of engines) if (!ENGINES.includes(e)) throw Error('unknown engine ' + e);
  for (const n of counts) if (!Number.isSafeInteger(n) || n < 1 || n > 10000) throw Error('--counts must be integers 1..10000');
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 17) throw Error('--pages must be an integer 1..17');
  for (const [name, values] of [
    ['--families', families],
    ['--engines', engines],
    ['--counts', counts],
  ])
    if (!values.length || new Set(values).size !== values.length) throw Error(name + ' must be a non-empty list without repeats');
  return { dir: resolve(dir), expect: { families, engines, counts, pages }, rehash: !flags.has('--no-artifact-rehash') };
}

function checkVariants(doc, rehash) {
  const problems = [];
  if (!Array.isArray(doc.variants) || doc.variants.length !== 2) return ['expected exactly two artifact variants (baseline, state-lib)'];
  if (!same(doc.variants.map((v) => v?.name), BACKENDS)) problems.push(`artifact variants ${JSON.stringify(doc.variants.map((v) => v?.name))}, expected baseline, state-lib`);
  if (doc.artifactRootsExplicit !== true) problems.push('artifact roots were not explicit (BENCH_ARTIFACT_BASELINE/BENCH_ARTIFACT_STATE)');
  for (const v of doc.variants) {
    const name = v?.name ?? '?';
    if (typeof v?.root !== 'string' || !isAbsolute(v.root)) problems.push(`${name}: artifact root is not an absolute path`);
    if (!HEX64.test(v?.sha256 ?? '')) problems.push(`${name}: app.js sha256 is missing or malformed`);
    if (!HEX64.test(v?.treeDigest ?? '')) problems.push(`${name}: artifact tree digest is missing or malformed`);
    const files = Array.isArray(v?.files) ? v.files : [];
    if (!files.length || !files.every((f) => typeof f?.path === 'string' && typeof f?.sha256 === 'string'))
      problems.push(`${name}: artifact file manifest is missing or malformed`);
    else {
      if (!files.every((f, i) => i === 0 || files[i - 1].path < f.path)) problems.push(`${name}: artifact file manifest is not sorted by unique path`);
      if (treeDigest(files) !== v.treeDigest) problems.push(`${name}: artifact tree digest does not match its file manifest`);
      if (files.find((f) => f.path === 'app.js')?.sha256 !== v.sha256) problems.push(`${name}: app.js sha256 is not the manifest's app.js`);
      if (!files.some((f) => f.path === 'index.html')) problems.push(`${name}: manifest has no index.html`);
    }
    if (rehash && typeof v?.root === 'string' && isAbsolute(v.root))
      try {
        if (!existsSync(v.root)) problems.push(`${name}: artifact root ${v.root} is missing on disk`);
        else if (hashTree(v.root).digest !== v.treeDigest) problems.push(`${name}: artifact tree on disk changed since the run (${v.root})`);
      } catch (error) {
        problems.push(`${name}: artifact root ${v.root} cannot be re-hashed (${error.message})`);
      }
  }
  const [a, b] = doc.variants;
  if (a?.root === b?.root || a?.treeDigest === b?.treeDigest || a?.sha256 === b?.sha256)
    problems.push('baseline and state-lib artifacts are not distinct (same root, tree or app.js)');
  return problems;
}

function checkDocument(doc, family, engine, expect, pinned, rehash) {
  const problems = [];
  if (doc.family !== family) problems.push(`family ${JSON.stringify(doc.family)}, expected ${family}`);
  if (doc.engine !== engine) problems.push(`engine ${JSON.stringify(doc.engine)}, expected ${engine}`);
  if (typeof doc.browser !== 'string' || !doc.browser) problems.push('browser version is missing');
  if (doc.negative !== '') problems.push(`negative control ${JSON.stringify(doc.negative)} output is not acceptance data`);
  if (doc.probe?.version !== PROBE_VERSION) problems.push(`probe version ${JSON.stringify(doc.probe?.version)}, expected ${PROBE_VERSION}`);
  else if (!same(doc.probe.boundaries, END_BOUNDARIES)) problems.push('probe end boundaries differ from this harness');
  if (doc.settingsSha256 !== sha256(JSON.stringify(FAMILIES[family]))) problems.push('family settings hash differs from this harness (settingsSha256)');
  if (!same(doc.settings, FAMILIES[family].settings) || doc.description !== FAMILIES[family].description)
    problems.push('recorded family settings or description differ from this harness');
  for (const [what, recorded, hashes] of [
    ['harness source', doc.sourceHashes, pinned.harness],
    ['fixture server source', doc.fixtureServer?.sourceHashes, pinned.server],
  ])
    if (!isObject(recorded)) problems.push(what + ' hashes are missing');
    else if (!same(Object.keys(recorded).sort(), Object.keys(hashes).sort()))
      problems.push(`${what} files ${JSON.stringify(Object.keys(recorded))} differ from this checkout's ${JSON.stringify(Object.keys(hashes))}`);
    else
      for (const [file, hash] of Object.entries(hashes))
        if (recorded[file] !== hash) problems.push(`${what} ${file} differs from this checkout (recorded ${recorded[file]})`);
  if (!Array.isArray(doc.counts) || !same([...doc.counts].sort((x, y) => x - y), [...expect.counts].sort((x, y) => x - y)))
    problems.push(`run counts ${JSON.stringify(doc.counts)}, expected ${JSON.stringify(expect.counts)}`);
  if (doc.measuredPagesPerBackend !== expect.pages)
    problems.push(`measured pages per backend ${JSON.stringify(doc.measuredPagesPerBackend)}, expected ${expect.pages}`);
  if (typeof doc.fixtureServer?.label !== 'string' || !doc.fixtureServer.label.startsWith('SYNTHETIC LOCAL FIXTURE SERVER'))
    problems.push('fixture server label is missing');
  if (doc.fixtureServer?.seedPeople !== 'absent') problems.push('fixture server seed-people input was not recorded as absent');
  problems.push(...checkVariants(doc, rehash));
  return problems;
}

/** Plan and expected stages rebuilt from the recorded fixture template with the lib oracle, or a problem. */
function recomputeOracle(record, family) {
  const template = record.fixtureTemplate;
  if (!isObject(template)) return { problem: 'fixture template is missing' };
  try {
    if (!same(fixtureTemplate(template), template)) return { problem: 'fixture template is not a reduced template (one board, one column, no rows)' };
    const seeded = buildActionDocument(template, record.count);
    const plan = planAction(family, seeded);
    const topology = seeded.boards.map((b) => ({ id: b.id, columnRows: b.columns.map((c) => c.items.length) }));
    if (!same(record.topology, topology)) return { problem: 'recorded topology is not the fixture built from its template' };
    return { plan, stages: expectedStages(family, seeded, plan).map(({ name, digest, mutates }) => ({ name, digest, mutates })) };
  } catch (error) {
    return { problem: `fixture template cannot be rebuilt (${error.message})` };
  }
}

function checkRecord(record, family) {
  if (!isObject(record)) return ['record is not an object'];
  const problems = [];
  if (!Array.isArray(record.problems)) problems.push('problems list is missing');
  else problems.push(...record.problems);
  if (record.family !== family) problems.push(`record family ${JSON.stringify(record.family)}`);
  const oracle = recomputeOracle(record, family);
  if (oracle.problem) return [...problems, oracle.problem];
  const { plan, stages } = oracle,
    rowId = plan.rowId;
  if (record.plan?.rowId !== rowId) problems.push(`plan row ${JSON.stringify(record.plan?.rowId)}, oracle row ${rowId}`);
  if (record.plan?.typed !== plan.typed) problems.push('plan typed text differs from the family settings');
  // Stages and documents: the recorded expectation must be the recomputed oracle, and the stored
  // document after every stage, the final document and each save payload must be that oracle.
  if (!same(stages.map((s) => s.name), stageNames(family))) problems.push('oracle stage names differ from stageNames (harness bug)');
  if (!same(record.stageExpected, stages.map(({ name, digest }) => ({ name, digest }))))
    problems.push('recorded expected stages differ from the oracle recomputed from the fixture template');
  if (!isObject(record.stageDigests) || !same(Object.keys(record.stageDigests).sort(), stages.map((s) => s.name).sort()))
    problems.push(`stored-document stages ${JSON.stringify(Object.keys(record.stageDigests ?? {}))} are not exactly the oracle stages`);
  for (const { name, digest } of stages)
    if (record.stageDigests?.[name] !== digest) problems.push(`stored document after ${name} is missing or differs from the expected document`);
  if (record.finalDigest !== stages.at(-1).digest) problems.push('final stored document differs from the last expected stage');
  if (!Array.isArray(record.saves) || !record.saves.every(isObject)) problems.push('save request list is missing or malformed');
  else problems.push(...judgeStageSaves(record.saves, stages));
  const selection = expectedSelection(family, plan);
  if (selection && !same(record.selectedIds, selection))
    problems.push(`selected rows ${JSON.stringify(record.selectedIds)}, expected ${JSON.stringify(selection)}`);
  // Samples: the oracle's stage sequence, each a trusted, committed event at its declared boundary.
  const specs = expectedSampleSpecs(family),
    samples = Array.isArray(record.samples) ? record.samples : [];
  if (!samples.every(isObject)) problems.push('a sample is not an object');
  else if (!same(samples.map((s) => s.stage), specs.map((s) => s.stage)))
    problems.push(`samples ${JSON.stringify(samples.map((s) => s.stage))}, expected ${JSON.stringify(specs.map((s) => s.stage))}`);
  else
    specs.forEach((spec, i) => {
      const s = samples[i],
        at = `${spec.stage} sample ${i + 1}: `;
      problems.push(...judgeSample(s).map((p) => at + p));
      if (s.id !== rowId || s.expectedId !== rowId) problems.push(at + `row ${s.id}/${s.expectedId}, planned ${rowId}`);
      for (const field of family === 'load' ? ['lastResponseMs', 'postResponseRenderMs', 'nextFrameMs'] : ['handlerMs', 'nextFrameMs'])
        if (!(Number.isFinite(s[field]) && s[field] >= 0)) problems.push(at + `${field === 'handlerMs' ? 'handler' : field === 'nextFrameMs' ? 'next frame' : field} time is not a finite non-negative number`);
      if (family === 'load') {
        if (s.metricKind !== 'navigation-load') problems.push(at + 'not a navigation-load sample');
        return;
      }
      if (s.probeVersion !== PROBE_VERSION) problems.push(at + `probe version ${JSON.stringify(s.probeVersion)}, expected ${PROBE_VERSION}`);
      if (s.boundary !== spec.boundary || s.expectedBoundary !== spec.boundary)
        problems.push(at + `end boundary ${s.boundary}/${s.expectedBoundary}, expected ${spec.boundary}`);
      if (s.expectAsync !== spec.awaitSave) problems.push(at + `awaits a save ${s.expectAsync}, expected ${spec.awaitSave}`);
      if (spec.awaitSave && !(Number.isFinite(s.asyncSettledMs) && s.asyncSettledMs >= 0)) problems.push(at + 'async save settlement is not a finite number');
    });
  return problems;
}

/** Full receipt over a directory. Returns {lines, problems}; never writes. */
export function checkEvidence(dir, expect, { rehash = true, harnessRoot = HARNESS_ROOT } = {}) {
  const lines = [],
    problems = [];
  const fail = (where, list) => list.forEach((p) => problems.push(`${where}: ${p}`));
  const hashesOf = (files) => Object.fromEntries(files.map((f) => [f, sha256(readFileSync(join(harnessRoot, f)))]));
  let pinned;
  try {
    pinned = { harness: hashesOf(HARNESS_FILES), server: hashesOf(fixtureServerFiles(harnessRoot)) };
  } catch (error) {
    return { lines, problems: [`harness or fixture server sources cannot be hashed in ${harnessRoot} (${error.message})`] };
  }
  lines.push('harness source: ' + HARNESS_FILES.map((f) => `${f} ${pinned.harness[f].slice(0, 12)}`).join(', '));
  lines.push(`expected: families ${expect.families.join(',')}; engines ${expect.engines.join(',')}; counts ${expect.counts.join(',')}; ${expect.pages} measured pages per backend`);
  let listing;
  try {
    listing = readdirSync(dir);
  } catch (error) {
    return { lines, problems: [`evidence directory ${dir} cannot be read (${error.message})`] };
  }
  const wanted = new Map(expect.families.flatMap((f) => expect.engines.map((e) => [artifactFile(f, e), [f, e]])));
  for (const file of listing.filter((f) => f.endsWith('.json')).sort())
    if (!wanted.has(file)) problems.push(`${file}: unexpected JSON file in the evidence directory`);
  let identity;
  for (const [file, [family, engine]] of wanted) {
    if (!existsSync(join(dir, file))) {
      problems.push(`${file}: missing (family ${family}, engine ${engine})`);
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      problems.push(`${file}: cannot parse JSON (${error.message})`);
      continue;
    }
    if (!isObject(doc) || !Array.isArray(doc.raw) || !Array.isArray(doc.comparisons)) {
      problems.push(`${file}: no raw records or comparisons list`);
      continue;
    }
    fail(file, checkDocument(doc, family, engine, expect, pinned, rehash));
    const ids = Array.isArray(doc.variants) ? doc.variants.map((v) => [v?.name, v?.sha256, v?.treeDigest]) : null;
    if (identity === undefined) identity = ids;
    else if (!same(ids, identity)) problems.push(`${file}: artifact identities differ from the other files of this directory`);
    // The summary is what a numerical GO reads; it must be exactly the summary of these raw records.
    try {
      if (!same(doc.summary, summarizeRuns(doc.raw))) problems.push(`${file}: summary is not the summary of its raw records`);
    } catch (error) {
      problems.push(`${file}: summary cannot be recomputed from its raw records (${error.message})`);
    }
    lines.push(`# ${file}: ${family}, ${engine} ${doc.browser}, probe ${doc.probe?.version}`);
    for (const v of Array.isArray(doc.variants) ? doc.variants : [])
      lines.push(`  artifact ${v?.name} ${v?.root} app.js ${v?.sha256} tree ${v?.treeDigest} (${v?.files?.length ?? '?'} files)`);
    if (!doc.raw.length) problems.push(`${file}: no records`);
    for (const record of doc.raw)
      if (!expect.counts.includes(record?.count) || !BACKENDS.includes(record?.backend) || !Number.isSafeInteger(record?.trial) || record.trial < 0 || record.trial >= expect.pages)
        problems.push(`${file}: record outside the expected cells (count ${record?.count}, backend ${record?.backend}, trial ${record?.trial})`);
    for (const count of expect.counts) {
      let matched = 0,
        failed = 0,
        pairsFailed = 0;
      const versions = new Set();
      for (let trial = 0; trial < expect.pages; trial++) {
        const pair = {};
        for (const backend of BACKENDS) {
          const at = doc.raw.filter((r) => r?.count === count && r?.trial === trial && r?.backend === backend);
          const where = `${file} ${count} rows ${backend} trial ${trial}`;
          if (at.length !== 1) {
            problems.push(`${where}: ${at.length ? 'duplicate records' : 'missing page'} (${at.length} records)`);
            failed++;
            continue;
          }
          matched++;
          let list;
          try {
            list = checkRecord(at[0], family);
          } catch (error) {
            list = [`record cannot be checked (${error.message})`];
          }
          if (list.length) failed++;
          fail(where, list);
          pair[backend] = at[0];
          versions.add(JSON.stringify(Array.isArray(at[0].saves) ? at[0].saves.map((s) => s?.version) : null));
        }
        const comparison = doc.comparisons.filter((c) => c?.count === count && c?.trial === trial);
        const where = `${file} ${count} rows trial ${trial}`;
        const pairProblems = [];
        if (comparison.length !== 1 || !Array.isArray(comparison[0].differences))
          pairProblems.push(`expected one pairwise comparison, found ${comparison.length}`);
        else if (comparison[0].differences.length) pairProblems.push(`baseline vs state-lib differ: ${comparison[0].differences.join('; ')}`);
        if (pair.baseline && pair['state-lib'])
          try {
            const recomputed = compareRuns(pair.baseline, pair['state-lib']);
            if (recomputed.length) pairProblems.push(`recomputed pairwise comparison differs: ${recomputed.join('; ')}`);
          } catch (error) {
            pairProblems.push(`pairwise comparison cannot be recomputed (${error.message})`);
          }
        if (pairProblems.length) pairsFailed++;
        fail(where, pairProblems);
      }
      lines.push(
        `  ${failed || pairsFailed ? 'FAIL' : 'PASS'} ${count} rows: ${matched}/${expect.pages * 2} pages found, ${failed} failed, ${pairsFailed} failed pairs; samples ${expectedSampleSpecs(family).map((s) => s.stage + (s.boundary ? '@' + s.boundary : '')).join(' ')}; save versions ${[...versions].join(' ')}`,
      );
    }
    const extra = doc.comparisons.filter(
      (c) => !expect.counts.includes(c?.count) || !Number.isSafeInteger(c?.trial) || c.trial < 0 || c.trial >= expect.pages,
    );
    if (extra.length) problems.push(`${file}: ${extra.length} comparisons outside the expected cells`);
  }
  return { lines, problems };
}

// Node resolves the main module through realpath; compare real paths so a symlinked invocation
// still runs the checks instead of exiting 0 silently.
const invokedAsMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedAsMain) {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message + '\n' + USAGE);
    process.exit(2);
  }
  const { lines, problems } = checkEvidence(parsed.dir, parsed.expect, { rehash: parsed.rehash });
  console.log(lines.join('\n'));
  for (const p of problems) console.log('problem: ' + p);
  console.log(problems.length ? `RECEIPT: FAIL (${problems.length})` : 'RECEIPT: PASS');
  process.exitCode = problems.length ? 1 : 0;
}
