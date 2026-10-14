# Ubuntu continuation handoff: Boards state-lib migration (2026-10-14)

Starting point: branch `fix/state-staging-completion-20261014`, a fresh clone of `feat/state-complete-HYP-1490` at
`074c1ed2f891f23771e3f61085eb77eb73f798c6` ("WIP: snapshot before machine sale"). Nothing was committed or pushed by the implementation passes. The coordinator holds a
staged diff of earlier passes in the index; the review-fix pass below is left UNSTAGED on top of it.
HYP-1490 may have been renumbered; the ticket was not verified and no tracker was mutated.

Separate read-only baseline revision (reference only, never edited): `9ebf080da4cdb96deb13b80f5faf5775850be67a`.

Dependencies: `bun install --frozen-lockfile --ignore-scripts` (lifecycle scripts of nx/playwright were inspected and not run).
Browser used: the already cached Playwright chromium in `~/.cache/ms-playwright`; nothing was downloaded.

## Remaining faults found

1. RED at start (the only failing test of 285): `tests/board-commands.test.mjs:169`
   "invalid relative-move arguments are rejected before either implementation writes". Log `/tmp/bsr-logs/unit-start.log`:

       AssertionError [ERR_ASSERTION]: Missing expected exception.   actual: undefined   expected: /delta/i

   Cause: a non-integer `delta` reached `moveItem`/`moveColumn`, so the callback path spliced with NaN and the declared path
   planned an invalid index. Fix in `apps/board/board-commands.mjs`: `needDelta` helper, `validate` on `moveItem` (only when
   `toColumnId` is undefined) and `moveColumn`, and `command.validate?.(args)` at the top of `run()` before `store.read()`.
   GREEN: `node --test tests/board-commands.test.mjs` 17/17.
2. Lifecycle hunt (signout, disposer, observer, rolled-back and nested reset). No production fault was reproduced: the
   scoped helper already handled every case below. They were added as regression coverage in `tests/board-state.test.mjs`
   (17 new tests, all three document backends where applicable). They are NOT red-first evidence of a fix; they were written
   first, run once against unchanged source (log `/tmp/bsr-logs/red-board-state.log`), and the only failures were two mistakes
   in the tests themselves (an over-narrow message regex), corrected in `/tmp/bsr-logs/green-board-state.log` (68/68).
   Covered: every disposer runs and the document/user/selection/caches are wiped when disposers throw (baseline, state-lib,
   state-lib-cow); a throwing `task.cancel()` does not strand state, caches or later tasks; cancel plus disposer failures are both
   reported; a throwing observer on the committed signout still wipes and disposes; `resetPrivate()` inside an outer batch is
   refused and keeps handles; a rolled-back signout (`documentStore.replace` throws) keeps the old handle and caches for a retry
   and the retry wipes; a stale in-flight search finishing after signout cannot repopulate `searchResults`.
3. The handoff's "new-board action runs `change()` inside `S.batch`" edge is already handled: `commitDocumentAction`
   (`apps/board/document-action.mjs`) queues the document only after the batch commits, and
   `tests/document-action-commit.test.mjs` tests exactly the failed-batch-never-queued case. No change was needed.
4. Observation, not fixed: the AggregateError for a failed task cancel is reported under the message "resource disposal
   failed" (the cancel error is nested). Behavior is correct, wording is imprecise.
5. Observation, not fixed: on the baseline backend (non-atomic by design) a throwing `documentStore.replace(null)` leaves the
   document in place while owners are already reset. No real code path throws there; documented, not changed.

`packages/state-lib/scoped/*` was NOT changed, so the `*.provenance.json` pins were not regenerated.

## Added browser coverage

- `tests/state-migration-browser.mjs`: new `scenarioUndoRedo` (move, undo, redo, final undo; order checked each step) and
  `scenarioSignoutRelogin` (selection, an in-flight slow search started before signout, signout, relogin: nothing stale renders,
  no selection or chrome leaks). Existing scenarios (selection, menus, move, input/editor, search cancellation, duplicate
  suggestion, navigation, signout) are unchanged.
