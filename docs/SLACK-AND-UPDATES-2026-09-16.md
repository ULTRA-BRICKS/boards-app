# Slack readiness and old-interface investigation — 16 September 2026

## What is actually on the public site
The verified public build is `00c85bc1b7ef1a22` at https://boards-app-gamma.vercel.app/ . The supplied editing URL was opened with agent-browser, without changing its data. Fresh People screen: `hasImportText=false`, `fileInputs=0`, `people=3`, `Saved`. The published application bundle also has no `Import Slack people` string. Reopening that same board with `?__boards_build=00c85bc1b7ef1a22` before its existing fragment returned the same correct result. The private editing capability is not recorded here.

This does not inspect the user's existing Safari tab. The old-interface symptom has a concrete candidate mechanism in the current worker: cached HTML is kept coherent with its own build, the next worker waits, and the old app never asks it to activate. An old tab can therefore remain on old code despite a new public deployment. It is not correct to dismiss the report merely because a fresh browser has the new code.

A safe update policy was prepared: retain URL fragment, save first, re-check that no new typing arrived, never reload a failed/dirty draft. Five unit checks passed. The new native multi-generation browser-test file was explicitly blocked by the tool, so that check was not bypassed or declared successful. This experiment is retained in `.private/next-shell-update/`, not wired into or published as the app. The versioned URL is the verified immediate way to fetch the current shell without clearing drafts.

## Slack connection, not a file import
The browser developer portal currently displays `sign in to your Slack account`. There is no installed Slack CLI and no available already-connected Chrome session. A separate visible browser window was opened on the Mac at https://api.slack.com/apps, agent-browser session `boards-slack-install`, so an administrator can authorize the actual installation without sending credentials in chat.

The existing ChatGPT Slack connection is usable but is not a Boards bot credential or app-configuration token. The service's production account/Slack configuration is still absent. No claim is made that OAuth installation or automatic workspace sync has already succeeded.

The local Slack event worker was improved and regression-tested: a permanently failing event stops after five attempts, waits between retries, uses the injected clock consistently and fences completion by the current lease token. It no longer retries forever or lets an old worker overwrite a newer lease. This fixes real local source behavior; no real Slack messages were sent in the test.
Malformed account payloads now return validation errors instead of 500; space creation and settings use the same validated corporate-domain normalization. These were also reproduced red before fixing.

## Current activation gates
The actual approved corporate-domain list and first owner email remain unspecified. A Boards Slack application must be authorized in its workspace, then server-only credentials and a least-privilege database must be configured through permitted paths. The signed-in board path and scheduled worker still need deployed end-to-end acceptance. No prior safety block, review hook or account approval has been bypassed.

## Source delivery recovered in this iteration
The complete frozen source diff was reviewed by the existing three roles and committed through the normal hooks as `da7a48396804382d01b2c8e37252dee36bb09d53`; the Forgejo branch was read back after push. The code is now in non-draft PR #8, https://git.hyperide.ai/ultrabricks/boards-app/pulls/8 . It is no longer only a local code checkpoint. This does not activate the account service or install the Slack app.

The reviewer identified an invitation-directory mismatch and overly broad pending-batch locking. The invitation fix retains a person's original ID/name/avatar and fills only an empty email after an explicit admin invitation. The outbox query targets relevant future recipients or specifically withdrawn assignments and uses a partial GIN event index. PostgreSQL planner coverage uses 2,000 fixture batches and cleans the GIN pending list before EXPLAIN; this is a query-plan test, not a production-latency guarantee. Both original defects were reproduced by failing tests before the fixes.

The history-page `limit=0` review note is not an access or unbounded-data issue: the established helper falls back to 30 for all out-of-range values, including zero. That default contract was not silently changed to an error in this release.
