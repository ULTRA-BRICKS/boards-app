// Validates docs/state-migration-manifest.json and proves the validator itself
// rejects bad entries and accepts a good one (HYP-1490).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateManifest,summarizeManifest} from '../scripts/validate-state-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const gitShow = () => 'const onlyType = false; function legacyHelper() {}';
const check = (manifest) => validateManifest(manifest, {root, gitShow, warn: () => {}});
const good = () => ({
  id: 'demo-entry', owner: 'test', kind: 'document', category: 'application-state', actions: ['edit'],
  oldSource: {file: 'scripts/build.mjs', symbols: ['onlyType']},
  replacement: {file: 'apps/board/state-config.mjs', symbols: ['STATE_CONFIG']},
  completion: 'complete', completionNote: '', baselineRevision: '9ebf080',
  tests: ['tests/state-build-config.test.mjs'], spec: ['/spec#s4-4'], appUse: ['STATE_CONFIG'],
});
const wrap = (...entries) => ({baselineRevision: '9ebf080', specBase: '/spec', generatedFor: 'HYP-1490', entries});
const errorsFor = (patch) => check(wrap({...good(), ...patch}));

test('the committed manifest is valid', () => {
  const manifest = JSON.parse(readFileSync(root + 'docs/state-migration-manifest.json', 'utf8'));
  assert.deepEqual(validateManifest(manifest, {root, warn: () => {}}), []);
});

test('a good entry passes', () => assert.deepEqual(check(wrap(good())), []));

test('top-level fields are required', () => {
  assert.ok(check({entries: []}).length >= 3);
  assert.ok(check({baselineRevision: '9ebf080', specBase: '/spec', generatedFor: 'x'}).some((e) => /entries/.test(e)));
});

test('bad entries are rejected with specific errors', () => {
  const cases = {
    'duplicate id': () => check(wrap(good(), good())),
    'unknown kind': () => errorsFor({kind: 'thing'}),
    'missing category': () => errorsFor({category: undefined}),
    'unknown category': () => errorsFor({category: 'misc'}),
    'application state cannot be out of scope': () => errorsFor({completion: 'out-of-scope', completionNote: 'x'}),
    'out-of-board-entry must be out-of-scope': () => errorsFor({category: 'out-of-board-entry'}),
    'out-of-scope must be out-of-board-entry': () => errorsFor({category: 'compiler-lowering', completion: 'out-of-scope', completionNote: 'x'}),
    'unknown completion': () => errorsFor({completion: 'done'}),
    'partial without note': () => errorsFor({completion: 'partial', completionNote: ' '}),
    'missing replacement file': () => errorsFor({replacement: {file: 'nope/missing.mjs', symbols: ['x']}}),
    'missing replacement symbol': () => errorsFor({replacement: {file: 'apps/board/state-config.mjs', symbols: ['NoSuchSymbol']}}),
    'missing old symbol': () => errorsFor({oldSource: {file: 'scripts/build.mjs', symbols: ['absentInBaseline']}}),
    'missing test file': () => errorsFor({tests: ['tests/nope.test.mjs']}),
    'spec outside closed set': () => errorsFor({spec: ['/spec#s99']}),
    'complete without test': () => errorsFor({tests: []}),
    'complete with unrelated test': () => errorsFor({tests: ['tests/state-lib-assets.test.mjs']}),
    'actions not array': () => errorsFor({actions: 'edit'}),
    'complete without appUse': () => errorsFor({appUse: []}),
    'appUse absent from the app': () => errorsFor({appUse: ['NoSuchHandlerCall(']}),
    'appUse not an array': () => errorsFor({appUse: 'STATE_CONFIG'}),
  };
  for (const [name, run] of Object.entries(cases)) assert.ok(run().length > 0, name);
});

test('non-complete entries may cite no test but need a note', () => {
  assert.deepEqual(errorsFor({completion: 'not-started', completionNote: 'planned', tests: []}), []);
});

test('an unavailable git object is skipped with a warning, not an error', () => {
  const warnings = [];
  const throwing = () => { throw new Error('bad object'); };
  const errors = validateManifest(wrap(good()), {root, gitShow: throwing, warn: (m) => warnings.push(m)});
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /skipp/i);
});

test('a non-complete entry may omit appUse', () => {
  assert.deepEqual(errorsFor({completion: 'partial', completionNote: 'x', appUse: undefined}), []);
});

// ---- inventory completeness: every baseline state location is mapped, none survives in the app ----
import {execFileSync} from 'node:child_process';

const baselineApp = (() => {
  try { return execFileSync('git', ['show', '9ebf080:apps/board/app.mjs'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}); } catch { return null; }
})();
const splitTopLevel = (text) => {
  const parts = []; let depth = 0, start = 0, quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if ("'\"`".includes(c)) quote = c; else if ('({['.includes(c)) depth++; else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  return [...parts, text.slice(start)];
};
const baselineStateNames = (source) => {
  const names = [];
  for (const [, decl] of source.matchAll(/^let ([^\n]+);$/gm)) for (const part of splitTopLevel(decl)) names.push(part.split('=')[0].trim());
  for (const [, name] of source.matchAll(/^const (\w+)=new (?:Map|Set)\(\)/gm)) names.push(name);
  for (const [, name] of source.matchAll(/;let (\w+)=null,fileVersion=0|let (image)=null,(fileVersion)=0/g)) names.push(name);
  return names.filter(Boolean);
};

