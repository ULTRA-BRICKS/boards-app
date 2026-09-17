import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceLoader } from '../packages/core/workspace-loader.mjs';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
for (const backend of ['baseline', 'state-lib']) {
  test(`${backend}: stale workspace cannot replace the most recent board`, async () => {
    const work = [deferred(), deferred()], seen = []; let calls = 0;
    const loader = createWorkspaceLoader({ backend,
      readState: () => work[calls++].promise,
      readPeople: async () => ({ people: ['owner'] }),
      publish: (state, people) => seen.push({ state, people }),
    });
    const old = loader.load(), current = loader.load();
    work[1].resolve({ value: 'new', version: 2 }); assert.equal(await current, 'committed');
    work[0].resolve({ value: 'old', version: 1 }); assert.equal(await old, 'superseded');
    assert.deepEqual(seen, [{ state: { value: 'new', version: 2 }, people: { people: ['owner'] } }]);
    loader.dispose();
  });
}
test('state-lib settles logout cancellation even if a request ignores abort', async () => {
  const pending = deferred(), seen = []; let signal;
  const loader = createWorkspaceLoader({ readState: (s) => { signal = s; return pending.promise; },
    readPeople: async () => { throw Error('must not read after cancellation'); },
    publish: (...args) => seen.push(args),
  });
  const running = loader.load(); loader.clear();
  assert.equal(signal.aborted, true);
  assert.equal(await running, 'cancelled');
  pending.resolve({ value: 'private prior workspace' }); await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, []); loader.dispose();
});
test('superseded rejection cannot show an obsolete load error', async () => {
  const old = deferred(); let calls = 0; const seen = [];
  const loader = createWorkspaceLoader({ readState: () => calls++ ? Promise.resolve('current') : old.promise,
    readPeople: async () => 'people', publish: (...args) => seen.push(args),
  });
  const previous = loader.load(); assert.equal(await loader.load(), 'committed');
  old.reject(Error('obsolete failure')); assert.equal(await previous, 'superseded');
  assert.deepEqual(seen, [['current', 'people']]); loader.dispose();
});
test('current request failure is not masked as a successful workspace', async () => {
  const loader = createWorkspaceLoader({ readState: async () => { throw Error('network'); },
    readPeople: async () => 'people', publish: () => { throw Error('unexpected publish'); },
  });
  await assert.rejects(loader.load(), /network/); loader.dispose();
});
