// A/B proof for apps/board/board-commands.mjs (HYP-1490): the declared immutable command
// and the callback mutation produce the same document, share history, and the declared
// path is really used by the state-lib stores.
import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentStore } from "../packages/core/document-store.mjs";
import { defineJsonCommand } from "../packages/core/json-draft.mjs";
import { createBoardCommands } from "../apps/board/board-commands.mjs";

const commands = createBoardCommands({ defineJsonCommand });
const task = (id, text) => ({ id, text, tag: "", assignees: [], done: false });
const doc = () => ({
  boards: [
    {
      id: "b1",
      title: "One",
      footer: "f",
      columns: [
        {
          id: "c1",
          title: "A",
          note: "n",
          illustrationId: "art-1",
          items: [task("i1", "one"), task("i2", "two"), task("i3", "three")],
        },
        { id: "c2", title: "B", note: "n", illustrationId: "", items: [task("j1", "jay")] },
      ],
    },
    {
      id: "b2",
      title: "Two",
      footer: "g",
      columns: [{ id: "c3", title: "C", note: "n", illustrationId: "", items: [] }],
    },
  ],
});
const stores = () => ({
  baseline: createDocumentStore({ backend: "baseline", initial: doc() }),
  "state-lib": createDocumentStore({ backend: "state-lib", initial: doc() }),
  "state-lib-cow": createDocumentStore({ backend: "state-lib-cow", initial: doc() }),
});
const where = { boardId: "b1", columnId: "c1", itemId: "i2" };
const CASES = {
  toggleDone: [where],
  setFieldItem: [{ ...where, target: "item", key: "text", value: "renamed" }],
  setFieldColumnClear: [
    { ...where, target: "column", key: "title", value: "New", clearIllustration: true },
  ],
  setFieldBoard: [{ boardId: "b1", target: "board", key: "footer", value: "fresh" }],
  moveUp: [{ ...where, delta: -1 }],
  moveDownAtEnd: [{ ...where, itemId: "i3", delta: 1 }],
  moveToColumn: [{ ...where, toColumnId: "c2" }],
  unknownBoardFallsBackToFirst: [{ ...where, boardId: "zzz" }],
  moveColumnRight: [{ boardId: "b1", columnId: "c1", delta: 1 }],
  moveColumnLeftAtStart: [{ boardId: "b1", columnId: "c1", delta: -1 }],
};
const RUN = {
  toggleDone: "toggleDone",
  setFieldItem: "setField",
  setFieldColumnClear: "setField",
  setFieldBoard: "setField",
  moveUp: "moveItem",
  moveDownAtEnd: "moveItem",
  moveToColumn: "moveItem",
  unknownBoardFallsBackToFirst: "toggleDone",
  moveColumnRight: "moveColumn",
  moveColumnLeftAtStart: "moveColumn",
};

for (const [label, [args]] of Object.entries(CASES)) {
  test(`${label}: every backend yields the same document, history and undo`, () => {
    const results = {};
    for (const [backend, store] of Object.entries(stores())) {
      commands.run(store, RUN[label], args);
      results[backend] = JSON.parse(JSON.stringify(store.read()));
      assert.equal(store.canUndo, true, backend);
      store.undo();
      assert.deepEqual(store.read(), doc(), `${backend} undo`);
      store.redo();
      assert.deepEqual(
        JSON.parse(JSON.stringify(store.read())),
        results[backend],
        `${backend} redo`,
      );
      store.dispose();
    }
    assert.deepEqual(results["state-lib"], results.baseline);
    assert.deepEqual(results["state-lib-cow"], results.baseline);
    if (!["moveDownAtEnd", "moveColumnLeftAtStart"].includes(label))
      assert.notDeepEqual(results.baseline, doc());
  });
}

test("state-lib stores publish declared commands through apply, sharing untouched structure", () => {
  const store = createDocumentStore({ backend: "state-lib", initial: doc() });
  let applied = 0;
  const original = store.apply;
  store.apply = (...a) => {
    applied++;
    return original(...a);
  };
  const before = store.read();
  commands.run(store, "toggleDone", where);
  assert.equal(applied, 1);
  const after = store.read();
  assert.equal(after.boards[1], before.boards[1], "untouched board keeps identity");
  assert.equal(after.boards[0].columns[1], before.boards[0].columns[1]);
  assert.notEqual(after.boards[0].columns[0], before.boards[0].columns[0]);
  assert.equal(before.boards[0].columns[0].items[1].done, false, "old snapshot is immutable");
});

test("baseline store has no apply and uses the callback path", () => {
  const store = createDocumentStore({ backend: "baseline", initial: doc() });
  assert.equal(store.apply, undefined);
  commands.run(store, "toggleDone", where);
  assert.equal(store.read().boards[0].columns[0].items[1].done, true);
});

test("a document without the field falls back to the callback path instead of failing", () => {
  const legacy = doc();
  delete legacy.boards[0].columns[0].illustrationId;
  const store = createDocumentStore({ backend: "state-lib", initial: legacy });
  commands.run(store, "setField", {
    ...where,
    target: "column",
    key: "title",
    value: "T",
    clearIllustration: true,
  });
  const column = store.read().boards[0].columns[0];
  assert.equal(column.title, "T");
  assert.equal(column.illustrationId, "");
});

test("a missing item is rejected without publishing", () => {
  for (const backend of ["baseline", "state-lib"]) {
    const store = createDocumentStore({ backend, initial: doc() });
    assert.throws(() => commands.run(store, "toggleDone", { ...where, itemId: "nope" }), /item/);
    // The baseline oracle records history before its mutator runs (documented legacy hazard).
    if (backend === "state-lib") assert.equal(store.canUndo, false);
  }
  assert.throws(
    () => commands.run(createDocumentStore({ initial: doc() }), "nope", {}),
    /Unknown board command/,
  );
});

test("an invalid move destination cannot remove an item from either implementation", () => {
  for (const backend of ["baseline", "state-lib", "state-lib-cow"]) {
    const store = createDocumentStore({ backend, initial: doc() });
    const before = structuredClone(store.read());
    assert.throws(
      () => commands.run(store, "moveItem", { ...where, toColumnId: "missing" }),
      /destination column/,
    );
    assert.deepEqual(store.read(), before, backend + " retains the source item");
    store.dispose();
  }
});

test('item field edits preserve illustration metadata when the column-only clear flag is set', () => {
  const initial=doc();initial.boards[0].columns[0].items[0].illustrationId='item-art';
  const baseline=createDocumentStore({backend:'baseline',initial}),state=createDocumentStore({backend:'state-lib',initial});
  const args={...where,kind:'item',field:'text',value:'Changed',clear:true};
  commands.run(baseline,'setField',args);commands.run(state,'setField',args);
  assert.deepEqual(state.read(),baseline.read());assert.equal(state.read().boards[0].columns[0].items[0].illustrationId,'item-art');
  baseline.dispose();state.dispose();
});
test('invalid relative-move arguments are rejected before either implementation writes', () => {
  for(const backend of ['baseline','state-lib']){
    const store=createDocumentStore({backend,initial:doc()}),before=structuredClone(store.read());
    assert.throws(()=>commands.run(store,'moveItem',where),/delta/i);
    assert.deepEqual(store.read(),before);store.dispose();
  }
});
