import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const compiler = process.env.STATE_BUILD_CLI;
if (!compiler) throw Error('Set STATE_BUILD_CLI to the canonical state/cli/bin/state for integration tests');
const build = (args) =>
  spawnSync(process.execPath, ['scripts/build.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, STATE_BUILD_CLI: compiler },
  });
for (const backend of ['baseline', 'state-lib'])
  test('static ' + backend + ' entry drops unused runtime families', () => {
    const out = 'dist/specialized-test-' + backend;
    const result = build(['--compile', '--state-backend=' + backend, '--out=' + out]);
    assert.equal(result.status, 0, result.stderr);
    assert(existsSync(resolve(root, out, 'state.manifest.json')), 'state build produces its full entry manifest');
    const manifest = JSON.parse(readFileSync(resolve(root, out, 'state.manifest.json'), 'utf8'));
    const html = readFileSync(resolve(root, out, 'index.html'), 'utf8');
    assert(html.includes('/app.js'));
    assert(!html.includes('/boot.mjs'));
    assert(
      !existsSync(resolve(root, out, 'packages/core/document-store-baseline.mjs')),
      'Unbundled alternatives are not copied into deployment',
    );
    const active = Object.entries(manifest.contributions)
      .filter(([, info]) => info.bytesInOutput > 0)
      .map(([name]) => name);
    const excluded = backend === 'state-lib' ? 'scope-baseline.mjs' : 'state-lib/dist/core.js';
    assert(!active.some((name) => name.endsWith(excluded)), excluded + ' must contribute no code');
    // Row-local views need immutable snapshots: the baseline entry links neither shared adapter, the state-lib entry both.
    for (const adapter of ['state-lib/dom/keyed-row-patch.mjs', 'state-lib/dom/immutable-row-delta.mjs'])
      assert.equal(active.some((name) => name.endsWith(adapter)), backend === 'state-lib', adapter + ' linked only into state-lib');
    const app = readFileSync(resolve(root, out, 'app.js'), 'utf8');
    for (const marker of ['beforeApply', 'outerHTML'])
      assert.equal(app.includes(marker), backend === 'state-lib', `row patch code "${marker}" is linked only into state-lib`);
    assert.equal(manifest.buildConstants.__STATE_BUILD_BASELINE__, backend === 'baseline');
    assert.equal(manifest.emitted.runtimeDispatcher, false);
    assert(
      !readFileSync(resolve(root, out, 'app.js'), 'utf8').includes('"stateBackend"'),
      'Fixed entry no longer parses a runtime backend selector',
    );
  });
test('compilation requires an explicit frozen backend', () => {
  const result = build(['--compile', '--out=dist/specialized-no-backend']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /explicit.*backend/i);
});

test('a compiler failure preserves the complete previous application directory', () => {
  const out = 'dist/specialized-rollback-proof';
  const prepared = build(['--compile', '--state-backend=state-lib', '--out=' + out]);
  assert.equal(prepared.status, 0, prepared.stderr);
  const before = readFileSync(resolve(root, out, 'app.js'));
  const result = spawnSync(
    process.execPath,
    ['scripts/build.mjs', '--compile', '--state-backend=state-lib', '--out=' + out],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STATE_BUILD_CLI: resolve(root, 'missing-state-compiler.py') },
    },
  );
  assert.notEqual(result.status, 0);
  assert.deepEqual(readFileSync(resolve(root, out, 'app.js')), before);
});
