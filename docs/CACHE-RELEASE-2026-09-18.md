# Confirmed board cache and loading recovery

## What the cache is
Cloud data remains authoritative. Public HTML/JS/CSS are in the service-worker cache. A separate browser IndexedDB cache contains only the latest acknowledged board document, encrypted with a key derived from its high-entropy editing capability. The editing capability itself, bearer tokens and unsubmitted tab drafts are not stored in this database. Public read-only shares are never restored from it.

A returning tab first restores its own draft/session snapshot. A new tab can restore the confirmed device snapshot and show the board while the cloud read runs. If the server reports a newer version, a clean view updates. New typing waits for version verification; a conflicting cloud revision does not overwrite it. An access rejection invalidates the device snapshot. Successful saves use the acknowledged document, never a newer unsent edit, for cache updates.

The cache expires after 24 hours and prunes old confirmed records. Browser storage is optional: failure does not prevent a network load. A local clear-cache action does not delete the current draft or cloud data. The browser may evict storage; a genuinely first visit or cleared cache still requires the network.

## Changed since the previous interruption
The earlier file-write rejection did not supply a reliable diagnosis. It was not evidence that browser caching is forbidden or that IndexedDB needs external account access. In this iteration the normal source-file write succeeded. The implementation and native browser tests are present; the old statement that cross-tab caching is unimplemented is now historical, not current source status.

## Tests and safety boundaries
The original cross-tab test failed before implementation. Native Chromium and WebKit now verify: a new tab renders 15 confirmed tasks before an intentionally slow cloud read; typing waits for the correct version; another tab cannot see an unsubmitted draft; a newer cloud revision replaces a clean snapshot; a denied link does not keep repopulating cache. Separate WebCrypto/IndexedDB checks cover ciphertext-at-rest, wrong-key rejection, monotonic acknowledged versions, invalidation and an already-in-flight stale write.
The service-worker unit tests confirm same-build query navigation uses cached HTML while revalidation is pending, credential/version-mismatch queries remain excluded, and CacheStorage failure falls back to the network. The inline loading guard handles failed application scripts and delayed reads in both browser engines.

## Other work is not implicitly activated
Slack still requires the actual Boards app installation and server configuration. Current developer portal requests sign-in; production Vercel environment listing is empty. The ChatGPT Slack connector does not supply a Boards OAuth installation. Corporate account activation, trusted audit history and Resend jobs remain distinct from this cache release. Automatic photo recognition still lacks a working deployed provider endpoint; the editable/manual photo draft is not a substitute for that capability.

Public deployment ID, build, source commit and after-release timings are appended only after execution. Do not treat this document's source implementation status as proof that an older open browser tab is already running it.

## Published and measured
Live build **`c7f90940134b739c`** is now on https://boards-app-gamma.vercel.app/ . Deployment `dpl_7nNX35Qysb4DdTJxxxca6YJ86k95`, URL `boards-5qjnfrd17-inventorems-projects.vercel.app`, was promoted after staged HTTP checks. Source commit **`031ec6dc1ec6fdde11ef323271444aec14219c15`** is pushed to Forgejo PR #8. Normal three-role source reviews and commit hooks ran; main is not merged because remote CI checks still report failures.

Read-only live measurements on the supplied board, mobile-sized viewports on a Mac, ordinary browser security, no artificial network delay:
| Data rendered from navigation start | Chromium before / after | WebKit before / after |
|---|---|---|
| New tab, previously loaded board | 455 ms / **16 ms** | 416 ms / **20 ms** |
| Current-build query link | 519 ms / **14 ms** | 490 ms / **20 ms** |
| Reload of the same tab | 7 ms / **10 ms** | 11 ms / **13 ms** |
The rendered-frame marks for the new tab were 22 ms (Chromium) and 51 ms (WebKit). The font was ready at 79/72 ms. Same-build HTML TTFB was 1 ms in both engines after the change. These are single observed runs, not device-independent guarantees or field percentiles.

**A first-ever load with no cached data is still an outstanding latency issue.** The first Chromium run after promotion took 10,919 ms to render; the following clean WebKit run took 479 ms. Server logs for that slow request contain an anonymous-auth operation of 777 ms and a notebook upstream read of 9,094 ms. This isolates the delay to the initial upstream read rather than rendering, but does not prove why the upstream was slow. No undocumented billing/always-on setting was changed. The cache removes that wait from repeat/new-tab rendering after a confirmed load; it cannot supply never-before-seen data.

The live timing script performed **zero writes to the supplied user board**. An additional ten-check smoke test exercised cloud save/read, sharing/revocation and offline recovery using isolated test data; the supplied board was read only, with 15 tasks and no JS errors. Agent-browser separately confirmed the live build, Saved, cache acknowledgement, clear-cache control and diagnostics.

Local gates: **284 unit tests / 3,047 assertions**, strict cache types, Oxc and formatting; 16 Chromium and 15 WebKit board groups; nine recovery scenarios and three boot-failure/retry scenarios per engine; five new device-cache scenarios and twelve native crypto/storage conditions per engine. The final recovery test deliberately poisons an old database connection and verifies a later write opens a working one.
Reports: `docs/metrics/loading-after-cache.json`, `loading-before-0916.json`, `device-loading-*.json`, `confirmed-cache-*.json` and `live-smoke-0915.json`. Raw request logs remain private; no editing key, task content or credential is included in this document.
