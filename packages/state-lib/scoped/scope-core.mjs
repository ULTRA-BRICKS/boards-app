/**
 * Backend-independent scope mechanism (HYP-1490). NOT a reactive kernel: every piece of
 * reactive state is a "cell" ({get, peek, set, update, subscribe}) supplied by the
 * backend, and `batch(fn)` is the backend's atomic-write primitive. scope.mjs plugs in
 * Runtime signals + runtime.transaction; scope-baseline.mjs plugs in plain mutable
 * cells + a synchronous `fn()`, so the two builds differ only in the state substrate.
 *
 * Invariants:
 *  - a key is unique across owners, ids, epochs and resources of one scope;
 *  - ids values are frozen arrays; a write that does not change content keeps the
 *    previous reference (so cells with Object.is equality do not notify);
 *  - resource handles live only in a closure, never in a cell; cells hold a revision;
 *  - reset() runs its state writes inside one batch and disposes handles AFTER it;
 *  - snapshot() is JSON-safe and never contains a handle.
 */

export const EMPTY_IDS = Object.freeze([]);

/** Minimal synchronous cell for the baseline backend; listeners may write (not atomic). */
export function createPlainCell(initial, equals = Object.is) {
  let value = initial;
  const listeners = new Set();
  const set = (next) => {
    const previous = value;
    if (equals(previous, next)) return;
    value = next;
    for (const listener of [...listeners]) listener(next, previous);
  };
  return {
    get: () => value,
    peek: () => value,
    set,
    update: (fn) => set(fn(value)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Returns `current` itself when content is unchanged, otherwise a new frozen array. */
function nextList(current, list) {
  if (sameList(current, list)) return current;
  return list.length ? Object.freeze(list) : EMPTY_IDS;
}

function createIdsSelection(cell) {
  const write = (list) => cell.set(nextList(cell.get(), list));
  return {
    get: () => cell.get(),
    peek: () => cell.peek(),
    has: (id) => cell.get().includes(id),
    get size() {
      return cell.get().length;
    },
    toggle(id) {
      const current = cell.get();
      write(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
    },
    only: (id) => write([id]),
    replace: (ids) => write([...new Set(ids)]),
    clear: () => write([]),
    subscribe: (listener) => cell.subscribe(listener),
  };
}

function createEpoch(cell) {
  return {
    get: () => cell.get(),
    peek: () => cell.peek(),
    bump: () => cell.update((n) => n + 1),
    guard() {
      const captured = cell.get();
      return () => cell.peek() === captured;
    },
    subscribe: (listener) => cell.subscribe(listener),
  };
}

/** Opaque handle slot. Same-handle set() only swaps the disposer (never disposes it). */
function createResourceSlot(revision) {
  let present = false,
    handle,
    dispose;
  const bump = () => revision.update((n) => n + 1);
  const empty = () => {
    present = false;
    handle = dispose = undefined;
  };
  /** Detaches state now, returns the pending dispose call (or null when empty). */
  const release = () => {
    if (!present) return null;
    const [h, d] = [handle, dispose];
    empty();
    bump();
    return () => d?.(h);
  };
  const slot = {
    get() {
      revision.get();
      return handle;
    },
    set(next, disposer) {
      if (next === undefined)
        throw TypeError("resource.set() needs a handle; use clear() to empty the slot");
      if (present && Object.is(handle, next)) {
        dispose = disposer ?? dispose;
        return;
      }
      try {
        if (present) dispose?.(handle);
      } finally {
        present = true;
        handle = next;
        dispose = disposer;
        bump();
      }
    },
    clear: () => release()?.(),
    take() {
      const taken = handle;
      release();
      return taken;
    },
    revision: {
      get: () => revision.get(),
      peek: () => revision.peek(),
      subscribe: (listener) => revision.subscribe(listener),
    },
  };
  const prepareRelease = () => {
    if (!present) return null;
    const saved = { handle, dispose };
    let staged = false;
    return {
      stage() {
        empty();
        staged = true;
        bump();
      },
      rollback() {
        if (staged) {
          present = true;
          handle = saved.handle;
          dispose = saved.dispose;
        }
      },
      finish() {
        if (staged) saved.dispose?.(saved.handle);
      },
    };
  };
  return { slot, release, prepareRelease, isPresent: () => present };
}

/** structuredClone doubles as the "is this plain data" check; handles must use resource(). */
function plainOwnerValue(key, value) {
  try {
    return structuredClone(value);
  } catch (cause) {
    throw new TypeError(
      `Scope owner "${key}" holds a non-cloneable value (function/DOM-like handle); store it with resource() instead`,
      { cause },
    );
  }
}

/** Runs every disposer even if some throw; returns the collected errors. */
function runAll(thunks) {
  const errors = [];
  for (const thunk of thunks) {
    try {
      thunk?.();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

const fromEntries = (map, project) =>
  Object.fromEntries([...map].map(([key, item]) => [key, project(item, key)]));

export function buildScope({
  name,
  makeCell,
  batch,
  assertResetBoundary = () => {},
  atomic = false,
  commitVersion = () => 0,
}) {
  const keys = new Set();
  const owners = new Map(),
    idLists = new Map(),
    epochs = new Map(),
    resources = new Map();
  const claim = (key) => {
    if (typeof key !== "string" || !key) throw TypeError("Scope keys must be non-empty strings");
    if (keys.has(key)) throw Error(`Scope "${name}" already has a member named "${key}"`);
    keys.add(key);
  };
  const register = (map, key, entry) => {
    claim(key);
    map.set(key, entry);
    return entry;
  };
  const resetState = () => {
    for (const { cell, initial } of owners.values()) cell.set(initial);
    for (const cell of idLists.values()) cell.set(EMPTY_IDS);
    for (const epoch of epochs.values()) epoch.bump();
  };
  const releaseAtBoundary = (writeTogether, afterCommit) => {
    // A resource release needs the final commit outcome, not a nested savepoint.
    assertResetBoundary();
    const pending = [...resources.values()].map((entry) => entry.prepareRelease()).filter(Boolean);
    const version = commitVersion();
    let failure;
    try {
      batch(() => {
        for (const entry of pending) entry.stage();
        const result = writeTogether();
        if (result && typeof result.then === "function") {
          Promise.resolve(result).catch(() => {});
          throw TypeError("Scope reset companions must be synchronous");
        }
      });
    } catch (error) {
      failure = { error };
    }
    if (failure && atomic && commitVersion() === version) {
      for (const entry of pending) entry.rollback();
      throw failure.error;
    }
    // Notification errors are post-commit: retain the captured disposers and run all.
    const errors = runAll([afterCommit, ...pending.map((entry) => () => entry.finish())]);
    if (!errors.length && failure) throw failure.error;
    if (errors.length) {
      const error = new AggregateError(
        failure ? [failure.error, ...errors] : errors,
        `Scope "${name}" reset: resource disposal failed`,
      );
      error.committed = true;
      throw error;
    }
  };
  return {
    name,
    owner(key, initial, { equals } = {}) {
      const cell = makeCell(initial, equals);
      register(owners, key, { cell, initial });
      return cell;
    },
    ids(key) {
      claim(key);
      const cell = makeCell(EMPTY_IDS);
      idLists.set(key, cell);
      return createIdsSelection(cell);
    },
    epoch(key) {
      claim(key);
      const epoch = createEpoch(makeCell(0));
      epochs.set(key, epoch);
      return epoch;
    },
    resource(key) {
      claim(key);
      const entry = createResourceSlot(makeCell(0));
      resources.set(key, entry);
      return entry.slot;
    },
    batch: (fn) => batch(fn),
    reset(writeTogether = () => {}, afterCommit = () => {}) {
      return releaseAtBoundary(() => {
        resetState();
        return writeTogether();
      }, afterCommit);
    },
    snapshot() {
      return {
        owners: fromEntries(owners, ({ cell }, key) => plainOwnerValue(key, cell.peek())),
        ids: fromEntries(idLists, (cell) => [...cell.peek()]),
        epochs: fromEntries(epochs, (epoch) => epoch.peek()),
        resources: fromEntries(resources, (entry) => entry.isPresent()),
      };
    },
    dispose() {
      return releaseAtBoundary(
        () => {},
        () => {},
      );
    },
  };
}
