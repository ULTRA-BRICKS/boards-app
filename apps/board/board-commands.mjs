/**
 * Board document commands (HYP-1490). Every edit is described twice with the SAME result:
 *  - `declared`: an immutable path command for the shared publication interface
 *    (`store.apply`, HYP-1488) that copies only the changed path and publishes document
 *    plus history atomically;
 *  - `mutate`: the original callback mutation, used by the baseline store (no `apply`)
 *    and as a fallback when a document lacks a field a declared command needs.
 * tests/board-commands.test.mjs proves the two agree and share history.
 *
 * `defineJsonCommand` is injected (app.mjs imports it by absolute browser path; tests by
 * relative path), so this module has no import specifiers.
 *
 * Addressing: {boardId, columnId, itemId}; an unknown boardId falls back to the first
 * board exactly like the app's board() helper always did.
 */

function locate(doc, { boardId, columnId, itemId }) {
  const bi = Math.max(
    0,
    doc.boards.findIndex((b) => b.id === boardId),
  );
  const board = doc.boards[bi];
  const ci = columnId === undefined ? -1 : board.columns.findIndex((c) => c.id === columnId);
  const column = board.columns[ci];
  const ii = itemId === undefined || !column ? -1 : column.items.findIndex((t) => t.id === itemId);
  return { bi, ci, ii, board, column, item: column?.items[ii] };
}

const itemsPath = ({ bi, ci }) => ["boards", bi, "columns", ci, "items"];
const itemPath = (loc) => [...itemsPath(loc), loc.ii];
const columnPath = ({ bi, ci }) => ["boards", bi, "columns", ci];
const isScalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);

function need(found, what) {
  if (!found) throw new RangeError(`Board command: ${what} not found`);
}

function needDelta(a) {
  if (!Number.isInteger(a.delta)) throw new TypeError("Board command: delta must be an integer");
}

/** The node a field edit writes to, plus the path to it. */
function fieldTarget(doc, { target, ...where }) {
  const loc = locate(doc, where);
  if (target === "item") return { node: loc.item, path: itemPath(loc), what: "item" };
  if (target === "column") return { node: loc.column, path: columnPath(loc), what: "column" };
  return { node: loc.board, path: ["boards", loc.bi], what: "board" };
}

const toggleDone = {
  supports: (doc, a) => typeof locate(doc, a).item?.done === "boolean",
  plan: (doc, a) => [...itemPath(locate(doc, a)), "done"],
  declared: (tx, path) => tx.toggle(path),
  mutate(doc, a) {
    const { item } = locate(doc, a);
    need(item, "item");
    item.done = !item.done;
  },
};

const setField = {
  supports(doc, a) {
    const { node, path } = fieldTarget(doc, a);
    if (!node || !isScalar(node[a.key])) return false;
    return !a.clearIllustration || isScalar(node.illustrationId);
  },
  plan: (doc, a) => ({
    path: fieldTarget(doc, a).path,
    key: a.key,
    value: a.value,
    clear: Boolean(a.clearIllustration),
  }),
  declared(tx, { path, key, value, clear }) {
    tx.set([...path, key], value);
    if (clear) tx.set([...path, "illustrationId"], "");
  },
  mutate(doc, a) {
    const { node, what } = fieldTarget(doc, a);
    need(node, what);
    node[a.key] = a.value;
    if (a.clearIllustration && node.items) node.illustrationId = "";
  },
};

/** Within a column (delta = -1/+1, clamped) or to the end of another column (toColumnId). */
function moveDestination(loc, doc, a) {
  if (a.toColumnId === undefined) {
    const to = Math.max(0, Math.min(loc.column.items.length - 1, loc.ii + a.delta));
    return { path: itemsPath(loc), index: to, same: true };
  }
  const dest = doc.boards[loc.bi].columns.findIndex((c) => c.id === a.toColumnId);
  return {
    path: itemsPath({ bi: loc.bi, ci: dest }),
    index: doc.boards[loc.bi].columns[dest]?.items.length,
    dest,
    same: false,
  };
}

const moveItem = {
  validate: (a) => a.toColumnId === undefined && needDelta(a),
  supports(doc, a) {
    const loc = locate(doc, a);
    if (!loc.item) return false;
    return (
      a.toColumnId === undefined ||
      (a.toColumnId !== a.columnId && moveDestination(loc, doc, a).dest >= 0)
    );
  },
  plan(doc, a) {
    const loc = locate(doc, a),
      to = moveDestination(loc, doc, a);
    return { from: itemsPath(loc), fromIndex: loc.ii, to: to.path, toIndex: to.index };
  },
  declared: (tx, { from, fromIndex, to, toIndex }) => tx.move(from, fromIndex, to, toIndex),
  mutate(doc, a) {
    const loc = locate(doc, a);
    need(loc.item, "item");
    const dest =
      a.toColumnId === undefined ? null : loc.board.columns.find((c) => c.id === a.toColumnId);
    if (a.toColumnId !== undefined) need(dest, "destination column");
    const [moving] = loc.column.items.splice(loc.ii, 1);
    if (a.toColumnId === undefined) {
      loc.column.items.splice(
        Math.max(0, Math.min(loc.column.items.length, loc.ii + a.delta)),
        0,
        moving,
      );
      return;
    }
    dest.items.push(moving);
  },
};

const columnsPath = ({ bi }) => ["boards", bi, "columns"];

/** Reorders a column within its board by delta (-1/+1, clamped). */
const moveColumn = {
  validate: needDelta,
  supports: (doc, a) => locate(doc, a).ci >= 0,
  plan(doc, a) {
    const loc = locate(doc, a);
    const to = Math.max(0, Math.min(loc.board.columns.length - 1, loc.ci + a.delta));
    return { from: columnsPath(loc), fromIndex: loc.ci, to: columnsPath(loc), toIndex: to };
  },
  declared: (tx, { from, fromIndex, to, toIndex }) => tx.move(from, fromIndex, to, toIndex),
  mutate(doc, a) {
    const { board, ci } = locate(doc, a);
    need(ci >= 0, "column");
    const to = Math.max(0, Math.min(board.columns.length - 1, ci + a.delta));
    const [column] = board.columns.splice(ci, 1);
    board.columns.splice(to, 0, column);
  },
};

const COMMANDS = { toggleDone, setField, moveItem, moveColumn };

/** Returns {run(store, name, args)}; `defineJsonCommand` comes from packages/core/json-draft.mjs. */
export function createBoardCommands({ defineJsonCommand }) {
  const declared = Object.fromEntries(
    Object.entries(COMMANDS).map(([name, c]) => [
      name,
      defineJsonCommand((tx, plan) => c.declared(tx, plan)),
    ]),
  );
  function run(store, name, args) {
    const command = COMMANDS[name];
    if (!command) throw new TypeError(`Unknown board command ${name}`);
    command.validate?.(args);
    const doc = store.read();
    if (typeof store.apply === "function" && command.supports(doc, args))
      return store.apply(declared[name], command.plan(doc, args));
    return store.change((draft) => command.mutate(draft, args));
  }
  return { run, names: Object.keys(COMMANDS) };
}
