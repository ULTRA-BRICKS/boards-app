# Verification ledger

## Recovery checkpoint — 2026-09-10

Source recovered from Git tree `29f479efbdd15865ddd2415c5f9ec843f6218050`. That tree had not been attached to the main branch. Previous prose and JSON claiming passed tests were not sufficient evidence of a reproducible checkout; they have been removed.

The `Verify` GitHub Actions workflow now runs the actual committed source: Node tests, both builds, and a native Chromium run against local HTTP servers. Reports and screenshots are uploaded as workflow artifacts. A test result is valid only with the corresponding commit SHA and successful workflow/job logs.

Live OAuth, Resend email delivery, Cloudflare image/embedding requests, Linear/GitHub posting and the deployed Vercel-to-Neon path still require authorized provider configuration and independent smoke tests. Fixtures are not live integration evidence.

The browser workflow uses public sample names/tasks and image silhouettes. Private Slack profile data is not committed or uploaded by CI. Source snapshots omit generated fonts, credentials and databases.

See ROADMAP.md for acceptance gates and the current delivery state.
