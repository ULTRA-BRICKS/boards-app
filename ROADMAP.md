# Boards roadmap

Canonical repository: `ultrabricks/boards-app`. Progress is evidence-based; a source adapter is not a live integration.

| Stage | Deliverable | Current gate |
|---|---|---|
| R0 | Recover source, working Git access, reproducible commits | GitHub writes restored after organization app installation |
| R1 | Approved paper layout, avatar chain, direct page creation, editable in-sheet photo draft | Bun checkpoint under native browser review |
| R2 | Hosted board + independent type site + cloud sign-in/save | Open: no verified service URL; see docs/RELEASE.md |
| R3 | People, @, avatar proposals, provider ownership confirmation | Source and fixture regressions exist; live accounts unverified |
| R4 | Lexical/semantic search, duplicates, illustration reuse | Historical real-E5 evaluation exists; deployment provider still required |
| R5 | Slack directory, GitHub/Linear issues and PR previews, explicit idempotent backlinks | Fixtures do not close live-credential gates |
| R6 | Deterministic scoped share previews; quota-bounded image/vision providers | Public shell/private-cache separation under regression tests; live providers remain open |
| R7 | Bun/Oxc/Nx, frozen dependencies, quality/security/browser gates, release proof | Source migration must pass CI before merge; production measurements remain open |

## This delivery

- Bun server/SQLite/build/test runtime; Oxc syntax/lint and Oxfmt formatting.
- Native TypeScript Playwright instead of Python browser tests; fontkit validation in memory.
- Thumbnail-based page navigation and inline page/column creation, with no formal creation wizard.
- Avatar overlap order and hover/focus elevation; missing photos remain image placeholders.
- In-sheet photo draft with explicit keep/leave action, not a JSON form.
- Version-coherent app-shell stale-while-revalidate; no private API/auth/share caching.
- Worker-based font construction; minified split bundles and compressed transfer budgets.
- More than 2,000 parameterized parser/security cases plus behavioral regressions; 80% server/shared-core coverage gate with its scope stated explicitly.
- Independent CI categories for format, lint/parser, types/Nx, tests/coverage, builds/budgets, styles, static security, dependencies, font geometry, Chromium and WebKit; CodeQL and dependency review separately.

## Next release checkpoint

Finish actual hosted configuration and provider authorization rather than presenting an archive or source HTML as the service. Record a URL only after testing the deployed page, its sign-in and cloud round-trip. Preserve the current Neon data. The user requested merging reviewed green changes, not bypassing failed tests or permissions.
