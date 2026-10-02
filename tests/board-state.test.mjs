// Contract tests for apps/board/board-state.mjs (HYP-1490): the application-owned state
// of the board UI (session, navigation, selection, menus, editor, pending operations)
// built on the state-lib Runtime, with a baseline (no Runtime) twin as the A/B oracle.
import test from "node:test";
import assert from "node:assert/strict";
import { Runtime } from "../packages/state-lib/dist/index.js";
import { createDocumentStore } from "../packages/core/document-store.mjs";
import { createScope } from "../packages/state-lib/scoped/scope.mjs";
import { createBaselineScope } from "../packages/state-lib/scoped/scope-baseline.mjs";
import {
  createDebouncedLatestTask,
  createBaselineDebouncedLatestTask,
} from "../packages/state-lib/scoped/debounced-latest.mjs";
import { createBoardState, resolveBackends } from "../apps/board/board-state.mjs";

const kit = {
  Runtime,
  createDocumentStore,
  createScope,
  createBaselineScope,
  createDebouncedLatestTask,
  createBaselineDebouncedLatestTask,
};
const doc = () => ({
  boards: [
    { id: "b1", columns: [] },
    { id: "b2", columns: [] },
  ],
});
const make = (document) =>
  createBoardState({
    kit,
    backends: { workspace: document === "baseline" ? "baseline" : "state-lib", document },
  });
const ALL = ["baseline", "state-lib", "state-lib-cow"];
const RUNTIME = ["state-lib", "state-lib-cow"];

test("resolveBackends: build config wins unless URL override is allowed", () => {
  const open = { backend: "state-lib", allowUrlOverride: true },
    frozen = { backend: "baseline", allowUrlOverride: false };
  assert.deepEqual(resolveBackends(open, ""), { workspace: "state-lib", document: "state-lib" });
  assert.deepEqual(resolveBackends(open, "?stateBackend=baseline"), {
    workspace: "baseline",
    document: "baseline",
  });
  assert.deepEqual(resolveBackends(open, "?stateBackend=state-lib-cow"), {
    workspace: "state-lib",
    document: "state-lib-cow",
  });
  assert.deepEqual(resolveBackends(frozen, "?stateBackend=state-lib-cow"), {
    workspace: "baseline",
    document: "baseline",
  });
  assert.deepEqual(
    resolveBackends({ backend: "state-lib", allowUrlOverride: false }, "?stateBackend=baseline"),
    { workspace: "state-lib", document: "state-lib" },
  );
  assert.deepEqual(resolveBackends(open, "?stateBackend=nonsense"), {
    workspace: "state-lib",
    document: "state-lib",
  });
  assert.throws(() => resolveBackends({ backend: "x", allowUrlOverride: false }, ""), /backend/);
});

for (const backend of ALL) {
  test(`[${backend}] initial values, selection and navigation owners`, () => {
    const S = make(backend);
    assert.equal(S.shared.get(), false);
    assert.equal(S.boardId.get(), "");
    assert.equal(S.columnId.get(), "");
    assert.deepEqual([...S.people.get()], []);
    assert.equal(S.user.get(), null);
    assert.equal(S.selected.size, 0);
    S.selected.toggle("a");
    S.selected.toggle("b");
    assert.deepEqual([...S.selected.get()], ["a", "b"]);
    S.selected.only("c");
    assert.deepEqual([...S.selected.get()], ["c"]);
    assert.equal(S.dialog.get().open, false);
  });

  test(`[${backend}] resetPrivate clears private state but keeps session chrome`, () => {
    const S = make(backend);
    S.documentStore.replace(doc());
    S.config.set({ providers: ["x"] });
    S.shared.set(true);
    S.boardId.set("b2");
    S.columnId.set("c1");
    S.user.set({ id: "u" });
    S.selected.replace(["a"]);
    S.tickets.set("ref", 1);
    S.artAttempts.add("k");
    const before = S.workspaceEpoch.get();
    S.resetPrivate();
    assert.equal(S.boardId.get(), "");
    assert.equal(S.columnId.get(), "");
    assert.equal(S.user.get(), null);
    assert.equal(S.selected.size, 0);
    assert.equal(S.tickets.size, 0);
    assert.equal(S.artAttempts.size, 0);
    assert.equal(S.documentStore.read(), null);
    assert.ok(S.workspaceEpoch.get() > before);
    assert.deepEqual({ ...S.config.get() }, { providers: ["x"] });
    assert.equal(S.shared.get(), true);
  });

  test(`[${backend}] resources hold opaque handles, dispose once, and never enter snapshots`, () => {
    const S = make(backend);
    const calls = [];
    const handle = { tagName: "DIV", parentNode: null, fn() {} };
    S.popover.set(handle, (h) => calls.push(["dispose", h]));
    S.sync.set({ paused: false }, () => calls.push(["sync"]));
    assert.equal(S.popover.get(), handle);
    const snap = S.snapshot();
    assert.equal(snap.private.resources.popover, true);
    assert.doesNotThrow(() => JSON.stringify(snap));
    assert.ok(!JSON.stringify(snap).includes("tagName"));
    S.resetPrivate();
    assert.deepEqual(calls, [["dispose", handle], ["sync"]]);
    assert.equal(S.popover.get(), undefined);
    S.resetPrivate();
    assert.equal(calls.length, 2);
  });

  test(`[${backend}] a scope owner refuses an opaque handle`, () => {
    const S = make(backend);
    assert.throws(() => {
      S.editMeta.set({ el: () => {} });
      S.snapshot();
    }, /resource/);
  });

  test(`[${backend}] resetPrivate cancels debounced tasks and epochs guard stale work`, async () => {
    const S = make(backend);
    let loads = 0;
    const task = S.debounced({
      delay: 5,
      load: () => {
        loads++;
        return 1;
      },
      commit: () => {},
    });
    const guard = S.workspaceEpoch.guard();
    const run = task.run("x");
    S.resetPrivate();
    assert.equal(await run, "cancelled");
    assert.equal(loads, 0);
    assert.equal(guard(), false);
  });

  test(`[${backend}] dialog-chrome: dialog owner and epoch survive private reset (session state)`, () => {
    const S = make(backend);
    S.dialogEpoch.bump();
    const guard = S.dialogEpoch.guard();
    S.dialog.set({ open: true, dismiss: false });
    S.resetPrivate();
    assert.equal(guard(), true);
    assert.deepEqual({ ...S.dialog.get() }, { open: true, dismiss: false });
  });
}