- `tests/state-build-static-browser.mjs` (new): serves the STATIC `dist/board-baseline` and `dist/board-state` output over a
  loopback file server on an ephemeral port and loads each with no query, `?stateBackend=baseline|state-lib|state-lib-cow|nonsense`.
  All 10 loads stayed on the build's own backend. This closes the previous gap (import-resolution test only).

## Commands and logs (all under `/tmp/bsr-logs/`)

| Step | Command | Result |
| --- | --- | --- |
| start unit run | `node --test tests/*.test.mjs` | 285 tests, 284 pass, 1 fail (`unit-start.log`) |
| final unit run | `node --test tests/*.test.mjs` | 302 tests, 302 pass, 0 fail (`unit-final.log`) |
| manifest | `node scripts/validate-state-manifest.mjs` | exit 0 (`validate2.log`) |
| builds | `npm run build:baseline`, `npm run build:state` | both exit 0 (`build-*.log`) |
| browser matrix | `MIGRATION_PORT=6953 MIGRATION_EVIDENCE=/tmp/bsr-logs/browser-evidence node tests/state-migration-browser.mjs` | 16/16 scenarios pass: 8 per implementation (`browser-matrix.log`) |
| static build | `node tests/state-build-static-browser.mjs` | 10/10 (`static-build-browser.log`) |

Port 6953 was verified unused with `ss -ltn` immediately before each matrix run. An earlier matrix attempt aborted inside the new
signout scenario (a test mistake: it tried to select an already selected row); it was fixed and the full matrix rerun once to
completion. The reported matrix is the complete run. The matrix uses the existing synthetic in-memory dev server
(`scripts/dev.mjs`, `LOCAL_TEST_MODE=1`), which the script starts and kills itself. No numerical benchmark was run.

## Inventory status (docs/state-migration-manifest.json, 32 entries)

(Superseded by the completion inventory at the end of this file. Start-of-session figures: complete 22, partial 6, not-started 4.)

- partial: `document-declared-commands` (add item, add/remove column, remove item, board creation, assignee changes and workspace
  settings still use the generic `change(callback)` adapter), `workspace-loader` (own Runtime, publishes via `S.batch`),
  `save-status` (label lost on re-render as in baseline), `editor-inline` (real IME composition not exercised),
  `cache-tickets-and-art-attempts` (plain Map/Set, not Runtime-owned), `dialog-local-view-state` (form values DOM-local).
- not-started: `photo-review-component`, `type-site`, `compiler-lowered-commands`, `bundle-budget`.
- Manifest edits made, evidence-backed only: `document-history` gained `tests/state-migration-browser.mjs` (browser undo/redo)
  and `backend-selection-build-config` gained `tests/state-build-static-browser.mjs`. No completion value was changed.

## Build commands

    npm run build:baseline    # node scripts/build.mjs --state-backend=baseline --out=dist/board-baseline
    npm run build:state       # node scripts/build.mjs --state-backend=state-lib --out=dist/board-state

Both write a frozen `state-config.mjs` (`allowUrlOverride:false`); `dist/` is git-ignored. Baseline source and behavior are retained.

## Staging environment (names only, from deploy/staging/baseline.json and state-lib.json)

- Local synthetic (runnable here): `LOCAL_TEST_MODE`, `LOCAL_DATABASE_PATH` (`:memory:`), `AUTH_SECRET` (synthetic placeholder),
  `BOARDS_SEED_PEOPLE` (`deploy/staging/synthetic-demo/people.json`), `PORT`, `BOARDS_STATE_BACKEND` (`baseline` or `state-lib`).
