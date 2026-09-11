# Boards

## Open the prototype

**[Cloud notebook prototype](https://rawcdn.githack.com/ultrabricks/boards-app/89a117f152df5720705716a25eb59d087d433433/apps/prototype/index.html)** · **[Separate Conloca Sans specimen](https://rawcdn.githack.com/ultrabricks/boards-app/89a117f152df5720705716a25eb59d087d433433/apps/prototype/type.html)**

These are immutable source-hosted entrypoints through rawgit.hack, not a Vercel deployment. The notebook talks directly to the separate Neon **`boards_prototype`** database through a restricted Data API. No database password, provider secret or original team data is sent to the browser. The static host may display its standard first-visit confirmation.

**Verification boundary:** the PostgreSQL functions were deployed and tested against real Neon; a committed write was read in a later transaction as the anonymous role. The actual interface passed Chromium interaction checks with a fixture RPC transport. The external CDN → browser → Auth/Data API HTTPS/CORS path could not be independently checked from the restricted runner, and is not claimed as a completed production smoke test. [Exact review and scope](docs/PROTOTYPE-2026-09-11.md).

### Using this prototype

Opening the notebook without a key creates a separate sample workspace with the 15 original thoughts. Bookmark the resulting address. Its `#key=…` fragment is the **private editing capability**, not a public share link; do not send it to other people unless they should edit. Use **Share** to make a revocable read-only link. There are no production accounts or account recovery in this prototype. Do not put sensitive data in it.

Pages, columns and thoughts are editable in place. Create a page through its thumbnail, then type its title directly. Avatars overlap in a chain, with hover elevation; `@Name` plus Enter assigns a sample person. Search responds from the loaded workspace immediately. Cloud writes use version checks; conflicts stop editing rather than silently overwrite another session. Failed saves offer retry and a draft backup, never a hidden local-only mode.

The prototype deliberately does **not** pretend that Google/Slack/GitHub sign-in, email invitations, provider linking, generated artwork, photo transcription or messenger OpenGraph cards are live. Those belong to the full application's separate provider adapters. The original `scriptboard` database and its team workspace were not modified.

## Full application and Bun migration

The repository also contains the fuller board backend, identity/linking flows, deterministic PNG previews and provider adapters. The Bun/Oxc/Nx migration remains in [PR #2](https://github.com/ultrabricks/boards-app/pull/2); it must not be described as merged or fully verified merely because the isolated prototype is accessible. The older root commands still reflect the previous runtime until that migration is accepted.

The prototype is plain browser ES modules plus PostgreSQL RPCs: no container, Python server or Node process is required to host it. The new browser harness is TypeScript and runs with Bun:

```sh
bun install
bunx --bun playwright install chromium
bun tests/prototype-browser.ts
```

Set `CHROMIUM_PATH` for a system Chromium. This harness uses actual HTML/CSS/modules and a fixture RPC transport; it is explicitly not a production cookie/CORS test. `deploy/prototype/selftest.sql` exercises the actual PostgreSQL functions using rolled-back fixtures. The schema is in `deploy/prototype/schema.sql` and is intended only for the isolated prototype database.

## Visual reference

These existing images come from the last successful full-application native CI run, not the new prototype harness. Their [manifest](https://github.com/ultrabricks/boards-app/blob/visual-evidence/evidence.json) records the source and run. Current prototype screenshots are produced by its TypeScript harness and attached to the delivery conversation; they are not generated UI mockups.

![Paper board](https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/board-desktop.png)

<details><summary>Mobile and independent type specimen</summary>

<img width="393" alt="Mobile board" src="https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/board-mobile-viewport.png">

![Conloca type specimen](https://raw.githubusercontent.com/ultrabricks/boards-app/visual-evidence/screenshots/type-site.png)

</details>

## Source and operational limits

[Roadmap](ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) · [Provider setup](docs/SETUP.md) · [Security](SECURITY.md) · [Previous full-app review](docs/REVIEW-2026-09-10.md) · [GitHub Actions](https://github.com/ultrabricks/boards-app/actions)

The prototype is bounded to 200 isolated notebooks, 50 share links per notebook and a 512 KB document. It is a demonstration, not an audited multi-tenant identity platform. The static host has no uptime guarantee. Keep backups. Revoking a share prevents new reads but cannot remove screenshots someone already saved.

The Conloca specimen is separate from the board. It contains original editable glyph geometry and a compiler, not a packaged font binary. The variable file is constructed on the visitor's device. Neither a test matrix count nor server-only coverage should be reported as whole-application coverage.
