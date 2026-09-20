## Current published correction — 20 September 2026

Boards source: `2d24ad478f6736e0aa42dffb1cb812308ea5eafe`. Canonical source: `1a6d08481ce82f5fc57998b092b117b420eba06b`. HYP-1505 is fixed; the historical 19 September report remains an earlier experiment, not the current correctness status. This branch is still an explicit laboratory opt-in, not performance-qualified default COW. No main merge or deployment.

# COW qualification, generated code and a hybrid algorithm plan

Research date: 20 September 2026. Tasks: HYP-1500, HYP-1504, HYP-1505. This report separates the current implementation, the canonical specification, supplied research, new primary-source reading and new measurements.

## 1. What is actually selected today

The normal Boards pilot uses the full-copy state-lib document adapter. The separate `research/state-cow-HYP-1500` branch exposes COW only through the explicit `?stateBackend=state-lib-cow` laboratory selector. It does not automatically choose COW for individual application operations. Moreover, that research branch statically imports the helper, so not using its algorithm by default does not mean its bytes are absent from that laboratory bundle. The earlier pilot branch is unchanged.

`state build` selects explicitly declared implementation modules, not arbitrary statements inside every callback. It can already statically select a qualified projection, and this continuation adds native generation of that projection from field declarations. The whole COW document candidate is still rejected after the correctness fix because required performance cells fail. Per-command COW/dense-builder selection is the next architecture step, not a hidden existing feature.

There are two different baselines: B0 is the original mutable application before state-lib; B1 is the full-copy Runtime adapter with stronger immutable ownership guarantees. The optional compiler's byte-identical fallback preserves B1. It does NOT establish that B1 is as fast as B0. Meeting the user's end-to-end B0 budget remains a separate requirement without dropping the stronger contract.

## 2. Tool-boundary diagnosis and successful correction

The plugin-specific permission was already “Allow all actions”; the remote tool reported unrestricted directory access. No permission, allowlist, safety setting or Git hook was relaxed. A compound read-only terminal request was nevertheless rejected with “couldn't determine the safety status.” The tool did not expose a more detailed classifier reason. It is therefore unsupported to attribute that rejection to filesystem permissions or to promise that a permission-mode change would fix it.

A direct file read, one test command, and one explicitly bounded, precondition-checked source edit succeeded through the same connector. This is an observed working procedure, not a guaranteed rule of the safety classifier. Failed calls are not evidence that files changed. Future uncertain rejections still require preserving state and reading the actual result; no alternate transport or encoded execution is used to evade them.

The source correction distinguishes an explicit historical immutable edge from a handle into the live transaction. Historical edges are tagged before the no-op assignment check; parent propagation ignores those edges; finalization resolves active proxies rather than treating every known base object as a live draft. Reattaching an actual draft clears the historical-edge tag. The five previous failures became green without changing their expectations: **21/21 COW contracts**, including 300 mixed operations. The original Boards document adapter suite also passed **19/19** with the corrected helper. The full common browser scenario passed all six Chromium/WebKit/backend combinations.

## 3. New measured state: correctness fixed, global speed gate still fails

Same real controller benchmark as the prior report: 17 alternating recorded batches after three warmups, 80 operations per batch except dense writes (20); construction/import, DOM and network excluded. Three sizes, seven operation classes, outcome parity checked across implementations. Values below are median batch-mean milliseconds at 1,200 tasks.

| Operation        | B0 original | B1 full-copy Runtime | Corrected COW |
| ---------------- | ----------: | -------------------: | ------------: |
| One item         |     0.45627 |              1.34130 |       0.01215 |
| Every tenth item |     0.46614 |              1.38765 |       0.20122 |
| All items        |     0.47931 |              1.37986 |       1.42894 |
| Move item        |     0.46384 |              1.35116 |       0.51234 |

Only **13/21** cells pass the conservative `max(candidate) <= min(baseline)` check against B0. The new admission run sees 21 passing correctness tests but still rejects COW for performance; its automatic output is identical to explicit B1: **11,408 raw / 4,288 gzip bytes**. The runner now checks that measured source hashes and the independently tested helper match before constructing a fresh profile. Historical timing data is not attached to newly edited code.

