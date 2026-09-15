# Request-by-request audit of the deployed prototype

Verified service: https://boards-app-gamma.vercel.app/ . Browser build `3dfae8a87229ebf6`, 2026-09-15. See LIVE-RELEASE-2026-09-15.md for actual public-browser evidence. “Live” below refers to this prototype, not the unfinished full app.

| Request | Status | Exact scope / remaining work |
|---|---|---|
| Public service link here and in repository | Live | Stable gamma URL retained; the user-provided notebook key remains valid and was not replaced. |
| Service-worker app shell and stale-while-revalidate | Live | Public resources only; real repeat/offline/retry checks passed. Private API responses and share contents are not cached by the worker. |
| Slow initial/repeat loading, specific page title | Improved, measured | Sample frame 300 ms and repeat frame 22 ms in one unthrottled run. Cold cloud confirmation still took 2573 ms. Named title available from the fragment; all titles end in `| Boards`. |
| Modify/add multiple assignees | Live | Picker remains open, supports independent toggles, and persists changes. |
| Right-side overlapping avatars, hover above neighbors | Live | First-letter fallback uses distinct colors. Requested Slack export imported privately into the supplied notebook: 2 photos, 1 fallback. Automatic authenticated Slack directory sync is not yet live. |
| Explain other tasks and apply N+2, N=3 | Live | Up to five show all; six or more show three with expansion. Current task excluded by both board and item identity. |
| Navigation tracks position | Live | Active mobile column follows scroll; clicks update the active section. Desktop remains a multi-column sheet. |
| Extensive hand-drawn icon source | Live | Tabler icons processed through RoughJS at build time; only selected SVG paths shipped, not the whole library. |
| Clickable overlapping paper stack and animated board selection | Live | Existing board titles or a fresh-page affordance on layered sheets, animated real DOM thumbnails. No Lottie player is required; reduced motion is honored. |
| Animated hand-drawn completion plus sound | Live | Restrained deterministic line variation and optional generated pencil sound; mute available. |
| Share replaces bottom ellipsis; remove technical paragraphs from menus | Live | Share is last; settings are on the sheet, with useful actions rather than implementation disclaimers. Accurate limitations remain in documentation. |
| Load/save failure loop, even before editing | Live fix | Clean connection failure is separate from a dirty draft; failed cloud read retains the draft; successful read provides Undo. Nine targeted failure scenarios pass per engine. |
| Logging and TDD | Implemented for recovery | Allowlisted bounded client/server operation/status/timing logs, download action, no keys/body/token logging. Regression suite began red; native and public runs are distinct. |
| Bun/Oxc everywhere feasible, no Python application requirement | Partial | Deployed prototype builds/tests use Bun and Oxc; relay runs on Bun. The separate whole-monorepo migration/Nx consolidation remains PR #2. |
| 2000+ tests and 80%+ whole-application coverage | Not complete | Prototype unit/scenario counts and full-app parameterized matrices must not be confused. No whole-product coverage claim is made. |
| OAuth, account linking, avatar approval and email delivery | Not live | Prototype still uses an editing capability, not the final account system. |
| Live Slack/Linear/GitHub ticket previews and backlinks | Not live | Full-app adapters and fixture tests are not deployed provider integrations. |
| Semantic duplicates, art-library matching, generated illustrations | Not live | Current live search is lexical and drawings are existing vectors. Real evaluated provider configuration remains required. |
| Photo-to-board without a creation wizard | Not live in this prototype | An inline draft design exists in full-app work; actual vision provider and reviewed import need integration. |
| Adaptive dynamic messenger previews for item/selection/column/space | Not live | Read-only scopes and revocation work, but deterministic server-generated OG cards are not yet shipped. |

Issues #5, #6 and #7 separate prototype polish, full-product gates and the P0 recovery incident. Do not silently close the remaining rows after a successful prototype release.
