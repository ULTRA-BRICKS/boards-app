const UNCHANGED = Object.freeze([]);

/**
 * Plan field-only updates between immutable keyed snapshots before touching a view.
 * null means the consumer must rebuild; [] means no changes. Reordering is not
 * silently treated as a field update. This optional adapter retains no application
 * state and does not assume a DOM or a particular reactivity runtime.
 */
export function immutableRowDelta(before, after, keyOf, accepts = () => true) {
  if (before === after) return UNCHANGED;
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return null;
  const seen = new Set();
  let changes;
  for (let index = 0; index < after.length; index++) {
    if (!(index in before) || !(index in after)) return null;
    const previous = before[index],
      value = after[index];
    const key = keyOf(value);
    if (
      (typeof key !== 'string' && typeof key !== 'number') ||
      key === '' ||
      (typeof key === 'number' && !Number.isFinite(key)) ||
      seen.has(key) ||
      keyOf(previous) !== key
    )
      return null;
    seen.add(key);
    if (previous === value) continue;
    if (!accepts(previous, value)) return null;
    (changes ??= []).push({ key, before: previous, after: value, index });
  }
  return changes ?? UNCHANGED;
}
