// Cold import (HYP-1737): the state-lib build reads /api/state as text, certifies `value` once at that boundary and
// adopts the frozen root into the document store, instead of parsing to a mutable graph and cloning it in replace().
// Pinned here: response error messages, loader authority (rollback, stale, cancel, post-commit errors), the frozen
// alias visible to the publish callback, and an unchanged first-save PUT body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Runtime } from '../packages/state-lib/dist/index.js';
import { createDocumentStore, readStateResponse as read } from '../packages/core/document-store.mjs';
import { createWorkspaceLoader } from '../packages/core/workspace-loader.mjs';
import { SyncQueue } from '../packages/core/sync.mjs';
import * as json from '../packages/core/json-draft.mjs';
import { createBoardCommands } from '../apps/board/board-commands.mjs';

const task = (id, text) => ({ id, text, tag: '', assignees: [], done: false });
const workspace = (title = 'Loaded') => ({
  schemaVersion: 2,
  name: title,
  boards: [{ id: 'b1', title, columns: [{ id: 'c1', title: 'A', items: [task('i1', 'one'), task('i2', 'two')] }] }],
});
const body = (value, version = 4) => JSON.stringify({ version, value });
const respond = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => (resolve = yes));
  return { promise, resolve };
};
const setup = (readState, publish = () => {}) => {
  const runtime = new Runtime();
  const store = createDocumentStore({ backend: 'state-lib', initial: workspace('Before'), runtime });
  const published = [];
  const loader = createWorkspaceLoader({
    runtime,
    readState,
    readPeople: async () => ({ people: [] }),
    apply: ({ state }) => {
      assert.equal(typeof store.replaceImported, 'function');
      store.replaceImported(state.value);
    },
    publish: (state) => {
      published.push(state);
      publish(state, store);
    },
  });
  return { runtime, store, loader, published, close: () => (loader.dispose(), store.dispose(), runtime.dispose()) };
};

test('an OK state response yields an envelope whose value is already certified and adoptable', async () => {
  const envelope = await read(respond(body(workspace(), 9)));
  assert.equal(envelope.version, 9);
  assert.equal(Object.isFrozen(envelope), false);
  assert.equal(Object.isFrozen(envelope.value.boards[0].columns[0].items[0]), true);
  assert.equal(json.isImportedJsonRoot(envelope.value), true);
  assert.equal(json.isImportedJsonRoot(envelope.value.boards[0]), false);
});

test('response errors keep the existing app messages', async () => {
  await assert.rejects(read(respond('{"error":"Sign in again."}', 401)), (error) => {
    assert.equal(error.message, 'Sign in again.');
    assert.equal(error.status, 401);
    return true;
  });
  await assert.rejects(read(respond('{}', 500)), { message: 'Request failed.', status: 500 });
  await assert.rejects(read(respond('<html>', 502)), { message: 'The server did not return a valid response.' });
  await assert.rejects(read(respond('{"version":1,"value":')), {
    message: 'The server did not return a valid response.',
  });
  const broken = new Response(new ReadableStream({ start: (controller) => controller.error(Error('reset')) }));
  await assert.rejects(read(broken), { message: 'The server did not return a valid response.' });
  // Valid JSON that is not a JSON document keeps the document store's own error, as replace() reports today.
  await assert.rejects(read(respond('{"version":1,"value":{"n":1e999}}')), {
    name: 'TypeError',
    message: 'Document snapshots must be acyclic JSON data',
  });
});

test('publish receives the adopted frozen snapshot itself, not a separate mutable copy', async () => {
  let seen;
  const { store, loader, close } = setup(
    () => read(respond(body(workspace()))),
    (state, current) => (seen = { state, read: current.read() }),
  );
  assert.equal(await loader.load(), 'committed');
  assert.equal(seen.state.value, seen.read);
  assert.equal(seen.state.version, 4);
  assert.equal(Object.isFrozen(seen.state.value), true);
  assert.throws(() => {
    seen.state.value.name = 'callback write';
  }, TypeError);
  assert.equal(store.read().name, 'Loaded');
  assert.equal(store.canUndo, false);
  close();
});

