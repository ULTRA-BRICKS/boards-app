import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentStore } from "../packages/core/document-store.mjs";
const initial = () => ({
  name: "Workspace",
  boards: [
    {
      id: "b",
      columns: [
        { id: "a", items: [{ id: "1", text: "First", done: false }] },
        { id: "z", items: [] },
      ],
    },
  ],
});

test("document mutation failures roll back content AND undo history", () => {
  const store = createDocumentStore({ initial: initial() });
  const before = store.getSnapshot();
  assert.throws(
    () =>
      store.change((draft) => {
        draft.name = "Partial";
        throw Error("stop");
      }),
    /stop/,
  );
  assert.equal(store.read().name, "Workspace");
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.canUndo, false);
  store.dispose();
});
test("published snapshots and replacement inputs are owned and immutable", () => {
  const input = initial(),
    store = createDocumentStore({ initial: input });
  input.name = "External";
  assert.equal(store.read().name, "Workspace");
  const before = store.getSnapshot();
  store.change((draft) => {
    draft.name = "Edited";
  });
  assert.equal(before.document.name, "Workspace");
  assert.throws(() => {
    store.read().boards[0].columns[0].items[0].text = "untracked";
  }, TypeError);
  store.dispose();
});
test("escaped drafts and newly inserted external objects cannot mutate committed state", () => {
  const store = createDocumentStore({ initial: initial() });
  let escaped;
  const incoming = { id: "2", text: "New", done: false };
  store.change((draft) => {
    escaped = draft;
    draft.boards[0].columns[0].items.push(incoming);
  });
  escaped.name = "Late";
  incoming.text = "Outside";
  assert.equal(store.read().name, "Workspace");
  assert.equal(store.read().boards[0].columns[0].items[1].text, "New");
  store.dispose();
});
test("atomic cross-column move, undo and redo publish coherent snapshots once each", () => {
  const store = createDocumentStore({ initial: initial() }),
    seen = [];
  const stop = store.subscribe(() => seen.push(store.getSnapshot()));
  store.change((draft) => {
    const [a, z] = draft.boards[0].columns;
    z.items.push(a.items.pop());
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].canUndo, true);
  assert.deepEqual(
    seen[0].document.boards[0].columns.map((c) => c.items.map((i) => i.id)),
    [[], ["1"]],
  );
  assert.equal(store.undo(), true);
  assert.equal(store.canRedo, true);
  assert.deepEqual(store.read(), initial());
  assert.equal(store.redo(), true);
  assert.equal(seen.length, 3);
  stop();
  store.dispose();
});
test("remote replacement and logout clear history across workspace boundaries", () => {
  const store = createDocumentStore({ initial: initial() });
  store.change((draft) => {
    draft.name = "Local";
  });
  store.replace({ ...initial(), name: "Remote" });
  assert.equal(store.undo(), false);
  assert.equal(store.read().name, "Remote");
  store.clear();
  assert.equal(store.read(), null);
  assert.equal(store.redo(), false);
  store.dispose();
});
test("async callbacks cannot leak pre-await or late writes", async () => {
  const store = createDocumentStore({ initial: initial() });
  assert.throws(
    () =>
      store.change(async (draft) => {
        draft.name = "Early";
        await Promise.resolve();
        draft.name = "Late";
      }),
    /synchronous/,
  );
  await Promise.resolve();
  assert.equal(store.read().name, "Workspace");
  assert.equal(store.canUndo, false);
  store.dispose();
});
test("working document resolves current draft for legacy closure-based commands", () => {
  const store = createDocumentStore({ initial: initial() });
  store.change(() => {
    store.read().name = "Command";
  });
  assert.equal(store.read().name, "Command");
  store.undo();
  assert.equal(store.read().name, "Workspace");
  store.dispose();
});
test("history bound and disposal prevent replay or future writes", () => {
  const store = createDocumentStore({ initial: initial(), limit: 2 });
  for (const name of ["one", "two", "three"])
    store.change((draft) => {
      draft.name = name;
    });
  assert(store.undo());
  assert(store.undo());
  assert.equal(store.undo(), false);
  assert.equal(store.read().name, "one");
  store.dispose();
  assert.throws(() => store.change(() => {}), /disposed/);
});
test("baseline and state-lib agree on 240 real edits, moves and undo/redo operations", () => {
  const stores = ["baseline", "state-lib"].map((backend) =>
    createDocumentStore({ backend, initial: initial() }),
  );
  for (let i = 0; i < 240; i++) {
    for (const s of stores) {
      if (i % 7 === 0) s.undo();
      else if (i % 7 === 1) s.redo();
      else if (i % 5 === 0)
        s.change((d) => {
          const cols = d.boards[0].columns;
          const from = cols.find((c) => c.items.length);
          cols.find((c) => !c.items.length).items.push(from.items.pop());
        });
      else
        s.change((d) => {
          d.name = `Edit ${i}`;
        });
    }
    assert.deepEqual(stores[1].read(), stores[0].read());
    assert.equal(stores[1].canUndo, stores[0].canUndo);
    assert.equal(stores[1].canRedo, stores[0].canRedo);
  }
  stores.forEach((s) => s.dispose());
});