“Worst case” has three distinct meanings here: worst declared workload, maximum observed sample, and a mathematical bound over all possible executions. The current gate addresses the first two in a finite test matrix. It does not prove the third, nor does a historical maximum estimate every browser's future scheduling. At 17 samples, nearest-rank P95 is the observed maximum. One winning mean cannot cancel a losing cell.

## 4. Check against the specification and supplied research

The canonical v0.6 master specification §4.4 requires structural sharing and one copied container per touched container, patches only when consumed, rollback and synchronous transaction semantics. It says no production auto-freeze, with freeze in development. The current research adapter's always-frozen snapshots are a stronger, measured app contract; silently disabling those tests would not be an optimization of the same contract. A spec-production mode must be tested separately with its own ownership/escape guarantees and labels.

Sections 4.5 and 5 already point toward the required combination: keyed `ids/byId` collections, per-item subscriptions, change-aware views, and elimination of proxy reads when the compiler proves the shape. Their intended effect is to avoid copying entity payloads when only ordering changes and to avoid notifying all rows after one row changes. The optional compiler must preserve observable behavior. The appended old v0.2 spec is evidence of original intent, not a replacement for current REQUIREMENTS/DECISIONS/v0.6.

The supplied GRC proposal contributes the idea of moving known accesses into generated code; its unresolved enumeration, receiver and foreign-code boundaries remain real. Its prototype `ownKeys` claim was already contradicted by executable tests. The supplied Wasm report's four-axis split remains essential: algorithm, representation, executor and placement are separate. The “beyond push-pull” report motivates a separate incremental collection/query layer, not replacing every scalar UI update with a database engine. These are source-derived directions, not measurements of the hybrid proposed below.

## 5. Existing and recent algorithms: what transfers, what does not

| Family / primary source                     | Useful part for state-lib                                                                                   | Boundary before adoption                                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transient builders [A1]                     | Copy a changed node once under a private edit owner, then perform a batch without rebuilding the same paths | Clojure invalidates transients after publication; our detached escaped-draft behavior is different and must be retained or explicitly compiled away under a proof |
| HAMT / CHAMP [A2]                           | Persistent keyed storage, compact nodes and better traversal/locality than naive pointer-heavy tries        | JVM measurements are not JS results; hash collisions and string-to-ID indexing need their own worst cases                                                         |
| RRB vectors [A3]                            | Structural split/concatenation and persistent ordered IDs instead of moving full row objects                | Tiny bounded arrays may still win; concatenation complexity is not a constant-factor guarantee for browser workloads                                              |
| Blocked leaves / PaC trees [A4]             | Batch work over compact leaf arrays, copying each affected leaf once                                        | Compression and block rebuilding can hurt point updates; validate leaf size and representation, do not copy C++ speed claims                                      |
| Perceus reuse analysis [A5]                 | Mutate uniquely owned construction buffers while presenting a functional result                             | JavaScript WeakMap is not a reference-count oracle; escaped or historically shared nodes cannot be mutated based on guesswork                                     |
| Snapshottable stores [A6]                   | Low-overhead current-state writes with capture/restore, useful for backtracking/transaction internals       | Restore-oriented mutable references are not automatically simultaneous plain immutable snapshots held by React readers                                            |
| Persistent amortised analysis, 2026 [A7]    | Proves why ordinary amortised accounting can fail when users branch from old versions                       | Undo/branch/replay tests must repeatedly reuse old roots; average linear-history cost is not the required worst-case guarantee                                    |
| Persistent iterators, 2026 [A8]             | Version-pinned traversal and value semantics can avoid invalidation during batched processing               | C++ iterator/library results do not make arbitrary JavaScript callbacks pure or their references safe                                                             |
| Modern Immer array-method optimization [A9] | Read-only search can avoid per-element draft proxies before editing the selected element                    | Its optimized callbacks receive base values rather than drafts; copying that behavior blindly would lose writes in callbacks                                      |

These sources support mechanisms and caveats, not a theorem that combining all of them is always faster. The architecture below is our testable synthesis. No third-party benchmark multiplier is treated as a state-lib result.

## 6. Proposed hybrid: select the command shape, not a universal COW mode

**Small scalar or point edit:** generated direct field access and path copying, with one owner-tagged copy per touched container. For large keyed collections, compare a paged integer-ID table against CHAMP; preserve a small-array baseline when its complete workload contract is better. Avoid a linear `find` through draft proxies: when a read-only selector is proved, locate on the immutable base, then draft only the selected path.

