# Boards delivery roadmap

Updated: 2026-09-10. This file is the execution ledger, not a promise that an adapter or screenshot is a deployed product. Each stage is complete only when its acceptance checks have evidence.

Tracking issue: [#1](https://github.com/alex-mextner/boards-app/issues/1).

## Delivery order

| Stage | Priority | Scope | Acceptance gate | Status |
|---|---|---|---|---|
| R0 — Recover and verify | P0 | Recover previously uploaded Git objects into a reachable commit; preserve main; run source/build/tests in CI; remove unverified claims | Fresh checkout contains the application, both apps build, tests have real logs tied to a SHA | Done: source recovery + native CI |
| R1 — Paper interface | P0 | No app header/logo; faithful paper/ink hierarchy; image avatars on the right; dashed assign control; useful page-edge navigation; mobile layout | Actual desktop/mobile screenshots, keyboard and touch tests, no clipping; type site separate | Working implementation + native desktop/mobile checks; visual/Safari review remains |
| R2 — Cloud and sign-in | P0 | Configured cloud opens automatically; otherwise setup first. Durable Neon records; Google/GitHub/Slack or email login; no silent local persistence | Deployed save/reload across sessions, successful real login, correct setup/error states, no public credentials | In progress: readiness and test/cloud isolation verified; live deployment blocked |
| R3 — People and confirmations | P1 | @ selection/create; own avatar; proposed avatar visible immediately only to uploader; approval; explicit provider linking; cross-board person tasks | Ownership/CSRF/replay tests, third party cannot steal account or replace approved photo, browser confirmation tests | Fixture/backend tests and basic browser flows pass; live proof/approval edge cases remain |
| R4 — Workspace search | P1 | Lexical + true semantic retrieval; current-column/board priority; duplicate dropdown; illustration metadata/vector reuse; multilingual provider adapters | Labeled RU/EN queries and duplicate examples, measured ranking and latency, model-aware cache, no synthetic meaning fallback | Pending verification and live embeddings |
| R5 — Tickets and accounts | P1 | GitHub issue/PR and Linear recognition; preview; explicit idempotent backlink; Slack directory and profile linking | Correct issue/PR detection; no automatic comments; live integrations tested only with authorized credentials | Adapters may be tested with fixtures; live gate separate |
| R6 — Visual content and sharing | P1 | Reuse existing drawings by meaning, bounded optional generation; photo-to-new-board reviewed draft; deterministic current-state share previews for all scopes | Quota/failure handling; photo text never executed; complete readable focus text; revocable least-privilege links; no LLM for previews | Pending verification and provider keys |
| R7 — Ship and maintain | P0 release gate | Two sites deploy independently; README screenshots; pinned reproducible toolchain; backup/recovery; status and health | Green CI + deployed smoke tests + documented rollback + mobile/Safari checks | Not released |

## Required design invariants

The board is a handwritten sheet, not a dashboard with decorative lettering. Keep generous margins, warm paper, blue ink, large headings and quiet rules. Navigation must be discoverable without relying on hover or hidden gestures. Missing avatars are actual image placeholders, never fabricated real people. The font specimen lives in a separate Nx application/build/deployment, not a board tab.

## Engineering invariants

- Atomic commits and verified branch updates; no force push. Re-read the branch before advancing it.
- Preserve the existing cloud workspace. Never publish personal contacts, avatars, credentials or local databases in Git.
- Do not mark OAuth, email, LLM generation or cloud round-trip verified from mocked tests.
- Explicit account linking requires proof of control, not just matching email. Avatar proposals do not silently overwrite canonical photos.
- Distinguish lexical retrieval, real embeddings and unavailable provider states.
- Prefer existing Nx targets; add Bun support where compatible, not a fabricated Bun-only claim for Node-specific code.
- A file uploaded as a Git blob/tree is not pushed until a commit and branch ref make it reachable.

## GitHub failure protocol

1. Check the official GitHub Status API and the specific failed component.
2. Separate platform incidents from connector errors, authorization failures and sandbox network/DNS failures.
3. Retry transient reads with bounded backoff (about 2, 5, 15, 30 seconds), not tight loops. Do useful local work between retry rounds.
4. After an ambiguous write, read the target first; do not duplicate a comment, commit or file blindly.
5. Confirm the final branch SHA and fresh file contents after a write. Never report a push from an attempted request alone.
6. Continue during this working session; no unattended monitoring or future notifications are implied.

## Initial factual checkpoint (before recovery)

The repository is accessible through the GitHub connector with push permission. `main` was confirmed at `b13fae0b66bd1a8deaaa2f47096eea12925230e4`, containing only the initialization README. A previous application tree was uploaded under `29f479efbdd15865ddd2415c5f9ec843f6218050` but never attached to main. Its contents and old verification claims must be checked rather than assumed. The local shell currently cannot resolve github.com; that is not evidence of a GitHub outage.

## Execution log and next checkpoint

1. `95648aa` — roadmap committed before implementation recovery.
2. `bf97e7` — attached the previously orphaned source tree to main, preserved the roadmap, removed unverified success claims and enabled real CI. Native browser testing exposed a client parse error despite 60 passing backend tests.
3. `6ee1c44` — fixed startup, added guarded boot and browser-module syntax checks; fixed caret/text loss during editing; added mobile column tabs. [Native run 34488301726](https://github.com/alex-mextner/boards-app/actions/runs/34488301726) passed 65 Node tests, both builds and 27 native Chromium checks.
4. `a74b4a9` — explicit test mode now refuses a cloud database, validates configuration without exposing secrets, and gives shared views the same guarded bootstrap/mobile styles. [Run 34489588055](https://github.com/alex-mextner/boards-app/actions/runs/34489588055) passed both jobs. Local and CI source include 71 Node tests.
5. Evidence publication: CI validates the font in memory and publishes only allowlisted sample screenshots to `visual-evidence` after both test jobs succeed. The branch manifest records the source SHA and workflow run; it is not a production deployment.

**Next critical gate: R2.** Finish the real Vercel project, OAuth/email application settings and cloud smoke checks. Vercel was retried in this session: the exposed zero-argument deploy command is rejected by its backend for missing `name`, `target`, `files`. A read of the connected team's projects lists no `boards-app` project. Continue independent R1/R3/R4 checks rather than calling this blocker a GitHub outage.

Neon was read again: database `scriptboard`, document version 1, one board, three people, fifteen items. The workspace was not modified. SQL read access is not proof of a deployed application-to-database round-trip.

Open refinements include unresolved assignee-hint preservation, real-avatar fetch/approval cases, evaluated RU/EN semantic retrieval, configurable generation quotas and better photo-draft editing. Source adapters and mock provider tests must not close those live-product gates.