test("both backends reject invalid history limits at the public factory", () => {
  for (const backend of ["baseline", "state-lib"]) {
    for (const limit of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => createDocumentStore({ backend, initial: initial(), limit }), TypeError);
    }
  }
  assert.throws(() => createDocumentStore({ backend: "typo", initial: initial() }), /backend/);
});
test("all public readers and writers reject access after disposal consistently", () => {
  for (const backend of ["baseline", "state-lib"]) {
    const store = createDocumentStore({ backend, initial: initial() });
    store.dispose();
    for (const access of [
      () => store.read(),
      () => store.getSnapshot(),
      () => store.subscribe(() => {}),
      () => store.canUndo,
      () => store.canRedo,
      () => store.replace(initial()),
      () => store.change(() => {}),
      () => store.undo(),
      () => store.redo(),
      () => store.clear(),
    ]) {
      assert.throws(access, { message: "Document store is disposed" });
    }
    assert.doesNotThrow(() => store.dispose());
  }
});
test("nested commands are rejected before publishing either history or content", () => {
  for (const method of ["change", "undo", "redo", "replace", "clear", "dispose"]) {
    const store = createDocumentStore({ initial: initial() }),
      before = store.getSnapshot();
    assert.throws(
      () =>
        store.change((draft) => {
          draft.name = "Partial";
          if (method === "change") store.change(() => {});
          else if (method === "replace") store.replace(initial());
          else store[method]();
        }),
      /Nested document mutation/,
    );
    assert.equal(store.getSnapshot(), before);
    store.dispose();
  }
});
test("subscriber failures occur AFTER commit and state-lib still delivers later subscribers", () => {
  for (const backend of ["baseline", "state-lib"]) {
    const store = createDocumentStore({ backend, initial: initial() });
    let delivered = 0;
    store.subscribe(() => {
      throw Error("listener failed");
    });
    store.subscribe(() => {
      delivered++;
    });
    assert.throws(
      () =>
        store.change((draft) => {
          draft.name = "Committed";
        }),
      (error) => {
        if (backend === "state-lib") assert.equal(error.committed, true);
        else assert.equal(error.message, "listener failed");
        return true;
      },
    );
    assert.equal(store.read().name, "Committed");
    assert.equal(store.canUndo, true);
    assert.equal(delivered, backend === "state-lib" ? 1 : 0);
    store.dispose();
  }
});
test("notifications are observational in state-lib, unlike the recursive mutable baseline", () => {
  for (const backend of ["baseline", "state-lib"]) {
    const store = createDocumentStore({ backend, initial: initial() });
    store.subscribe(() => {
      if (store.read()?.name === "Trigger") store.clear();
    });
    if (backend === "state-lib") {
      assert.throws(
        () =>
          store.change((draft) => {
            draft.name = "Trigger";
          }),
        (error) => error.committed === true,
      );
      assert.equal(store.read().name, "Trigger");
    } else {
      store.change((draft) => {
        draft.name = "Trigger";
      });
      assert.equal(store.read(), null);
    }
    store.dispose();
  }
});
test("non-JSON or cyclic drafts fail legibly without a partial commit", () => {
  const store = createDocumentStore({ initial: initial() }),
    before = store.getSnapshot();
  assert.throws(
    () =>
      store.change((draft) => {
        draft.self = draft;
      }),
    { name: "TypeError", message: "Document snapshots must be acyclic JSON data" },
  );
  assert.throws(
    () =>
      store.change((draft) => {
        draft.data = new Map();
      }),
    { name: "TypeError", message: "Document snapshots must be acyclic JSON data" },
  );
  assert.equal(store.getSnapshot(), before);
  store.dispose();
});
test("replace and clear each publish once, and unsubscribe stops further delivery", () => {
  for (const backend of ["baseline", "state-lib"]) {
    const store = createDocumentStore({ backend, initial: initial() });
    let count = 0;
    const stop = store.subscribe(() => {
      count++;
    });
    store.replace({ ...initial(), name: "Replacement" });
    assert.equal(count, 1);
    store.clear();
    assert.equal(count, 2);
    assert.equal(store.getSnapshot().document, null);
    stop();
    store.replace(initial());
    assert.equal(count, 2);
    store.dispose();
  }
});

