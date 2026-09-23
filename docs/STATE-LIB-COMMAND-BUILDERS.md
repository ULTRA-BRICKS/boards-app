# Generated immutable commands with shared publication and byte budgets

**Date:** 2026-09-23. **Task:** HYP-1488. This is the implementation record, not a marketing article. Historical reports and their timings remain unchanged.

## Implemented combination

The native compiler now lowers declared scalar assignment, toggle, sparse/dense row assignment, grouped assignment, move and no-op commands to compact calls into shared immutable helpers. It does not copy a large implementation body into every generated function. Arbitrary JavaScript callbacks still use the separate general draft adapter.

Point commands copy the changed path. Batch commands construct changed rows in one private pass and retain unchanged rows. Moves copy order containers and retain row payloads, combining shared ancestors once. Shared graph inputs use a conservative copying path rather than pretending they are trees. All published outputs retain the measured immutable ownership contract; no freeze, alias, rollback or synchronous-notification expectation was deleted for performance.

Certified dense arrays use an engine-friendly copy path. Certification occurs at the existing import boundary. Sparse arrays retain holes through indexed copying; custom iteration does not silently change values. A negative test also caught an untrusted array overriding `slice` to return itself; the fallback now invokes the captured intrinsic. Density certificates are internal, not a user assertion.

The extracted `createDocumentPublication` takes one dedicated, disposal-owned Runtime. One atomic signal contains document/history and a cached public snapshot. Generic `.change` and declared `.apply` share that ownership, history, notification and cleanup mechanism. The callback adapter supplies draft creation separately, so a declared command entry does not need to ship the Proxy engine. This is not a second reactive kernel.

## Actual controller result

The measured entry includes the real document controller's Runtime, bounded history and publication. Six document sizes (0,1,30,300,1200,10000) and seven operation classes produce 42 cells. Each has 17 recorded alternating batches after three warmups. The largest fixture is a single 10000-item column plus an empty destination, not a conveniently bounded 200-item leaf. The suite verifies 2520 cross-backend document results.

Medians below are **milliseconds per operation averaged inside a batch**. Construction/import, DOM, network and peak memory are excluded. B0 is the unchanged original mutable application; the generated path keeps stronger immutable ownership. A positive comparison does not make those contracts identical.

| Items | Operation    | Original B0 | Generated command with publication |
| ----: | ------------ | ----------: | ---------------------------------: |
|     1 | Point update |   0.0020548 |                          0.0014248 |
|     1 | Dense update |   0.0020781 |                          0.0013757 |
|     1 | Move         |   0.0021336 |                          0.0017379 |
|  1200 | Point update |    0.443271 |                           0.002965 |
|  1200 | Dense update |    0.456649 |                           0.276127 |
|  1200 | Move         |    0.453188 |                           0.003470 |
| 10000 | Point update |    4.147521 |                           0.006245 |
| 10000 | Dense update |    4.332281 |                           2.497547 |
| 10000 | Move         |    4.175078 |                           0.007594 |

All 42 Node medians are lower than B0 in this run. That is a real improvement over the previous generic-COW dense/move result, not full admission: only 26/42 cells satisfy the deliberately conservative `max(candidate) <= min(original)` sample rule. Tail overlap and very small cases remain explicit. The unmodified qualification rule therefore retains reference modules. It is not relaxed to turn the median result into a universal claim.

## Real entry bytes, not function-only accounting

The catalogue experiment measures 1,16,128 and512 distinct command exports. Both full entry variants expose the same command-publication factory, Runtime and history; the reference implementations use ordinary COW, while generated modules import narrow helpers. All reachable dependencies count. Debug source maps do not count as runtime transfer.

| Commands | Reference raw | Generated raw | Reference gzip | Generated gzip | Reference Brotli | Generated Brotli |
| -------: | ------------: | ------------: | -------------: | -------------: | ---------------: | ---------------: |
|        1 |         13041 |         11329 |           4691 |           4113 |             4164 |             3653 |
|       16 |         14693 |         12196 |           4880 |           4264 |             4314 |             3749 |
|      128 |         27293 |         18860 |           6014 |           5326 |             4854 |             4254 |
|      512 |         71069 |         42284 |           9525 |           8619 |             6596 |             5779 |

