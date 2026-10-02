/**
 * Runtime-backed application state scope (HYP-1490): owners, id selections, epochs and
 * opaque-handle resources on top of the EXISTING state-lib Runtime; not a second kernel.
 *
 * Invariants: the injected runtime is shared with other state (e.g. the document store)
 * and is never disposed by the scope; reset() is one Runtime transaction, so no listener
 * observes a half-reset scope; resource handles are disposed only after that commit.
 * All allocation (owner/ids/epoch/resource) must happen outside a transaction.
 */
import { buildScope } from "./scope-core.mjs";

/**
 * @param {import("../dist/index.js").Runtime} runtime
 * @param {{ name: string }} options
 */
export function createScope(runtime, { name }) {
  return buildScope({
    name,
    makeCell: (initial, equals) => runtime.signal(initial, equals),
    batch: (fn) => runtime.transaction(fn),
    atomic: true,
    commitVersion: () => runtime.version,
    assertResetBoundary() {
      if (runtime.inTransaction) throw Error("Scope reset requires an outer transaction boundary");
      runtime.transaction(() => {}); // Public boundary validates disposed/pure/notification contexts before handles detach.
    },
  });
}
