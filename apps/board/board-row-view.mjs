/** Field-only view updates (completion and text) from immutable document snapshots; structural edits keep full rendering. */
const sameExcept = (a, b, except) => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && (except.includes(key) || a[key] === b[key]))
  );
};
// A removed selection falls back to the first board, exactly like board().
const shown = (document, boardId) =>
  Math.max(
    0,
    document.boards.findIndex((board) => board.id === boardId),
  );

/** One template for the completion button label, shared with the full renderer. */
export const taskLabel = (done, text) => (done ? 'Reopen ' : 'Complete ') + text;

/**
 * before is the document the view currently shows. sameHints(a, b) says whether two item records render the same
 * unresolved-assignee controls, because those are derived from the text.
 */
export function planRowChanges(before, after, boardId, diffRows, sameHints) {
  if (before === after) return [];
  if (!before || !after || !sameExcept(before, after, ['boards']) || before.boards.length !== after.boards.length)
    return null;
  const index = shown(after, boardId);
  if (index !== shown(before, boardId) || before.boards.some((board, i) => i !== index && board !== after.boards[i]))
    return null;
  const a = before.boards[index],
    b = after.boards[index];
  if (!a || !b || !sameExcept(a, b, ['columns']) || a.columns.length !== b.columns.length) return null;
  const plan = [];
  for (let i = 0; i < b.columns.length; i++) {
    const prev = a.columns[i],
      next = b.columns[i];
    if (prev === next) continue;
    if (!sameExcept(prev, next, ['items'])) return null;
    const updates = diffRows(
      prev.items,
      next.items,
      (row) => row.id,
      (x, y) =>
        typeof y.done === 'boolean' &&
        typeof y.text === 'string' &&
        sameExcept(x, y, ['done', 'text']) &&
        (x.text === y.text || sameHints(x, y)),
    );
    if (updates === null) return null;
    for (const update of updates) plan.push({ ...update, columnId: next.id });
  }
  return plan;
}

/**
 * Row locate/apply callbacks for patchKeyedRows. textHTML(row) is the full renderer's own task text element template.
 * A change flagged `restore` rebuilds that element although the document row did not change: the inline editor left
 * plain text and browser editing residue (contenteditable, inline style) on it, which the full renderer would discard.
 */
export function boardRowView(root, textHTML) {
  return {
    locate(change) {
      const row = root.ownerDocument.getElementById('item-' + change.key);
      const button = row?.querySelector('[data-done]'),
        text = row?.querySelector('[data-edit="item"]');
      return row && root.contains(row) && row.dataset.col === change.columnId && button && text && {row, button, text};
    },
    apply({after, before, restore}, {row, button, text}) {
      row.classList.toggle('done', after.done);
      button.setAttribute('aria-pressed', String(after.done));
      button.setAttribute('aria-label', taskLabel(after.done, after.text));
      if (restore || before.text !== after.text) text.outerHTML = textHTML(after);
    },
  };
}