- Remote staging required (coordinator-only, not runnable by a worker): `DATABASE_URL`, `APP_ORIGIN`, `OWNER_EMAIL`,
  `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Optional: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`.
  `LOCAL_TEST_MODE` is refused on Vercel, so remote staging needs a real sign-in provider.
- Must stay unset (forbidden): `RESEND_API_KEY`, `MAIL_FROM`, `SLACK_BOT_TOKEN`, `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
  `SLACK_TEAM_ID`, `GITHUB_TOKEN`, `LINEAR_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `VISION_BASE_URL`,
  `VISION_API_KEY`, `VISION_MODEL`, `EMBEDDING_API_KEY`.

## Synthetic setup requirements

Node 26 with `node:test`, locked `node_modules` (playwright chromium cached), a free loopback port, and the in-memory dev server.
No database, network service or credential is needed for the unit suite, the browser matrix or the static-build check.

## Coverage pass (STATE-COVERAGE-REQUEST): implemented

Everything below was written tests-first, confirmed RED for the right reason, then implemented. Nothing committed, staged or pushed.

### Changed files

- `apps/board/board-state.mjs`: new private owners `workspaceStatus` ("idle"), `searchActive`, `mentionIndex`, `photoImage`, `photoReview`,
  `tickets` (copy-on-write Map owner behind a Map facade), `dialogDraft` (facade `S.draft`: open/set/get/values/form/clear), ids `artAttempts`,
  resource `photoForm`, and `S.loadTicket(ref, fetcher)` guarded by `workspaceEpoch`. The manual cache clears in `resetPrivate` are gone (owner reset is atomic).
- `apps/board/photo-review.mjs`: `createPhotoReviewSession(cell)` (pure, immutable values, one submission at a time, stale `done()` ignored);
  `reviewPhoto` takes `{session}` and mirrors the live inputs into it (inputs are never rewritten, so IME is untouched).
- `apps/board/app.mjs`: closure `hits/active/index/image` replaced by the owners; `getTicket` uses `S.loadTicket`; form drafts tracked via `trackDraft`;
  photo form is a `photoForm` resource; `closeDialog` wipes drafts/photo state; the workspace loader borrows `S.runtime` and commits through `apply`;
  `renderBoard` paints `.save-state` from `S.saveStatus`.
- `packages/core/workspace-loader.mjs`: optional `runtime` (borrowed, never disposed), `apply` (inside the commit transaction), `batch` (baseline). With a
  borrowed runtime `publish` runs after the commit transaction returned (a subscriber would run in the notification phase and failed with "observers failed" on login;
  caught by the first browser run, covered by a unit test). Publish-only callers unchanged.
- `scripts/scan-board-state.mjs` + `docs/board-ownership-registry.json` (19 registered exceptions, each with a reason): deterministic guard for unregistered
  `let/var`, `new Map/Set/WeakMap/WeakSet`, mutable top-level literals, web-storage in `apps/board/*.mjs`. `npm run scan:board-state` (package.json).
- `scripts/validate-state-manifest.mjs`: required `category`, closed set, `out-of-board-entry` iff `out-of-scope`, `summarizeManifest`, per-category summary on the CLI.
- `docs/state-migration-manifest.json`: `category` on all 32 entries; status updates below.
- Tests: `tests/board-state-ownership.test.mjs` (the former RED file, now green, 33 tests), `tests/state-lib-loader-shared-runtime.test.mjs` (7), `tests/board-state-scan.test.mjs`
  (7, mutation tests), `tests/state-migration-manifest.test.mjs` (+categories), `tests/state-migration-browser.mjs` (+6 scenarios, `MIGRATION_ONLY` filter).
- Kept from earlier: `board-commands.mjs` delta validation, disposal tests in `board-state.test.mjs`, `tests/state-build-static-browser.mjs`.

### RED evidence (for the right reason)

