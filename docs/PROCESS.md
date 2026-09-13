# Execution reliability and interruption analysis
Updated 2026-09-13. Based on observable tool replies, process logs and repository state; not hidden model telemetry.

## Failure classes
| ID | Layer / evidence | Diagnosis | Required response |
|---|---|---|---|
| GEN-01 | Chat response: repeated `Thinking failed`, sometimes while remote commands completed | Cause unknown. Long conversation is a plausible contributor, not a proven timer or sole cause. | Read existing PID/log/branch results first. Preserve a checkpoint before the next batch. Do not rerun mutations blindly. |
| AUTH-01 | GitHub returned `403 Resource not accessible by integration`; ultrabricks absent from installations | Confirmed missing organization app installation. User installed it; a real file commit then succeeded. | Verify both app installation and actual resource permissions. Current GitHub access is restored; do not repeatedly request reconnection. |
| SCHEMA-01 | Vercel wrapper exposed no parameters but backend required name/target/files | Confirmed connector schema mismatch, not a GitHub outage | Use a documented authorized CLI/API. Local Vercel CLI deployed successfully. |
| RATE-01 | Desktop Commander returned HTTP 429 / `Rate exceeded` | Confirmed gateway throttling; exact quota unknown | Honor Retry-After; otherwise pause at least 60 seconds, then bounded backoff. No rapid retries or parallel floods. |
| NET-01 | `mcp_network_error`, connection failed | Transport failure; request completion may be ambiguous | Read target/log before repeating a write; at most two retry rounds with backoff. |
| SAFE-01 | Tool call explicitly blocked by safety checks | Execution denied, not an ordinary timeout | Stop the denied action. Do not obfuscate, split or change tools to bypass a safety boundary. Request authorization/review when necessary. |
| ARGS-01 | Missing required timeout_ms | Assistant invocation error | Check the discovered schema. Supply required arguments once; do not blame the provider. |
| CODE-01 | Patched `$$().forEach` became `$().forEach` | JavaScript string replacement interprets `$$` in replacement strings | Use function replacements or explicit file edits. Add syntax/lint and UI boot regression tests. |
| CODE-02 | CSS text-transform caused saved title case changes; strike SVG overflowed at 320px | Reproducible implementation defects | Turn each finding into a failing regression, fix the source, rerun responsive checks. |
| TEST-01 | `bun tests/ui.ts; tail log` reported process exit 0 despite test failure | Shell returned the exit code of tail, not the test | Capture status immediately and exit with it. Use pipefail when tee-ing output. |
| TEST-02 | WebKit fixture request escaped routing after service worker activation | Harness boundary issue; not proof of production failure | Block SW only in the explicitly labeled fixture suite; test real SW separately with no request mocking. Never present it as full SW coverage. |
| DELIVERY-01 | Published static prototype differed from unfinished full-app branch | Architectural/delivery gap, not a tool failure | Work on the actual deployed source; maintain separate prototype and full-product acceptance gates. |
| DELIVERY-02 | Orphan Git trees, uncommitted recovery sources, githack URL published without external read | Incomplete delivery verification | A write requires target readback; a release requires real URL + browser + cloud round-trip. |

## What is not established
There is no evidence of a fixed session-duration cutoff or that every interruption shares one cause. The remote runtime survived several chat failures. Passing fixture tests is not live provider proof. An exit-0 tool response is insufficient when shell commands discard the tested command's status.

## Operating protocol
1. On every request read AGENTS.md, docs/USER_RULES.json, this file, ROADMAP.md and the local .private/HANDOFF.md. Reconcile git status, remote SHA and active process outputs before editing.
2. Record new user requirements with their date and explicit supersession; never treat an old assistant assertion as evidence.
3. Execute bounded stages: one purpose, one log file, one real exit status. Prefer 5–10 minute checkpoints and save progress after each completed stage; these are workflow targets, not claims about platform limits.
4. Keep output to the failing section or last 20–50 lines. Discover tool schemas once, reuse them, and stop polling when a result is definitive. Use Bun and existing CLIs; avoid giant source payloads.
5. Keep work in an isolated worktree. Never reset the uncommitted Bun migration. Checkpoint in a WIP commit before another complex stage; failed stages are not merged or deployed.
6. Follow a tight loop: reproduce -> regression test -> source fix -> targeted check -> full relevant check -> review diff -> commit. Do not rewrite the whole application to fix a small defect.
7. Check asynchronous writes by reading the resulting ref/file/resource. Before retrying deployment, inspect the existing deployment. Never duplicate invitations, comments, imports or database seeds because a reply was lost.
8. Maintain a checkpoint containing paths, branch/SHA, live URL/build, completed gates, exact remaining blockers, log files and active PIDs. Do not store private capabilities or tokens in tracked documents.
9. Distinguish local, fixture, CI, and deployed browser evidence. Count test cases and state coverage scope. Retain failed reports privately; public docs describe current evidence and known limitations.
10. A release is complete only after public HTTP, real-browser interactions, cloud save/readback in independent contexts, screenshot review and README URL verification. User data must be restored after tests; use isolated test spaces.

## Confirmed recovery as of this checkpoint
Worktree: ~/xp/boards-polish-20260913; branch work/prototype-polish-0913. Source is locally changed, not yet deployed. Actual live site still serves the older static build.
The last completed local runs report 96 unit cases, 13 Chromium scenario groups and 12 WebKit scenario groups. The WebKit fixture group intentionally blocks service workers. Re-run with preserved exit codes before release.
The separate recovered full-app checkout at ~/xp/boards-app remains uncommitted on work/bun-shell-quality and must not be reset.

## References
OpenAI troubleshooting recommends a new chat for long/unresponsive conversations but does not establish the root cause of this session: https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages
GitHub rate-limit response procedure and bounded backoff: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
GitHub request serialization and pause guidance: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
These references explain provider behavior; the local incident evidence above is distinct.
