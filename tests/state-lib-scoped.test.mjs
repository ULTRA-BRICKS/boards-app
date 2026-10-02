// Contract + Runtime-only tests for packages/state-lib/scoped (HYP-1490).
// The portable contract runs against BOTH the Runtime-backed and the baseline backend;
// atomicity, rollback and kernel-rule tests exist only for the Runtime backend.
import test from "node:test";
import assert from "node:assert/strict";
import { Runtime, NotificationError } from "../packages/state-lib/dist/index.js";
import { createScope } from "../packages/state-lib/scoped/scope.mjs";
import { createBaselineScope } from "../packages/state-lib/scoped/scope-baseline.mjs";
import {
  createDebouncedLatestTask,
  createBaselineDebouncedLatestTask,
} from "../packages/state-lib/scoped/debounced-latest.mjs";
import { createDocumentStore } from "../packages/core/document-store.mjs";

const backends = {
  runtime: () => {
    const runtime = new Runtime();
    return { scope: createScope(runtime, { name: "t" }), runtime };
  },
  baseline: () => ({ scope: createBaselineScope({ name: "t" }) }),
};

function fakeTimers() {
  let now = 0,
    next = 0;
  const queue = new Map();
  return {
    setTimer(fn, ms) {
      const h = ++next;
      queue.set(h, { fn, at: now + ms });
      return h;
    },
    clearTimer(h) {
      queue.delete(h);
    },
    advance(ms) {
      now += ms;
      const due = [...queue].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [h, t] of due) {
        queue.delete(h);
        t.fn();
      }
    },
    get size() {
      return queue.size;
    },
  };
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setImmediate(r));

