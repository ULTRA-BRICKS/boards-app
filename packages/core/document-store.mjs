import { Runtime } from "../state-lib/dist/index.js";
import { createBaselineDocumentStore } from "./document-store-baseline.mjs";
import { beginJsonDraft, beginCopiedJson } from "./json-draft.mjs";
import { createDocumentPublication } from "./document-publication.mjs";

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

/** An injected `runtime` is shared with other state (e.g. a scope) so both can be updated in
 * one runtime.transaction; the store never disposes a runtime it did not create. */
function borrowRuntime(runtime) {
  const subscriptions = new Set();
  return {
    signal(initial, equals) {
      const cell = runtime.signal(initial, equals);
      return { ...cell, subscribe(listener) {
        const stop = cell.subscribe(listener);
        const release = () => { stop(); subscriptions.delete(release); };
        subscriptions.add(release);
        return release;
      } };
    },
    dispose() {
      if (runtime.inTransaction) throw Error("Cannot dispose a document during a transaction");
      // Use the public write boundary to reject notification/pure-phase cleanup.
      try { runtime.transaction(() => {}); }
      catch (error) { if (error.code !== "STATE_DISPOSED") throw error; }
      for (const release of [...subscriptions]) release();
    },
  };
}

export function createDocumentStore({ backend = "state-lib", initial = null, limit = 40, runtime } = {}) {
  if (!["baseline", "state-lib", "state-lib-cow"].includes(backend)) throw TypeError("Unknown document backend");
  if (!Number.isSafeInteger(limit) || limit < 1) throw TypeError("History limit must be positive");
  if (backend === "baseline") return createBaselineDocumentStore({ initial, limit });
  const publication = createDocumentPublication(runtime ? borrowRuntime(runtime) : new Runtime(), { initial, limit });
  publication.change = (mutate) => publication.transact((before, expose) => {
    const tx = backend === "state-lib-cow" ? beginJsonDraft(before) : beginCopiedJson(before);
    expose(tx.draft);
    try {
      const result = mutate(tx.draft);
      if (result && typeof result.then === "function") {
        Promise.resolve(result).catch(() => {});
        throw TypeError("Document changes must be synchronous");
      }
      return tx.finish();
    } finally { tx.abort(); }
  });
  return publication;
}