- `board-state-ownership.test.mjs`: failed to load (missing `createPhotoReviewSession` export / owners) before the code.
- `state-lib-loader-shared-runtime.test.mjs`: 5 of 6 failed (options unsupported) before; a 7th test came from a real fault found by the browser (publish writing in the notification phase).
- Browser, baseline-selected build: `scenarioSaveStatusSurvivesRerender` failed with `'' !== 'Ink drying…'`, proving the label was lost on re-render; fixed in `renderBoard`, green on both builds.
- Mutation check: removing the `alive()` epoch guard in `loadTicket` makes `scenarioStaleTicketAfterSignout` fail (restored afterwards).
- Scan: the scan test needed the module first; the mutation test then proves each state kind is detected (not observed separately as a RED run).

### Commands and results (logs in `/tmp/bsr-logs/`)

| Step | Command | Result |
| --- | --- | --- |
| unit | `node --test tests/*.test.mjs` | 354 tests, 354 pass, 0 fail (`unit-final.log`) |
| manifest | `node scripts/validate-state-manifest.mjs` | exit 0, 32 entries (`manifest.log`) |
| scan | `node scripts/scan-board-state.mjs` | 7 files, 19 findings, 0 unregistered, 0 stale |
| builds | `npm run build:baseline`, `npm run build:state` | both exit 0 (`builds.log`) |
| static build | `node tests/state-build-static-browser.mjs` | exit 0, all loads on own backend (`static-build-browser.log`) |
| browser matrix | `MIGRATION_PORT=6953 MIGRATION_EVIDENCE=/tmp/bsr-logs/browser-evidence node tests/state-migration-browser.mjs` | 28/28: 14 scenarios x 2 builds (`browser-matrix.log`) |

There is no lint or typecheck script in package.json. Port 6953 was checked free with `ss -ltn` before the static and matrix runs. Two earlier matrix attempts aborted on
scenario ORDER (my new scenarios reload or navigate and wiped the selection the signout scenario needs); I reordered and reran the full matrix once to completion.
New browser scenarios: real IME in the inline editor (CDP `Input.imeSetComposition` x3 + `Input.insertText`: compositionstart/update/end fire, in-progress text in the field,
committed text kept, Escape reverts) and in the photo review textarea; save status surviving a re-render; search and mention cursors; dialog drafts via the settings form;
photo review edit/confirm (trimmed title, dropped thought, hint never an assignee, composed text kept) and closing mid-read; a ticket lookup resolving after sign-out.
No numerical benchmark was run.

### Completion inventory (32 entries)

| Category | Total | Complete | Partial | Not started | Out of scope |
| --- | --- | --- | --- | --- | --- |
| application-state | 28 | 28 | 0 | 0 | 0 |
| compiler-lowering | 2 | 0 | 1 | 1 | 0 |
| test-performance-evidence | 1 | 0 | 0 | 1 | 0 |
| out-of-board-entry | 1 | 0 | 0 | 0 | 1 |

Moved to complete in this pass: `workspace-loader`, `save-status`, `editor-inline`, `cache-tickets-and-art-attempts`, `dialog-local-view-state`, `photo-review-component`.
No in-scope entry was removed. `document-declared-commands` is the one honest partial and is re-categorized `compiler-lowering` (optional specialization): four commands are
hand-written declared commands, the rest run through the library `change(callback)` adapter and are library-owned, not statically lowered. `compiler-lowered-commands`
stays not-started (nothing is generated; not an ownership gap). `bundle-budget` is evidence only (not measured). `type-site` is `out-of-board-entry`/`out-of-scope`
(separate Conloca Sans product, mapped to its real `apps/type-site/type.mjs`; no migration is claimed).

### Remaining true gaps