for (const [label, make] of Object.entries(backends)) {
  test(`[${label}] owner: get/peek/set/update/subscribe and custom equality`, () => {
    const { scope } = make();
    const a = scope.owner("a", 1);
    const seen = [];
    const off = a.subscribe((v, p) => seen.push([v, p]));
    a.set(2);
    a.update((n) => n + 1);
    a.set(3);
    assert.deepEqual(seen, [
      [2, 1],
      [3, 2],
    ]);
    assert.equal(a.get(), 3);
    assert.equal(a.peek(), 3);
    off();
    a.set(9);
    assert.equal(seen.length, 2);
    const b = scope.owner("b", { id: 1 }, { equals: (x, y) => x.id === y.id });
    let calls = 0;
    b.subscribe(() => calls++);
    b.set({ id: 1 });
    assert.equal(calls, 0);
    b.set({ id: 2 });
    assert.equal(calls, 1);
  });

  test(`[${label}] duplicate key across every kind throws`, () => {
    const { scope } = make();
    scope.owner("k", 1);
    assert.throws(() => scope.owner("k", 2), /k/);
    assert.throws(() => scope.ids("k"), /k/);
    assert.throws(() => scope.epoch("k"), /k/);
    assert.throws(() => scope.resource("k"), /k/);
    scope.ids("i");
    assert.throws(() => scope.owner("i", 1), /i/);
    scope.epoch("e");
    assert.throws(() => scope.resource("e"), /e/);
  });

  test(`[${label}] ids: ordered, unique, frozen, structural sharing`, () => {
    const { scope } = make();
    const sel = scope.ids("sel");
    const notes = [];
    sel.subscribe((v) => notes.push(v));
    const empty = sel.get();
    assert.ok(Object.isFrozen(empty));
    sel.toggle("a");
    sel.toggle("b");
    sel.toggle("c");
    assert.deepEqual(sel.get(), ["a", "b", "c"]);
    assert.equal(sel.size, 3);
    assert.ok(sel.has("b") && !sel.has("z"));
    sel.toggle("b");
    assert.deepEqual(sel.get(), ["a", "c"]);
    assert.ok(Object.isFrozen(sel.get()));
    const before = sel.get();
    sel.only("a");
    sel.only("a");
    assert.deepEqual(sel.get(), ["a"]);
    sel.replace(["x", "y", "x"]);
    assert.deepEqual(sel.get(), ["x", "y"]);
    const same = sel.get();
    sel.replace(["x", "y"]);
    sel.only("x");
    sel.toggle("q");
    sel.toggle("q");
    assert.notEqual(before, same);
    sel.replace(["x", "y"]);
    sel.clear();
    assert.deepEqual(sel.get(), []);
    const cleared = sel.get();
    sel.clear();
    assert.equal(sel.get(), cleared);
    assert.equal(notes.filter((v) => v === cleared).length, 1);
  });

  test(`[${label}] ids: no-op writes keep the reference and never notify`, () => {
    const { scope } = make();
    const sel = scope.ids("sel");
    sel.replace(["a", "b"]);
    const ref = sel.get();
    let n = 0;
    sel.subscribe(() => n++);
    sel.replace(["a", "b"]);
    sel.replace(["a", "b", "a"]);
    sel.only("a");
    assert.equal(n, 1);
    sel.replace(["a", "b"]);
    assert.equal(n, 2);
    assert.notEqual(sel.get(), ref);
    const only = scope.ids("o");
    only.only("z");
    const oref = only.get();
    only.only("z");
    assert.equal(only.get(), oref);
    const e = scope.ids("e");
    const eref = e.get();
    e.clear();
    e.replace([]);
    assert.equal(e.get(), eref);
  });

  test(`[${label}] epoch: guard is true only until the next bump`, () => {
    const { scope } = make();
    const ep = scope.epoch("nav");
    const g1 = ep.guard();
    assert.equal(g1(), true);
    const seen = [];
    ep.subscribe((v) => seen.push(v));
    ep.bump();
    const g2 = ep.guard();
    assert.equal(g1(), false);
    assert.equal(g2(), true);
    assert.equal(ep.get(), 1);
    assert.deepEqual(seen, [1]);
    ep.bump();
    assert.equal(g2(), false);
  });

  test(`[${label}] resource: set disposes previous first, clear disposes, take detaches`, () => {
    const { scope } = make();
    const log = [];
    const slot = scope.resource("popup");
    assert.equal(slot.get(), undefined);
    const revs = [];
    slot.revision.subscribe((v) => revs.push(v));
    const h1 = { id: 1 },
      h2 = { id: 2 },
      h3 = { id: 3 };
    slot.set(h1, (h) => log.push(`d${h.id}:${slot.get()?.id}`));
    slot.set(h2, (h) => log.push(`d${h.id}`));
    assert.deepEqual(log, ["d1:1"]);
    assert.equal(slot.get(), h2);
    assert.equal(slot.take(), h2);
    assert.equal(slot.get(), undefined);
    assert.deepEqual(log, ["d1:1"]);
    slot.set(h3, (h) => log.push(`d${h.id}`));
    slot.clear();
    assert.deepEqual(log, ["d1:1", "d3"]);
    slot.clear();
    assert.equal(slot.take(), undefined);
    assert.deepEqual(log, ["d1:1", "d3"]);
    assert.deepEqual(revs, [1, 2, 3, 4, 5]);
    assert.equal(slot.revision.get(), 5);
    assert.equal(typeof slot.revision.set, "undefined");
  });

  test(`[${label}] resource: setting a handle without dispose leaves previous alone`, () => {
    const { scope } = make();
    const slot = scope.resource("r");
    const h = {};
    slot.set(h);
    slot.set({});
    slot.clear();
    assert.equal(slot.get(), undefined);
  });

  test(`[${label}] batch returns the callback value`, () => {
    const { scope } = make();
    const a = scope.owner("a", 0);
    assert.equal(
      scope.batch(() => {
        a.set(5);
        return "ok";
      }),
      "ok",
    );
    assert.equal(a.get(), 5);
  });

  test(`[${label}] reset restores owners, clears ids, bumps epochs, disposes resources in order`, () => {
    const { scope } = make();
    const a = scope.owner("a", 1),
      sel = scope.ids("sel"),
      ep = scope.epoch("e");
    const log = [],
      r1 = scope.resource("r1"),
      r2 = scope.resource("r2");
    a.set(7);
    sel.replace(["x"]);
    const guard = ep.guard();
    r1.set("h1", (h) => log.push(h));
    r2.set("h2", (h) => log.push(h));
    const r1Rev = r1.revision.get();
    scope.reset();
    assert.equal(a.get(), 1);
    assert.deepEqual(sel.get(), []);
    assert.equal(guard(), false);
    assert.equal(ep.get(), 1);
    assert.deepEqual(log, ["h1", "h2"]);
    assert.equal(r1.get(), undefined);
    assert.ok(r1.revision.get() > r1Rev);
  });

  test(`[${label}] reset attempts every disposer and throws AggregateError`, () => {
    const { scope } = make();
    const a = scope.owner("a", 1);
    const log = [];
    scope.resource("r1").set("h1", () => {
      log.push("h1");
      throw Error("boom1");
    });
    scope.resource("r2").set("h2", () => log.push("h2"));
    scope.resource("r3").set("h3", () => {
      log.push("h3");
      throw Error("boom3");
    });
    a.set(2);
    assert.throws(
      () => scope.reset(),
      (e) => {
        assert.ok(e instanceof AggregateError);
        assert.deepEqual(
          e.errors.map((x) => x.message),
          ["boom1", "boom3"],
        );
        return true;
      },
    );
    assert.deepEqual(log, ["h1", "h2", "h3"]);
    assert.equal(a.get(), 1);
  });

  test(`[${label}] snapshot is JSON-safe and hides handles`, () => {
    const { scope } = make();
    scope.owner("n", 3);
    scope.owner("o", { a: [1, { b: 2 }] });
    scope.ids("sel").replace(["a", "b"]);
    scope.epoch("e").bump();
    scope.resource("full").set({ fn() {} });
    scope.resource("empty");
    const snap = scope.snapshot();
    assert.deepEqual(snap, {
      owners: { n: 3, o: { a: [1, { b: 2 }] } },
      ids: { sel: ["a", "b"] },
      epochs: { e: 1 },
      resources: { full: true, empty: false },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
  });

  test(`[${label}] snapshot rejects an owner holding a handle and names the key`, () => {
    const { scope } = make();
    scope.owner("editor", { focus() {} });
    assert.throws(
      () => scope.snapshot(),
      (e) => {
        assert.ok(e instanceof TypeError);
        assert.match(e.message, /editor/);
        assert.match(e.message, /resource\(\)/);
        return true;
      },
    );
  });

  test(`[${label}] dispose clears resources`, () => {
    const { scope } = make();
    const log = [];
    scope.resource("a").set(1, (h) => log.push(h));
    scope.dispose();
    assert.deepEqual(log, [1]);
  });
}

test("[runtime] scope.dispose does not dispose the injected runtime", () => {
  const { scope, runtime } = backends.runtime();
  scope.dispose();
  assert.doesNotThrow(() => runtime.signal(1).set(2));
});

test("[runtime] reset is atomic: no observer sees a half-reset scope", () => {
  const { scope, runtime } = backends.runtime();
  const a = scope.owner("a", 1),
    b = scope.owner("b", "x");
  const sel = scope.ids("sel"),
    ep = scope.epoch("e"),
    slot = scope.resource("r");
  a.set(2);
  b.set("y");
  sel.replace(["q"]);
  slot.set({}, () => {});
  const shape = () => [a.get(), b.get(), sel.get().length, slot.revision.get()];
  const watched = [],
    viaSubscribe = [];
  runtime.watch(shape, (v) => watched.push(v));
  a.subscribe(() => viaSubscribe.push(shape()));
  sel.subscribe(() => viaSubscribe.push(shape()));
  slot.revision.subscribe(() => viaSubscribe.push(shape()));
  const beforeRev = slot.revision.get();
  scope.reset();
  assert.equal(watched.length, 1);
  assert.deepEqual(watched[0], [1, "x", 0, beforeRev + 1]);
  for (const s of viaSubscribe) assert.deepEqual(s, [1, "x", 0, beforeRev + 1]);
  assert.equal(viaSubscribe.length, 3);
  assert.equal(ep.get(), 1);
});

test("[runtime] a throwing batch rolls back owners, ids and epochs without notifying", () => {
  const { scope, runtime } = backends.runtime();
  const a = scope.owner("a", 1),
    sel = scope.ids("sel"),
    ep = scope.epoch("e");
  const notes = [];
  runtime.watch(
    () => [a.get(), sel.get(), ep.get()],
    (v) => notes.push(v),
  );
  assert.throws(
    () =>
      scope.batch(() => {
        a.set(2);
        sel.toggle("x");
        sel.toggle("y");
        ep.bump();
        assert.deepEqual(sel.get(), ["x", "y"]);
        throw Error("nope");
      }),
    /nope/,
  );
  assert.equal(a.get(), 1);
  assert.deepEqual(sel.get(), []);
  assert.equal(ep.get(), 0);
  assert.equal(notes.length, 0);
});

test("[runtime] one batch publishes one notification wave", () => {
  const { scope, runtime } = backends.runtime();
  const a = scope.owner("a", 1),
    sel = scope.ids("sel");
  const notes = [];
  runtime.watch(
    () => [a.get(), sel.get()],
    (v) => notes.push(v),
  );
  scope.batch(() => {
    a.set(2);
    sel.toggle("x");
    sel.toggle("y");
  });
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0], [2, ["x", "y"]]);
});

