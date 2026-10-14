// Shared-runtime workspace loader (coverage pass): the optional `runtime`, `apply` and `batch` options let the
// board commit the fetched document + people + user in ONE Runtime transaction, then publish (render) after commit.
// Legacy publish-only callers must keep working unchanged (tests/state-lib-loader.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../packages/state-lib/dist/index.js';
import { createWorkspaceLoader } from '../packages/core/workspace-loader.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('state-lib: apply runs inside the shared runtime transaction, publish only after commit', async () => {
  const runtime = new Runtime(), owner = runtime.signal('before'), log = [];
  const loader = createWorkspaceLoader({
    runtime,
    readState: async () => 'state',
    readPeople: async () => 'people',
    apply: ({ state, people }) => { assert.equal(runtime.inTransaction, true); owner.set(`${state}+${people}`); log.push('apply'); },
    publish: () => { assert.equal(runtime.inTransaction, false); log.push(`publish:${owner.peek()}`); },
  });
  assert.equal(await loader.load(), 'committed');
  assert.deepEqual(log, ['apply', 'publish:state+people']);
  loader.dispose();
  assert.doesNotThrow(() => owner.set('runtime still alive'), 'a borrowed runtime is never disposed by the loader');
  runtime.dispose();
});

test('state-lib: a throwing apply rolls the shared runtime back and never publishes', async () => {
  const runtime = new Runtime(), owner = runtime.signal('before'), published = [];
  const loader = createWorkspaceLoader({
    runtime, readState: async () => 's', readPeople: async () => 'p',
    apply: () => { owner.set('half written'); throw Error('apply failed'); },
    publish: (...args) => published.push(args),
  });
  await assert.rejects(loader.load(), /apply failed/);
  assert.equal(owner.peek(), 'before');
  assert.deepEqual(published, []);
  loader.dispose(); runtime.dispose();
});

test('state-lib: superseded and cleared loads never apply', async () => {
  const runtime = new Runtime(), first = deferred(), applied = [], published = [];
  let calls = 0;
  const loader = createWorkspaceLoader({
    runtime, readState: () => (calls++ === 0 ? first.promise : Promise.resolve('new')), readPeople: async () => 'p',
    apply: ({ state }) => applied.push(state), publish: (state) => published.push(state),
  });
  const old = loader.load();
  assert.equal(await loader.load(), 'committed');
  first.resolve('old');
  assert.equal(await old, 'superseded');
  const gate = deferred();
  const loader2 = createWorkspaceLoader({
    runtime, readState: () => gate.promise, readPeople: async () => 'p',
    apply: ({ state }) => applied.push(state), publish: (state) => published.push(state),
  });
  const running = loader2.load();
  loader2.clear();
  assert.equal(await running, 'cancelled');
  gate.resolve('after clear');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(applied, ['new']);
  assert.deepEqual(published, ['new']);
  loader.dispose(); loader2.dispose(); runtime.dispose();
});

test('baseline: batch wraps apply, publish follows, superseded loads never apply', async () => {
  const log = [], first = deferred();
  let calls = 0;
  const loader = createWorkspaceLoader({
    backend: 'baseline',
    readState: () => (calls++ === 0 ? first.promise : Promise.resolve('new')), readPeople: async () => 'p',
    batch: (fn) => { log.push('batch:start'); fn(); log.push('batch:end'); },
    apply: ({ state }) => log.push(`apply:${state}`),
    publish: (state) => log.push(`publish:${state}`),
  });
  const old = loader.load();
  assert.equal(await loader.load(), 'committed');
  first.resolve('old');
  assert.equal(await old, 'superseded');
  assert.deepEqual(log, ['batch:start', 'apply:new', 'batch:end', 'publish:new']);
});

test('baseline: apply without batch is called directly', async () => {
  const log = [];
  const loader = createWorkspaceLoader({ backend: 'baseline', readState: async () => 's', readPeople: async () => 'p',
    apply: ({ state }) => log.push(`apply:${state}`), publish: () => log.push('publish') });
  await loader.load();
  assert.deepEqual(log, ['apply:s', 'publish']);
});

test('legacy publish-only callers keep their own runtime and dispose it', async () => {
  const seen = [];
  const loader = createWorkspaceLoader({ readState: async () => 's', readPeople: async () => 'p', publish: (...a) => seen.push(a) });
  assert.equal(await loader.load(), 'committed');
  assert.deepEqual(seen, [['s', 'p']]);
  loader.dispose();
});