test('every baseline module-level state name is mapped by a manifest entry (state is a name inside oldSource.symbols)', {skip: baselineApp === null}, () => {
  const manifest = JSON.parse(readFileSync(root + 'docs/state-migration-manifest.json', 'utf8'));
  const mapped = manifest.entries.flatMap((entry) => entry.oldSource.symbols).join('\n');
  const names = baselineStateNames(baselineApp);
  assert.ok(names.length >= 16, `expected the baseline to declare many state names, found ${names.join(',')}`);
  for (const name of names) assert.match(mapped, new RegExp(`\\b${name}\\b`), `baseline state "${name}" has no manifest entry`);
});

test('the migrated app keeps no module-level mutable state or hand-rolled epoch counters', () => {
  const app = readFileSync(root + 'apps/board/app.mjs', 'utf8');
  assert.deepEqual([...app.matchAll(/^(?:let|var) [^\n]+/gm)].map((m) => m[0]), []);
  assert.doesNotMatch(app, /^const \w+=new (?:Map|Set)\(/m);
  for (const legacy of [/\bdialogEpoch\+\+/, /\bworkspaceEpoch\+\+/, /\bhoverSeq\b/, /\bsearchSeq\b/, /\bclearTimeout\(debounce\)/, /\bstate\.(?:ws|boardId|columnId|shared|people|user|config)\b/, /\bselected\.(?:add|delete)\(/]) {
    assert.doesNotMatch(app, legacy, String(legacy));
  }
});

test('app.mjs only reaches state through the board-state owners', () => {
  const app = readFileSync(root + 'apps/board/app.mjs', 'utf8');
  for (const owner of ['boardId', 'columnId', 'selected', 'popover', 'hoverCard', 'editor', 'editMeta', 'sync', 'dialog', 'modalReturn', 'errorOpen', 'shared', 'config', 'people', 'user']) {
    assert.match(app, new RegExp(`\\bS\\.${owner}\\.(?:get|set|peek|clear|take|toggle|only|has|bump|guard)\\b|\\bS\\.${owner}\\.size\\b`), `S.${owner} is never used by a handler`);
  }
});

test('a state entry that is not complete says so and no entry claims an unbuilt spec anchor', () => {
  const manifest = JSON.parse(readFileSync(root + 'docs/state-migration-manifest.json', 'utf8'));
  const incomplete = manifest.entries.filter((e) => e.completion !== 'complete');
  assert.ok(incomplete.some((e) => e.completion === 'partial'), 'the manifest must record real partial work');
  for (const entry of manifest.entries) assert.ok(entry.spec.every((a) => a.startsWith('/spec#')));
});

// ---- categories keep ownership, optional compiler lowering, evidence and other products apart ----
const committed = () => JSON.parse(readFileSync(root + 'docs/state-migration-manifest.json', 'utf8'));
const byId = (id) => committed().entries.find((e) => e.id === id);

test('summarizeManifest counts every entry once by category and completion', () => {
  const manifest = committed(), summary = summarizeManifest(manifest);
  assert.equal(Object.values(summary.byCategory).reduce((n, c) => n + c.total, 0), manifest.entries.length);
  assert.deepEqual(Object.keys(summary.byCategory).sort(), ['application-state', 'compiler-lowering', 'out-of-board-entry', 'test-performance-evidence']);
  assert.deepEqual(summarizeManifest(wrap(good(), {...good(), id: 'b', completion: 'partial', completionNote: 'x'})).byCategory['application-state'],
    {total: 2, complete: 1, partial: 1, 'not-started': 0, 'out-of-scope': 0});
});

test('every board application-state owner is categorized as application state and none is excused', () => {
  const owners = ['document-store', 'document-history', 'document-with-navigation-atomic', 'session-config', 'session-share-mode', 'private-user-people-requests',
    'workspace-loader', 'sync-queue', 'save-status', 'save-error-dialog-flag', 'navigation-board', 'navigation-column', 'selection', 'menu-popover', 'menu-hover-card',
    'dialog-chrome', 'editor-inline', 'toast-timer', 'column-observer', 'pending-duplicate-suggestion', 'pending-search-dialog', 'pending-illustration',
    'pending-ticket-preview', 'pending-photo-read', 'cache-tickets-and-art-attempts', 'backend-selection-build-config', 'dialog-local-view-state', 'photo-review-component'];
  for (const id of owners) {
    assert.equal(byId(id)?.category, 'application-state', id);
    assert.notEqual(byId(id).completion, 'out-of-scope', `${id} must not be excused from the board`);
  }
});

test('optional compiler specialization, evidence and the separate type product are not ownership gaps', () => {
  assert.equal(byId('compiler-lowered-commands').category, 'compiler-lowering');
  assert.equal(byId('document-declared-commands').category, 'compiler-lowering');
  assert.equal(byId('bundle-budget').category, 'test-performance-evidence');
  assert.equal(byId('type-site').category, 'out-of-board-entry');
  assert.equal(byId('type-site').completion, 'out-of-scope');
  assert.notEqual(byId('compiler-lowered-commands').completion, 'complete', 'no generated lowering exists, so it must not be called implemented');
  assert.match(byId('document-declared-commands').completionNote, /change\(callback\)/);
  assert.match(byId('document-declared-commands').completionNote, /library-owned/);
});

test('type-site points at the real separate entry, not at a board owner', () => {
  const entry = byId('type-site');
  assert.equal(entry.oldSource.file, 'apps/type-site/type.mjs');
  assert.equal(entry.replacement.file, 'apps/type-site/type.mjs');
});

test('the inventory exposes zero application-state gaps once every owner is verified', () => {
  const state = summarizeManifest(committed()).byCategory['application-state'];
  assert.equal(state.total, state.complete, JSON.stringify(state));
});