test("[runtime] a listener cannot write during notification (NotificationError)", () => {
  const { scope } = backends.runtime();
  const a = scope.owner("a", 1),
    b = scope.owner("b", 1);
  a.subscribe(() => b.set(99));
  assert.throws(
    () => a.set(2),
    (e) => {
      assert.ok(e instanceof NotificationError);
      assert.equal(e.committed, true);
      return true;
    },
  );
  assert.equal(a.get(), 2);
  assert.equal(b.get(), 1);
});

test("[runtime] snapshot rejects DOM-like handle owners even if nested", () => {
  const { scope } = backends.runtime();
  scope.owner("hover", { node: { addEventListener() {} } });
  assert.throws(() => scope.snapshot(), /hover/);
});

test("[runtime] scope and document store share one Runtime and one transaction", () => {
  const runtime = new Runtime();
  const scope = createScope(runtime, { name: "app" });
  const store = createDocumentStore({ initial: { title: "a" }, runtime });
  const selected = scope.owner("selected", null);
  const waves = [];
  runtime.watch(
    () => [store.getSnapshot(), selected.get()],
    (v) => waves.push(v),
  );
  runtime.transaction(() => {
    selected.set("card-1");
    store.change((d) => {
      d.title = "b";
    });
  });
  assert.equal(waves.length, 1);
  assert.equal(waves[0][1], "card-1");
  assert.equal(waves[0][0].document.title, "b");
  assert.equal(store.canUndo, true);
  assert.equal(store.read().title, "b");
});