for (const backend of RUNTIME) {
  test(`[${backend}] document and navigation share one Runtime: one atomic wave`, () => {
    const S = make(backend);
    S.documentStore.replace(doc());
    const seen = [];
    S.boardId.subscribe(() =>
      seen.push(["board", S.boardId.get(), S.documentStore.read().boards.length]),
    );
    S.selected.subscribe(() => seen.push(["selected", S.selected.size]));
    S.documentStore.subscribe(() =>
      seen.push(["doc", S.boardId.get(), S.documentStore.read().boards.length]),
    );
    S.batch(() => {
      S.documentStore.change((d) => {
        d.boards.push({ id: "b3", columns: [] });
      });
      S.boardId.set("b3");
      S.selected.clear();
    });
    assert.deepEqual(seen.filter((e) => e[0] !== "selected").sort(), [
      ["board", "b3", 3],
      ["doc", "b3", 3],
    ]);
    assert.equal(S.documentStore.read().boards.length, 3);
  });

  test(`[${backend}] a failing batch leaves document and owners untouched`, () => {
    const S = make(backend);
    S.documentStore.replace(doc());
    S.boardId.set("b1");
    assert.throws(
      () =>
        S.batch(() => {
          S.documentStore.change((d) => {
            d.boards.length = 0;
          });
          S.boardId.set("zzz");
          throw new Error("boom");
        }),
      /boom/,
    );
    assert.equal(S.boardId.get(), "b1");
    assert.equal(S.documentStore.read().boards.length, 2);
  });

  test(`[${backend}] undo/redo history stays available through the shared runtime`, () => {
    const S = make(backend);
    S.documentStore.replace(doc());
    S.documentStore.change((d) => {
      d.boards[0].id = "changed";
    });
    assert.equal(S.documentStore.canUndo, true);
    S.documentStore.undo();
    assert.equal(S.documentStore.read().boards[0].id, "b1");
    S.documentStore.redo();
    assert.equal(S.documentStore.read().boards[0].id, "changed");
  });
}

test("baseline batch is a plain call (documented: no rollback)", () => {
  const S = make("baseline");
  S.boardId.set("a");
  assert.throws(
    () =>
      S.batch(() => {
        S.boardId.set("b");
        throw new Error("x");
      }),
    /x/,
  );
  assert.equal(S.boardId.get(), "b");
});

