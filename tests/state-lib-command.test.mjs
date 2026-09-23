import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentStore } from "../packages/core/document-store.mjs";
import * as json from "../packages/core/json-draft.mjs";
const initial = () => ({
  title: "old",
  columns: [
    {
      items: [
        { id: "1", text: "one", done: false },
        { id: "2", text: "two", done: false },
      ],
    },
  ],
});
const command = (base, args) => {
  const tx = json.beginJsonCommand(base);
  try {
    tx.assignGroups(["columns"], "items", "text", args.text);
    return tx.finish();
  } catch (error) {
    tx.abort();
    throw error;
  }
};
const create = () => createDocumentStore({ backend: "state-lib-cow", initial: initial() });
test("declared command publishes document and history atomically to one Runtime", () => {
  const store = create(),
    before = store.getSnapshot(),
    seen = [];
  assert.equal(typeof store.apply, "function");
  const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));
  assert.equal(store.apply(command, { text: "new" }), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].document.columns[0].items[0].text, "new");
  assert.equal(seen[0].canUndo, true);
  assert.equal(before.document.columns[0].items[0].text, "one");
  assert(store.undo());
  assert.deepEqual(store.read(), initial());
  assert(store.redo());
  assert.equal(store.read().columns[0].items[1].text, "new");
  unsubscribe();
  store.dispose();
});
test("generic callbacks and declared commands share history, snapshots and ownership", () => {
  const store = create();
  store.change((d) => {
    d.title = "callback";
  });
  const prior = store.getSnapshot();
  store.apply(command, { text: "command" });
  store.change((d) => {
    d.columns[0].items[1].done = true;
  });
  assert.equal(prior.document.columns[0].items[0].text, "one");
  assert(store.undo());
  assert.equal(store.read().columns[0].items[1].done, false);
  assert(store.undo());
  assert.equal(store.read().title, "callback");
  assert.equal(store.read().columns[0].items[0].text, "one");
  store.dispose();
});
test("failure and invalid returned ownership do not publish a partial command", () => {
  const store = create(),
    snapshot = store.getSnapshot();
  let calls = 0;
  store.subscribe(() => calls++);
  assert.throws(() =>
    store.apply((base) => {
      const tx = json.beginJsonCommand(base);
      tx.set(["title"], "partial");
      tx.toggle(["title"]);
      return tx.finish();
    }, {}),
  );
  assert.throws(() => store.apply(() => ({ title: "unowned" }), {}), /owned/);
  assert.equal(store.getSnapshot(), snapshot);
  assert.equal(calls, 0);
  store.dispose();
});
test("no-op command preserves publication and undo availability", () => {
  const store = create();
  let calls = 0;
  store.subscribe(() => calls++);
  const old = store.getSnapshot();
  store.apply((base) => json.beginJsonCommand(base).finish(), {});
  assert.notEqual(store.getSnapshot(), old);
  assert.equal(calls, 1);
  assert(store.canUndo);
  assert(store.undo());
  store.dispose();
});
test("nested and asynchronous commands are rejected without publishing", async () => {
  const store = create(),
    before = store.getSnapshot();
  assert.throws(
    () =>
      store.apply((base) => {
        store.change((d) => {
          d.title = "nested";
        });
        return base;
      }, {}),
    /Nested/,
  );
  assert.throws(
    () =>
      store.apply(async () => {
        throw new Error("late");
      }, {}),
    /synchronous/,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.getSnapshot(), before);
  store.dispose();
});
test("commands read committed state and notify only after they finish", () => {
  const store = create(),
    before = store.getSnapshot();
  let calls = 0;
  store.subscribe(() => calls++);
  store.apply((base) => {
    const tx = json.beginJsonCommand(base);
    tx.set(["title"], "new");
    assert.equal(store.getSnapshot(), before);
    assert.equal(store.read(), base);
    assert.equal(calls, 0);
    return tx.finish();
  }, {});
  assert.equal(calls, 1);
  assert.equal(store.read().title, "new");
  store.dispose();
});
test("all command entry after dispose is rejected", () => {
  const store = create();
  store.dispose();
  assert.throws(() => store.apply(command, { text: "late" }), /disposed/);
});
test('document and history share one atomic Runtime cell instead of a derived publication graph',async()=>{
 const {Runtime}=await import('../packages/state-lib/dist/index.js');
 const original=Runtime.prototype.signal;let cells=0;
 Runtime.prototype.signal=function(...args){cells++;return original.apply(this,args);};
 let store;
 try { store=create();assert.equal(cells,1,'One publication cell carries the coherent document/history pair'); }
 finally { Runtime.prototype.signal=original;store?.dispose(); }
});