test("[runtime] document change inside an outer transaction stages, and rolls back with it", () => {
  const runtime = new Runtime();
  const store = createDocumentStore({ initial: { n: 0 }, runtime });
  let notes = 0;
  store.subscribe(() => notes++);
  runtime.transaction(() => {
    store.change((d) => {
      d.n = 1;
    });
    store.change((d) => {
      d.n += 1;
    });
  });
  assert.equal(store.read().n, 2);
  assert.equal(notes, 1);
  const before = store.getSnapshot();
  assert.throws(
    () =>
      runtime.transaction(() => {
        store.change((d) => {
          d.n = 99;
        });
        throw Error("abort");
      }),
    /abort/,
  );
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.read().n, 2);
  store.change((d) => {
    d.n = 3;
  });
  assert.equal(store.read().n, 3);
});

test("document store disposal does not dispose an injected runtime; baseline ignores it", () => {
  const runtime = new Runtime();
  const store = createDocumentStore({ initial: { n: 0 }, runtime });
  const sibling = runtime.signal(1);
  store.dispose();
  assert.doesNotThrow(() => sibling.set(2));
  assert.throws(() => store.read(), /disposed/);
  const base = createDocumentStore({ backend: "baseline", initial: { n: 0 }, runtime });
  base.change((d) => {
    d.n = 1;
  });
  assert.equal(base.read().n, 1);
});

const debouncers = {
  runtime: (opts) => createDebouncedLatestTask(new Runtime(), opts),
  baseline: (opts) => createBaselineDebouncedLatestTask(opts),
};