**Known dense update:** generate a single leaf-wise builder. Read old scalar values directly, construct each changed row once, publish the batch once. Do not first pay a proxy pass and then retry the callback through a different algorithm; callbacks may have side effects, and the first pass already spent time. A private builder is mutable only until publication. This is transient-style construction, not mutation of a shared snapshot.

**Reorder or move:** split ordered IDs from entity payloads. Change the two order sequences without copying row contents or running a full entity-validation pass. Use RRB/chunked sequences only where measured size/operation bounds justify them. References and entity deletions still need a version/ownership contract. This changes representation and must be compared separately from the executor.

**Unknown callback / unknown alias effects:** retain the conforming general path until proof and workload coverage exist. Compile-time optimization cannot know a future arbitrary mutation density. Separate declared commands such as `setOne`, `updateAll` and `reorder` permit static choice; a generic command with runtime-dependent cardinality needs either a bounded common algorithm, explicit size-specialized build contract or an openly documented runtime branch. Calling such a runtime decision “fully compiled away” would be false.

A single hybrid data structure may contain ordinary node-fullness or ownership checks; this is not the same as dynamic feature detection or a runtime profiler choosing an executor. Conversely, moving between JS/Wasm/worker authoritative stores on each operation would add conversions and queues. Keep UI synchronization and one Runtime; test Wasm/worker residency only for independently qualified heavy kernels. The existing three-engine measurements do not prove that COW pointer bookkeeping itself belongs in Wasm.

### Cost target, not a claim already met

Sparse work should scale with changed paths/chunks; dense work should traverse each affected leaf once. Materializing n genuinely changed rows still requires at least proportional output work. The target is a tight linear dense path rather than universal sublinear updates. Repeated operations on the same historical root, split/join boundaries, very long columns, near-zero changes, alias restoration, exceptions and escaped references are explicit adversarial cases. A late threshold switch that has already paid generic-proxy costs cannot promise zero worst-case overhead relative to starting with the right algorithm.

## 7. A new dense-path probe

A narrow handwritten compiler-target prototype directly constructs frozen rows for one known scalar `text` assignment. In a data-only fixture with 1,200 rows and the last 40 output versions retained, median batch-mean times were **1.232 ms full copy, 1.559 ms generic COW, 0.0292 ms direct builder**. The builder's maximum batch mean was 0.0694 ms. The experiment uses 17 alternating batches after three warmups and checks every retained row, not just a count.

This establishes that the generic-draft overhead is not necessary for this restricted transformation. It is NOT a complete application improvement: Runtime/history bookkeeping, import/schema validation, arbitrary callback semantics, DOM, general alias graphs and registration of direct outputs in the COW ownership system are excluded. The direct updater is not yet emitted by the compiler and cannot simply be mixed with the generic helper without that ownership bridge. No production selection was enabled from this probe.

## 8. Native generation now works for projections

The previously missing Rust `projection.rs` now generates a named projection from its field declaration. Modules exist virtually in the bundler and source map, not as files that overwrite authored code. Generated computed property names preserve `__proto__` as data. Duplicate/non-string field lists, invalid exports, path collisions/escapes and unsupported executor contracts are rejected. The generated JS is parsed by Oxc before selection.

All **18 existing CLI tests and 11 generator contracts pass**. A fresh benchmark calls the actual Rust-generated function, checks 5,000 object results plus getter order, and builds the qualified variant. Output is **171 to 64 raw bytes and 153 to 80 gzip bytes** in this new fixture, with zero authored candidate implementation files. Previous gzip155 belonged to the earlier fixture and is not silently substituted. No manual candidate body is required now, but this does not establish fewer lines across a whole application; tooling and declarations have costs too.

## 9. Next implementation and admission order

