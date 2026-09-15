# Boards delivery roadmap

## Current checkpoint — accounts and privacy, September 15
Public build `00c85bc1b7ef1a22`: no Slack JSON upload, noindex headers/meta, anonymous read-only previews remain available. Account source is not deployed; the exact blockers are in [ACCOUNTS-RELEASE-GATES.md](docs/ACCOUNTS-RELEASE-GATES.md). Local checks: 222 unit tests, strict account types, lint/format, eight account views at four widths with axe checks in Chromium and WebKit. Current independent review attempt returned the configured provider weekly usage limit.

Next gates: receive explicitly approved corporate domains/initial owner; establish least-privilege database and server-only mail credentials; install the Boards Slack app; deploy a real outbox scheduler; integrate the signed-in board/migration path; verify live email/history and finish source review/merge. Existing notebook access is preserved. Older progress sections below are historical, not the current deployment state.

Updated: 2026-09-10. This is the execution ledger, not a claim that tested adapters are a deployed product. [Tracking issue #1](https://github.com/alex-mextner/boards-app/issues/1) · [Review and evidence](docs/REVIEW-2026-09-10.md).

## Delivery order and acceptance gates

| Stage | Priority | Scope and acceptance gate | Current status |
|---|---|---|---|
| R0 — Recover and verify | P0 | Reachable source commits; fresh checkout builds both sites; logs tied to exact SHAs | Done: recovered the orphan tree, fixed startup and established native CI |
| R1 — Paper interface | P0 | No app masthead/logo; approved ink/paper hierarchy; image avatars on right; dashed assign control; discoverable mobile/keyboard navigation; independent font site | Approved direction retained. Chromium and WebKit touch checks pass; physical iOS and real-profile review remain |
| R2 — Cloud and sign-in | P0 | Configured cloud opens automatically; otherwise setup first. Real sign-in plus deployed save/reload across sessions | Readiness and cloud/test isolation verified. Real deployment/OAuth/email configuration remains blocked |
| R3 — People and confirmations | P1 | @ creation/assignment; provisional avatars visible to uploader, canonical only after owner approval; explicit provider proof; cross-board task view | Stale/competing-avatar and repeated-request bugs fixed; unresolved hints preserved. Live provider proof and complete recovery remain |
| R4 — Workspace search | P1 | Real lexical + semantic retrieval; context boosts; duplicate suggestions; indexed illustration metadata; evaluated EN/RU queries | Actual E5 evaluation: 13/15 Recall@3 vs lexical 6/15. Opposite-action duplicate guard added. Hosted embeddings and broader evaluation remain |
| R5 — Tickets and accounts | P1 | GitHub issue/PR and Linear recognition/preview; authorized Slack directory; explicit idempotent backlink comments | Fixture contracts verified; live token/scopes and actual provider runs remain separate |
| R6 — Visual content and sharing | P1 | Semantic library reuse then bounded generation; reviewed photo-to-new-board; current deterministic previews for all share scopes | Editable photo review and multiline focus rendering verified. Live generation/vision and broader preview cases remain |
| R7 — Ship and maintain | Release gate | Two independent hosted sites, README screenshots, reproducible dependencies, backups/recovery, rollback and live smoke tests | README evidence and no-Git deployment targets available; not released |

## Invariants

The board is a handwritten sheet, not a dashboard with decorative lettering. Retain the approved screenshots' warm paper, blue ink, large headings and quiet rules. Do not hide required actions behind hover-only or undiscoverable gestures. Missing avatars are image silhouettes, not fabricated real portraits. The font specimen has a separate build/deployment, not a board tab.

Atomic commits, verified refs, no force pushes. Preserve the real Neon workspace. Do not publish secrets, personal contact exports, real profile photos, databases or generated font binaries. An uploaded tree is not a push until a reachable commit and branch reference exist.

Account linking requires proof of control, not matching email. Proposed photos cannot overwrite newer canonical photos. Semantic results require real vectors, not hash vectors. OAuth/mail/model fixtures do not close live-integration gates. Whole-workspace CAS is not CRDT collaboration. Nx remains the task runner; runtime claims must match tested Node APIs.

## GitHub retry protocol

Check the official status API and the failing component, but distinguish cached status, connector errors, authorization and local network/DNS restrictions. Retry transient failures with bounded backoff (roughly 2, 5, 15, 30 seconds), doing useful local work between rounds. After ambiguous writes, read before retrying to avoid duplicate effects. Confirm final ref/file contents and CI against the exact SHA. This describes work during the active session, not unattended monitoring.

## Completed checkpoints

1. `95648aa` — roadmap committed before recovery. Initial main had only README; application objects existed in orphan tree `29f479efbdd15865ddd2415c5f9ec843f6218050`.
2. `bf97e7` — recovered source, removed unverified claims, added actual CI. Native browser testing exposed a parse error despite passing backend tests.
3. `6ee1c44` — fixed startup and added guarded bootstrap, browser-module syntax checks, caret/draft preservation and mobile column tabs. [Run 34488301726](https://github.com/alex-mextner/boards-app/actions/runs/34488301726): 65 Node tests and 27 native browser checks.
4. `a74b4a9` — refused mixed test/cloud configuration; validated readiness and shared bootstrap. [Run 34489588055](https://github.com/alex-mextner/boards-app/actions/runs/34489588055): 71 Node tests and both jobs passed.
5. `ef5166f` — automated sample screenshot publication with a source/run manifest and in-memory font validation. README images are actual Chromium output.
6. `963ce23` — self-contained original-source type specimen, suitable for independent static hosting; not a font binary.
7. `fe8405d`, `d721c9b` — avatar approval races, repeat linking, UTF-8 chunk decoding, disposed queue writes, active-draft loss, stale UI responses and lost assignee hints fixed. Photo review is now a form instead of a JSON editor.
8. `0094449`, `c65206f` — actual multilingual model evaluation and conservative opposite-action/stopword fixes. [Measured run 34500828958](https://github.com/alex-mextner/boards-app/actions/runs/34500828958): 15 public tasks and 15 queries; not a production-quality benchmark.
9. `fb36de0`, `11be9ee` — isolated no-Git static Vercel deployment and alternative Neon Node 24 function target; code/build/HTTP checks, not a completed authenticated deployment.
10. `29922cc` — [run 34501918744](https://github.com/alex-mextner/boards-app/actions/runs/34501918744): **92 Node tests; 27 main Chromium + 9 review Chromium + 7 WebKit touch checks; eight font instances; both builds passed**. WebKit uses a simulated viewport, not a physical iPhone.

## Current blocker and next work

R2 still needs a real hosted project, sign-in configuration and two-user cloud smoke test. Vercel's zero-argument deploy action is rejected for required arguments absent from its exposed schema. Its alternate static-import action also rejects the GitHub HTML source URL. Neon Functions was investigated and its deployment action rejected a mounted ZIP path; no function was created. CLI targets can publish without GitHub, but need an authenticated executable deployment environment. See the review for the exact attempts.

The Neon workspace was read again without modification: document version 1, one board, three people, fifteen items. A connector SQL read is not a deployed application-to-database round-trip.

Remaining refinements: live approved profile images and provider identities, real email delivery, bounded image/vision configuration, larger semantic evaluation and indexing, account recovery/retention, dependency lockfiles and hosted release checks. Keep these gates open rather than marking them complete from mocked tests.

## Active delivery plan — 2026-09-13 (supersedes older execution status)
Read AGENTS.md, docs/USER_RULES.json and docs/PROCESS.md first. Main source is still 0dd04be; the polished prototype exists in a separate uncommitted worktree and is not deployed yet.

| Step | Work | Completion evidence | Current state |
|---|---|---|---|
| P0 | Classify interruptions and make work recoverable | PROCESS.md, USER_RULES.json, AGENTS.md, local HANDOFF | Documents written; checkpoint commit pending |
| P1 | Review the actual prototype changes, preservation of input during loading/saving, private-safe SWR | Tests with real exit codes; no private data in public shell cache; regression cases for every found loss | 96 unit / 13 Chromium / 12 WebKit fixture groups observed; additional race checks needed |
| P2 | Finish visual/interaction corrections: assignments, initials, N+2, active navigation, stack, icons, completion | Native screenshots, keyboard/touch and accessibility, no uncaught errors | Working locally; screenshots require final review |
| P3 | Bound loading and interaction regressions | Before/after cold and repeat metrics, SW lifecycle checks, asset budgets, no hidden network waits | Baseline captured; final build measurements pending |
| P4 | Commit/review and publish prototype to current Vercel project | Clean reviewed diff, CI, public build ID, actual unmocked save + independent read + reload | Not yet published |
| P5 | Update README/screenshots/issues and handoff | Exact URL/build/SHA and clear scope; no leaked editing key or real portraits in Git | Pending P4 |
| F1 | Integrate recovered full Bun app, authentication and providers | Separate PR #2 / issue #6 gates | Not part of a falsely claimed prototype completion |

User-reported prototype issues are tracked in #5; full-product gaps in #6. A working prototype with better UX must not imply that live OAuth, account linking, semantic AI or messenger OG have been shipped.

Process acceptance: a remote `exit 0` is not sufficient if a shell command masked test failure. Rate limits are handled with pauses, failed mutations are read back before retry, and explicit safety blocks are not bypassed. No fixed cause/timer is assigned to Thinking failed without evidence.

## 2026-09-15 evening: paper depth and share-card release
Public browser build is now `634694f79261ec34`, Vercel deployment `dpl_XKtn6r7ZBXeEcNYKM9vEx4knd3nQ` on the existing gamma address.
- Done and live: opaque active sheet in front of true neighboring-paper layers; one fresh-sheet fallback; keyboard focus/current-page state; contrast correction.
- Done and live: crawler-readable `/s/` URLs, server-rendered metadata and 1200×630 PNGs for board/column/item/selection/space, current-state reads, 404 after revocation. No LLM dependency.
- Verified: 149 unit cases; 15 Chromium + 14 WebKit groups; nine recovery scenarios per engine; 1/2/3/6 pages at seven widths in each engine. Public unmocked save/read/offline/retry and exact user's board read passed. Five share scopes and updated/revoked images checked over HTTPS.
- Not closed: independent source-review/commit/merge gate. One bounded attempt on the previously configured GLM backend again timed out for all three roles. Do not fabricate a reviewer verdict or bypass the hook.
- Remaining product gates: authenticated accounts/linking/email; actual workspace integrations and backlinks; semantic/AI/image/photo workflows; full Bun/Nx consolidation and whole-application 2000+/80% coverage. Recipient messenger caching is not a server-controlled guarantee.
Release evidence and screenshots: docs/STACK-AND-PREVIEWS-2026-09-15.md. New code is staged/preserved locally; documentation commits and public deployment are separate from merged source delivery.
