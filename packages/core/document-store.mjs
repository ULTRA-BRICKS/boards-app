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

export function createDocumentStore({ backend = "state-lib", initial = null, limit = 40 } = {}) {
  if (!["baseline", "state-lib", "state-lib-cow"].includes(backend)) throw TypeError("Unknown document backend");
  if (!Number.isSafeInteger(limit) || limit < 1) throw TypeError("History limit must be positive");
  if (backend === "baseline") return createBaselineDocumentStore({ initial, limit });
  const publication = createDocumentPublication(new Runtime(), { initial, limit });
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