1. Publish and review the historical-reference correction separately from any performance-promotion claim. Preserve all 21 expectations and run the actual app adapter/browser paths. HYP-1505 is a correctness issue, not permission to enable COW everywhere.
2. Extend the now-working generator from projection to a narrowly specified immutable point updater and a dense leaf builder. Use one shared ownership/commit interface and the existing Runtime; no second reactive kernel. Compare compiled/uncompiled behavior, side effects, old roots, no-op/history semantics, failure and rollback.
3. Expose separate command boundaries to the compile-time planner. Benchmark each against both B1 equivalence and the B0 latency budget, including long unbounded columns, read-heavy searches, bulk edits, retained histories and cold paths. Do not promote a whole slice based only on the one-item result.
4. Compare normalized ID ordering with a short-array baseline and an RRB/paged representation on actual moves. Include materialization, memory and import/conversion cost. Then pair the winning state path with per-item/keyed rendering under HYP-1501; state-only speedup is not frame speedup.
5. Enforce a vector of hard gates: no known correctness failure; no required latency regression; emitted route bytes and retained/peak memory; fewer authored effects/branches/casts; preserved caret/IME/focus/keyboard/announcements. Readability needs independent developer tasks, not a minifier statistic. Physical-mobile and production field metrics are still missing.

## 10. Reproducibility and sources

Current evidence lives in this directory: `results/controller.json`, `results/compile-gate.json`, `results/generated-profile.json`, `results/generated-manifest.json`, `results/dense-probe.json`. The controller runner is in the Boards research branch. The compiler admission runner at `../2026-09-19-cow/verify-selection.mjs` accepts a separate dated results directory and verifies the measured source before admission. Source maps preserve generated projection code. Older reports/results remain historical rather than being rewritten to match a new conclusion.

Run `python3 tests/compiler/test_cli.py` and `python3 tests/compiler/test_generated.py` from `packages/state-lib`; run `node --test experiments/2026-09-19-cow/json-draft.test.mjs` for the repaired COW contract. `node experiments/2026-09-20-hybrid/measure-generated.mjs` regenerates its fixture and trusted profile. `node experiments/2026-09-20-hybrid/dense-probe.mjs` runs the restricted data-only builder comparison. The generator does not yet produce that dense updater.

### Primary literature and official implementation sources, checked 20 September 2026

- [A1] Clojure, Transient Data Structures: https://clojure.org/reference/transients .
- [A2] Steindorfer and Vinju, Optimizing Hash-Array Mapped Tries for Fast and Lean Immutable JVM Collections, OOPSLA2015: https://ir.cwi.nl/pub/24029 . The author's manuscript is linked, not redistributed here.
- [A3] Clojure core.rrb-vector reference (based on Bagwell/Rompf RRB trees): https://clojure.github.io/core.rrb-vector/ .
- [A4] Dhulipala, Blelloch, Gu and Sun, PaC-trees, PLDI2022: https://arxiv.org/abs/2204.06077 .
- [A5] Reinking, Xie, de Moura and Leijen, Perceus, PLDI2021: https://www.microsoft.com/en-us/research/publication/perceus-garbage-free-reference-counting-with-reuse-2/ .
- [A6] Allain, Clement, Moine and Scherer, Snapshottable Stores, ICFP2024: https://icfp24.sigplan.org/details/icfp-2024-papers/14/Snapshottable-Stores ; authors' implementation: https://ocaml.org/p/store/latest/doc/README.html .
- [A7] Lorenzen, Persistent Amortised Analysis, Operationally, 2026: https://arxiv.org/abs/2605.09411 .
- [A8] Li and Duck, Persistent Iterators with Value Semantics, 2026: https://arxiv.org/abs/2604.14072 .
- [A9] Immer, performance and array-method semantic limits: https://immerjs.github.io/immer/performance/ ; https://immerjs.github.io/immer/pitfalls/ .

Only the quoted/described mechanisms are attributed to these sources. The proposed hybrid, cost targets and our measurements are separate. No vendor benchmark or theoretical result is treated as a measurement of state-lib. Main and production are unchanged.

## Review correction before publication

The full three-role review confirmed the historical/live-reference fix, then found a separate generator-path ownership defect: a baseline, facade or ordinary candidate in another unit could borrow a virtual path. Three independent subtests reproduced it. Authored roles are now required to exist in the authored inventory; only the explicitly generating variant can own a virtual module. Authored selected entries are checked again before bundling. All 18 previous CLI tests and 11 generator tests pass after the correction. The measured projection profile was regenerated with the actual changed compiler fingerprint, and the new COW qualification again rejected performance promotion despite 21 passing conformance tests.
