import { Runtime, toExternalStore } from "../state-lib/dist/index.js";
import { createBaselineDocumentStore } from "./document-store-baseline.mjs";
import { ownJson, beginJsonDraft } from "./json-draft.mjs";

// This application adapter deliberately copies whole JSON documents. It is not
// state-lib's planned normalized/structural-sharing store or collaborative undo.
function cloneFrozen(value) {
  const message = "Document snapshots must be acyclic JSON data";
  let copy;
  try {
    copy = structuredClone(value);
  } catch (cause) {
    throw new TypeError(message, { cause });
  }
  const active = new WeakSet();
  const freeze = (object) => {
    if (object === null) return object;
    if (typeof object !== "object") {
      if (
        typeof object === "string" ||
        typeof object === "boolean" ||
        (typeof object === "number" && Number.isFinite(object))
      )
        return object;
      throw new TypeError(message);
    }
    if (active.has(object)) throw new TypeError(message);
    const prototype = Object.getPrototypeOf(object);
    if (!Array.isArray(object) && prototype !== Object.prototype && prototype !== null)
      throw new TypeError(message);
    if (Object.isFrozen(object)) return object;
    active.add(object);
    Object.values(object).forEach(freeze);
    active.delete(object);
    return Object.freeze(object);
  };
  return freeze(copy);
}

/**
 * Plain, acyclic JSON documents only; schema/size validation belongs to the app.
 * The state-lib backend owns inputs and exposes immutable committed documents.
 * read() exposes the isolated live draft inside change(); getSnapshot() always
 * exposes the last committed snapshot, even while a command is being assembled.
 * Mutator exceptions roll back. Listener failures happen AFTER commit: the runtime
 * delivers every listener then throws NotificationError with committed=true.
 * Subscriptions are observational: synchronous writes from listeners are forbidden
 * by state-lib, while the extracted mutable baseline permits recursive publication.
 * Top-level successful commands are A/B equivalent; exceptional observer behavior is
 * deliberately tested separately. The baseline also retains legacy mutable input
 * aliases, async callback hazards and acceptance of non-JSON fields; it is an
 * oracle, not a safe replacement. Callers must supply validated workspace objects
 * (or null), never primitive roots. All access after disposal throws uniformly.
 * Async callbacks are rejected synchronously; abandoned promise errors are consumed.
 */

export function createDocumentStore({ backend = "state-lib", initial = null, limit = 40 } = {}) {
  if (!["baseline", "state-lib", "state-lib-cow"].includes(backend)) throw TypeError("Unknown document backend");
  if (!Number.isSafeInteger(limit) || limit < 1) throw TypeError("History limit must be positive");
  if (backend === "baseline") return createBaselineDocumentStore({ initial, limit });
  const copyOnWrite = backend === "state-lib-cow";
  const importDocument = copyOnWrite ? ownJson : cloneFrozen;
  const runtime = new Runtime();
  const document = runtime.signal(importDocument(initial));
  const history = runtime.signal({ past: [], future: [] });
  const snapshot = runtime.derive(() =>
    Object.freeze({
      document: document.get(),
      canUndo: history.get().past.length > 0,
      canRedo: history.get().future.length > 0,
    }),
  );
  const external = toExternalStore(snapshot);
  let working,
    mutating = false,
    closed = false;
  const assertOpen = () => {
    if (closed) throw Error("Document store is disposed");
  };
  const assertIdle = () => {
    assertOpen();
    if (mutating) throw Error("Nested document mutation is not supported");
  };
  const publish = (value, nextHistory) =>
    runtime.transaction(() => {
      document.set(value);
      history.set(nextHistory);
    });
  return {
    read() {
      assertOpen();
      return mutating ? working : document.get();
    },
    getSnapshot() {
      assertOpen();
      return external.getSnapshot();
    },
    subscribe(listener) {
      assertOpen();
      return external.subscribe(listener);
    },
    get canUndo() {
      assertOpen();
      return snapshot.get().canUndo;
    },
    get canRedo() {
      assertOpen();
      return snapshot.get().canRedo;
    },
    replace(value) {
      assertIdle();
      publish(importDocument(value), { past: [], future: [] });
    },
    change(mutate) {
      assertIdle();
      const before = document.get();
      if (!before) return false;
      const draft = copyOnWrite ? beginJsonDraft(before) : null;
      working = draft ? draft.draft : structuredClone(before);
      mutating = true;
      let next;
      try {
        const result = mutate(working);
        if (result && typeof result.then === "function") {
          // The abandoned draft is isolated; consume late rejection, never publish it.
          Promise.resolve(result).catch(() => {});
          throw TypeError("Document changes must be synchronous");
        }
        next = draft ? draft.finish() : cloneFrozen(working);
      } finally {
        draft?.abort();
        working = undefined;
        mutating = false;
      }
      const past = [...history.get().past, before].slice(-limit);
      publish(next, { past, future: [] });
      return true;
    },
    undo() {
      assertIdle();
      const { past, future } = history.get();
      if (!past.length) return false;
      publish(past.at(-1), {
        past: past.slice(0, -1),
        future: [...future, document.get()].slice(-limit),
      });
      return true;
    },
    redo() {
      assertIdle();
      const { past, future } = history.get();
      if (!future.length) return false;
      publish(future.at(-1), {
        past: [...past, document.get()].slice(-limit),
        future: future.slice(0, -1),
      });
      return true;
    },
    clear() {
      assertIdle();
      publish(null, { past: [], future: [] });
    },
    dispose() {
      if (closed) return;
      assertIdle();
      runtime.dispose();
      closed = true;
    },
  };
}
