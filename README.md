# Boards

A cloud notebook with editable, handwritten pages. No application masthead or logo. Page thumbnails create a page directly; headings and thoughts are edited on the sheet. The Conloca type specimen is an independent application in this Nx repository.

**Service URL:** no verified production deployment yet. Do not confuse a successful build, screenshot, source HTML or GitHub commit with a running cloud workspace. When a hosted deployment passes sign-in and save/reload smoke checks, its actual URL belongs here.

[Roadmap](ROADMAP.md) · [Quality runs](https://github.com/ultrabricks/boards-app/actions) · [Release blockers](docs/RELEASE.md)

## Screenshots

Real browser screenshots from public sample data, not model-generated UI mockups. [The evidence manifest](https://github.com/ultrabricks/boards-app/blob/visual-evidence/evidence.json) records their source commit and workflow run. Until the new main checks pass, this branch can show screenshots of the previous successful checkpoint.

![Board](https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/board-desktop.png)

<details><summary>Mobile, page thumbnails, photo draft and type specimen</summary>

<img alt="Mobile board" width="393" src="https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/board-mobile-viewport.png">

![Page thumbnails](https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/page-thumbnails.png)

![Draft on the page](https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/photo-review.png)

The photo-draft screenshot uses a fixture transcription, not a live vision call.

![Independent type site](https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/type-site.png)

</details>

## Run with Bun

Bun **1.4.2** is the pinned development, build and test runtime. No Python, Docker or container is needed for normal use.

```sh
bun install --frozen-lockfile
bun run setup
bun run dev
```

For an explicit isolated preview without provider credentials:

```sh
bun run demo
```

The preview uses Bun SQLite and a visibly labelled test sign-in. It refuses a supplied cloud `DATABASE_URL` and is disabled on Vercel. It is not production authentication. A real deployment opens setup/sign-in before revealing the workspace; failed cloud saves never silently become local-only task storage.

| Application | Development | Build | Deployment command |
|---|---|---|---|
| Board | `bun run dev` | `bun run build` | `bun run deploy` |
| Type specimen | `bun run dev:type` | `bun run build:type` | `bun run deploy:type` |

Nx: `bunx --bun nx dev board`, `bunx --bun nx dev type-site`. The independent type site uses port 5174; board uses 5173. Deployment commands require the operator's authorized provider CLI sessions and appropriate configuration. They are not evidence of a deployment already performed.

## Interaction and data

Photo avatars overlap in a trailing chain; hover/focus raises a portrait. `@` selects a workspace person, and missing people can be added by email. A suggested avatar is private to its uploader/owner until approval. Provider linking requires proof of account ownership, not merely matching email.

Private state is versioned in Neon. Conflicting whole-workspace writes surface a conflict rather than silently overwrite. This is not CRDT collaboration. Share capabilities can expose a board, column, one thought, selected thoughts or workspace; previews read the latest saved state and render a deterministic PNG without an LLM. Neighbor disclosure is opt-in. Revocation cannot delete recipients' cached screenshots.

The service worker uses stale-while-revalidate only for an explicit public app-shell allowlist. Auth, task APIs, profiles, shares and sign-in query links are never cached. Each generation is coherent; an old worker cannot cache new HTML referring to another build's chunks. Offline shell availability does not pretend private cloud data is available offline.

Font geometry is generated in a worker so initialization does not block controls. Only original drawing/compiler source is stored here. No font binary is committed; the independent specimen constructs the variable font on the user's device.

## Quality gates

```sh
bun run verify
bun run test:browser
bun run test:browser:webkit
```

Oxfmt, Oxc parsing/lint, strict checks of new TypeScript modules, Nx project discovery, unit/integration tests, explicit coverage gates, CSS parsing, bundle transfer budgets, static artifact/secret-pattern boundaries, dependency audit, native Chromium/WebKit, axe accessibility and local performance budgets run in separate checks. CodeQL and pull-request dependency review supplement them. Pin and deliberately update the lockfile; CI installs frozen dependencies.

The >2,000 cases include parser/security equivalence-class matrices, not >2,000 independent end-user journeys. Coverage is explicitly measured for **all server and shared core modules** with an 80% line/function gate; it does not label browser UI as covered by server tests. Browser behavior and SW lifecycle have separate tests. Legacy JavaScript modules are parsed/linted but not claimed to be fully strict TypeScript.

Accessibility checks and unthrottled local timing budgets are regression checks, not an accessibility certification or production Core Web Vitals. Fixture OAuth/mail/AI calls never count as successful live integrations. See [release gates](docs/RELEASE.md).
