// Validates docs/state-migration-manifest.json (HYP-1490). Each entry maps old
// baseline state code to its replacement and must be backed by real files,
// real symbols and (for "complete") a test that plausibly covers it.
// CLI: node scripts/validate-state-manifest.mjs [manifest.json]  (exit 1 on errors)
import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const KINDS = ['document', 'selection', 'navigation', 'menu', 'editor', 'pending-operation',
  'workspace-session', 'resource', 'cache', 'other-entry'];
const COMPLETIONS = ['complete', 'partial', 'not-started', 'out-of-scope'];
// Keeps three different questions apart: who OWNS board state (application-state), optional compiler specialization of
// commands (compiler-lowering), measurement gaps (test-performance-evidence) and separate products (out-of-board-entry).
// A command that already runs through the library change(callback) is library-owned, so lowering is never an ownership gap.
const CATEGORIES = ['application-state', 'compiler-lowering', 'test-performance-evidence', 'out-of-board-entry'];
// CLOSED set. Adding an anchor requires a real target for it to exist in the spec.
const SPEC_ANCHORS = ['/spec#s4-4', '/spec#s4-9', '/spec#s4-10', '/spec#s5', '/spec#s13'];
const TOP_FIELDS = ['baselineRevision', 'specBase', 'generatedFor'];

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isTextList = (value) => Array.isArray(value) && value.every(isText);

function defaultGitShow(root) {
  return (revision, file) => execFileSync('git', ['show', `${revision}:${file}`],
    {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024});
}

function checkShape(entry, at) {
  const errors = [];
  if (!isText(entry.id)) errors.push(`${at}: id must be a non-empty string`);
  if (!isText(entry.owner)) errors.push(`${at}: owner must be a non-empty string`);
  if (!KINDS.includes(entry.kind)) errors.push(`${at}: kind ${JSON.stringify(entry.kind)} not in ${KINDS.join(', ')}`);
  if (!CATEGORIES.includes(entry.category)) errors.push(`${at}: category ${JSON.stringify(entry.category)} not in ${CATEGORIES.join(', ')}`);
  else if (entry.category === 'out-of-board-entry' && entry.completion !== 'out-of-scope') errors.push(`${at}: out-of-board-entry entries must have completion out-of-scope`);
  else if (entry.category !== 'out-of-board-entry' && entry.completion === 'out-of-scope') errors.push(`${at}: only out-of-board-entry entries may be out-of-scope; board state, lowering and evidence cannot be excused`);
  if (!isTextList(entry.actions)) errors.push(`${at}: actions must be an array of strings`);
  if (!COMPLETIONS.includes(entry.completion)) errors.push(`${at}: completion ${JSON.stringify(entry.completion)} not in ${COMPLETIONS.join(', ')}`);
  else if (entry.completion !== 'complete' && !isText(entry.completionNote)) errors.push(`${at}: completionNote is required unless completion is complete`);
  if (!isText(entry.baselineRevision)) errors.push(`${at}: baselineRevision must be a non-empty string`);
  for (const key of ['oldSource', 'replacement']) {
    const part = entry[key];
    if (!part || !isText(part.file) || !isTextList(part.symbols)) errors.push(`${at}: ${key} needs {file, symbols[]}`);
  }
  if (!isTextList(entry.tests)) errors.push(`${at}: tests must be an array of paths`);
  if (!isTextList(entry.spec)) errors.push(`${at}: spec must be an array of anchors`);
  else for (const anchor of entry.spec) if (!SPEC_ANCHORS.includes(anchor)) errors.push(`${at}: spec anchor ${anchor} is not in the closed set`);
  return errors;
}

