// Ownership-completion contract (HYP-1490, coverage pass). Written BEFORE the implementation:
// caches, workspace status, dialog drafts, search/mention cursors, the photo draft and the
// photo-review session are Runtime-scope owners on all document backends, are wiped atomically by
// resetPrivate(), and never leak a DOM handle into a snapshot.
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
import { createBoardState } from "../apps/board/board-state.mjs";
import { createPhotoReviewSession } from "../apps/board/photo-review.mjs";

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
const draft = () => ({
  board: {
    title: "From photo",
    columns: [
      {
        id: "col",
        title: "Launch",
        items: [
          { id: "a", text: "Ship", tag: "D", assignees: ["x"] },
          { id: "b", text: "Unclear", tag: "", assignees: [] },
        ],
      },
      { id: "empty", title: "Nothing", items: [] },
    ],
  },
  warnings: [],
});

for (const backend of ALL) {
  test(`[${backend}] ticket and art caches live in private scope owners`, () => {
    const S = make(backend);
    S.tickets.set("#1", { title: "t" });
    S.artAttempts.add("c:t");
    const snap = S.snapshot().private;
    assert.equal(snap.owners.tickets["#1"].title, "t", "tickets is a scope owner (a frozen JSON record), visible in the snapshot");
    assert.deepEqual(snap.ids.artAttempts, ["c:t"], "art attempts reuse the shipped ids collection");
    assert.equal(S.tickets.has("#1"), true);
    S.artAttempts.add("c:t");
    assert.equal(S.artAttempts.size, 1, "adding twice keeps one entry");
    S.tickets.delete("#1");
    assert.equal(S.tickets.size, 0);
  });

  test(`[${backend}] loadTicket caches a fresh result and never caches a failure`, async () => {
    const S = make(backend);
    let calls = 0;
    const fetcher = async () => ({ title: "ok", n: ++calls });
    assert.equal((await S.loadTicket("#1", fetcher)).n, 1);
    assert.equal((await S.loadTicket("#1", fetcher)).n, 1, "second lookup is served from the owner");
    await assert.rejects(S.loadTicket("#2", async () => { throw Error("down"); }), /down/);
    assert.equal(S.tickets.has("#2"), false);
  });

  test(`[${backend}] a ticket lookup finishing after sign-out cannot repopulate the next session's cache`, async () => {
    const S = make(backend);
    let release;
    const gate = new Promise((r) => (release = r));
    const pending = S.loadTicket("#private", async () => { await gate; return { title: "old user's ticket" }; });
    S.resetPrivate();
    release();
    assert.equal((await pending).title, "old user's ticket", "the caller still gets its value");
    assert.equal(S.tickets.size, 0, "but the reset session is not repopulated");
  });

  test(`[${backend}] workspaceStatus is a private owner reset to idle`, () => {
    const S = make(backend);
    assert.equal(S.workspaceStatus.get(), "idle");
    S.workspaceStatus.set("loading");
    assert.equal(S.snapshot().private.owners.workspaceStatus, "loading");
    S.resetPrivate();
    assert.equal(S.workspaceStatus.get(), "idle");
  });

  test(`[${backend}] dialog view state is owned, wiped on reset, and a draft is plain data`, () => {
    const S = make(backend);
    S.searchActive.set(3);
    S.mentionIndex.set(2);
    S.photoImage.set("data:image/jpeg;base64,AAAA");
    S.draft.open("settings-form", { space: "Ws" });
    S.draft.set("repo", "a/b");
    assert.deepEqual({ ...S.draft.values() }, { space: "Ws", repo: "a/b" });
    assert.equal(S.draft.form(), "settings-form");
    assert.equal(S.draft.get("repo"), "a/b");
    assert.ok(Object.isFrozen(S.draft.values()), "drafts are immutable values");
    S.draft.set("repo", "a/b"); // unchanged write keeps identity
    const kept = S.draft.values();
    S.draft.set("repo", "a/b");
    assert.equal(S.draft.values(), kept);
    S.resetPrivate();
    assert.equal(S.searchActive.get(), 0);
    assert.equal(S.mentionIndex.get(), 0);
    assert.equal(S.photoImage.get(), null);
    assert.equal(S.draft.form(), "");
    assert.deepEqual({ ...S.draft.values() }, {});
    assert.equal(S.photoReview.get(), null);
  });

  test(`[${backend}] draft.clear empties a form without touching other owners`, () => {
    const S = make(backend);
    S.boardId.set("keep");
    S.draft.open("person-form", { name: "Ada", email: "ada@example.test" });
    S.draft.clear();
    assert.equal(S.draft.form(), "");
    assert.equal(S.boardId.get(), "keep");
  });

  test(`[${backend}] the photo review form is a disposable resource, not owner data`, () => {
    const S = make(backend);
    const form = { tagName: "FORM", parentNode: {}, onsubmit() {} };
    const disposed = [];
    S.photoForm.set(form, (f) => disposed.push(f.tagName));
    assert.equal(S.snapshot().private.resources.photoForm, true);
    assert.doesNotThrow(() => JSON.stringify(S.snapshot()));
    S.resetPrivate();
    assert.deepEqual(disposed, ["FORM"], "sign-out disposes the editor handle");
    assert.equal(S.photoForm.get(), undefined);
  });

  test(`[${backend}] the photo review session is wiped by resetPrivate and holds no DOM`, () => {
    const S = make(backend);
    const review = createPhotoReviewSession(S.photoReview);
    review.open(draft());
    review.setTitle("Edited");
    assert.equal(S.snapshot().private.owners.photoReview.title, "Edited");
    S.resetPrivate();
    assert.equal(S.photoReview.get(), null);
    assert.equal(review.view(), null);
  });
}

