/**
 * Checked view boundary for a plan from immutableRowDelta. Every target is located before the first
 * write; if any is missing, false is returned before beforeApply or apply runs and the caller rebuilds.
 * beforeApply runs once after verification (also for an accepted empty plan) so a caller keeps its
 * cleanup-before-write ordering; it must not replace or detach a located target. Nothing is rolled
 * back: an exception from beforeApply leaves the rows unwritten, one from apply may leave earlier rows
 * written, and either way the caller must render in full. The application supplies locate/apply; this
 * adapter holds no state and assumes no DOM.
 */
export function patchKeyedRows(changes, { locate, apply, beforeApply }) {
  if (changes === null) return false;
  const targets = [];
  for (const change of changes) {
    const target = locate(change);
    // Only null, undefined and false mean "not found": 0 and '' are real targets.
    if (target == null || target === false) return false;
    targets.push(target);
  }
  beforeApply?.();
  for (let index = 0; index < changes.length; index++) apply(changes[index], targets[index]);
  return true;
}
