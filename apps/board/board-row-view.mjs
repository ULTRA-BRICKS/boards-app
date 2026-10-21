/** Field-only view updates from immutable document snapshots; structural edits keep full rendering. */
const sameExcept = (a, b, except) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && (key === except || a[key] === b[key]))
  );
};

export function planCompletionChanges(before, after, boardId, diffRows) {
  if (before === after) return [];
  if (!before || !after || !sameExcept(before, after, 'boards') || before.boards.length !== after.boards.length)
    return null;
  // A removed selection falls back to the first board, exactly like board().
  const index = Math.max(
    0,
    after.boards.findIndex((board) => board.id === boardId),
  );
  if (before.boards.some((board, i) => i !== index && board !== after.boards[i])) return null;
  const a = before.boards[index],
    b = after.boards[index];
  if (!a || !b || !sameExcept(a, b, 'columns') || a.columns.length !== b.columns.length) return null;
  const plan = [];
  for (let i = 0; i < b.columns.length; i++) {
    const prev = a.columns[i],
      next = b.columns[i];
    if (prev === next) continue;
    if (!sameExcept(prev, next, 'items')) return null;
    const updates = diffRows(
      prev.items,
      next.items,
      (row) => row.id,
      (x, y) => typeof y.done === 'boolean' && sameExcept(x, y, 'done'),
    );
    if (updates === null) return null;
    for (const update of updates) plan.push({ ...update, columnId: next.id });
  }
  return plan;
}

export function patchCompletionRows(root, changes, beforeApply = () => {}) {
  if (changes === null) return false;
  const ready = [];
  for (const change of changes) {
    const row = root.ownerDocument.getElementById('item-' + change.key);
    const button = row?.querySelector('[data-done]');
    if (!row || !root.contains(row) || row.dataset.col !== change.columnId || !button) return false;
    ready.push({ row, button, done: change.after.done, text: change.after.text });
  }
  // Preserve the full renderer cleanup-before-write contract, after validating all targets.
  beforeApply();
  // Every affected node was verified before the first visible write.
  for (const { row, button, done, text } of ready) {
    row.classList.toggle('done', done);
    button.setAttribute('aria-pressed', String(done));
    button.setAttribute('aria-label', (done ? 'Reopen ' : 'Complete ') + text);
  }
  return true;
}
