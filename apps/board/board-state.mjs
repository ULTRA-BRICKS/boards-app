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
/** Initial and reset value of the tickets owner: a frozen null-prototype record, so no key can alias a prototype member. */
const EMPTY_TICKETS = Object.freeze(Object.create(null));

function deepFreeze(value, active = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw new TypeError("A cached ticket must be JSON data");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new TypeError("A cached ticket must contain only JSON objects and arrays");
  if (active.has(value)) throw new TypeError("A cached ticket must be acyclic JSON data");
  if (Object.isFrozen(value)) return value;
  active.add(value);
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], active);
  active.delete(value);
  return value;
}

/** Cache admission: a private structured clone, deep-frozen, so neither the caller's object nor a reader can alter it. */
function admit(value) {
  try {
    return deepFreeze(structuredClone(value));
  } catch (cause) {
    throw new TypeError("A cached ticket must be plain JSON data", { cause });
  }
}
const EMPTY_DRAFT = Object.freeze({ form: "", values: Object.freeze({}) });

/** Build config picks the backend; the URL only overrides it when the build allows it. */
export function resolveBackends(config, search) {
  return typeof __STATE_BUILD_BASELINE__ === "boolean"
    ? {workspace: __STATE_BUILD_BASELINE__ ? "baseline" : "state-lib", document: __STATE_BUILD_BASELINE__ ? "baseline" : "state-lib"}
    : resolveRuntimeBackends(config, search);
}

function resolveRuntimeBackends(config, search) {
  if (!BUILD_BACKENDS.includes(config?.backend))
    throw TypeError(`Unknown state backend ${JSON.stringify(config?.backend)}`);
  const asked = config.allowUrlOverride ? new URLSearchParams(search).get("stateBackend") : null;
  const chosen = DOCUMENT_BACKENDS.includes(asked) ? asked : config.backend;
  return { workspace: chosen === "baseline" ? "baseline" : "state-lib", document: chosen };
}

function createInfrastructure({ kit, backends }) {
  const baseline = typeof __STATE_BUILD_BASELINE__ === "boolean" ? __STATE_BUILD_BASELINE__ : backends.document === "baseline";
  const runtime = baseline ? null : new kit.Runtime();
  const documentStore = kit.createDocumentStore({
    backend: backends.document,
    runtime: runtime ?? undefined,
  });
  const makeScope = (name) =>
    baseline ? kit.createBaselineScope({ name }) : kit.createScope(runtime, { name });
  const batch = (fn) => (baseline ? fn() : runtime.transaction(fn));
  const tasks = new Set();
  const debounced = (options) => {
    const task = baseline
      ? kit.createBaselineDebouncedLatestTask(options)
      : kit.createDebouncedLatestTask(runtime, options);
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
    rendered: scope.owner("rendered", null),
    editMeta: scope.owner("editMeta", null),
    saveStatus: scope.owner("saveStatus", ""),
    suggestions: scope.owner("suggestions", null),
    searchResults: scope.owner("searchResults", null),
    workspaceStatus: scope.owner("workspaceStatus", "idle"),
    searchActive: scope.owner("searchActive", 0),
    mentionIndex: scope.owner("mentionIndex", 0),
    photoImage: scope.owner("photoImage", null),
    photoReview: scope.owner("photoReview", null),
    tickets: scope.owner("tickets", EMPTY_TICKETS),
    dialogDraft: scope.owner("dialogDraft", EMPTY_DRAFT),
    artAttempts: scope.ids("artAttempts"),
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
    photoForm: scope.resource("photoForm"),
  };
}

/**
 * Copy-on-write Map-like facade over an owner holding a frozen null-prototype record {ref: frozen JSON value}. Every
 * write builds a new frozen record; reads never subscribe (a ticket lookup must not re-render).
 */
function createTicketCache(cell) {
  const has = (record, ref) => Object.hasOwn(record, ref);
  const replace = (change) => {
    const next = Object.create(null);
    for (const key of Object.keys(cell.peek())) next[key] = cell.peek()[key];
    change(next);
    cell.set(Object.freeze(next));
  };
  return {
    has: (ref) => has(cell.peek(), ref),
    get: (ref) => (has(cell.peek(), ref) ? cell.peek()[ref] : undefined),
    set(ref, value) {
      const admitted = admit(value);
      replace((next) => {
        next[ref] = admitted;
      });
    },
    delete(ref) {
      if (!has(cell.peek(), ref)) return;
      replace((next) => {
        delete next[ref];
      });
    },
    clear: () => cell.set(EMPTY_TICKETS),
    get size() {
      return Object.keys(cell.peek()).length;
    },
  };
}

/** Set facade over the shipped ids collection: adding a known attempt keeps the previous reference. */
export function createAttemptSet(ids) {
  return {
    has: (key) => ids.peek().includes(key),
    add(key) {
      if (!ids.peek().includes(key)) ids.replace([...ids.peek(), key]);
    },
    clear: () => ids.clear(),
    get size() {
      return ids.peek().length;
    },
  };
}

/** Form draft: plain immutable data (which form is open and its field values); inputs stay the live DOM surface. */
function createDialogDraft(cell) {
  const write = (form, values) => cell.set(Object.freeze({ form, values: Object.freeze(values) }));
  return {
    open: (form, values = {}) => write(form, { ...values }),
    set(key, value) {
      const { form, values } = cell.peek();
      if (values[key] !== value) write(form, { ...values, [key]: value });
    },
    get: (key) => cell.peek().values[key],
    values: () => cell.peek().values,
    form: () => cell.peek().form,
    clear: () => cell.set(EMPTY_DRAFT),
  };
}

export function createBoardState({ kit, backends }) {
  const infra = createInfrastructure({ kit, backends });
  const sessionScope = infra.makeScope("board-session"),
    privateScope = infra.makeScope("board-private");
  const session = defineSession(sessionScope),
    data = defineData(privateScope),
    handles = defineHandles(privateScope);
  const tickets = createTicketCache(data.tickets),
    artAttempts = createAttemptSet(data.artAttempts),
    draft = createDialogDraft(data.dialogDraft);

  /** Cached lookup; a result that arrives after sign-out or a workspace reload is returned but not cached. */
  async function loadTicket(ref, fetcher) {
    if (tickets.has(ref)) return tickets.get(ref);
    const alive = data.workspaceEpoch.guard();
    const value = await fetcher();
    if (!alive()) return value;
    tickets.set(ref, value);
    return tickets.get(ref);
  }

  function resetPrivate() {
    privateScope.reset(
      () => infra.documentStore.replace(null),
      () => {
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
    draft,
    loadTicket,
    batch: infra.batch,
    debounced: infra.debounced,
    resetPrivate,
    snapshot: () => ({ session: sessionScope.snapshot(), private: privateScope.snapshot() }),
  };
}
