import test from 'node:test';
import assert from 'node:assert/strict';
import { planCompletionChanges, patchCompletionRows } from '../apps/board/board-row-view.mjs';
import { immutableRowDelta } from '../packages/state-lib/dom/immutable-row-delta.mjs';
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
const change = (doc, rows) => ({
  ...doc,
  boards: [{ ...doc.boards[0], columns: [{ ...doc.boards[0].columns[0], items: rows }] }],
});
test('only changed completion rows are planned; unchanged records retain their identity', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items,
    after = change(before, [{ ...rows[0], done: true }, rows[1]]);
  const plan = planCompletionChanges(before, after, 'b', immutableRowDelta);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, 'a');
  assert.equal(plan[0].columnId, 'c');
  assert.equal(rows[0].done, false);
});
test('non-completion, reorder, header and external-field changes keep the full renderer', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items;
  for (const after of [
    change(before, [rows[1], rows[0]]),
    change(before, [{ ...rows[0], text: 'new' }, rows[1]]),
    { ...before, people: [{ id: 'person' }] },
    { ...before, boards: [{ ...before.boards[0], title: 'Other' }] },
  ])
    assert.equal(planCompletionChanges(before, after, 'b', immutableRowDelta), null);
});
test('missing DOM targets fail before the first visible write', () => {
  let writes = 0;
  const row = {
    dataset: { col: 'c' },
    querySelector: () => ({ setAttribute: () => writes++ }),
    classList: { toggle: () => writes++ },
  };
  const root = {
    contains: (value) => value === row,
    ownerDocument: { getElementById: (id) => (id === 'item-a' ? row : null) },
  };
  assert.equal(
    patchCompletionRows(root, [
      { key: 'a', columnId: 'c', after: { done: true, text: 'A' } },
      { key: 'missing', columnId: 'c', after: { done: true, text: 'B' } },
    ]),
    false,
  );
  assert.equal(writes, 0);
});

test('identical snapshots produce an empty plan without consulting row keys', () => {
  const document = base();
  assert.deepEqual(
    planCompletionChanges(document, document, 'b', () => {
      throw Error('unexpected scan');
    }),
    [],
  );
});
test('a stale board selection follows the same first-board fallback as the renderer', () => {
  const before = base(),
    rows = before.boards[0].columns[0].items;
  const after = change(before, [{ ...rows[0], done: true }, rows[1]]);
  assert.deepEqual(
    planCompletionChanges(before, after, 'removed-board', immutableRowDelta),
    planCompletionChanges(before, after, 'b', immutableRowDelta),
  );
});

test('renderer cleanup runs before any DOM write and a failed cleanup leaves rows intact', () => {
  const events = [];
  const row = {
    dataset: { col: 'c' },
    querySelector: () => ({ setAttribute: () => events.push('attribute') }),
    classList: { toggle: () => events.push('class') },
  };
  const root = { contains: (value) => value === row, ownerDocument: { getElementById: () => row } };
  const changes = [{ key: 'a', columnId: 'c', after: { done: true, text: 'A' } }];
  assert.throws(
    () =>
      patchCompletionRows(root, changes, () => {
        events.push('cleanup');
        throw Error('release failed');
      }),
    /release failed/,
  );
  assert.deepEqual(events, ['cleanup']);
  events.length = 0;
  assert.equal(
    patchCompletionRows(root, changes, () => events.push('cleanup')),
    true,
  );
  assert.deepEqual(events, ['cleanup', 'class', 'attribute', 'attribute']);
});