test('a throwing apply after adoption rolls back and never publishes', async () => {
  const runtime = new Runtime();
  const store = createDocumentStore({ backend: 'state-lib', initial: workspace('Before'), runtime });
  const before = store.getSnapshot();
  const published = [];
  let adopted;
  const loader = createWorkspaceLoader({
    runtime,
    readState: () => read(respond(body(workspace()))),
    readPeople: async () => ({ people: [] }),
    apply: ({ state }) => {
      adopted = state.value;
      store.replaceImported(state.value);
      throw Error('people rejected');
    },
    publish: (state) => published.push(state),
  });
  await assert.rejects(loader.load(), (error) => error.message === 'people rejected' && !error.committed);
  assert.equal(store.getSnapshot(), before);
  assert.notEqual(store.read(), adopted);
  assert.deepEqual(published, []);
  loader.dispose();
  store.dispose();
  runtime.dispose();
});

test('stale and cancelled imports never reach the store', async () => {
  const first = deferred();
  let calls = 0;
  const { store, loader, published, close } = setup(() =>
    calls++ === 0 ? first.promise.then(() => read(respond(body(workspace('Stale'))))) : read(respond(body(workspace('Fresh')))),
  );
  const stale = loader.load();
  assert.equal(await loader.load(), 'committed');
  const fresh = store.read();
  first.resolve();
  assert.equal(await stale, 'superseded');
  assert.equal(store.read(), fresh);
  assert.equal(store.read().name, 'Fresh');
  assert.deepEqual(
    published.map((state) => state.value.name),
    ['Fresh'],
  );
  const gate = deferred();
  calls = 0;
  const cancelled = setup(() => gate.promise.then(() => read(respond(body(workspace('Cancelled'))))));
  const before = cancelled.store.read();
  const running = cancelled.loader.load();
  cancelled.loader.cancel();
  gate.resolve();
  assert.equal(await running, 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled.store.read(), before);
  assert.deepEqual(cancelled.published, []);
  cancelled.close();
  close();
});

test('a publish failure after the commit keeps the adopted document authoritative', async () => {
  const { store, loader, close } = setup(
    () => read(respond(body(workspace()))),
    () => {
      throw Error('render failed');
    },
  );
  await assert.rejects(loader.load(), (error) => error.committed === true && error.message === 'render failed');
  assert.equal(store.read().name, 'Loaded');
  assert.equal(json.isImportedJsonRoot(store.read()), true);
  close();
});

test('an invalid document fails the load before apply and leaves the previous document', async () => {
  const { store, loader, published, close } = setup(() =>
    read(respond('{"version":1,"value":{"boards":[{"rows":[-1e999]}]}}')),
  );
  const before = store.getSnapshot();
  await assert.rejects(loader.load(), (error) => error instanceof TypeError && !error.committed);
  assert.equal(store.getSnapshot(), before);
  assert.deepEqual(published, []);
  close();
});

test('the first save after an adopted load sends the same PUT body as the copy path, isolated from the store', async () => {
  const commands = createBoardCommands({ defineJsonCommand: json.defineJsonCommand });
  const text = body(workspace());
  const save = async (load) => {
    const store = createDocumentStore({ backend: 'state-lib', initial: null });
    await load(store);
    let sent;
    const queue = new SyncQueue({
      capture: json.captureJsonSnapshot,
      send: async ({ document, version }) => {
        sent = JSON.stringify({ version, value: document });
        document.boards[0].columns[0].items[0].text = 'transport mutation';
        return { version: version + 1 };
      },
    });
    queue.configure({ enabled: true, version: 4 });
    assert.equal(commands.run(store, 'toggleDone', { boardId: 'b1', columnId: 'c1', itemId: 'i2' }), true);
    queue.change(store.read());
    assert.equal(queue.document, store.read(), 'capture retains the committed snapshot');
    await queue.flush();
    assert.equal(store.read().boards[0].columns[0].items[0].text, 'one');
    queue.dispose();
    store.dispose();
    return createHash('sha256').update(sent).digest('hex');
  };
  const copied = await save((store) => store.replace(JSON.parse(text).value));
  const adopted = await save(async (store) => store.replaceImported((await read(respond(text))).value));
  assert.equal(adopted, copied);
});

test('the baseline store keeps its original replace-only surface', () => {
  const store = createDocumentStore({ backend: 'baseline', initial: null });
  assert.equal('replaceImported' in store, false);
  const plain = workspace();
  store.replace(plain);
  assert.equal(store.read(), plain);
  assert.equal(Object.isFrozen(plain), false);
  store.dispose();
});
