import { clone } from "./model.mjs";

/** Extracted pre-migration document/history policy, retained as the A/B oracle. */
export function createBaselineDocumentStore({ initial = null, limit = 40 } = {}) {
  let document = initial,
    past = [],
    future = [],
    closed = false;
  const listeners = new Set();
  let snapshot = { document, canUndo: false, canRedo: false };
  const publish = () => {
    snapshot = { document, canUndo: past.length > 0, canRedo: future.length > 0 };
    for (const listener of listeners) listener();
  };
  const assertOpen = () => {
    if (closed) throw Error("Document store is disposed");
  };
  return {
    read() {
      assertOpen();
      return document;
    },
    getSnapshot() {
      assertOpen();
      return snapshot;
    },
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get canUndo() {
      assertOpen();
      return past.length > 0;
    },
    get canRedo() {
      assertOpen();
      return future.length > 0;
    },
    replace(value) {
      assertOpen();
      document = value;
      past = [];
      future = [];
      publish();
    },
    change(mutate) {
      assertOpen();
      if (!document) return false;
      past.push(clone(document));
      if (past.length > limit) past.shift();
      future = [];
      mutate(document);
      publish();
      return true;
    },
    undo() {
      assertOpen();
      if (!past.length) return false;
      future.push(clone(document));
      document = past.pop();
      publish();
      return true;
    },
    redo() {
      assertOpen();
      if (!future.length) return false;
      past.push(clone(document));
      document = future.pop();
      publish();
      return true;
    },
    clear() {
      assertOpen();
      document = null;
      past = [];
      future = [];
      publish();
    },
    dispose() {
      closed = true;
      document = null;
      past = [];
      future = [];
      listeners.clear();
    },
  };
}
