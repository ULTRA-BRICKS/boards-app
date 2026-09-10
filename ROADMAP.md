# Boards delivery roadmap

Updated: 2026-09-10. This file is the execution ledger, not a promise that an adapter or screenshot is a deployed product. Each stage is complete only when its acceptance checks have evidence.

## Delivery order

| Stage | Priority | Scope | Acceptance gate | Status |
|---|---|---|---|---|
| R0 — Recover and verify | P0 | Recover previously uploaded Git objects into a reachable commit; preserve main; run source/build/tests in CI; remove unverified claims | Fresh checkout contains the application, both apps build, tests have real logs tied to a SHA | In progress |
| R1 — Paper interface | P0 | No app header/logo; faithful paper/ink hierarchy; image avatars on the right; dashed assign control; useful page-edge navigation; mobile layout | Actual desktop/mobile screenshots, keyboard and touch tests, no clipping; type site separate | Pending verification of recovered implementation |
| R2 — Cloud and sign-in | P0 | Configured cloud opens automatically; otherwise setup first. Durable Neon records; Google/GitHub/Slack or email login; no silent local persistence | Deployed save/reload across sessions, successful real login, correct setup/error states, no public credentials | Provider configuration and deployment gate |
| R3 — People and confirmations | P1 | @ selection/create; own avatar; proposed avatar visible immediately only to uploader; approval; explicit provider linking; cross-board person tasks | Ownership/CSRF/replay tests, third party cannot steal account or replace approved photo, browser confirmation tests | Pending verification |
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

## Initial factual checkpoint

The repository is accessible through the GitHub connector with push permission. `main` was confirmed at `b13fae0b66bd1a8deaaa2f47096eea12925230e4`, containing only the initialization README. A previous application tree was uploaded under `29f479efbdd15865ddd2415c5f9ec843f6218050` but never attached to main. Its contents and old verification claims must be checked rather than assumed. The local shell currently cannot resolve github.com; that is not evidence of a GitHub outage.