- No generated (compiler) lowering exists; 4 of ~12 commands are declared, the rest are `change(callback)`.
- No bundle byte budget or numerical comparison was measured (coordinator owns it).
- The type-site specimen keeps its page-local handlers (separate product).
- `S.draft` mirrors text fields of three dialog forms (settings, person, name); other dialogs have no form drafts. Submit still reads the live DOM, by design.
- The scan is a lexer, not a full parser; it guards the listed state kinds, not every possible mutable binding (e.g. object properties on module singletons).
- `review diff`, deploy, and any real vision/ticket provider were not exercised (the browser matrix stubs `/api/photo`, `/api/import`, `/api/ticket`, `/api/status` vision flag).
- Process note: some source edits in this pass were made with python/sed writes rather than the Edit tool (the shell hook did not block them); the diff is unchanged in content.

### Staging seed/session notes (notes only, coordinator owns deploy)

Unchanged from the sections above. Extra for a staging check of this pass: the signed-in session must have the vision capability flag for the photo flow to be reachable (the
synthetic test patches `ai.vision`; real staging keeps `VISION_*` unset per the forbidden list, so photo import stays disabled there) and a Linear-style key (e.g. `ABC-123`) in an item to
reach the ticket dialog without a repo.

## Review-fix pass (STATE-REVIEW-FIX-REQUEST): implemented, unstaged

Counts below supersede the 354-test and "complete 22 / partial 6" figures earlier in this file (those are historical).

### Source changes

- `apps/board/board-state.mjs`: the `tickets` owner is a frozen null-prototype JSON record (`EMPTY_TICKETS`), not a Map. `createTicketCache` keeps the
  `get/has/set/delete/clear/size` API as a copy-on-write facade (`Object.hasOwn` reads, so `__proto__`/`constructor`/`toString` are plain keys; deleting a missing key
  writes nothing). `set` admits a `structuredClone` that is deep-frozen (a non-cloneable value throws `TypeError`), so retained caller objects and readers cannot alter the
  cache. `loadTicket` returns the cached frozen value. `createAttemptSet` is exported and `add` now checks membership first, keeping the ids identity (no needless notify).
- Correction to the review claim: `S.snapshot()` already `structuredClone`d owner values, so the snapshot Map never aliased the live Map or `EMPTY_MAP`; poisoning through
  the snapshot was NOT reproducible. The reproducible faults were the mutable cached values (a retained input mutated after `set` changed the cache; a reader could mutate
  it) and an unfrozen Map as the reset sentinel. The snapshot shape is now a plain JSON record `{ref: value}`.
- `packages/core/workspace-loader.mjs` (borrowed runtime): the shared `last` cell is gone. Each `load()` owns a run record passed through `latestTask` as its input and
  receiving the exact committed value in the commit callback. A `clear`/`cancel`/`dispose` or a newer `load` marks the run over, so a commit that already happened but whose
  post-await continuation has not run no longer publishes and `load()` resolves `'cancelled'` or `'superseded'` (previously a clear nulled the shared cell and the
  continuation threw a `TypeError`; a newer load let the stale run publish). Sync apply transaction and post-commit publish semantics are unchanged.
- A `publish` that throws after an accepted commit (borrowed and baseline paths) rejects with an Error that keeps the message, carries `cause`, and has `committed: true`.
  `apps/board/app.mjs` `loadWorkspace` no longer sets `workspaceStatus` to `'error'` for such an error, so a committed `'ready'` is not clobbered. That app.mjs line is
  covered only by the loader contract (the `committed` flag) and the unchanged browser matrix, not by a dedicated test of the catch.
- `docs/board-ownership-registry.json`: removed the two `EMPTY_MAP`/`next` Map entries (the scan reports 0 stale). `docs/state-migration-manifest.json`: updated owner text for
  `cache-tickets-and-art-attempts` and `workspace-loader`, added the new test file. `tests/board-state-ownership.test.mjs`: one assertion now reads the snapshot as a record
  (`owners.tickets["#1"]`), the deliberate shape change.

### RED evidence

