import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore, workspace, mutate } from "../server/store.mjs";
import { registerProof, identity, approveAvatar, ownAvatar, propose } from "../server/identity.mjs";
import { uploadAvatar } from "../server/assets.mjs";
import { body, rawBody } from "../server/http.mjs";
import { SyncQueue } from "../packages/core/sync.mjs";

const env = { APP_ORIGIN: "https://boards.example", OWNER_EMAIL: "owner@example.test" };
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK3cAAAAASUVORK5CYII=";
async function owner() {
  const store = new MemoryStore();
  await workspace(store);
  await registerProof(
    store,
    { provider: "github", subject: "1", email: env.OWNER_EMAIL, name: "Owner", verified: true },
    { env },
  );
  return { store, user: { id: "owner", sessionCreated: Date.now() } };
}

test("review: HTTP body preserves Cyrillic split between UTF-8 chunks", async () => {
  const value = { text: "Проверка ёжика 🦔" };
  const bytes = Buffer.from(JSON.stringify(value));
  const req = {
    headers: { "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      for (const n of bytes) yield Buffer.from([n]);
    },
  };
  assert.deepEqual(await body(req), value);
});
test("review: JSON arrays/null/primitives are invalid request objects", async () => {
  for (const value of ["null", "[]", "1", '"hello"'])
    await assert.rejects(
      () => body({ body: value, headers: { "content-type": "application/json" } }),
      (e) => e.status === 400,
    );
});
test("review: byte limit counts original incoming bytes", async () => {
  const req = {
    headers: {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from([0xff, 0xff]);
    },
  };
  await assert.rejects(
    () => rawBody(req, 1),
    (e) => e.status === 413,
  );
});
test("review: a stale avatar proposal cannot overwrite the owner’s newer photo", async () => {
  const { store, user } = await owner();
  const pending = await uploadAvatar(store, { id: "danny" }, { target: user.id, image });
  const own = await uploadAvatar(store, user, { target: user.id, image });
  await assert.rejects(() => approveAvatar(store, user, pending.proposalId, true));
  assert.equal((await identity(store)).users.owner.avatarAsset, own.asset);
});
test("review: approving one photo invalidates competing pending proposals", async () => {
  const { store, user } = await owner();
  const a = await uploadAvatar(store, { id: "danny" }, { target: user.id, image });
  const b = await uploadAvatar(store, { id: "niko" }, { target: user.id, image });
  await approveAvatar(store, user, a.proposalId, true);
  await assert.rejects(() => approveAvatar(store, user, b.proposalId, true));
  assert.equal((await identity(store)).users.owner.avatarAsset, a.asset);
});
test("review: repeated linking suggestions coalesce rather than flood the inbox", async () => {
  const { store, user } = await owner();
  const input = { type: "link", target: "owner", provider: "google" };
  const a = await propose(store, { id: "danny" }, input),
    b = await propose(store, { id: "danny" }, input);
  assert.equal(a, b);
});
test("review: disposing a save queue prevents an in-flight request from rescheduling writes", async () => {
  let release;
  const states = [];
  const q = new SyncQueue({
    delay: 10000,
    send: () => new Promise((r) => (release = r)),
    onState: (x) => states.push(x),
  });
  q.configure({ enabled: true, version: 1 });
  q.change({ a: 1 });
  const sending = q.flush();
  q.change({ a: 2 });
  q.dispose();
  const before = states.length;
  release({ version: 2 });
  await sending;
  assert.equal(states.length, before);
  assert.equal(q.enabled, false);
  assert.equal(q.timer, null);
});