test("photo review session: edits are immutable and the source draft is never touched", () => {
  const S = make("state-lib");
  const review = createPhotoReviewSession(S.photoReview);
  const source = draft();
  review.open(source);
  const before = review.view();
  review.setText(0, 0, "Ship it");
  assert.notEqual(review.view(), before, "an edit replaces the value");
  assert.ok(Object.isFrozen(review.view()));
  assert.equal(before.columns[0].items[0].text, "Ship", "earlier view is unchanged");
  assert.equal(source.board.columns[0].items[0].text, "Ship", "caller draft is untouched");
  review.setText(0, 0, "Ship it");
  assert.equal(review.view(), review.view(), "no-op edit keeps identity");
});

test("photo review session: submit applies the exact legacy confirmation rules", () => {
  const S = make("state-lib");
  const review = createPhotoReviewSession(S.photoReview);
  review.open(draft());
  review.setTitle("  Reviewed launch  ");
  review.setText(0, 0, "  Ship the reviewed app ");
  review.setHint(0, 0, " D ");
  review.setKeep(0, 1, false);
  const { value } = review.submit();
  assert.equal(value.title, "Reviewed launch");
  assert.deepEqual(value.columns.map((c) => c.id), ["col"], "empty columns are dropped");
  assert.deepEqual(value.columns[0].items.map((i) => i.text), ["Ship the reviewed app"]);
  assert.deepEqual(value.columns[0].items[0].assignees, [], "an unverified hint never becomes an assignee");
  assert.equal(value.columns[0].items[0].tag, "D");
  assert.equal(value.columns[0].items[0].id, "a", "untouched item fields are preserved");
});

test("photo review session: validation errors mirror the form and do not start a submission", () => {
  const S = make("state-lib");
  const review = createPhotoReviewSession(S.photoReview);
  review.open(draft());
  review.setTitle("  ");
  assert.throws(() => review.submit(), /Name the page and its columns/);
  assert.equal(review.view().submitting, false);
  review.setTitle("ok");
  review.setColumnTitle(0, "");
  assert.throws(() => review.submit(), /Name the page and its columns/);
  review.setColumnTitle(0, "Back");
  review.setKeep(0, 0, false);
  review.setKeep(0, 1, false);
  assert.throws(() => review.submit(), /Name the page and its columns/, "at least one thought must be kept");
});

test("photo review session: only one submission at a time and a reset invalidates its completion", () => {
  const S = make("state-lib");
  const review = createPhotoReviewSession(S.photoReview);
  review.open(draft());
  const first = review.submit();
  assert.equal(review.view().submitting, true);
  assert.equal(review.submit(), null, "a double submit is ignored while one is in flight");
  first.done();
  assert.equal(review.view().submitting, false);
  const second = review.submit();
  S.resetPrivate();
  assert.doesNotThrow(() => second.done(), "completing after sign-out is a no-op");
  assert.equal(S.photoReview.get(), null);
  review.open(draft());
  const third = review.submit();
  review.open(draft());
  third.done();
  assert.equal(review.view().submitting, false, "a stale completion cannot clear a newer review");
  assert.equal(review.view().consent, false);
});

test("photo review session: consent and cancel", () => {
  const S = make("baseline");
  const review = createPhotoReviewSession(S.photoReview);
  assert.equal(review.view(), null);
  review.open(draft());
  assert.equal(review.view().consent, false);
  review.setConsent(true);
  assert.equal(review.view().consent, true);
  review.close();
  assert.equal(review.view(), null);
  assert.equal(review.submit(), null, "closed session cannot submit");
});

test("photo review session works over a plain cell for standalone use", async () => {
  const { createPlainCell } = await import("../packages/state-lib/scoped/scope-core.mjs");
  const review = createPhotoReviewSession(createPlainCell(null));
  review.open(draft());
  review.setTitle("Solo");
  assert.equal(review.submit().value.title, "Solo");
});

for (const backend of ALL) {
  test(`[${backend}] saveStatus (save-status) is a private owner that sign-out empties`, () => {
    const S = make(backend);
    S.saveStatus.set("saving");
    assert.equal(S.snapshot().private.owners.saveStatus, "saving");
    S.resetPrivate();
    assert.equal(S.saveStatus.get(), "", "the next session never starts with the previous label");
  });
}