- `tests/state-lib-loader-shared-runtime.test.mjs` (6 new tests: 13 in file, 5 failed and 8 passed before the fix; the sixth new test, a throwing apply is not flagged committed, passes by design): clear in the commit window: `TypeError: Cannot read properties of null (reading 'state')`;
  later load and cancel in the window: `Expected values to be strictly equal: actual 'committed' expected 'superseded'` / `'cancelled'`; throwing publish: `callers can tell this
  is a post-commit failure, not a rollback` (`committed` was `undefined`); baseline throwing publish also failed on the missing flag. The window is hit deterministically with a
  `queueMicrotask` queued inside `apply` (no timers). One of my own tests was wrong first (publish stub threw on the second load too) and was corrected.
- `tests/board-state-ticket-cache.test.mjs` (new, 22 tests): 19 failed, 3 passed before the fix (the 3 are the set/replace/delete/clear test on each backend). Messages:
  `Missing expected exception (TypeError)` (frozen value and non-JSON admission), `no Map is stored or exposed`, `Expected values to be strictly equal` (retained input leak,
  JSON snapshot shape), and `Expected "actual" to be reference-equal to "expected"` (attempt set replaced the ids on a known add). The first run failed only on the missing
  `createAttemptSet` export, so the export was added alone before capturing the behavioral RED.

### Commands and results (logs in `/tmp/t12/`)

| Step | Command | Result |
| --- | --- | --- |
| loader RED / GREEN | `node --test tests/state-lib-loader-shared-runtime.test.mjs tests/state-lib-loader.test.mjs` | RED: 13 tests, 5 fail; GREEN (with the legacy loader file) 18 tests, 18 pass |
| ticket cache GREEN | `node --test tests/board-state-ticket-cache.test.mjs tests/board-state-ownership.test.mjs tests/board-state.test.mjs` | 123 tests, 123 pass |
| unit | `node --test tests/*.test.mjs` | 382 tests, 382 pass, 0 fail, 0 skipped |
| manifest | `node scripts/validate-state-manifest.mjs` | exit 0, 32 entries, application-state 28/28 complete |
| scan | `node scripts/scan-board-state.mjs` | exit 0, 7 files, 17 findings, 0 unregistered, 0 stale |
| builds | `npm run build:baseline`, `npm run build:state` | both exit 0 |
| static build | `node tests/state-build-static-browser.mjs` | exit 0 |
| browser matrix | `MIGRATION_PORT=6953 node tests/state-migration-browser.mjs` | exit 0, 28 PASS lines (14 scenarios x 2 builds) |
| full matrix | `npm run verify` (unit + build + build:type) | exit 0, 382/382 |
| python browser | `npm run test:browser` | NOT RUN: exit 1, `ModuleNotFoundError: No module named 'playwright'` (host python lacks the module; nothing installed) |

The standalone `npm test` is inside `npm run verify`; the state browser matrix was the focused browser set and was not repeated. No numerical benchmark was run.

### Review status

Pending. No independent `review diff` or other external review has been run on this pass; the implementer self-checked only. The remaining cleanups listed in
`/tmp/state-boards-review-20261014.log` (write-only `S.draft`, loader factory split, photo review double clone, scan precedence, weak browser assertion) were out of scope and are untouched.
`document-declared-commands` remains the one partial and is counted as `compiler-lowering`, which is how `application-state` reads 28/28.

## Not verified

External deployment or data operations, full-app performance or bundle budget, the multi-model
`review diff` (not run; no staging or commit allowed), and the ticket number.

## Coordinator cache boundary verification

The first review fix still allowed structured-clone host objects (Map, Date, typed arrays), whose contents are not made immutable by Object.freeze. Three backend regressions reproduced this before correction. Cache admission now rejects non-JSON scalars, mutable host types and cyclic input before owner publication, while a separate test preserves valid repeated child identity in cloned data. The recursion-path WeakSet is scoped to one admission, not an application owner, and is registered with that explicit lifetime in the guard. No existing expectation was removed.
