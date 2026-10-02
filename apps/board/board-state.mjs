/**
 * Application-owned state of the board UI (HYP-1490), built on the EXISTING state-lib
 * Runtime through packages/state-lib/scoped. This module owns every piece of state that
 * apps/board/app.mjs used to keep in module-level `let`s and DOM leftovers: session,
 * navigation, selection, menus, the inline editor, dialogs and pending operations.
 *
 * How it is used: app.mjs imports the state-lib modules (absolute browser paths), builds
 * a `kit` and calls createBoardState({kit, backends}). Tests build the same kit from
 * relative paths. Nothing here touches the DOM, so it also runs under `node --test`.
 *
 * Two scopes share ONE Runtime with the document store, so a document command and the
 * matching navigation/selection writes can commit in a single S.batch(...):
 *  - `session`  survives sign-out: config, share mode, dialog chrome, toast timer;
 *  - `private`  is wiped by resetPrivate(): user data, navigation, selection, editor,
 *    popover/hover handles, sync queue and everything derived from the signed-in user.
 *
 * Invariants:
 *  - DOM nodes, observers and the sync queue are `resource` handles, never owner values;
 *  - allocation (owners, tasks) happens once in createBoardState, never in a batch;
 *  - the baseline backend has NO Runtime: its batch is a plain call without rollback.
 */

const DOCUMENT_BACKENDS = ["baseline", "state-lib", "state-lib-cow"];
const BUILD_BACKENDS = ["baseline", "state-lib"];

/** Build config picks the backend; the URL only overrides it when the build allows it. */
export function resolveBackends(config, search) {
  if (!BUILD_BACKENDS.includes(config?.backend))
    throw TypeError(`Unknown state backend ${JSON.stringify(config?.backend)}`);
  const asked = config.allowUrlOverride ? new URLSearchParams(search).get("stateBackend") : null;
  const chosen = DOCUMENT_BACKENDS.includes(asked) ? asked : config.backend;
  return { workspace: chosen === "baseline" ? "baseline" : "state-lib", document: chosen };
}

function createInfrastructure({ kit, backends }) {
  const runtime = backends.document === "baseline" ? null : new kit.Runtime();
  const documentStore = kit.createDocumentStore({
    backend: backends.document,
    runtime: runtime ?? undefined,
  });
  const makeScope = (name) =>
    runtime ? kit.createScope(runtime, { name }) : kit.createBaselineScope({ name });
  const batch = (fn) => (runtime ? runtime.transaction(fn) : fn());
  const tasks = new Set();
  const debounced = (options) => {
    const task = runtime
      ? kit.createDebouncedLatestTask(runtime, options)
      : kit.createBaselineDebouncedLatestTask(options);
    tasks.add(task);
    return task;
  };
  return { runtime, documentStore, makeScope, batch, tasks, debounced };
}

/** Chrome that must outlive a sign-out: config, share mode, dialog, toast. */
function defineSession(scope) {
  return {
    config: scope.owner("config", null),
    shared: scope.owner("shared", false),
    shareId: scope.owner("shareId", ""),
    errorOpen: scope.owner("errorOpen", false),
    dialog: scope.owner("dialog", Object.freeze({ open: false, dismiss: true })),
    dialogEpoch: scope.epoch("dialogEpoch"),
    photoEpoch: scope.epoch("photoEpoch"),
    modalReturn: scope.resource("modalReturn"),
    toastTimer: scope.resource("toastTimer"),
  };
}

/** Everything that belongs to the signed-in user and must vanish on sign-out. */
function defineData(scope) {
  return {
    user: scope.owner("user", null),
    people: scope.owner("people", Object.freeze([])),
    requests: scope.owner("requests", Object.freeze([])),
    boardId: scope.owner("boardId", ""),
    columnId: scope.owner("columnId", ""),
    selected: scope.ids("selected"),
    editMeta: scope.owner("editMeta", null),
    saveStatus: scope.owner("saveStatus", ""),
    suggestions: scope.owner("suggestions", null),
    searchResults: scope.owner("searchResults", null),
    workspaceEpoch: scope.epoch("workspaceEpoch"),
    hoverEpoch: scope.epoch("hoverEpoch"),
  };
}

/** Opaque handles. Registration order is disposal order on reset. */
function defineHandles(scope) {
  return {
    popover: scope.resource("popover"),
    hoverCard: scope.resource("hoverCard"),
    columnObserver: scope.resource("columnObserver"),
    editor: scope.resource("editor"),
    sync: scope.resource("sync"),
  };
}

export function createBoardState({ kit, backends }) {
  const infra = createInfrastructure({ kit, backends });
  const sessionScope = infra.makeScope("board-session"),
    privateScope = infra.makeScope("board-private");
  const session = defineSession(sessionScope),
    data = defineData(privateScope),
    handles = defineHandles(privateScope);
  // Memo caches: non-reactive by design (a ticket lookup or an attempted illustration must not re-render).
  const tickets = new Map(),
    artAttempts = new Set();

  function resetPrivate() {
    privateScope.reset(
      () => infra.documentStore.replace(null),
      () => {
        // These caches are not reactive, but must clear even if cancellation throws.
        tickets.clear();
        artAttempts.clear();
        const errors = [];
        for (const task of infra.tasks) {
          try {
            task.cancel();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, "Private task cancellation failed");
      },
    );
  }

  return {
    backends,
    runtime: infra.runtime,
    documentStore: infra.documentStore,
    ...session,
    ...data,
    ...handles,
    tickets,
    artAttempts,
    batch: infra.batch,
    debounced: infra.debounced,
    resetPrivate,
    snapshot: () => ({ session: sessionScope.snapshot(), private: privateScope.snapshot() }),
  };
}
