import test from 'node:test';
import assert from 'node:assert/strict';
import { SyncQueue } from '../packages/core/sync.mjs';
import { ownJson } from '../packages/core/json-draft.mjs';

test('save enqueue can retain a certified snapshot while send still receives its own mutable copy', async () => {
  const immutable = ownJson({ rows: [{ text: 'first' }] });
  let calls = 0,
    sent;
  const queue = new SyncQueue({
    capture: (value) => {
      calls++;
      assert.equal(value, immutable);
      return value;
    },
    send: async ({ document }) => {
      sent = document;
      document.rows[0].text = 'sender mutation';
      return { version: 1 };
    },
  });
  queue.configure({ enabled: true });
  queue.change(immutable);
  assert.equal(calls, 1);
  assert.equal(queue.document, immutable);
  await queue.flush();
  assert.notEqual(sent, immutable);
  assert.equal(immutable.rows[0].text, 'first');
  assert.equal(queue.document, immutable);
  queue.dispose();
});
test('capture failure cannot replace the prior pending revision', () => {
  const queue = new SyncQueue({
    capture: (value) => {
      if (value.bad) throw Error('capture failed');
      return structuredClone(value);
    },
    send: async () => ({ version: 1 }),
  });
  queue.change({ text: 'previous' });
  assert.throws(() => queue.change({ bad: true }), /capture failed/);
  assert.equal(queue.sequence, 1);
  assert.deepEqual(queue.document, { text: 'previous' });
  queue.dispose();
});
test('a newer retained snapshot and delayed mutable send payload never overwrite one another', async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const first = ownJson({ text: 'first' }),
    second = ownJson({ text: 'second' });
  let submitted;
  const queue = new SyncQueue({
    capture: (value) => value,
    send: async ({ document }) => {
      submitted = document;
      return pending;
    },
  });
  queue.configure({ enabled: true });
  queue.change(first);
  const send = queue.flush();
  queue.change(second);
  submitted.text = 'sender changed';
  release({ version: 1 });
  await send;
  assert.equal(queue.document, second);
  assert.equal(queue.ack, 1);
  assert.equal(queue.sequence, 2);
  assert.equal(first.text, 'first');
  queue.dispose();
});
