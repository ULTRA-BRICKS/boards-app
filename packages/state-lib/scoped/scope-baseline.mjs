/**
 * Baseline (no Runtime) twin of scope.mjs: plain mutable variables and synchronous
 * listener sets, used as the A/B oracle for the baseline build.
 *
 * Differences by design: batch(fn) is just fn(), so there is no rollback and reset() is
 * SEQUENTIAL, NOT ATOMIC (listeners can observe a partially reset scope); listeners may
 * write during notification. Everything else follows the scope.mjs contract.
 */
import { buildScope, createPlainCell } from "./scope-core.mjs";

/** @param {{ name: string }} options */
export function createBaselineScope({ name }) {
  return buildScope({
    name,
    makeCell: (initial, equals) => createPlainCell(initial, equals),
    batch: (fn) => fn(),
  });
}
