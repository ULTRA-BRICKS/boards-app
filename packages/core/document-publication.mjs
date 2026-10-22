import { ownJson, isOwnedJsonSnapshot, isImportedJsonRoot } from './json-draft.mjs';

/** One supplied Runtime, one atomic cell, one cached public snapshot.
 * Draft construction is separate so command-only programs need not ship Proxy COW.
 */
export function createDocumentPublication(runtime, { initial = null, limit = 40 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw TypeError('History limit must be positive');
  const record = (document, history) => ({
    history,
    view: Object.freeze({ document, canUndo: history.past.length > 0, canRedo: history.future.length > 0 }),
  });
  const cell = runtime.signal(record(ownJson(initial), { past: [], future: [] }));
  let active = false,
    closed = false,
    working,
    generation = 0;
  const open = () => {
    if (closed) throw Error('Document store is disposed');
  };
  const idle = () => {
    open();
    if (active) throw Error('Nested document mutation is not supported');
  };
  const publish = (document, history) => cell.set(record(document, history));
  function execute(build, args, withDraft) {
    idle();
    const before = cell.get().view.document;
    if (!before) return false;
    active = true;
    working = before;
    const token = ++generation;
    let next;
    try {
      next = withDraft
        ? build(before, (value) => {
            if (!active || generation !== token) throw Error('Draft exposure requires its active transaction');
            working = value;
          })
        : build(before, args);
      if (next && typeof next.then === 'function') {
        Promise.resolve(next).catch(() => {});
        throw TypeError('Document commands must be synchronous');
      }
      if (!isOwnedJsonSnapshot(next)) throw TypeError('Command must return an owned immutable snapshot');
    } finally {
      active = false;
      working = undefined;
    }
    publish(next, { past: [...cell.get().history.past, before].slice(-limit), future: [] });
    return true;
  }
  return {
    read() {
      open();
      return active ? working : cell.get().view.document;
    },
    getSnapshot() {
      open();
      return cell.get().view;
    },
    subscribe(listener) {
      open();
      return cell.subscribe(() => listener());
    },
    get canUndo() {
      open();
      return cell.get().view.canUndo;
    },
    get canRedo() {
      open();
      return cell.get().view.canRedo;
    },
    transact(build) {
      return execute(build, null, true);
    },
    apply(command, args) {
      return execute(command, args, false);
    },
    replace(value) {
      idle();
      publish(ownJson(value), { past: [], future: [] });
    },
    // Adopts by identity: every other holder of the imported root now sees the frozen published document.
    replaceImported(value) {
      idle();
      if (!isImportedJsonRoot(value)) throw TypeError('Only a root returned by importJsonField can be adopted');
      publish(value, { past: [], future: [] });
    },
    undo() {
      idle();
      const { past, future } = cell.get().history;
      if (!past.length) return false;
      publish(past.at(-1), { past: past.slice(0, -1), future: [...future, cell.get().view.document].slice(-limit) });
      return true;
    },
    redo() {
      idle();
      const { past, future } = cell.get().history;
      if (!future.length) return false;
      publish(future.at(-1), { past: [...past, cell.get().view.document].slice(-limit), future: future.slice(0, -1) });
      return true;
    },
    clear() {
      idle();
      publish(null, { past: [], future: [] });
    },
    dispose() {
      if (closed) return;
      idle();
      runtime.dispose();
      closed = true;
    },
  };
}
