/**
 * Debounced "latest wins" async task (HYP-1490). run(input) waits `delay`, loads, and
 * commits only if nothing newer was requested meanwhile. Two engines share one debounce
 * shell: the Runtime build wraps `latestTask` (commit inside one transaction); the
 * baseline build uses a plain epoch counter and is the A/B oracle with the same outcomes.
 *
 * Invariants:
 *  - every run() promise settles exactly once: 'committed' | 'superseded' | 'cancelled',
 *    or rejects with the loader/commit error of the CURRENT run;
 *  - a newer run() (or cancel/dispose) aborts in-flight work and its late result or error
 *    is never published nor surfaced;
 *  - `pending` is true from run() until the current run settles.
 */
import { latestTask } from "../dist/index.js";
import { createPlainCell } from "./scope-core.mjs";

function createDeferredOutcome() {
  let resolve, reject, settled = false;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    settle(outcome) {
      if (settled) return;
      settled = true;
      resolve(outcome);
    },
    fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    },
  };
}

/** engine: { start(input) => Promise<outcome>, abort(), dispose() }; pending: writable cell. */
function createDebounceShell({ delay, engine, pending, setTimer, clearTimer }) {
  let current, timer, disposed = false;
  /** Settles `run` (idempotent) and clears pending if it is still the current run. */
  const settleRun = (run, settle) => {
    settle(run.outcome);
    if (current !== run) return;
    current = undefined;
    pending.set(false);
  };
  const stopTimer = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  };
  const settleCurrent = (outcome) => {
    stopTimer();
    if (current) settleRun(current, (o) => o.settle(outcome));
  };
  const fire = (run) => {
    timer = undefined;
    try {
      engine.start(run.input).then(
        (outcome) => settleRun(run, (o) => o.settle(outcome)),
        (error) => settleRun(run, (o) => o.fail(error)),
      );
    } catch (error) {
      settleRun(run, (o) => o.fail(error));
    }
  };
  return {
    run(input) {
      if (disposed) throw Error("Debounced task is disposed");
      engine.abort();
      stopTimer();
      current?.outcome.settle("superseded");
      const run = { input, outcome: createDeferredOutcome() };
      current = run;
      pending.set(true);
      timer = setTimer(() => fire(run), delay);
      return run.outcome.promise;
    },
    cancel() {
      if (disposed) return;
      engine.abort();
      settleCurrent("cancelled");
    },
    dispose() {
      if (disposed) return;
      engine.abort();
      settleCurrent("cancelled");
      disposed = true;
      engine.dispose();
    },
    pending: readOnly(pending),
  };
}

const readOnly = (cell) =>
  Object.freeze({ get: () => cell.get(), peek: () => cell.peek(), subscribe: (l) => cell.subscribe(l) });

const timerDefaults = { setTimer: setTimeout, clearTimer: clearTimeout };

/**
 * @template Input, Value
 * @param {Runtime} runtime
 * @param {{ delay: number, load: (input: Input, signal: AbortSignal) => Value | PromiseLike<Value>,
 *   commit: (value: Value, input: Input) => void, setTimer?: Function, clearTimer?: Function }} options
 */
export function createDebouncedLatestTask(runtime, { delay, load, commit, ...timers }) {
  const inner = latestTask(runtime, load, (value, input) => {
    commit(value, input);
  });
  const engine = { start: (input) => inner.run(input), abort: () => inner.cancel(), dispose: () => inner.dispose() };
  return createDebounceShell({ delay, engine, pending: runtime.signal(false), ...timerDefaults, ...defined(timers) });
}

/** Same outcomes without a Runtime: a monotonically increasing epoch guards each load. */
export function createBaselineDebouncedLatestTask({ delay, load, commit, ...timers }) {
  let epoch = 0, controller;
  const abort = () => {
    epoch++;
    controller?.abort();
    controller = undefined;
  };
  const engine = {
    async start(input) {
      const mine = ++epoch;
      const own = (controller = new AbortController());
      const value = await load(input, own.signal);
      if (mine !== epoch) return "superseded";
      commit(value, input);
      return "committed";
    },
    abort,
    dispose: abort,
  };
  return createDebounceShell({ delay, engine, pending: createPlainCell(false), ...timerDefaults, ...defined(timers) });
}

const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
