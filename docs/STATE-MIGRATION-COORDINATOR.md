# Boards comparison-branch checkpoint

Branch: `feat/state-complete-HYP-1490`. Starting reference: `9ebf080da4cdb96deb13b80f5faf5775850be67a`. A detached, unchanged build exists in `boards-baseline-comparison-20260924`; it avoids treating the new baseline-scope wrapper as the original application.

The scoped migration and 32-entry ownership manifest remain partially complete, as the implementation handoff reports. Application document, navigation, menus, selection and several async/resource paths now use the library owners and explicit commands. The type/composer app, some resource lifecycle and data-source orchestration still require work. Do not present this inventory as a completed whole-app migration.

Coordinator review found two concrete publication bugs and added failing tests before changing the source:

1. Saving inside the outer document/navigation transaction could queue a change that later rolled back. `document-action.mjs` now performs external save/render effects after the outer commit. A post-commit observer failure still queues the committed value before propagating the error. Real new-board creation uses this boundary.
2. The borrowed Runtime adapter's no-op disposal retained subscribers and ignored notification-phase restrictions. It now owns and releases only its subscriptions, preserves the parent Runtime and leaves rejected cleanup retryable. Tests cover parent-already-disposed cleanup and idempotence.

The coordinator's current ordinary suite passes 269 tests. Both baseline/state builds and 12 existing real browser scenarios passed before the final borrowed-disposal refinement; rerun the affected application browser suite after that source change before publication. Build/dev asset lists include the new document-action module, and the mechanism manifest names the actual boundary.

No changes from this new worktree are committed, pushed or deployed yet. No production secrets or database state were read/copied. The local-test server deliberately refuses the test mode on Vercel; do not remove that guard to label a static/mock shell as full staging. Independent remote baseline/state deployments require an authorized isolated database and explicit staging auth/effect configuration.

## Final branch review — publication remains blocked

The final current-source baseline/state builds and 12 existing app scenarios passed after the borrowed-disposal fix (`/tmp/boards-final-owned-state-browser.log`). However the independent source review (`/tmp/boards-full-state-source-review.log`) identified two additional reset-path blockers not covered by those scenarios: resource handles are detached inside a batch and can lose their disposer callbacks when notification throws; `resetPrivate` can skip cache/document clearing when a disposer fails. The scope reset and document reset also occur in separate waves. These need failing error-path tests and a coherent cleanup/commit design before publishing the migration branch. Do not equate the successful browser scenarios or the review process exit code with acceptance of these paths.

The current changes are staged for review but are not committed or deployed. Preserve the index and original baseline. The full source review also notes an invalid destination can mutate the weaker baseline move before throwing; validate destinations before mutation when addressing that path. No unreviewed source workaround was applied after the report.

## 2026-09-25 — reset blockers reproduced
Four new executable regressions reproduce the review findings: losing cleanup after a committed observer exception, losing a handle on reset rollback, unsafe nested reset, and the non-atomic private/document reset when disposal fails. Focused suite:98 passed/4 failed across102 tests; log `/tmp/boards-reset-red-20260925.log`.

The first source-rewrite chunk was written, but the continuation was rejected by tool safety. The incomplete `scope-core.mjs` was immediately restored from this worktree's pre-existing staged version; `git diff --quiet` and `node --check` confirmed exact restoration and valid syntax. The proposed fix was not applied through another transport. New regression tests remain preserved and failing; do not publish this branch as accepted or use the older green suite as proof of this boundary.

The current tasks-backend tracking card is HYP-1518 (`15f30e72-74b2-5107-a5a8-d15f56e9906c`), title-matched to the earlier Linear HYP-1490. Numeric codes are not interchangeable between trackers.
