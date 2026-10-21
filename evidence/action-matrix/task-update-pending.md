# Pending task update (task server returned 500; NOT written)

Ticket: HYP-1737 (Boards entry specialization), action-matrix acceptance.

Progress: a new sibling benchmark scripts/benchmark-compiled-board-actions.mjs (plus a pure helper
module and node:test contract tests) extends the compiled-board benchmark beyond the completion
checkbox to text edit/commit, column move, Undo/Redo after a move, and cold load, on the equally
compiled baseline and state-lib entries (compiler f0dece20, runtime app.js hashes equal to the accepted
release: baseline b83af585..., state-lib f19621d5...). Phase 1 (one correctness page per action per
engine, in Chromium 153 and WebKit 26.6, at 1, 30, 1200 and 10000 rows) passed with identical final
document, row order, selection and save payloads between the two backends. No timing statistics yet;
those wait for the coordinator go-ahead.

Branch: experiment/HYP-1737-action-matrix-20261021 (worktree
/home/ultra/work/boards-state-specialization-20261016/.worktrees/action-matrix-20261021).
Not done: repeated measurement, review, commit.
