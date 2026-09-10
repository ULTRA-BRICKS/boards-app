# Boards

A notebook-like collaborative task board. No application header or logo. The Conloca type specimen is a **separate application** in the same Nx repository.

## Roadmap and verified UI

[Delivery roadmap](ROADMAP.md) · [Review and measured results](docs/REVIEW-2026-09-10.md) · [Tracking issue #1](https://github.com/alex-mextner/boards-app/issues/1) · [CI](https://github.com/alex-mextner/boards-app/actions)

The screenshots below are rendered by the real browser tests from public sample data. They are not image-model mockups and do not prove a live cloud deployment. The [evidence manifest](https://github.com/alex-mextner/boards-app/blob/visual-evidence/evidence.json) records their exact source commit and CI run. Missing real profile pictures are shown as image silhouettes.

![Desktop board](https://raw.githubusercontent.com/alex-mextner/boards-app/visual-evidence/screenshots/board-desktop.png)

<details><summary>Mobile board and separate font site</summary>

<img alt="Mobile board" width="393" src="https://raw.githubusercontent.com/alex-mextner/boards-app/visual-evidence/screenshots/board-mobile-viewport.png">

![Independent Conloca specimen](https://raw.githubusercontent.com/alex-mextner/boards-app/visual-evidence/screenshots/type-site.png)

</details>

<details><summary>Reviewed photo-to-board draft</summary>

![Editable transcription review](https://raw.githubusercontent.com/alex-mextner/boards-app/visual-evidence/screenshots/photo-review.png)

This screenshot renders the real review UI using a test transcription, not a live vision-model result. Page, column and item text can be corrected without editing JSON; creation requires confirmation.

</details>

## Start

Node.js **22.16+**. No Docker or containers are required.

```sh
npm install
npm run setup
npm run dev
```

Open `http://127.0.0.1:5173`. With a configured Neon database and an active sign-in session, the cloud workspace opens automatically. Otherwise the app shows setup or sign-in **before** revealing an editable board. There is no silent localStorage/SQLite fallback. A disconnected save blocks further edits and offers retry or a backup.

`npm run setup` writes an ignored, mode-600 `.env.local`. It can obtain the existing `script-board` database connection through your authenticated Neon CLI. It cannot create Google/GitHub/Slack OAuth applications or verify your email sender domain without your provider account setup.

For an explicit development-only preview without cloud accounts:

```sh
LOCAL_TEST_MODE=1 npm run dev
```

This mode uses isolated SQLite and a visibly labeled test login. It refuses to start if a cloud `DATABASE_URL` is also present, so it cannot create test identities in the real workspace. It is disabled on Vercel. Never use it as production authentication. The public seed contains names and tasks, **not private emails or avatar URLs**. The existing Neon workspace is retained unchanged.

## Two applications

| Application | Development | Build | Deploy |
|---|---|---|---|
| Board | `npm run dev` | `npm run build` | `npm run deploy` |
| Type specimen | `npm run dev:type` | `npm run build:type` | `npm run deploy:type` |

Equivalent Nx targets: `npx nx dev board`, `npx nx dev type-site`, `npx nx build board`, `npx nx build type-site`.

The type site runs on port 5174. Its static deployment contains **no board API, workspace data or credentials**. It contains the editable glyph source and the browser TTF compiler, with real `wght` 300–800 and `wdth` 85–125 axes. Font binaries are generated on your own device, not committed here. This is an experimental original typeface, not a finished commercial font or a renamed third-party family.

## Publishing without GitHub

Neither CLI publishing path needs a Git repository. The font site is isolated from the board's credentials and Vercel project settings:

```sh
npm run deploy:type        # Independent Vercel static site (boards-type)
npm run deploy:type:neon   # Alternative: Neon Node 24 function (conlocatype)
```

Both require your own authenticated CLI account. No public deployment is claimed merely because the build/tests pass. See the [review](docs/REVIEW-2026-09-10.md#publishing-without-git) for the connector attempts and remaining blockers.

## Board deployment

```sh
npm run deploy
```

The script links this directory to the Vercel project `boards-app`, supplies configured production variables from `.env.local` through stdin, then requests a production deployment. CLI login remains on your computer. Set `APP_ORIGIN` to the final HTTPS URL **before** configuring OAuth callbacks. `npm run deploy:type` independently stages and deploys only `dist/type-site` as static files.

A push is not proof of a working cloud deployment. Verify `/api/status`, one real sign-in, a save/reload from another session, image generation, email delivery and a shared PNG in the deployed environment. Provider credentials and a working public deployment are not bundled in the repository.

See [setup and provider instructions](docs/SETUP.md), [architecture](docs/ARCHITECTURE.md), [security boundaries](SECURITY.md) and [verification notes](docs/VERIFICATION.md).

## Included

- Editable boards, columns, headings, notes and tasks; ordering, completion, undo/redo and JSON backup.
- Right-aligned photo avatars; dotted add-person circle on hover and visible touch controls. `@` selection and creation of invited people. Unresolved assignee hints are preserved until explicitly resolved.
- Google, GitHub and Slack login adapters; Resend email sign-in. Identity linking is explicit, not automatic on matching email.
- Proposed avatars: immediate for the uploader, visible to everyone only after the depicted account owner confirms. Older proposals cannot replace a newer photo; competing suggestions are superseded.
- A person view across boards; profile/account links; independently configured Slack directory import.
- GitHub issue/PR and Linear references, hover details and explicit, idempotent backlink comments.
- Workspace BM25/typo search plus optional semantic vectors, RRF ranking and bounded current-board/current-column boosts; duplicate suggestions with conservative opposite-action filtering.
- Reusable illustration metadata and cached vectors; Cloudflare FLUX generation after checking the library; app-side generation ceiling and concurrency guard.
- Photo-to-board vision draft with an editable review form and explicit confirmation. No automatic execution of text found in photographs.
- Revocable capability links for a workspace, board, column, item or selection. Current-state 1200×630 PNG previews rendered deterministically, without LLM calls or Chromium.

## Deliberate limits

One private workspace per deployment; up to 30 boards, 200 people and 1,200 items per board. Whole-workspace optimistic concurrency, **not CRDT live co-editing**. Concurrent writes surface a conflict instead of overwriting silently. Vector ranking is an exact small-corpus scan with durable caching, not a pgvector/HNSW index. External provider flows are implemented but must be validated with your own provider applications before a public rollout.

Shared previews are disclosure: recipients and messengers can retain them even after a link is revoked. Messenger caches may keep an older preview. Read-only shares omit private email addresses, Slack IDs and identity records.

## Tests

```sh
npm test
npm run build
npm run build:type
```

Browser tests require Python Playwright, installed Chromium/WebKit engines, and running board/type test servers:

```sh
LOCAL_TEST_MODE=1 npm run dev
# second terminal: npm run dev:type
# third terminal:
uv run --with playwright python tests/browser.py
uv run --with playwright python tests/browser-review.py
uv run --with playwright python tests/mobile.py
```

Set `CHROMIUM_PATH` to a system Chromium executable when needed. `--harness` is only for restricted runners: it renders the actual modules and bridges requests to the local HTTP server, but **does not test native browser cookie/OAuth redirect behavior**. Unit provider transports are fixtures, never paid calls or real comments. The independent semantic-quality workflow uses actual public model weights; its measured results and limitations are documented in the review.
