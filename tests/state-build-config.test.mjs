// Verifies the explicit baseline/state-lib build configuration (HYP-1490):
// per-variant state-config.mjs output, byte-identical app.mjs across variants,
// argument validation, and the dev-server whitelist for the new files.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync, spawn} from 'node:child_process';
import {createServer} from 'node:net';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = (args, env = {}) => spawnSync(process.execPath, ['scripts/build.mjs', ...args], {
  cwd: root, encoding: 'utf8', timeout: 20000, stdin: 'ignore',
  env: {...process.env, BOARDS_STATE_BACKEND: '', ...env},
});
const read = (path) => readFileSync(join(root, path));

test('checked-in default config selects state-lib and allows URL override', async () => {
  const {STATE_CONFIG} = await import('../apps/board/state-config.mjs');
  assert.deepEqual({...STATE_CONFIG}, {backend: 'state-lib', allowUrlOverride: true});
  assert.ok(Object.isFrozen(STATE_CONFIG));
});

test('explicit backend builds write a non-overridable state-config and identical app.mjs', () => {
  const variants = {baseline: 'dist/board-baseline', 'state-lib': 'dist/board-state'};
  for (const [backend, out] of Object.entries(variants)) {
    const result = build([`--state-backend=${backend}`, `--out=${out}`]);
    assert.equal(result.status, 0, result.stderr);
    const config = read(`${out}/state-config.mjs`).toString();
    assert.match(config, new RegExp(`backend:\\s*'${backend}'`));
    assert.match(config, /allowUrlOverride:\s*false/);
  }
  assert.deepEqual(read('dist/board-baseline/app.mjs'), read('dist/board-state/app.mjs'));
  assert.deepEqual(read('dist/board-baseline/app.mjs'), read('apps/board/app.mjs'));
});

test('env backend is honored and the CLI flag wins over it', () => {
  const out = 'dist/board-env-check';
  assert.equal(build([`--out=${out}`], {BOARDS_STATE_BACKEND: 'baseline'}).status, 0);
  assert.match(read(`${out}/state-config.mjs`).toString(), /backend:\s*'baseline'/);
  assert.equal(build(['--state-backend=state-lib', `--out=${out}`], {BOARDS_STATE_BACKEND: 'baseline'}).status, 0);
  assert.match(read(`${out}/state-config.mjs`).toString(), /backend:\s*'state-lib'/);
  rmSync(join(root, out), {recursive: true, force: true});
});

test('default build copies the checked-in state-config unchanged', () => {
  const result = build([]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read('dist/board/state-config.mjs'), read('apps/board/state-config.mjs'));
});

test('invalid backend and out-of-dist output are rejected', () => {
  for (const args of [['--state-backend=state-lib-cow'], ['--state-backend=']]) {
    const result = build(args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /state backend/i);
  }
  const env = build([], {BOARDS_STATE_BACKEND: 'nope'});
  assert.notEqual(env.status, 0);
  for (const out of ['/tmp/boards-out', '../outside', 'dist', 'src/x', 'dist/../apps/x']) {
    const result = build(['--state-backend=baseline', `--out=${out}`]);
    assert.notEqual(result.status, 0, out);
    assert.match(result.stderr, /--out/);
  }
  assert.ok(existsSync(join(root, 'apps/board/app.mjs')));
});

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const {port} = server.address();
    server.close(() => resolve(port));
  });
  server.on('error', reject);
});

async function withDevServer(env, fn) {
  const port = await freePort();
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, PORT: String(port), LOCAL_TEST_MODE: '1', LOCAL_DATABASE_PATH: ':memory:',
      AUTH_SECRET: 'synthetic-not-a-secret', BOARDS_STATE_BACKEND: '', ...env},
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { if (String(chunk).includes('Board: http')) resolve(); });
      child.on('exit', () => reject(new Error('dev server exited early')));
    });
    await fn(`http://127.0.0.1:${port}`);
  } finally { clearTimeout(timer); child.kill('SIGKILL'); }
}

test('dev server serves state-config and whitelists the new module paths', async () => {
  await withDevServer({}, async (base) => {
    const config = await fetch(`${base}/state-config.mjs`);
    assert.equal(config.status, 200);
    assert.equal(await config.text(), readFileSync(join(root, 'apps/board/state-config.mjs'), 'utf8'));
    const optional = ['apps/board/board-state.mjs', ...['scope', 'scope-baseline', 'debounced-latest']
      .map((name) => `packages/state-lib/scoped/${name}.mjs`)];
    for (const file of optional) {
      const url = file.replace(/^apps\/board/, '');
      const res = await fetch(`${base}/${url.replace(/^\//, '')}`);
      assert.equal(res.status, existsSync(join(root, file)) ? 200 : 404, file);
    }
    assert.equal((await fetch(`${base}/packages/state-lib/scoped/x.json`)).status, 404);
    assert.equal((await fetch(`${base}/packages/state-lib/scoped/..%2f..%2fdist%2findex.mjs`)).status, 404);
  });
});

test('dev server generates a non-overridable state-config for BOARDS_STATE_BACKEND', async () => {
  await withDevServer({BOARDS_STATE_BACKEND: 'baseline'}, async (base) => {
    const text = await (await fetch(`${base}/state-config.mjs`)).text();
    assert.match(text, /backend:\s*'baseline'/);
    assert.match(text, /allowUrlOverride:\s*false/);
  });
});

test('built output is self-contained: every relative import of a shipped module resolves', () => {
  const out = 'dist/board-import-check';
  assert.equal(build(['--state-backend=state-lib', `--out=${out}`]).status, 0);
  const shipped = ['app.mjs', 'boot.mjs', 'board-state.mjs', 'board-commands.mjs', 'packages/core/document-store.mjs', ...['scope', 'scope-core', 'scope-baseline', 'debounced-latest'].map((n) => `packages/state-lib/scoped/${n}.mjs`)];
  for (const file of shipped) {
    const text = readFileSync(join(root, out, file), 'utf8');
    for (const [, spec] of text.matchAll(/from\s*["']([^"']+)["']/g)) {
      const target = spec.startsWith('/') ? join(root, out, spec) : join(root, out, file, '..', spec);
      assert.ok(existsSync(target), `${file} imports ${spec} which is not shipped`);
    }
  }
  rmSync(join(root, out), {recursive: true, force: true});
});