// One contract per manifest entry (docs/state-migration-manifest.json ids in the titles).
for (const backend of ALL) {
  test(`[${backend}] session-config, session-share-mode and save-error-dialog-flag are session chrome: they survive resetPrivate`, () => {
    const S = make(backend);
    S.config.set({ ready: true });
    S.shared.set(true);
    S.shareId.set("s1");
    S.errorOpen.set(true);
    S.resetPrivate();
    assert.equal(S.config.get().ready, true);
    assert.equal(S.shared.get(), true);
    assert.equal(S.shareId.get(), "s1");
    assert.equal(S.errorOpen.get(), true);
  });

  test(`[${backend}] private-user-people-requests, navigation-board, navigation-column and selection reset together`, () => {
    const S = make(backend);
    S.people.set([{ id: "p" }]);
    S.requests.set([{ id: "r" }]);
    S.user.set({ id: "u" });
    S.boardId.set("b");
    S.columnId.set("c");
    S.selected.replace(["x", "y", "x"]);
    assert.deepEqual([...S.selected.get()], ["x", "y"]);
    S.resetPrivate();
    assert.deepEqual(
      [
        [...S.people.get()],
        [...S.requests.get()],
        S.user.get(),
        S.boardId.get(),
        S.columnId.get(),
        S.selected.size,
      ],
      [[], [], null, "", "", 0],
    );
  });

  test(`[${backend}] menu-popover, menu-hover-card, column-observer and sync-queue handles dispose on replace and reset`, () => {
    const S = make(backend);
    const log = [];
    for (const name of ["popover", "hoverCard", "columnObserver", "sync"]) {
      const first = { name, n: 1 },
        second = { name, n: 2 };
      S[name].set(first, (h) => log.push(`${name}${h.n}`));
      S[name].set(second, (h) => log.push(`${name}${h.n}`));
    }
    assert.deepEqual(
      log,
      ["popover1", "hoverCard1", "columnObserver1", "sync1"],
      "replacing a handle disposes the previous one",
    );
    S.popover.clear();
    assert.equal(S.popover.get(), undefined);
    assert.equal(S.editor.take(), undefined);
    S.resetPrivate();
    assert.deepEqual(
      log.slice(4),
      ["popover2", "hoverCard2", "columnObserver2", "sync2"],
      "clear() and reset dispose what is held, once each",
    );
  });

  test(`[${backend}] editor-inline: take() detaches the element WITHOUT running its disposer; clear() runs it`, () => {
    const S = make(backend);
    const el = { tagName: "DIV" };
    let disposed = 0;
    S.editor.set(el, () => disposed++);
    S.editMeta.set({ ref: { target: "item" }, key: "text", max: 1000, old: "a" });
    assert.equal(S.editor.take(), el);
    assert.equal(disposed, 0);
    S.editor.set(el, () => disposed++);
    S.editor.clear();
    assert.equal(disposed, 1);
    S.editMeta.set(null);
    assert.doesNotThrow(() => S.snapshot());
  });

  test(`[${backend}] toast-timer: a new timer disposes (clears) the previous one`, () => {
    const S = make(backend);
    const cleared = [];
    S.toastTimer.set(1, (id) => cleared.push(id));
    S.toastTimer.set(2, (id) => cleared.push(id));
    assert.deepEqual(cleared, [1]);
  });

  test(`[${backend}] pending-illustration, pending-ticket-preview and pending-photo-read epochs invalidate stale async work`, () => {
    const S = make(backend);
    for (const epoch of [S.workspaceEpoch, S.dialogEpoch, S.hoverEpoch, S.photoEpoch]) {
      const alive = epoch.guard();
      assert.equal(alive(), true);
      epoch.bump();
      assert.equal(alive(), false);
      assert.equal(epoch.guard()(), true);
    }
  });

  test(`[${backend}] cache-tickets-and-art-attempts are memo caches cleared by resetPrivate`, () => {
    const S = make(backend);
    S.tickets.set("#1", { title: "t" });
    S.artAttempts.add("c:t");
    assert.equal(S.tickets.get("#1").title, "t");
    S.resetPrivate();
    assert.deepEqual([S.tickets.size, S.artAttempts.size], [0, 0]);
  });

  test(`[${backend}] pending-duplicate-suggestion and pending-search-dialog: latest wins, results land in owners`, async () => {
    const S = make(backend);
    const loads = [];
    const task = S.debounced({
      delay: 1,
      load: (input) => {
        loads.push(input);
        return { hits: [input] };
      },
      commit: (v) => S.suggestions.set(v),
    });
    const first = task.run("a");
    const second = task.run("b");
    assert.equal(await first, "superseded");
    assert.equal(await second, "committed");
    assert.deepEqual(loads, ["b"]);
    assert.deepEqual(S.suggestions.get().hits, ["b"]);
    S.resetPrivate();
    assert.equal(S.suggestions.get(), null);
  });
}

test("[state-lib] private reset clears document and owners atomically despite disposer errors", () => {
  const S = make("state-lib");
  S.documentStore.replace(doc());
  S.boardId.set("b2");
  S.user.set({ id: "old-user" });
  S.tickets.set("private", {});
  S.artAttempts.add("private");
  const released = [];
  S.popover.set({}, () => {
    released.push("popover");
    throw Error("dispose failed");
  });
  S.sync.set({}, () => released.push("sync"));
  const observed = [];
  S.runtime.watch(
    () => [S.boardId.get(), S.user.get(), S.documentStore.read()],
    (value) => observed.push(value),
  );
  assert.throws(() => S.resetPrivate(), /disposal|dispose/i);
  assert.equal(S.documentStore.read(), null);
  assert.equal(S.user.get(), null);
  assert.equal(S.boardId.get(), "");
  assert.equal(S.tickets.size, 0);
  assert.equal(S.artAttempts.size, 0);
  assert.deepEqual(released, ["popover", "sync"]);
  assert.deepEqual(observed, [["", null, null]]);
});
