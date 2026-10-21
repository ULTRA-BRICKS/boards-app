# Compiled entry, retained save snapshots and row-local completion

Related tasks: HYP-1737, HYP-1739, HYP-1740. Baseline source: `90d06a8a38ab5bddb5922b43a56e8a4073090b2b`. Work remains in its separate research branch; no main/production promotion.

## Implemented boundary

The board's fixed entry calls canonical `state build`, retaining authored library metadata and applying the same bundler to both implementations. Explicit booleans remove dormant engines and URL backend dispatch; an ordinary bundle-only build isolates the common linking/minification effect. The existing uncompiled builds still work. Previous output survives failed compilation.

The save queue now captures only library-certified immutable roots by reference. Unowned input is still cloned; the outgoing sender receives a separate private copy, preserving mutations, conflicts/retries and in-flight/newer-value isolation. Completion changes use the library's pure immutable-row adapter and an app-specific field projection. All target DOM nodes are verified before visible writes. Moves, text edits, unexpected fields/order/keys and missing nodes fall back to the original renderer. No remote execution or asynchronous delay is inserted into input handling.

## Reproduction

Set `STATE_BUILD_CLI` to `packages/state-lib/cli/bin/state` in the canonical feature branch. Run `npm run verify`, `node scripts/scan-board-state.mjs`, `node scripts/validate-state-manifest.mjs`, and `node --test tests/state-specialized-build.mjs`. For the emitted application use `MIGRATION_COMPILED_ROOT=dist/specialized-test node tests/state-migration-browser.mjs`. The declared labels are frozen in emitted code, not selected by a query parameter.

Trusted-click evidence is produced by `scripts/benchmark-compiled-board.mjs` using `BENCH_ENGINE=chromium` or `webkit` and distinct `BENCH_EVIDENCE` directories. It uses actual application commands and its synthetic in-memory API, never production data. Read the method and limits in the saved JSON. A previous capture-microtask timing was rejected because it could run before the application's event handler; the final window-bubble measurement asserts committed output at its endpoint.

## Checks before final review corrections

65 canonical compiler tests, 53 capture/COW/row contract tests, 392 board unit tests, four static-build contracts and 28 compiled-browser scenarios pass. The application inventory covers 28 owned state entries; the source scan sees eight shipped files with zero unregistered/stale entries. Compiler-lowering and the complete product performance matrix remain separate manifest categories, not claimed complete by state ownership.

The final Chromium run at 1,200 visible rows measures median handler 32.6 → 0.8 ms and next animation-frame 165 → 10.2 ms. At 10,000 total rows (still 1,200 visible), retained JS heap after explicit GC is 15,574,328 → 4,730,908 bytes. WebKit independently preserves the same output and avoids row reconstruction. These are captured synthetic interaction observations with host load and raw samples, not field INP, peak memory or a universal worst-case certification. The one-row next-frame Chromium result slightly favours baseline, and the library retains about 29–32 KB more at the two small sizes.

Full gzip JS: previous copied distribution 68,690; bundle-only control 44,214; fixed state-lib 42,150; equally fixed baseline 37,132 bytes. Common bundling receives its credit. The state-lib result is smaller than its previous distribution but remains larger than optimized baseline. New explicit wiring and projection code do not yet establish less authored source; shared lifecycle reduction belongs to the separate HYP-1738/UB-113 workstream.

Mechanism trace: [structural sharing §4.4](https://state-lib-lab.vercel.app/spec#s4-4), [keyed collections §4.5](https://state-lib-lab.vercel.app/spec#s4-5), [compiler contract §5](https://state-lib-lab.vercel.app/spec#s5), [persistence §8.5](https://state-lib-lab.vercel.app/spec#s8-5) and [complete-entry budgets §13](https://state-lib-lab.vercel.app/spec#s13). The canonical `docs/research/2026-10-16-work-elimination/` records every source/entry hash and both full browser runs.

## Review correction status

The canonical compiler now checks the entire configuration inheritance graph and loaded source boundary and publishes complete output generations with rollback. The actual board patcher performs its popover/hover cleanup after target verification and before DOM writes, preserving the full renderer’s error ordering. Background work conservatively keeps the full renderer. Added regression assertions cover stale/no-op board selection, independent failed-build preservation, consecutive Space activation, accessible completion labels and scroll.

The numerical observations above remain pre-review records, not proof of the amended hash. The current compiler/runtime artifacts are being rebuilt and measured independently; the final code review covers this amended source. Renderer conventions and static backend decisions retain explicit module-local compile-time predicates because ordinary runtime indirection can defeat pruning. This branch does not claim reduced authored application code or full performance-matrix admission.

## Release acceptance, 21 October 2026

The tables above remain the dated pre-review record. Review corrections and a final compiler fix (single reused source inventory) were then verified on the amended source: 86 canonical compiler tests, 53 capture/COW/row contracts, 395 board unit tests and four fixed-build contracts pass. A rebuild produced runtime JavaScript, HTML and CSS byte-identical to the artifacts that passed all 28 compiled-browser scenarios, so those scenarios were not repeated.

Complete entries (raw / gzip / Brotli JavaScript): equally compiled baseline 96,877 / 37,132 / 32,188; state-lib 112,148 / 42,166 / 36,470; bundle-only control 118,626 / 44,221 / 38,165. The previously copied distribution was 68,690 gzip bytes. Bundling is credited separately; the optimized baseline remains smaller than the state-lib entry.

Trusted-click medians, baseline → state-lib, with seven measured pages per case under shared host load (about 5 to 7): Chromium handler 1.6 → 0.5, 3.7 → 0.6, 63.2 → 1, 90.4 → 0.9 ms and next frame 11.1 → 11, 14.2 → 9.9, 311 → 13.8, 312.2 → 12.5 ms at 1, 30, 1,200 and 10,000 total rows (1,200 visible at the largest). WebKit handler 2 → 1, 4 → 1, 93 → 1, 167 → 2 ms and next frame 25 → 25, 24 → 23, 546 → 7, 611 → 8 ms. Chromium retained heap at 10,000 rows is 15,584,456 → 4,731,016 bytes, but about 38 KB and 32 KB higher at one and 30 rows. The one-row frame result is a tie. These are synthetic completion-path observations, not field INP, network timing or a universal guarantee. Raw samples, load, per-file inventories, screenshots and source hashes are in the canonical `docs/research/2026-10-16-work-elimination/release-20261021/`; the full table is in the canonical report. Mechanism links: [§4.4](https://state-lib-lab.vercel.app/spec#s4-4), [§4.5](https://state-lib-lab.vercel.app/spec#s4-5), [§5](https://state-lib-lab.vercel.app/spec#s5), [§8.5](https://state-lib-lab.vercel.app/spec#s8-5), [§13](https://state-lib-lab.vercel.app/spec#s13).

Still separate and unproven: reduced authored source, general edge-case admission, other actions and Tasks, shared lifecycle reduction (HYP-1738/UB-113) and four independent cloud applications.
