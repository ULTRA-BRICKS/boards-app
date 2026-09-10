# Release gate — Bun checkpoint

Canonical repository: `ultrabricks/boards-app`.

## Proven source versus deployed service

A real service URL is still required before declaring the product released. The connected Vercel tool exposes `deploy_to_vercel()` without parameters, while its backend requires `name`, `target` and `files`. Read-only project actions work; the connected team currently has no `boards-app` project. No unrelated project has been repurposed. Neon Functions currently has no deployed board function. Neither an unexecuted CLI command nor the generated portable type HTML is a hosted service.

The application can be deployed from a normal authorized CLI with `bun run deploy`. The exact HTTPS `APP_ORIGIN`, Neon connection, owner email and an actual login provider must be configured. Secrets must never go in a repository, issue, public build variable or screenshot.

## Release acceptance

- [ ] A real public board URL, added here and at the top of README after verification.
- [ ] A separate hosted type-specimen URL.
- [ ] Real sign-in through a configured provider and correct invite-only admission.
- [ ] Cloud save/reload across two independent authenticated browser sessions.
- [ ] Actual approved avatar fetch and confirmation flow with non-test users.
- [ ] Email delivery through a verified sender, not a mocked transport.
- [ ] Bounded actual image generation and reviewed photo transcription.
- [ ] Production cold/warm loading and interaction measurements.
- [ ] Field accessibility/mobile checks beyond automated CI engines.

Do not close these items based on fixture tests. The existing private Neon document must be preserved. Source comments, screenshots and test counts are not proof of deployment.

## Toolchain migration

Bun runs application dev/build/tests; Oxfmt and Oxc parse/lint sources. Playwright is TypeScript, and variable-font validation uses fontkit in memory. Normal workflows do not install Python. The former Python E5 evaluation is retained only as historical measured documentation; no current hosted embedding provider is implied. Cloudflare or an authorized HTTP/Ollama embedding endpoint remains optional.

The provider-specific Neon function package may target Node 24 because that provider's function runtime requires it; this does not make Node the application's development/test runtime. Vercel's Bun runtime configuration is used for the board.

## Coverage scope

The line/function percentage covers every `server/` and `packages/core/` source file. Missing coverage records fail the gate. Browser UI, generated font geometry and scripts are not in that percentage; they have separate behavior/build/font tests. A whole-application 80% statement is not made.
