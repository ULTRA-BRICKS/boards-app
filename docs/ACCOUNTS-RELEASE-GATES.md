# Accounts, audit history, mail and Slack — release gates

## Public service versus local implementation
The public board is https://boards-app-gamma.vercel.app/; build `00c85bc1b7ef1a22` removes the arbitrary Slack JSON upload. HTML, the font specimen and share responses carry noindex directives. Shared `/s/` pages and PNG cards remain anonymous and revoked shares return 404. The prior public cloud smoke for this exact build passed ten checks with no user-board writes.

The `apps/prototype/accounts/` implementation is NOT activated on this deployment. Its verified corporate-email sessions, space access, profile/settings screens, trusted actor history, notification outbox and Slack app adapter run in local tests. This is not proof of production sign-in, delivered email, or an installed Slack application.

## What the local tests exercise
- Eight account views (setup, email, verification, spaces, profile, settings, people and history), Chromium and WebKit, widths 320/393/768/1080, actual handwriting font, no serious/critical automated accessibility violations. Draft input survives navigation. Fixtures use a local HTTPS server and PostgreSQL-in-Wasm; only the test certificate is trusted specially.
- Session tokens are hashed at rest and sent in HttpOnly/Secure/SameSite cookies. Corporate domains are exact allowlists; missing configuration fails closed. Email codes expire, are one-use, and failed attempts persist.
- History is written in the same transaction as a successful versioned save, using the server-verified actor and server timestamp. Pagination, space isolation and viewer-write denial are tested. Historical activity is not invented for old capability-only notebooks.
- Invitations now create an assignable person exactly once; another user's linked person ID cannot be taken over. Membership is granted only after verified corporate-email sign-in.
- A notification batch opens for five minutes after the first assignment by somebody else. Subsequent assignments join without postponing delivery. Withdrawn assignments, self-assignments and opt-outs do not produce mail. Retries preserve payload/idempotency key; uncertain old deliveries are held rather than duplicated.
- Weekly digest periods use Monday 08:00 in the selected space timezone, including daylight-saving changes. The renderer labels existing work as a digest, not new assignments.
- Slack OAuth state, exact workspace checks, encrypted tokens, signed event verification, paginated directory sync and durable event deduplication are implemented. Only public share URLs may be unfurled. Directory import is not silent account linking or an invitation acceptance.

## Production blockers — do not silently choose defaults
1. The approved corporate-domain allowlist and first-owner email have not been supplied. Neither an unrelated user email nor a verified sending domain establishes this access policy.
2. `boards_app_service` is not present in the project role list; its earlier creation was safety-blocked. No privileged existing database-owner credential has been substituted. The account schema has not been applied to the production database.
3. Production Vercel environment variables for accounts and Resend are still absent. The newly created domain-scoped Resend key has not been deployed; no key material belongs in Git, screenshots or a public response.
4. Slack's Boards application must actually be configured/installed with its required scopes and credentials. A working ChatGPT Slack connector is not that application. Basic Open Graph previews work independently.
5. An operational scheduler must invoke the durable outbox. Vercel Hobby's own scheduler cannot run every five minutes. Use an authorized minutely worker/scheduler (Neon scheduled functions are a candidate), not a tab timer or a fake enabled checkbox. No paid-plan upgrade has been made.
6. The signed-in board path and safe migration of existing capability notebooks still need their production end-to-end acceptance test. Existing user boards remain usable and have not been reassigned or overwritten.
7. Source review, commit and merge are distinct from the live static deployment. The repository's review hook remains enabled.

## Latest verification checkpoint
The current local run passes 222 unit tests with 2,858 assertions, Oxc, the strict account TypeScript check and formatting. The account-browser report now checks every one of the eight views for overflow at four widths and serious/critical axe violations in both Chromium and WebKit. These are regression checks, not a blanket accessibility certification.
A new 35-revision history test found a real cursor bug: `SELECT id::text ... ORDER BY id` sorted the output text alias, while the cursor compared numeric IDs. Ordering now explicitly uses the underlying numeric history ID. Pagination returns exactly 30 + 5 records with no repetition. Two invitation-lifecycle tests likewise started red and now pass.
The bounded independent source-review attempt did run, but all three configured Sonnet roles returned the weekly usage limit. No successful reviewer verdict or merged source release is claimed.

## Provider references
- Noindex must be readable by crawlers; robots.txt is not an authentication control: https://developers.google.com/search/docs/crawling-indexing/block-indexing
- Slack classic previews inspect Open Graph metadata independently of application sign-in: https://api.slack.com/reference/messaging/link-unfurling
- Slack event acknowledgement has a three-second deadline, so events are durably queued: https://docs.slack.dev/apis/events-api/
- Resend idempotency records last 24 hours; retries keep the same payload/key and old unknown outcomes are held: https://resend.com/docs/dashboard/emails/idempotency-keys
- Vercel Hobby cron runs at most daily; it is not a five-minute dispatcher: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Neon has a branch-scoped scheduled-function trigger API to evaluate when deploying the worker: https://api-docs.neon.tech/reference/createprojectbranchtrigger
