# state-lib pilot — boards-app

Branch: `pilot/state-lib-HYP-1464`. Baseline: Forgejo main `0dd04bec91785511028a6a00da7c2e4e49a489c8`.
The original `work/bun-shell-quality` worktree remains untouched. This is not a reimplementation of its unmerged features.

## Real integration, limited surface

`apps/board/app.mjs` now uses `createWorkspaceLoader` for the actual workspace/state + people load. The default implementation uses the same `@ultrabricks/state-lib` pilot package as tasks-app: one Runtime, latestTask, and one atomic result signal. It revokes obsolete requests, consumes stale errors, and promptly settles cancellation even if a provider ignores AbortSignal. Logout clears the retained private result and rejects late publication.

The old epoch strategy remains available with `?stateBackend=baseline`; the default is `state-lib`. Request order is unchanged (state then people), so improvements are not attributed to an unrelated parallel-fetch optimization. `data-workspace-backend` identifies the actual loaded implementation.

SyncQueue, document shape, undo/redo, mutation functions, URL navigation, server authorization and persistent storage are unchanged. This is not yet a normalized document-store migration or a claim of remote-safe collaborative undo.

## Package and tests

The source-pinned private package is under `packages/state-lib`; its provenance and compiled hashes match tasks-app. There is no remote package publication. Build/dev serving includes only the exact approved JavaScript modules, not arbitrary files.

`node --test tests/state-lib-loader.test.mjs` compares both strategies for out-of-order success and verifies current errors, cancellation, stale rejection and cleanup for the pilot. The real app browser A/B run and all baseline tests must pass before any production promotion. Synthetic local test data is used; cloud workspaces are untouched.

Run `LOCAL_TEST_MODE=1 PORT=6111 node scripts/dev.mjs`, then compare `/` and `/?stateBackend=baseline`. The existing Node toolchain on this main baseline is retained; the separate Bun migration branch is not overwritten or silently folded into this pilot.

## Executed comparison

All97 Node tests passed, including five pilot-loader contracts; both board/type builds passed. The real app was exercised in Chromium and WebKit with both baseline and pilot loaders: synthetic sign-in, task toggle and actual save response, Undo, reload, mobile layout, sign-out. All4 browser combinations passed without page exceptions. The4 matched desktop/mobile screenshot pairs were pixel-identical.
The baseline already prevents an old successful load from replacing a newer one. The pilot additionally settles cancelled/superseded callers promptly, requests transport cancellation and consumes obsolete rejection paths. These are directly tested behaviors, not a fabricated page-load speedup.
Whole-document mutation, full snapshot cloning for Undo and SyncQueue remain baseline mechanisms. The next domain-store migration needs independent history/remote-edit and normalized-read contracts; this pilot does not declare those solved.

## Static output contract correction — 17 September

The board production build now copies only `index.js`, `core.js`, `latest-task.js` and `external-store.js`, matching the dev server's runtime allowlist. It no longer recursively publishes declaration files or incidental files from the vendor directory. The runtime package and all module bytes are unchanged.

A build-output regression failed on the old recursive copy and passes on the explicit file list. The complete suite now has98passing tests, followed by both successful builds. The earlier real-browser A/B behavior evidence is unchanged; this new check covers the actual generated production asset set.