function readIfExists(root, file) {
  const path = resolve(root, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function checkReplacement(entry, at, root) {
  const text = readIfExists(root, entry.replacement.file);
  if (text === null) return [`${at}: replacement.file ${entry.replacement.file} does not exist`];
  return entry.replacement.symbols.filter((s) => !text.includes(s))
    .map((s) => `${at}: replacement symbol ${s} not found in ${entry.replacement.file}`);
}

function checkOldSource(entry, at, {root, gitShow, warn}) {
  let text;
  try { text = gitShow(entry.baselineRevision, entry.oldSource.file); } catch {
    warn(`${at}: skipping oldSource check, git object ${entry.baselineRevision}:${entry.oldSource.file} is unavailable`);
    return [];
  }
  return entry.oldSource.symbols.filter((s) => !text.includes(s))
    .map((s) => `${at}: oldSource symbol ${s} not found in ${entry.baselineRevision}:${entry.oldSource.file}`);
}

/** `appUse` names strings the CURRENT apps/board/app.mjs must contain: proof that event handlers
 * really call the replacement. Required for complete entries; validated whenever present. */
function checkAppUse(entry, at, root) {
  const uses = entry.appUse ?? [];
  if (!isTextList(uses)) return [`${at}: appUse must be an array of strings`];
  if (entry.completion === 'complete' && uses.length === 0) return [`${at}: complete entries need appUse (strings the app must contain)`];
  const app = readIfExists(root, 'apps/board/app.mjs') ?? '';
  return uses.filter((u) => !app.includes(u)).map((u) => `${at}: appUse ${JSON.stringify(u)} not found in apps/board/app.mjs`);
}

function checkTests(entry, at, root) {
  const errors = [];
  const texts = [];
  for (const file of entry.tests) {
    const text = readIfExists(root, file);
    if (text === null) errors.push(`${at}: test ${file} does not exist`); else texts.push(text);
  }
  if (entry.completion === 'complete') {
    const needles = [entry.id, ...entry.replacement.symbols];
    if (!texts.some((t) => needles.some((n) => t.includes(n)))) {
      errors.push(`${at}: complete entries need an existing test mentioning the entry id or a replacement symbol`);
    }
  }
  return errors;
}

function checkEntry(entry, index, ctx) {
  const at = `entries[${index}]${isText(entry?.id) ? ` (${entry.id})` : ''}`;
  if (!entry || typeof entry !== 'object') return [`${at}: must be an object`];
  const errors = checkShape(entry, at);
  if (errors.length) return errors;
  return [...checkReplacement(entry, at, ctx.root), ...checkOldSource(entry, at, ctx), ...checkAppUse(entry, at, ctx.root), ...checkTests(entry, at, ctx.root)];
}

/** Returns a list of error strings; empty means the manifest is valid. */
export function validateManifest(manifest, {root, gitShow = defaultGitShow(root), warn = console.warn} = {}) {
  const errors = [];
  for (const key of TOP_FIELDS) if (!isText(manifest?.[key])) errors.push(`${key} must be a non-empty string`);
  if (!Array.isArray(manifest?.entries)) return [...errors, 'entries must be an array'];
  const seen = new Set();
  manifest.entries.forEach((entry, index) => {
    if (seen.has(entry?.id)) errors.push(`entries[${index}]: duplicate id ${entry.id}`);
    seen.add(entry?.id);
    errors.push(...checkEntry(entry, index, {root, gitShow, warn}));
  });
  return errors;
}

/** Counts per category and completion; the honest inventory view (ownership gaps are application-state only). */
export function summarizeManifest(manifest) {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, {total: 0, ...Object.fromEntries(COMPLETIONS.map((k) => [k, 0]))}]));
  for (const entry of manifest.entries) {
    const bucket = byCategory[entry.category];
    if (!bucket) continue;
    bucket.total++;
    bucket[entry.completion]++;
  }
  return {total: manifest.entries.length, byCategory};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = resolve(process.argv[2] ?? `${root}/docs/state-migration-manifest.json`);
  const errors = validateManifest(JSON.parse(readFileSync(file, 'utf8')), {root});
  for (const error of errors) console.error(error);
  if (!errors.length) {
    const {total, byCategory} = summarizeManifest(JSON.parse(readFileSync(file, 'utf8')));
    console.log(`manifest ok: ${total} entries`);
    for (const [name, counts] of Object.entries(byCategory)) console.log(`  ${name}: ${JSON.stringify(counts)}`);
  }
  process.exit(errors.length ? 1 : 0);
}
