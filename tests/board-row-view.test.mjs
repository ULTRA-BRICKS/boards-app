import test from 'node:test';
import assert from 'node:assert/strict';
import { planRowChanges, boardRowView, taskLabel } from '../apps/board/board-row-view.mjs';
import { patchKeyedRows } from '../packages/state-lib/dom/keyed-row-patch.mjs';
import { immutableRowDelta } from '../packages/state-lib/dom/immutable-row-delta.mjs';
const stable = () => true;
const patchBoardRows = (root, changes, { textHTML, beforeApply }) =>
  patchKeyedRows(changes, { ...boardRowView(root, textHTML), beforeApply });
const base = () => ({
  people: [],
  boards: [
    {
      id: 'b',
      title: 'Board',
      columns: [
        {
          id: 'c',
          title: 'Column',
          items: [
            { id: 'a', text: 'A', done: false },
            { id: 'b', text: 'B', done: false },
          ],
        },
      ],
    },
  ],
});
const change0 = (doc, rows) => ({
  ...doc,
  boards: [{ ...doc.boards[0], columns: [{ ...doc.boards[0].columns[0], items: rows }] }],
});
test('only changed completion rows are planned; unchanged records retain their identity', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items,
    after = change0(before, [{ ...rows[0], done: true }, rows[1]]);
  const plan = planRowChanges(before, after, 'b', immutableRowDelta, stable);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, 'a');
  assert.equal(plan[0].columnId, 'c');
  assert.equal(rows[0].done, false);
});
test('unsupported-field, reorder, header and external-field changes keep the full renderer', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items;
  for (const after of [
    change0(before, [rows[1], rows[0]]),
    change0(before, [{ ...rows[0], tag: 'new' }, rows[1]]),
    { ...before, people: [{ id: 'person' }] },
    { ...before, boards: [{ ...before.boards[0], title: 'Other' }] },
  ])
    assert.equal(planRowChanges(before, after, 'b', immutableRowDelta, stable), null);
});
const fakeRow = (events, col = 'c') => {
  const part = (name) => ({
    setAttribute: (key, value) => events.push(`${name}.${key}=${value}`),
    removeAttribute: (key) => events.push(`${name}.-${key}`),
    set innerHTML(value) {
      events.push(`${name}.html=${value}`);
    },
    set outerHTML(value) {
      events.push(`${name}.element=${value}`);
    },
  });
  const parts = { '[data-done]': part('button'), '[data-edit="item"]': part('text') };
  return {
    dataset: { col },
    querySelector: (selector) => parts[selector] ?? null,
    classList: { toggle: (name, on) => events.push(`row.${name}=${on}`) },
  };
};
const fakeRoot = (row) => ({
  contains: (value) => value === row,
  ownerDocument: { getElementById: (id) => (id === 'item-a' ? row : null) },
});
const view = { textHTML: (row) => `<<${row.text}>>` };
const change = (key, before, after) => ({ key, columnId: 'c', before, after });
test('missing DOM targets fail before the first visible write', () => {
  const events = [];
  const row = fakeRow(events);
  assert.equal(
    patchBoardRows(
      fakeRoot(row),
      [
        change('a', { done: false, text: 'A' }, { done: true, text: 'A' }),
        change('missing', { done: false, text: 'B' }, { done: true, text: 'B' }),
      ],
      view,
    ),
    false,
  );
  assert.deepEqual(events, []);
});
test('a wrong column or a row without its text node also rejects the whole plan', () => {
  const events = [];
  assert.equal(
    patchBoardRows(
      fakeRoot(fakeRow(events, 'other')),
      [change('a', { done: false, text: 'A' }, { done: true, text: 'A' })],
      view,
    ),
    false,
  );
  const bare = { dataset: { col: 'c' }, querySelector: () => null, classList: { toggle: () => events.push('x') } };
  assert.equal(
    patchBoardRows(fakeRoot(bare), [change('a', { done: false, text: 'A' }, { done: true, text: 'A' })], view),
    false,
  );
  assert.deepEqual(events, []);
});
test('a text change rewrites the linked text and the shared completion label; unchanged text keeps its markup', () => {
  const events = [];
  const row = fakeRow(events);
  patchBoardRows(
    fakeRoot(row),
    [change('a', { done: false, text: 'A' }, { done: false, text: 'See #5' })],
    view,
  );
  assert.deepEqual(events, [
    'row.done=false',
    'button.aria-pressed=false',
    'button.aria-label=Complete See #5',
    'text.element=<<See #5>>',
  ]);
  events.length = 0;
  patchBoardRows(fakeRoot(row), [change('a', { done: false, text: 'A' }, { done: true, text: 'A' })], view);
  assert.deepEqual(events, ['row.done=true', 'button.aria-pressed=true', 'button.aria-label=Reopen A']);
  assert.equal(taskLabel(true, 'x'), 'Reopen x');
  assert.equal(taskLabel(false, 'x'), 'Complete x');
});
test('a restored row rebuilds its text element, editor residue included, although its document row did not change (cancel or no-change edit)', () => {
  const events = [];
  const same = { done: false, text: 'A #7' };
  patchBoardRows(fakeRoot(fakeRow(events)), [{ ...change('a', same, same), restore: true }], view);
  assert.deepEqual(events.slice(-1), ['text.element=<<A #7>>']);
  assert(!events.some((event) => event.startsWith('text.') && event !== 'text.element=<<A #7>>'), 'only the whole element is replaced');
});
test('a text edit that changes unresolved assignee hints keeps the full renderer', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items;
  const after = change0(before, [{ ...rows[0], text: 'A @someone' }, rows[1]]);
  assert.equal(planRowChanges(before, after, 'b', immutableRowDelta, () => false), null);
  assert.equal(planRowChanges(before, after, 'b', immutableRowDelta, () => true).length, 1);
});
test('text and completion on one row plan together; a text field of another type does not', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items;
  const both = change0(before, [{ ...rows[0], text: 'A2', done: true }, rows[1]]);
  assert.equal(planRowChanges(before, both, 'b', immutableRowDelta, stable).length, 1);
  const bad = change0(before, [{ ...rows[0], text: 5 }, rows[1]]);
  assert.equal(planRowChanges(before, bad, 'b', immutableRowDelta, stable), null);
});
test('a different displayed board between the two snapshots keeps the full renderer', () => {
  const one = base().boards[0];
  const before = { people: [], boards: [one, { ...one, id: 'z' }] };
  const after = { people: [], boards: [{ ...one, id: 'z' }, one] };
  assert.equal(planRowChanges(before, after, 'z', immutableRowDelta, stable), null);
});
test('identical snapshots produce an empty plan without consulting row keys', () => {
  const document = base();
  assert.deepEqual(
    planRowChanges(document, document, 'b', () => {
      throw Error('unexpected scan');
    }),
    [],
  );
});
test('a stale board selection follows the same first-board fallback as the renderer', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items;
  const after = change0(before, [{ ...rows[0], done: true }, rows[1]]);
  assert.deepEqual(
    planRowChanges(before, after, 'removed-board', immutableRowDelta, stable),
    planRowChanges(before, after, 'b', immutableRowDelta, stable),
  );
});

test('renderer cleanup runs before any DOM write, also for an accepted empty plan, and a failed cleanup leaves rows intact', () => {
  const events = [];
  const row = fakeRow(events);
  const changes = [change('a', { done: false, text: 'A' }, { done: true, text: 'A' })];
  assert.throws(
    () =>
      patchBoardRows(fakeRoot(row), changes, {
        ...view,
        beforeApply: () => {
          events.push('cleanup');
          throw Error('release failed');
        },
      }),
    /release failed/,
  );
  assert.deepEqual(events, ['cleanup']);
  events.length = 0;
  assert.equal(patchBoardRows(fakeRoot(row), changes, { ...view, beforeApply: () => events.push('cleanup') }), true);
  assert.deepEqual(events.slice(0, 2), ['cleanup', 'row.done=true']);
  events.length = 0;
  assert.equal(patchBoardRows(fakeRoot(row), [], { ...view, beforeApply: () => events.push('cleanup') }), true);
  assert.deepEqual(events, ['cleanup']);
});
