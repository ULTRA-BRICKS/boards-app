# Copy-on-write: application experiment and rejected promotion

Date: 2026-09-19. Research tasks: HYP-1500, HYP-1504. Correctness finding: HYP-1505.

## Decision

The COW candidate is **not accepted for general use**. It makes isolated edits substantially cheaper, but loses to the pre-library baseline on dense updates and structural operations. The complete new conformance suite also has three unresolved historical-snapshot-reference failures. The compiler rejected it and emitted exactly the current full-copy Runtime baseline: 11,408 raw bytes and 4,288 gzip bytes. This is a successful rejection check, not successful candidate acceptance.

The previous Boards pilot branch remains unchanged. The laboratory implementation is isolated on `research/state-cow-HYP-1500`; selecting `state-lib-cow` is explicit. No production deployment or main merge was performed.

## Experiment

The existing Boards document/history controller still owns one Runtime. Only document draft creation/finalization was replaced. Owned tree-shaped JSON snapshots copy changed ancestors, freeze the copied containers, and retain untouched subtree identities. Changed-key finalization avoids rescanning every untouched value, and repeated writes avoid repeatedly marking already-copied ancestors. Shared-reference input graphs retain the full-copy path.

This is not a normalized physical store. A changed array is still shallow-copied, and the fixture caps each column at 200 items. Structural graph checks may traverse the whole graph. Prototype/descriptor mutations are outside this experimental command grammar. General JavaScript transparency is not claimed.

The baseline before state-lib used mutable documents and did not provide all the new safety guarantees. The earlier full-copy Runtime adapter is therefore retained as a second, stronger semantic comparator. Performance against the original baseline is an additional required budget, not proof of identical safety guarantees.

## Actual controller measurements

Medians of per-operation means across 17 recorded batches, after three warmup batches. The order of the three backends alternates. Each batch executes 80 operations, except dense updates (20). Construction/import, DOM and network are excluded. Final document values are checked across all backends after every trial. The table shows 1,200 tasks, milliseconds.

| Operation | Pre-library baseline | Full-copy state-lib | COW candidate |
|---|---:|---:|---:|
| Root field | 0.46857 | 1.36101 | 0.00159 |
| One item | 0.46950 | 1.37025 | 0.01199 |
| Every tenth item | 0.47791 | 1.40068 | 0.21264 |
| All items | 0.48558 | 1.38818 | 1.42027 |
| Move item | 0.46971 | 1.37745 | 0.53954 |
| No-op command | 0.47491 | 1.37490 | 0.00130 |
| Undo + redo pair | 1.08719 | 0.00061 | 0.00055 |

The isolated one-item operation is about 39 times faster than the original baseline in this fixture. The dense operation is about 2.9 times slower. Neither statement is an application-wide speed claim. Across 30, 300 and 1,200 items and seven operations, **13 of 21** cells pass the conservative `max(candidate samples) <= min(baseline samples)` rule. Some better medians still fail that strict sample rule. The nearest-rank P95 of 17 batch means is their maximum, not a robust population-tail estimate.

## Real UI and memory

The original pre-library checkout, the full-copy candidate and COW ran through the actual Boards UI in Chromium, with local synthetic in-memory APIs. Nine recorded pages per size/backend follow two warmups; each page performs 12 real clicks. No worker/Wasm substitution or renderer redesign was made.

| Metric at 1,200 tasks | Original | Full-copy state-lib | COW |
|---|---:|---:|---:|
| Handler + DOM median, ms | 8.2 | 9.2 | 8.1 |
| Next-frame median, ms | 64.0 | 64.9 | 63.8 |
| Next-frame P95, ms | 76.1 | 77.3 | 75.0 |
| JS heap after GC, median bytes | 4,741,272 | 4,665,956 | 3,235,104 |

The large controller improvement mostly disappears in full-frame timing. The roughly 0.2 ms median difference from the original is not evidence of a meaningful general UI speedup. The unchanged full-board redraw remains the next profiling target. These are laboratory next-frame metrics, not field INP. Heap measurements exclude native DOM memory and RSS and cover only these page states, not peak memory or a leak proof.

## Size and code

The laboratory build, which includes both comparison paths, grows from the previous state-lib build's 128,747 raw / 46,183 summed gzip bytes to 137,960 raw / 48,757 summed gzip bytes: **+2,574 gzip bytes**. These are all JavaScript assets, not initial-route transfer. The draft helper itself is 257 lines including comments and blank lines. The existing document controller becomes 170 lines. Reduced authored code or improved team readability has not been demonstrated.