test("disposal rejected during notification leaves the scope open for a real later disposal", () => {
  const store = createDocumentStore({ initial: initial() });
  const stop = store.subscribe(() => store.dispose());
  assert.throws(
    () =>
      store.change((draft) => {
        draft.name = "Committed";
      }),
    (error) => error.committed === true,
  );
  assert.equal(store.read().name, "Committed");
  stop();
  assert.doesNotThrow(() => store.dispose());
  assert.throws(() => store.getSnapshot(), { message: "Document store is disposed" });
});

test("getSnapshot stays committed while read exposes the isolated current command draft", () => {
  const store = createDocumentStore({ initial: initial() });
  const before = store.getSnapshot();
  store.change((draft) => {
    draft.name = "Working";
    assert.equal(store.read(), draft);
    assert.equal(store.getSnapshot(), before);
    assert.equal(store.getSnapshot().document.name, "Workspace");
  });
  assert.equal(store.getSnapshot().document.name, "Working");
  store.dispose();
});

test("the extracted baseline deliberately retains unsafe ownership and async behavior", async () => {
  const input = initial();
  const baseline = createDocumentStore({ backend: "baseline", initial: input });
  const immutable = createDocumentStore({ initial: input });
  input.name = "External";
  assert.equal(baseline.read().name, "External");
  assert.equal(immutable.read().name, "Workspace");
  baseline.change(async (draft) => {
    draft.name = "Early";
    await Promise.resolve();
    draft.name = "Late";
  });
  assert.equal(baseline.read().name, "Early");
  await Promise.resolve();
  assert.equal(baseline.read().name, "Late");
  for (const value of [undefined, NaN, Infinity]) {
    baseline.change((draft) => {
      draft.invalid = value;
    });
    assert.throws(
      () =>
        immutable.change((draft) => {
          draft.invalid = value;
        }),
      /acyclic JSON data/,
    );
  }
  baseline.clear();
  immutable.clear();
  assert.equal(
    baseline.change(() => {
      throw Error("must not run");
    }),
    false,
  );
  assert.equal(
    immutable.change(() => {
      throw Error("must not run");
    }),
    false,
  );
  baseline.dispose();
  immutable.dispose();
});
