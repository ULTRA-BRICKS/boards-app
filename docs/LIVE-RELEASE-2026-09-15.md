# Live release and request audit — 2026-09-15

Service: https://boards-app-gamma.vercel.app/ · Type specimen: https://boards-app-gamma.vercel.app/type.html
Public browser build: `3dfae8a87229ebf6`. Vercel deployment `boards-cq9fwdelr-inventorems-projects.vercel.app`, promoted successfully to the existing project/domain. The provided user link was opened read-only to verify the exact notebook; its capability is never published here.

## Verified on the public service, without API fixtures
- The supplied notebook opens with 15 tasks, `| Boards` in the browser title, and no recovery loop.
- In a separate isolated test notebook: actual Unicode/emoji save, independent-session read, assignment changes, completion/reopening, public sharing and revocation all passed.
- A real service worker controlled repeat loading. Its cache contained only public shell assets, not cloud operations. Offline refresh of a clean page showed a connection error rather than claiming nonexistent unsaved edits; Retry recovered after reconnecting.
- Mobile width 393 px had no horizontal overflow. The independent type page loaded and its weight control worked. No unhandled browser exception was recorded.
- The user's requested Slack portrait export was imported into their existing notebook through the People UI: three people, two photos and one initial fallback. The save returned HTTP 200. Portrait files and the edit key are not in Git or public assets.

## Measured sample, not production percentiles
On the Mac's unthrottled Chromium: new sample first frame 300 ms, font ready 377 ms, initial cloud confirmation 2573 ms. Repeat first frame 22 ms, font ready 62 ms, cloud revalidation 196 ms. Cold auth/database startup remains visible in the initial cloud timing; it is not falsely called instantaneous. The repeat page rendered from its per-tab snapshot while revalidating.

![Actual public-service screenshot, isolated sample notebook](screenshots/boards-live-0915-desktop.png)

## Current checks and boundaries
Nine targeted loading regressions pass in each of Chromium and WebKit. The established suites cover 15 Chromium and 14 WebKit scenario groups. These deliberately inject backend failures; the public-service checks above do not. WebKit's fixture suite blocks service workers, so it is not used as proof of SW operation.
The regression suite began red on the reported failure. It now covers clean versus dirty failures, repeated retries, uncertain creation, preservation through a failed cloud read, Undo, title naming and log redaction. Oxc's undefined-name check also rejects the accidentally removed editor callback.
Browser diagnostics retain only a bounded allowlist of operation/status/timing events. The fixed-operation Bun relay sets no-store headers, constructs fresh upstream headers, forces the intended database schema, and does not log tokens, capabilities, request bodies or raw provider errors.

The release source remains subject to the repository's real commit/review gate. External reviewer attempts have encountered exhausted Codex quota, unavailable providers and timeouts; their failures are not recorded as successful independent reviews. See git history for the actual merged source, not only this deployment report.