The measured compiler boundary is separate: its rejected-COW output equals the current full-copy baseline exactly. The standalone boundary does not establish that the complete laboratory application already has zero additional bytes.

## Correctness

All 19 original document-store expectations pass with the COW backend, as do the default 117 app unit tests and six common Chromium/WebKit × backend UI combinations. The latter cover edits, moves, Undo/Redo, save conflict/retry, reload, narrow layout and logout.

The broader COW suite is **15 passed / 3 failed**. Restoring a prior immutable snapshot or its item can be confused with a live draft node: a supposedly old value changes, a false cycle is reported, or a transient edit is not undone by reassigning the old row. These are active failures tracked by HYP-1505, including a case using existing schema-shaped fields. Passing common UI paths does not erase them. An attempted correction was rejected before execution; no correction is claimed.

## Compiler gate and next hypotheses

`verify-selection.mjs` uses the real controller samples, runs the complete COW test file, and feeds its result into the existing `state build` pipeline. Its success means **the unsafe/regressing candidate was rejected**. It does not relabel the failing tests as passed. The automatically emitted bundle and the explicitly selected full-copy baseline are byte-identical. Profiles compare both the current Runtime implementation and a separate stricter pre-library performance budget.

D1 is partly supported: structural sharing removes most copying work for small edits and retained history. General COW adoption is not supported: dense writes, structural operations and historical-reference semantics still fail required criteria. The next implementation comparison should distinguish historical immutable values from active draft references, compare generated direct immutable updates with generic proxy drafts for statically known command shapes, and separately profile keyed rendering. No runtime density threshold or automatic worker dispatch has been enabled.

HYP-1499 is no longer a blocker: the existing Tasks fix is at `a4ae80b1aae42293674f091c14ab9b59b37609e0`, and the tracker says Done. This continuation reran the original focused 12 tests successfully; it did not claim a new full Tasks performance run. HYP-1500 remains In Progress. HYP-1505 is a separate COW correctness finding.

## Reproducibility

The canonical helper and tests are `json-draft.mjs` and `json-draft.test.mjs`. The source-hashed application measurements are in `results/controller.json`; final browser observations and complete samples are included in `results/raw-results.zip`. `results/summary.json` records source hashes, build sizes, full per-cell summaries, limitations and the archive hash. The first pre-refinement dataset is retained separately rather than silently overwritten.

In the Boards research branch, run `scripts/benchmark-state-cow.mjs` with `PILOT_EVIDENCE` pointing to this experiment's results directory. The existing browser script accepts `STATE_COW=1` and separate `EVAL_BASE_PORT` ports. The common UI suite accepts `EVAL_PORT`. Tests use synthetic in-memory databases only.

Run `node --test json-draft.test.mjs` to reproduce the three outstanding failures. Run `node verify-selection.mjs /path/to/boards-worktree` to verify their rejection by the compiler. These commands intentionally answer different questions.

The benchmark has one machine, finite samples, no randomized hardware scheduling, no physical mobile device and no peak/native memory measurement. The no-regression decision applies to the declared measured cases, not every possible future browser execution. The original structural-sharing goal is described in the master specification's transaction/snapshot section; this experiment is evidence toward that goal, not its completion.

## Review follow-up and compiler diagnostic correction

The 30-item move fixture has one column, so it rotates an item within that column. The 300/1,200-item fixtures move between columns. These cases must not be read as a single size-scaling series of identical cross-column work. Broad draft reads also allocate proxy/bookkeeping nodes even when few values are written; a direct-index point-edit benchmark does not measure a read-heavy find/filter command.

Structural operations can trigger a full-document certification pass. The dense `all` benchmark writes scalar strings and does not set that structural flag; its cost is per-visited-node draft bookkeeping, copying and finalization, not the structural certification path. Removing either cost must preserve the same ownership and snapshot guarantees.

The 13/21 pass count is against the original pre-library latency budget. Against the current full-copy Runtime comparator, 14/21 cells pass the strict sample rule; very small history outliers also fail despite similar medians. Neither comparison alone qualifies the candidate. The first pre-refinement dataset is present inside raw-results.zip, not just in the ignored local file.

An independent diagnostic bug in `state build` was reproduced and fixed: `worstObservedRatio` previously ignored the rejected cells, so a losing candidate could display a ratio below one. Three RED-to-GREEN tests now verify losing-cell inclusion, absence of observations, and a positive candidate over a zero baseline. The diagnostic records all observed cells, reports a null finite ratio with an explicit unbounded flag when appropriate, and leaves admission/rejection behavior intact. All 18 CLI tests pass. This fixes the compiler's explanation, not the COW candidate's three historical-reference failures.
