# Boards migration: reset and resource lifecycle correction

Date: 2026-09-25. Migration branch `feat/state-complete-HYP-1490`, baseline `9ebf080da4cdb96deb13b80f5faf5775850be67a`. The immutable original comparison checkout is unchanged. This record does not claim all apps or external staging are complete.

## Reproduced and corrected

Four inherited failing contracts demonstrated that reset detached opaque handles before knowing the transaction outcome, lost their disposers after a committed observer error, allowed nested reset without a final commit boundary, and could leave a private document/cache behind when disposal threw. Those expectations stayed intact.

Reset now captures every handle/disposer before the write, stages resource revisions and ordinary owner/document changes together, and restores the handle closures if that outer transaction rolls back. Committed notification errors still run every captured disposer. Resource cleanup errors are aggregated without preventing later cleanup. Private caches clear after commit, before task cancellation/disposal errors are reported. Scope disposal reuses that boundary and does not dispose its borrowed Runtime.

The helper uses only the public Runtime transaction, version and inTransaction contract. A new negative test proved that relying on an exception's `committed` property was insufficient: a throwing callback could forge it. The actual Runtime revision now distinguishes publication from rollback. Another red-first test prevents a Promise-returning reset companion from escaping synchronous transaction validation.

A separate invalid-move regression showed the callback path removed a card before discovering its target column was absent. Target validation now precedes mutation for the candidate's compatibility path; all valid move ordering remains unchanged. The separately pinned original baseline remains untouched, so any comparison must report this safety correction rather than relabel baseline source.

## Mechanism traceability

- [Writes and transaction publication](https://state-lib-lab.vercel.app/spec#s4-4): one coherent reset, rollback before publication, post-commit observer errors.
- [Scope ownership](https://state-lib-lab.vercel.app/spec#s4-7): retain opaque resources until commit, then release every captured disposer; injected Runtime remains alive.
- [Application UI ownership](https://state-lib-lab.vercel.app/spec#s4-9): private UI owners and document are reset as one state transition.
- [Shared publication](https://state-lib-lab.vercel.app/spec#document-publication): the migration preserves the existing document/history controller's public snapshot and notification semantics.

The current scoped helper is authored in this app worktree and has not been presented as an upstreamed core release. Its SHA256 provenance identifies the exact source; sourceCommit is explicitly marked as the branch base while changes remain uncommitted. No benchmark profile was relabeled after these changes.

## Final verification and scope

After the lifecycle corrections, the full Node suite passed280/280 tests, both `build:baseline` and `build:state` passed, and all12 browser migration scenarios passed (six per implementation). A subsequent manifest-only correction stops treating transient dialog forms, the photo-review draft and the separate type-specimen entry as completed exclusions. These remain unfinished ownership work, consistent with the requested complete migration.

The latest focused scope/board-state/command set passed123 tests before formatting; the complete280-test run includes those contracts. A later proposal to add the public `version` getter to a minimal test facade was denied before execution and did not change source. Production uses the supplied Runtime's public version; the minimal facade test only exercises successful reset and nested-boundary rejection, not notification failures. Those failure cases are tested separately against the actual Runtime.

Four empty databases now exist in the separate Neon comparison project. They have not yet been bootstrapped with service roles or connected to four application deployments. No external app-stage, all-owner migration, IME coverage or full-app performance acceptance is claimed here. Preserve the original baseline checkouts and active remaining tasks.