for (const [label, build] of Object.entries(debouncers)) {
  const setup = (loader) => {
    const timers = fakeTimers(),
      commits = [],
      signals = [];
    const task = build({
      delay: 100,
      load: (input, signal) => {
        signals.push(signal);
        return loader(input, signal);
      },
      commit: (value, input) => {
        commits.push([input, value]);
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    return { timers, commits, signals, task };
  };

  test(`[debounce:${label}] commits after the delay`, async () => {
    const { timers, commits, task } = setup(async (i) => i * 2);
    const p = task.run(2);
    assert.equal(task.pending.get(), true);
    timers.advance(99);
    assert.equal(commits.length, 0);
    timers.advance(1);
    assert.equal(await p, "committed");
    assert.deepEqual(commits, [[2, 4]]);
    assert.equal(task.pending.get(), false);
  });

  test(`[debounce:${label}] a new run restarts the timer and supersedes the waiting run`, async () => {
    const { timers, commits, task } = setup(async (i) => i);
    const p1 = task.run(1);
    timers.advance(60);
    const p2 = task.run(2);
    assert.equal(await p1, "superseded");
    timers.advance(60);
    assert.equal(commits.length, 0);
    timers.advance(40);
    assert.equal(await p2, "committed");
    assert.deepEqual(commits, [[2, 2]]);
    assert.equal(timers.size, 0);
  });

  test(`[debounce:${label}] late response of a superseded in-flight run is ignored, its error never surfaces`, async () => {
    const loads = [];
    const { timers, commits, signals, task } = setup(() => {
      const d = deferred();
      loads.push(d);
      return d.promise;
    });
    const p1 = task.run("a");
    timers.advance(100);
    const p2 = task.run("b");
    assert.equal(signals[0].aborted, true);
    assert.equal(await p1, "superseded");
    timers.advance(100);
    loads[0].reject(Error("stale failure"));
    await tick();
    loads[1].resolve("B");
    assert.equal(await p2, "committed");
    assert.deepEqual(commits, [["b", "B"]]);
    const late = setup(() => {
      const d = deferred();
      loads.push(d);
      return d.promise;
    });
    const q1 = late.task.run("a");
    late.timers.advance(100);
    const q2 = late.task.run("b");
    loads.at(-1).resolve("A-late");
    await tick();
    assert.equal(await q1, "superseded");
    late.timers.advance(100);
    loads.at(-1).resolve("B");
    assert.equal(await q2, "committed");
    assert.deepEqual(late.commits, [["b", "B"]]);
  });

  test(`[debounce:${label}] cancel clears the timer, aborts in-flight and settles waiters`, async () => {
    const { timers, commits, signals, task } = setup(() => new Promise(() => {}));
    const waiting = task.run(1);
    task.cancel();
    assert.equal(await waiting, "cancelled");
    assert.equal(timers.size, 0);
    assert.equal(task.pending.get(), false);
    const inflight = task.run(2);
    timers.advance(100);
    task.cancel();
    assert.equal(signals[0].aborted, true);
    assert.equal(await inflight, "cancelled");
    assert.equal(commits.length, 0);
  });

  test(`[debounce:${label}] current loader error rejects and clears pending`, async () => {
    const { timers, task } = setup(async () => {
      throw Error("load failed");
    });
    const p = task.run(1);
    timers.advance(100);
    await assert.rejects(p, /load failed/);
    assert.equal(task.pending.get(), false);
  });

  test(`[debounce:${label}] dispose settles waiters as cancelled and stops the timer`, async () => {
    const { timers, task } = setup(async (i) => i);
    const p = task.run(1);
    task.dispose();
    assert.equal(await p, "cancelled");
    assert.equal(timers.size, 0);
    task.dispose();
  });
}

test("[debounce:runtime] commit runs inside one transaction and pending is a Readable", async () => {
  const runtime = new Runtime();
  const a = runtime.signal(0),
    b = runtime.signal(0);
  const timers = fakeTimers();
  const task = createDebouncedLatestTask(runtime, {
    delay: 10,
    load: async (i) => i,
    commit: (v) => {
      a.set(v);
      b.set(v);
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  const notes = [];
  runtime.watch(
    () => [a.get(), b.get()],
    (v) => notes.push(v),
  );
  const flags = [];
  task.pending.subscribe((v) => flags.push(v));
  const p = task.run(5);
  timers.advance(10);
  await p;
  assert.deepEqual(notes, [[5, 5]]);
  assert.deepEqual(flags, [true, false]);
  assert.equal(typeof task.pending.set, "undefined");
});

// Reset owns the outer commit; opaque handles cannot be discarded by a rolled-back write.
test("[runtime] reset disposes every resource after a committed observer failure", () => {
  const { scope } = backends.runtime();
  const owner = scope.owner("reset-owner", 0),
    slot = scope.resource("reset-slot");
  const disposed = [];
  const handle = { id: "old" };
  slot.set(handle, (h) => disposed.push(h));
  owner.set(1);
  owner.subscribe(() => {
    assert.equal(slot.get(), undefined);
    throw Error("observer failed");
  });
  assert.throws(
    () => scope.reset(),
    (error) => error.committed === true,
  );
  assert.deepEqual(disposed, [handle]);
  assert.equal(slot.get(), undefined);
  assert.equal(owner.get(), 0);
});
test("[runtime] a failed reset preserves its resource and can be retried", () => {
  const { scope } = backends.runtime();
  let refuse = false;
  const owner = scope.owner("fallible", 0, {
    equals: (a, b) => {
      if (refuse) throw Error("reject reset");
      return Object.is(a, b);
    },
  });
  const slot = scope.resource("retained"),
    handle = { id: "retained" },
    disposed = [];
  slot.set(handle, (h) => disposed.push(h));
  owner.set(1);
  refuse = true;
  assert.throws(() => scope.reset(), /reject reset/);
  assert.equal(owner.get(), 1);
  assert.equal(slot.get(), handle);
  assert.deepEqual(disposed, []);
  refuse = false;
  scope.reset();
  assert.deepEqual(disposed, [handle]);
});
test("[runtime] reset refuses a nested transaction before releasing resources", () => {
  const { scope, runtime } = backends.runtime();
  const slot = scope.resource("nested"),
    handle = {},
    disposed = [];
  slot.set(handle, (h) => disposed.push(h));
  assert.throws(() => runtime.transaction(() => scope.reset()), /outer|nested|boundary/i);
  assert.equal(slot.get(), handle);
  assert.deepEqual(disposed, []);
});

test("[runtime] reset restores detached handles when companion writes roll back", () => {
  const { scope } = backends.runtime(),
    owner = scope.owner("extra", 0),
    slot = scope.resource("extra-resource");
  const handle = {},
    disposed = [];
  owner.set(7);
  slot.set(handle, (value) => disposed.push(value));
  const before = scope.snapshot();
  assert.throws(
    () =>
      scope.reset(() => {
        throw Error("companion failure");
      }),
    /companion failure/,
  );
  assert.deepEqual(scope.snapshot(), before);
  assert.equal(slot.get(), handle);
  assert.deepEqual(disposed, []);
  scope.reset();
  assert.deepEqual(disposed, [handle]);
});
test("[runtime] committed reset retains both notification and disposal errors", () => {
  const { scope } = backends.runtime(),
    owner = scope.owner("combined", 0),
    slot = scope.resource("combined-resource");
  const disposed = [];
  owner.set(1);
  slot.set({}, () => {
    disposed.push("done");
    throw Error("cleanup");
  });
  owner.subscribe(() => {
    throw Error("observer");
  });
  assert.throws(
    () => scope.reset(),
    (error) =>
      error.committed === true && error instanceof AggregateError && error.errors.length === 2,
  );
  assert.deepEqual(disposed, ["done"]);
  assert.equal(slot.get(), undefined);
  assert.equal(owner.get(), 0);
});

test("[runtime] scope disposal releases every captured handle after notification failure", () => {
  const { scope, runtime } = backends.runtime(),
    a = scope.resource("dispose-a"),
    b = scope.resource("dispose-b"),
    done = [];
  a.set({}, () => done.push("a"));
  b.set({}, () => done.push("b"));
  a.revision.subscribe(() => {
    throw Error("dispose observer");
  });
  assert.throws(
    () => scope.dispose(),
    (error) => error.committed === true,
  );
  assert.deepEqual(done, ["a", "b"]);
  assert.equal(a.get(), undefined);
  assert.equal(b.get(), undefined);
  assert.doesNotThrow(() => runtime.signal(1).set(2));
});

test("[runtime] reset rejects an asynchronous companion before publication", async () => {
  const { scope } = backends.runtime(),
    owner = scope.owner("async-reset", 0),
    slot = scope.resource("async-resource"),
    handle = {},
    disposed = [];
  owner.set(1);
  slot.set(handle, (h) => disposed.push(h));
  assert.throws(
    () =>
      scope.reset(async () => {
        throw Error("late companion");
      }),
    /synchronous/i,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(owner.get(), 1);
  assert.equal(slot.get(), handle);
  assert.deepEqual(disposed, []);
});

test("[runtime] scope reset only needs the public Runtime boundary", () => {
  const runtime = new Runtime();
  const publicRuntime = {
    signal: runtime.signal.bind(runtime),
    transaction: runtime.transaction.bind(runtime),
    get inTransaction() {
      return runtime.inTransaction;
    },
  };
  const scope = createScope(publicRuntime, { name: "public-contract" }),
    owner = scope.owner("value", 0);
  owner.set(2);
  assert.doesNotThrow(() => scope.reset());
  assert.equal(owner.get(), 0);
  assert.throws(() => runtime.transaction(() => scope.reset()), /outer|boundary/i);
});

test("[runtime] a callback cannot label its rolled-back reset as committed", () => {
  const { scope } = backends.runtime(),
    owner = scope.owner("commit-flag", 0),
    slot = scope.resource("commit-handle"),
    handle = {},
    disposed = [];
  owner.set(1);
  slot.set(handle, (value) => disposed.push(value));
  assert.throws(
    () =>
      scope.reset(() => {
        throw Object.assign(Error("callback failure"), { committed: true });
      }),
    /callback failure/,
  );
  assert.equal(owner.get(), 1);
  assert.equal(slot.get(), handle);
  assert.deepEqual(disposed, []);
});