test('state-lib: publish may write other owners of the borrowed runtime (render-time writes are not a notification-phase error)', async () => {
  const runtime = new Runtime(), owner = runtime.signal('before');
  const loader = createWorkspaceLoader({
    runtime, readState: async () => 's', readPeople: async () => 'p',
    publish: () => owner.set('written by publish'),
  });
  assert.equal(await loader.load(), 'committed');
  assert.equal(owner.peek(), 'written by publish');
  loader.dispose(); runtime.dispose();
});

// Commit -> post-await publish window. The microtask queued inside apply runs after the synchronous commit but before
// load()'s continuation, so a clear or a later load lands in that window deterministically (no timers).
test('state-lib: a clear between commit and continuation suppresses publication and does not throw', async () => {
  const runtime = new Runtime(), published = [];
  let loader;
  loader = createWorkspaceLoader({
    runtime, readState: async () => 's', readPeople: async () => 'p',
    apply: () => queueMicrotask(() => loader.clear()),
    publish: (...args) => published.push(args),
  });
  assert.equal(await loader.load(), 'cancelled', 'the committed run lost authority, so it reports why it did not publish');
  assert.deepEqual(published, []);
  loader.dispose(); runtime.dispose();
});

test('state-lib: a later load between commit and continuation owns publication, the stale run never publishes', async () => {
  const runtime = new Runtime(), published = [], second = deferred();
  let loader, calls = 0, secondRun;
  loader = createWorkspaceLoader({
    runtime, readState: () => (calls++ === 0 ? Promise.resolve('first') : second.promise), readPeople: async () => 'p',
    apply: ({ state }) => { if (state === 'first') queueMicrotask(() => { secondRun = loader.load(); }); },
    publish: (state) => published.push(state),
  });
  assert.equal(await loader.load(), 'superseded');
  assert.deepEqual(published, [], 'the first run committed but a newer load owns the window');
  second.resolve('second');
  assert.equal(await secondRun, 'committed');
  assert.deepEqual(published, ['second'], 'only the newest run publishes, with its own committed value');
  loader.dispose(); runtime.dispose();
});

test('state-lib: cancel between commit and continuation also suppresses publication', async () => {
  const runtime = new Runtime(), published = [];
  let loader;
  loader = createWorkspaceLoader({
    runtime, readState: async () => 's', readPeople: async () => 'p',
    apply: () => queueMicrotask(() => loader.cancel()),
    publish: (...args) => published.push(args),
  });
  assert.equal(await loader.load(), 'cancelled');
  assert.deepEqual(published, []);
  loader.dispose(); runtime.dispose();
});

test('state-lib: a throwing publish after an accepted commit keeps the commit and marks the error committed', async () => {
  const runtime = new Runtime(), owner = runtime.signal('before');
  const loader = createWorkspaceLoader({
    runtime, readState: async () => 's', readPeople: async () => 'p',
    apply: () => owner.set('ready'),
    publish: () => { if (!failed++) throw Error('render failed'); },
  });
  let failed = 0;
  await assert.rejects(loader.load(), (error) => {
    assert.match(error.message, /render failed/);
    assert.equal(error.committed, true, 'callers can tell this is a post-commit failure, not a rollback');
    assert.equal(error.cause.message, 'render failed');
    return true;
  });
  assert.equal(owner.peek(), 'ready', 'no rollback');
  assert.equal(await loader.load(), 'committed', 'the loader stays usable');
  loader.dispose(); runtime.dispose();
});

test('state-lib: a throwing apply is NOT marked committed (rolled back)', async () => {
  const runtime = new Runtime();
  const loader = createWorkspaceLoader({ runtime, readState: async () => 's', readPeople: async () => 'p',
    apply: () => { throw Error('apply failed'); }, publish: () => {} });
  await assert.rejects(loader.load(), (error) => error.message === 'apply failed' && error.committed !== true);
  loader.dispose(); runtime.dispose();
});

test('baseline: a throwing publish after apply is marked committed', async () => {
  const loader = createWorkspaceLoader({ backend: 'baseline', readState: async () => 's', readPeople: async () => 'p',
    apply: () => {}, publish: () => { throw Error('render failed'); } });
  await assert.rejects(loader.load(), (error) => /render failed/.test(error.message) && error.committed === true);
});
