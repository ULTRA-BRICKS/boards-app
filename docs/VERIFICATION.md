# Verification ledger

## Recovery checkpoint — 2026-09-10

Source recovered from Git tree `29f479efbdd15865ddd2415c5f9ec843f6218050`. That tree had not been attached to the main branch. Previous prose and JSON claiming passed tests were not sufficient evidence of a reproducible checkout; they have been removed.

The `Verify` GitHub Actions workflow now runs the actual committed source: Node tests, both builds, and a native Chromium run against local HTTP servers. Reports and screenshots are uploaded as workflow artifacts. A test result is valid only with the corresponding commit SHA and successful workflow/job logs.

Live OAuth, Resend email delivery, Cloudflare image/embedding requests, Linear/GitHub posting and the deployed Vercel-to-Neon path still require authorized provider configuration and independent smoke tests. Fixtures are not live integration evidence.

The browser workflow uses public sample names/tasks and image silhouettes. Private Slack profile data is not committed or uploaded by CI. Source snapshots omit generated fonts, credentials and databases.

See ROADMAP.md for acceptance gates and the current delivery state.

## Reproducible green checkpoints

- [34488301726](https://github.com/alex-mextner/boards-app/actions/runs/34488301726), source `6ee1c442f10450396d79b0bedddea9da5a5ef74a`: 65 Node tests, both application builds and 27 native Chromium checks passed. The native browser run includes real HTTP cookies and a full page reload, not the restricted-runner harness.
- [34489588055](https://github.com/alex-mextner/boards-app/actions/runs/34489588055), source `a74b4a95a5a6484c3d36a714899a18d880d4fb43`: cloud-boundary regressions added; 71 Node tests and both CI jobs passed.
- `tests/font.py` generates and validates the typeface entirely in memory using FontTools, including eight corner/intermediate axis instances. Only a JSON report is saved; font binaries are not uploaded.

The optional final CI job publishes a fixed allowlist of sample screenshots and its source/run manifest to the `visual-evidence` branch. It never modifies main or publishes databases, real profiles, secrets or generated font binaries. PRs cannot invoke that job; it requires a successful trusted main push. Its git push is fast-forward only.
