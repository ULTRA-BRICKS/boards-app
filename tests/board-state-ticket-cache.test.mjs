// Ticket cache immutability contract. The tickets owner holds a frozen null-prototype JSON record (not a Map), values are
// cloned and deep-frozen at cache admission, and the S.tickets facade keeps its get/has/set/delete/clear/size API.
// Snapshots are clones, so nothing reachable from S.snapshot() or a retained caller object can alter the cache.
import test from "node:test";
import assert from "node:assert/strict";
import { Runtime } from "../packages/state-lib/dist/index.js";
import { createDocumentStore } from "../packages/core/document-store.mjs";
import { createScope } from "../packages/state-lib/scoped/scope.mjs";
import { createBaselineScope } from "../packages/state-lib/scoped/scope-baseline.mjs";
import {
  createDebouncedLatestTask,
  createBaselineDebouncedLatestTask,
} from "../packages/state-lib/scoped/debounced-latest.mjs";
import { createBoardState, createAttemptSet } from "../apps/board/board-state.mjs";

const kit = {
  Runtime,
  createDocumentStore,
  createScope,
  createBaselineScope,
  createDebouncedLatestTask,
  createBaselineDebouncedLatestTask,
};
const make = (document) =>
  createBoardState({
    kit,
    backends: { workspace: document === "baseline" ? "baseline" : "state-lib", document },
  });
const ALL = ["baseline", "state-lib", "state-lib-cow"];

for (const backend of ALL) {
  test(`[${backend}] a retained caller object cannot alter a cached ticket after set`, () => {
    const S = make(backend);
    const input = { title: "t", labels: ["a"] };
    S.tickets.set("#1", input);
    input.title = "changed";
    input.labels.push("b");
    assert.equal(S.tickets.get("#1").title, "t");
    assert.deepEqual(S.tickets.get("#1").labels, ["a"]);
  });

  test(`[${backend}] a cached ticket is deeply frozen, so a reader cannot alter it`, () => {
    const S = make(backend);
    S.tickets.set("#1", { title: "t", labels: ["a"] });
    const read = S.tickets.get("#1");
    assert.throws(() => { read.title = "x"; }, TypeError);
    assert.throws(() => read.labels.push("b"), TypeError);
    assert.equal(S.tickets.get("#1").title, "t");
  });

  test(`[${backend}] the tickets snapshot is a JSON record and mutating it changes neither this nor a later session`, () => {
    const S = make(backend);
    S.tickets.set("#1", { title: "t" });
    const owner = S.snapshot().private.owners.tickets;
    assert.equal(owner instanceof Map, false, "no Map is stored or exposed");
    assert.deepEqual(JSON.parse(JSON.stringify(owner)), { "#1": { title: "t" } });
    owner["#1"].title = "poisoned";
    owner["#2"] = { title: "injected" };
    assert.equal(S.tickets.get("#1").title, "t");
    assert.equal(S.tickets.has("#2"), false);
    S.tickets.clear();
    const empty = S.snapshot().private.owners.tickets;
    empty["#3"] = { title: "poisoned reset" };
    S.resetPrivate();
    assert.equal(S.tickets.size, 0, "the reset sentinel is not writable through a snapshot");
    assert.equal(make(backend).tickets.size, 0, "a new session starts empty");
  });

  test(`[${backend}] ticket references that collide with Object.prototype members are plain keys`, () => {
    const S = make(backend);
    for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      assert.equal(S.tickets.has(key), false, `${key} absent before set`);
      assert.equal(S.tickets.get(key), undefined);
    }
    S.tickets.set("__proto__", { polluted: true });
    assert.equal(S.tickets.has("__proto__"), true);
    assert.equal(S.tickets.get("__proto__").polluted, true);
    assert.equal(S.tickets.size, 1);
    assert.equal({}.polluted, undefined, "Object.prototype untouched");
    assert.equal(S.tickets.has("toString"), false);
    S.tickets.set("constructor", { n: 1 });
    assert.equal(S.tickets.size, 2);
    S.tickets.delete("__proto__");
    assert.equal(S.tickets.has("__proto__"), false);
    assert.equal(S.tickets.size, 1);
    assert.equal(JSON.stringify(S.snapshot().private.owners.tickets), '{"constructor":{"n":1}}');
  });

  test(`[${backend}] set replaces, delete of a missing key is a no-op, clear empties`, () => {
    const S = make(backend);
    S.tickets.set("a", { v: 1 });
    S.tickets.set("a", { v: 2 });
    assert.equal(S.tickets.size, 1);
    assert.equal(S.tickets.get("a").v, 2);
    S.tickets.delete("missing");
    assert.equal(S.tickets.size, 1);
    S.tickets.set("b", 5);
    assert.equal(S.tickets.get("b"), 5, "non-object JSON values are admitted");
    S.tickets.clear();
    assert.equal(S.tickets.size, 0);
    assert.equal(S.tickets.get("a"), undefined);
  });

  test(`[${backend}] loadTicket returns a value that equals the cached one and signout still clears`, async () => {
    const S = make(backend);
    const fetched = { title: "ok" };
    const loaded = await S.loadTicket("#1", async () => fetched);
    fetched.title = "mutated after fetch";
    assert.equal(loaded.title, "ok");
    assert.equal(S.tickets.get("#1").title, "ok");
    S.resetPrivate();
    assert.equal(S.tickets.size, 0);
  });

  test(`[${backend}] a value that is not plain JSON data is rejected at admission, not stored`, () => {
    const S = make(backend);
    assert.throws(() => S.tickets.set("#1", { fn() {} }), TypeError);
    assert.equal(S.tickets.has("#1"), false);
  });
}

test("adding a known art attempt keeps the ids identity and does not notify", () => {
  const calls = [];
  const ids = { list: ["a"], peek() { return this.list; }, replace(next) { calls.push(next); this.list = next; }, clear() {} };
  const attempts = createAttemptSet(ids);
  const before = ids.peek();
  attempts.add("a");
  assert.equal(ids.peek(), before);
  assert.deepEqual(calls, [], "no replace for a known attempt");
  attempts.add("b");
  assert.deepEqual(ids.peek(), ["a", "b"]);
  assert.equal(calls.length, 1);
});

for (const backend of ALL) {
  test(`[${backend}] cache admission rejects mutable structured-clone types before changing the owner`, () => {
    const S = make(backend);
    S.tickets.set("kept", {title:"kept"});
    const cycle = {}; cycle.self = cycle;
    for (const value of [new Map([["x",1]]), new Set([1]), new Date(), new Uint8Array([1]), {n:1n}, {n:Infinity}, cycle]) {
      assert.throws(() => S.tickets.set("invalid", value), /JSON/i);
      assert.equal(S.tickets.has("invalid"), false);
      assert.equal(S.tickets.get("kept").title, "kept");
    }
    S.resetPrivate();
  });
}

test("valid JSON-shaped shared children remain accepted without caller ownership", () => {
  const S = make("state-lib"), child = {title:"shared"};
  S.tickets.set("shared", {a:child,b:child});
  child.title="outside";
  assert.equal(S.tickets.get("shared").a.title,"shared");
  assert.equal(S.tickets.get("shared").a,S.tickets.get("shared").b);
  S.resetPrivate();
});
