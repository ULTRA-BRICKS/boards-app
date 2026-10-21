import { Runtime, latestTask } from '../state-lib/dist/index.js';

function publishAfterCommit(publish, state, people) {
  try {
    publish(state, people);
  } catch (error) {
    const wrapped = new Error(error instanceof Error ? error.message : String(error), { cause: error });
    wrapped.committed = true;
    throw wrapped;
  }
}

/**
 * Workspace-result ownership: latest-wins load of document + people. SyncQueue, history and server auth stay unchanged.
 *
 * Options beyond the legacy {readState, readPeople, publish, backend}:
 *  - runtime: borrow the caller's Runtime (never disposed here) instead of allocating a private one;
 *  - apply({state, people}): commit-time writes. On state-lib it runs INSIDE the commit transaction, so a throw rolls
 *    everything back and nothing is published; superseded or cleared loads never reach it;
 *  - batch(fn): baseline-only wrapper for apply (the baseline has no Runtime transaction).
 * publish(state, people) always runs after the commit (render, sync setup); with a borrowed runtime it runs after the
 * commit transaction fully returned, so it may write to any owner of that runtime. Publish-only callers are unchanged.
 * With a borrowed runtime a clear/cancel/dispose or a newer load between the commit and publish suppresses publish and
 * load() resolves 'cancelled' / 'superseded'. A publish that throws after an accepted commit rejects with an error
 * flagged `committed: true` (message kept, original in `cause`): the workspace is loaded, nothing was rolled back.
 */
export function createWorkspaceLoader(options) {
  return (typeof __STATE_BUILD_BASELINE__ === 'boolean' ? __STATE_BUILD_BASELINE__ : options.backend === 'baseline')
    ? createBaselineLoader(options)
    : createRuntimeLoader(options);
}

function createBaselineLoader({readState, readPeople, publish, apply, batch = (fn) => fn()}) {
    let epoch = 0;
    return {
      async load() {
        const current = ++epoch;
        const state = await readState();
        const people = await readPeople();
        if (current !== epoch) return 'superseded';
        if (apply) batch(() => apply({ state, people }));
        publishAfterCommit(publish, state, people);
        return 'committed';
      },
      cancel() { epoch++; },
      clear() { epoch++; },
      dispose() { epoch++; },
    };
}

function createRuntimeLoader({readState, readPeople, publish, apply, runtime: borrowed}) {
  const load = async (_input, signal) => {
    // Keep the original request order for a fair comparison; no parallel-fetch speed claim.
    const state = await readState(signal);
    signal.throwIfAborted();
    const people = await readPeople(signal);
    return { state, people };
  };
  if (borrowed) {
    // A subscriber would run inside the shared Runtime's notification phase, where render-time writes to other owners
    // are forbidden. So publish runs right after the commit transaction has finished, only for the committing load.
    // Per-run authority: each load() owns one run record carrying its exact committed value. A clear/cancel/dispose or a
    // newer load marks the run over, so a commit that already happened can no longer publish, and no shared cell is read.
    let current = null;
    const endCurrent = (reason) => {
      if (current && !current.over) current.over = reason;
      current = null;
    };
    const task = latestTask(borrowed, load, (value, run) => { apply?.(value); run.committed = value; });
    return {
      async load() {
        endCurrent('superseded');
        const run = { committed: null, over: null };
        current = run;
        const outcome = await task.run(run);
        if (outcome !== 'committed') return outcome;
        if (run.over) return run.over;
        current = null;
        publishAfterCommit(publish, run.committed.state, run.committed.people);
        return outcome;
      },
      cancel() { endCurrent('cancelled'); task.cancel(); },
      clear() { endCurrent('cancelled'); task.cancel(); },
      dispose() { endCurrent('cancelled'); task.dispose(); },
    };
  }
  const runtime = new Runtime();
  const result = runtime.signal(null);
  const stop = result.subscribe((value) => { if (value) publish(value.state, value.people); });
  const task = latestTask(runtime, load, (value) => { apply?.(value); result.set(value); });
  return {
    load: () => task.run(undefined),
    cancel: () => task.cancel(),
    clear() { task.cancel(); result.set(null); },
    dispose() { task.dispose(); stop(); runtime.dispose(); },
  };
}