Every reported size decreases in these paired entries. The result depends on extracting the shared publication boundary: the earlier diagnostic build statically kept both laboratory callback engines and grew gzip despite smaller command functions. That negative observation is preserved with the earlier samples. It was not excluded while pretending the entry was unchanged; the later pair exports the same deliberately command-only contract on both sides.

The compiler now reports raw/gzip/Brotli and enforces both relative growth rejection and optional absolute project limits: `maxRawBytes`, `maxGzipBytes`, `maxBrotliBytes`. A reference fallback exceeding an absolute limit is an error, not an exemption. Rejected output leaves the prior generated directory unchanged. Unknown/misspelled, boolean, fractional or negative budget values fail validation.

This implemented gate measures the emitted JavaScript entry graph. It does not yet prove budgets for every unrelated route or optional worker/Wasm asset. Unreferenced features are absent; a future multi-entry deployment budget must explicitly include its additional artifacts. No giant fully unrolled updater is justified merely by a fast kernel.

## Browser and edge verification

The same controller/commands ran in Chromium153.0.8010.12, Firefox155.0 and WebKit26.6, five sizes and seven operations per engine. Each engine checked1260 cross-backend outputs. This is a synthetic controller test in installed automation builds, not a physical-mobile or UI-frame/INP measurement. At1200items, dense medians were about0.258→0.183ms in Chromium,0.500→0.250ms in Firefox and0.583→0.167ms in WebKit. Timing resolution produces zero observations on some short operations; those are not evidence of free work. Tiny Firefox/Chromium cases are not uniformly faster, so cross-browser edge admission is still open.

Correctness verification includes 47 Node tests for historical COW, declared construction, sparse holes, untrusted copying, alias graphs, old-root branching and invalid indices. Six separate Bun tests use the canonical real Runtime for shared publication, bounded history, rollback, asynchronous rejection and expiration of draft-exposure capabilities. The real app passes125 ordinary unit tests and the original19COW contracts. The expanded native/compiler suite has44 tests, including generation and absolute/relative byte-budget behavior.

## Reproduce and next admission work

From `packages/state-lib`, run `python3 -m unittest discover -s tests/compiler -p 'test_*.py'`, the Node `json-draft.test.mjs` and `experiments/2026-09-23-command-builder/*.test.mjs`, and `bun test experiments/2026-09-23-command-builder/publication.test.ts`. The controller runner is `node experiments/2026-09-23-command-builder/measure.mjs /path/to/boards-research-worktree`; it verifies that the app helper and publication module match the tested canonical source. Then run `measure-size.mjs` and `measure-browser.mjs` from that experiment. Do not run unrelated load-generating suites concurrently with numerical measurements.

The raw archive retains the final Node/browser observations, the actual generated manifest/profile and the earlier negative size/computation iterations. `results/summary.json` identifies tested sources, current observations and remaining admission failures. A rejected compiler profile is not manually relabeled or promoted; changing a source invalidates it.

The remaining priority is narrow: isolate and reduce tiny-operation/tail cost across engines, repeat with sufficient timer resolution, then integrate qualified commands into representative UI actions and measure actual input-to-frame behavior. Add memory/allocation and larger-history observations; the current retained-history correctness tests are not a peak-memory benchmark. Normalized ordered IDs, paged/CHAMP/RRB alternatives and incremental query/render choices remain individually testable candidates, not a checklist silently declared done. No default COW switch or production deployment is part of this result.

Marketing is paused rather than publishing another incomplete-work story. Future articles should explain a demonstrated mechanism and user benefit, while technical reports keep the full adverse evidence. Benchmark highlighting indicates the best comparable value in a row, including ties; it is not a statistical-significance badge.
