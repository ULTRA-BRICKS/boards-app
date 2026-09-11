# Isolated cloud prototype — 2026-09-11

## Entrypoints

- [Notebook](https://rawcdn.githack.com/ultrabricks/boards-app/89a117f152df5720705716a25eb59d087d433433/apps/prototype/index.html)
- [Separate Conloca Sans specimen](https://rawcdn.githack.com/ultrabricks/boards-app/89a117f152df5720705716a25eb59d087d433433/apps/prototype/type.html)

Both are immutable source-hosted pages, not a Vercel deployment. The CDN may show its first-visit content confirmation. The frontend and its imported assets are pinned to repository commits, rather than mutable third-party package URLs.

**Do not treat the external browser-to-cloud path as verified yet.** The current execution environment could render the actual page source in Chromium and execute real PostgreSQL operations through the authorized Neon connector, but could not navigate Chromium to the hosted URL or independently check the CDN/Auth/Data API HTTPS and CORS responses. Browser tests used an explicitly identified fixture RPC transport. This is a concrete deployment candidate with a deployed persistence backend, not a claim that every network hop or production login has passed.

## Architecture and isolation

The additional database is `boards_prototype`, project `crimson-hall-13043037`, branch `br-quiet-wind-aylocgl0`. It is separate from the original `scriptboard` database. Original team tasks, email addresses, profile images and identities were not copied into this public prototype or modified.

Neon Auth was provisioned for the prototype database. The UI uses only its anonymous-token endpoint, with the official `GET /token/anonymous` contract. No signed-in user is fabricated, and the interface does not impersonate a Google/Slack/GitHub account. Auth defaults advertise a shared Google provider and mail sender; these are not exercised or presented as working sign-in in this prototype.

The Data API exposes only `prototype_api`. Private tables are in `prototype_private`, with table/schema privileges revoked from public, anonymous and authenticated roles. Only three narrow functions have execute grants:

- `notebook`: create/read/version-checked update for a cryptographically random editing capability;
- `share_notebook`: validate a selected view and issue/revoke an independent read-only capability;
- `read_shared`: read the latest saved state projected through that share's scope.

Capability values are SHA-256 hashed in database records. The editing key stays in the URL fragment and is submitted in POST JSON, not a public query string or localStorage. Losing the address means losing access; there is no account recovery. The static host is shared infrastructure, so this prototype must not be used for sensitive material. A normal dedicated origin and real authenticated identities remain release requirements.

This is deliberately bounded to 200 notebooks, 50 issued share links per notebook, 30 pages, 100 sample assignees and 512 KiB per document. These are storage guards, not a general-purpose abuse prevention or billing guarantee. Anyone who has an editing capability can change that notebook. It is not an audited identity platform.

## Verified in actual Neon PostgreSQL

`deploy/prototype/selftest.sql` has 22 adversarial assertions. They ran against the deployed functions and passed. Test mutations are inside an exception subtransaction and are rolled back. Checks cover:

- creation, version and UTF-8/emoji preservation;
- wrong/short capabilities, stale writes and duplicate-create protection;
- absent schema version, null assignees, oversized task text and invalid selections;
- removal of private workspace name, contact fields and unselected neighboring tasks;
- current-state projection after an edit, foreign-owner revocation refusal and revoked-link refusal;
- absence of anonymous SELECT/UPDATE/schema-usage privileges on private storage;
- unchanged table count after rolling back fixtures.

Review found and fixed two real SQL validation issues: NULL did not fail a plain `<>` schema-version comparison, and empty selections required an explicit empty-array aggregate instead of NULL. A null assignee is also rejected explicitly.

A separate committed persistence check created one harmless verification notebook. A later independent SQL transaction switched to the **anonymous** role and read version 1 and the exact Cyrillic/emoji task text. This proves committed database durability and the least-privileged RPC contract, **not** an HTTP gateway test. The verification editing key is not published in source, reports or screenshots.

## Verified in Chromium

The TypeScript/Bun browser harness rendered the actual HTML, stylesheet, original glyph compiler and client modules. It recorded 25 assertions, including three checks of the anonymous-token GET contract; this is not 25 unrelated end-user journeys. No uncaught client exception was recorded.

The checked behavior includes 15 seed tasks, no app header/logo, Unicode editing, a second browser loading saved fixture state, HTML injection staying plain text, `@` assignment, overlapping avatars and hover elevation, immediate search, item-only read-only views, link revocation, thumbnail page creation without a modal form, new-column creation, widths 320/393/768/1448, failed-save blocking, retained drafts and successful retry.

Images are real screenshots, not generated UI illustrations. They were captured from this source with fixture transport. A screenshot is not evidence of a live provider or successful production request. The test is `tests/prototype-browser.ts`; its report explicitly states this boundary.

## Not included in this isolated prototype

Real provider account login/linking, avatar approval workflows, invitation email, Slack/Linear/GitHub integration, semantic model inference, generated artwork, photo transcription, service-worker shell and OpenGraph messenger images are not claimed here. The full application has separate source/adapters for many of these, and the Bun/Oxc migration remains PR #2 until ordinary source and its own checks are accepted. No whole-application 80% coverage claim is made.

## Publish review

This change is an additive prototype directory, SQL deployment recipe, test harness, documentation and public entrypoint links. It does not modify the prior main application's runtime or merge the unfinished Bun staging package. Existing CI results must not be attached to this new commit as if they were fresh. A hosted smoke check remains outstanding and should test the actual anonymous token, CORS, create/read/update/conflict/share/revoke chain from a browser with normal network access.
