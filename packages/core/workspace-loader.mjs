import { Runtime, latestTask } from '../state-lib/dist/index.js';

/** Pilot only: workspace-result ownership. SyncQueue, history and server auth stay unchanged. */
export function createWorkspaceLoader({ readState, readPeople, publish, backend = 'state-lib' }) {
  if (backend === 'baseline') {
    let epoch = 0;
    return {
      async load() {
        const current = ++epoch;
        const state = await readState();
        const people = await readPeople();
        if (current !== epoch) return 'superseded';
        publish(state, people);
        return 'committed';
      },
      cancel() { epoch++; },
      clear() { epoch++; },
      dispose() { epoch++; },
    };
  }
  const runtime = new Runtime();
  const result = runtime.signal(null);
  const stop = result.subscribe((value) => { if (value) publish(value.state, value.people); });
  const task = latestTask(runtime, async (_input, signal) => {
    // Keep the original request order for a fair comparison; no parallel-fetch speed claim.
    const state = await readState(signal);
    signal.throwIfAborted();
    const people = await readPeople(signal);
    return { state, people };
  }, (value) => { result.set(value); });
  return {
    load: () => task.run(undefined),
    cancel: () => task.cancel(),
    clear() { task.cancel(); result.set(null); },
    dispose() { task.dispose(); stop(); runtime.dispose(); },
  };
}
