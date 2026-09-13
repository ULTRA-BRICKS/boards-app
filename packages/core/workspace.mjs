/** One private workspace with multiple boards; credentials never belong in this document. */
import { DEFAULT_BOARD, clone, validateBoard, uid } from "./model.mjs";
export const validId = (id) =>
  typeof id === "string" &&
  /^[\w-]{1,80}$/.test(id) &&
  !["__proto__", "constructor", "prototype"].includes(id);
export function safeURL(value, { avatar = false, slack = false, linear = false } = {}) {
  if (!value || typeof value !== "string" || value.length > 200000) return "";
  if (avatar && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return "";
    if (slack && !/^[\w-]+\.slack\.com$/.test(u.hostname)) return "";
    if (linear && u.hostname !== "linear.app") return "";
    return u.href;
  } catch {
    return "";
  }
}
export function normalizePerson(p) {
  if (!p || !validId(p.id) || typeof p.name !== "string" || !p.name.trim() || p.name.length > 120)
    throw Error("Invalid person");
  const email = String(p.email || "").trim();
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200))
    throw Error("Invalid email");
  return {
    id: p.id,
    name: p.name.trim(),
    email,
    avatar: safeURL(p.avatar, { avatar: true }),
    slackUserId: /^[UW][A-Z0-9]+$/.test(p.slackUserId || "") ? p.slackUserId : "",
    slackUrl: safeURL(p.slackUrl, { slack: true }),
  };
}
export function packBoard(board) {
  const b = clone(board);
  delete b.people;
  delete b.space;
  delete b.integrations;
  return b;
}
export function createWorkspace() {
  return {
    schemaVersion: 2,
    id: "launch",
    name: "Launch workspace",
    people: clone(DEFAULT_BOARD.people),
    integrations: {
      slack: { workspace: "", enabled: false },
      linear: { baseUrl: "", enabled: false },
    },
    boards: [{ id: "roadmap", ...packBoard(DEFAULT_BOARD) }],
  };
}
export function effectiveBoard(ws, id) {
  const b = ws.boards.find((b) => b.id === id) || ws.boards[0];
  return {
    ...clone(b),
    people: clone(ws.people),
    space: { id: ws.id, name: ws.name },
    integrations: clone(ws.integrations),
  };
}
export function validateWorkspace(input) {
  if (input?.schemaVersion === 1) {
    const w = createWorkspace(),
      b = validateBoard(input);
    w.people = b.people.map(normalizePerson);
    w.boards = [{ id: "roadmap", ...packBoard(b) }];
    return w;
  }
  if (
    !input ||
    input.schemaVersion !== 2 ||
    !validId(input.id) ||
    typeof input.name !== "string" ||
    input.name.length > 120
  )
    throw Error("Invalid workspace");
  if (!Array.isArray(input.people) || input.people.length > 200) throw Error("At most 200 people");
  const people = input.people.map(normalizePerson),
    pids = new Set(people.map((p) => p.id));
  if (pids.size !== people.length) throw Error("Duplicate person ID");
  if (!Array.isArray(input.boards) || !input.boards.length || input.boards.length > 30)
    throw Error("Workspace requires 1–30 boards");
  const ids = new Set(),
    boards = input.boards.map((b) => {
      if (!validId(b.id) || ids.has(b.id)) throw Error("Duplicate/invalid board ID");
      ids.add(b.id);
      const v = validateBoard({
        ...b,
        people: [],
        integrations: {},
        space: { id: input.id, name: input.name },
      });
      for (const c of v.columns)
        for (const t of c.items) {
          t.assignees = [...new Set(t.assignees || [])];
          if (t.assignees.some((id) => !pids.has(id))) throw Error("Unknown assignee");
        }
      return { id: b.id, ...packBoard(v) };
    });
  const i = input.integrations || {},
    workspace = String(i.slack?.workspace || "");
  const result = {
    schemaVersion: 2,
    id: input.id,
    name: input.name,
    people,
    boards,
    integrations: {
      slack: {
        workspace: /^[a-z0-9-]{0,80}$/.test(workspace) ? workspace : "",
        enabled: !!i.slack?.enabled,
      },
      linear: {
        baseUrl: safeURL(i.linear?.baseUrl, { linear: true }),
        enabled: !!i.linear?.enabled,
      },
    },
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 2097152)
    throw Error("Workspace exceeds 2 MB");
  return result;
}
export function validateDocument(input) {
  return input?.schemaVersion === 2 ? validateWorkspace(input) : validateBoard(input);
}
export function newBoard(title = "New board") {
  return {
    id: uid(),
    schemaVersion: 1,
    title,
    tagline: "Build · Ship · Grow",
    footer: "Small steps. Big progress.",
    typography: clone(DEFAULT_BOARD.typography),
    columns: [],
  };
}
export function tasksForPerson(ws, id) {
  return ws.boards.flatMap((b) =>
    b.columns.flatMap((c) =>
      c.items
        .filter((t) => t.assignees?.includes(id))
        .map((t) => ({
          boardId: b.id,
          boardTitle: b.title,
          columnId: c.id,
          columnTitle: c.title,
          item: t,
        })),
    ),
  );
}
export function mergeSlackPeople(existing, incoming) {
  const result = existing.map(clone);
  for (const raw of incoming) {
    const p = normalizePerson(raw),
      index = result.findIndex(
        (x) =>
          (x.slackUserId && x.slackUserId === p.slackUserId) ||
          (x.email && p.email && x.email.toLowerCase() === p.email.toLowerCase()),
      );
    if (index < 0) result.push(p);
    else result[index] = { ...result[index], ...p, id: result[index].id };
  }
  return result;
}
export function validateScope(scope, ws) {
  if (!scope || !["board", "column", "item", "items", "space"].includes(scope.kind))
    throw Error("Invalid scope");
  if (scope.kind === "space") return { kind: "space", neighbors: false };
  const b = ws.boards.find((b) => b.id === scope.boardId);
  if (!b) throw Error("Board not found");
  if (scope.kind === "board") return { kind: "board", boardId: b.id, neighbors: false };
  if (scope.kind === "column") {
    if (!b.columns.some((c) => c.id === scope.columnId)) throw Error("Column not found");
    return { kind: "column", boardId: b.id, columnId: scope.columnId, neighbors: false };
  }
  const itemIds = [...new Set(scope.itemIds || [])];
  if (
    !itemIds.length ||
    itemIds.length > 50 ||
    (scope.kind === "item" && itemIds.length !== 1) ||
    itemIds.some((id) => !b.columns.some((c) => c.items.some((t) => t.id === id)))
  )
    throw Error("Items not found");
  return { kind: scope.kind, boardId: b.id, itemIds, neighbors: !!scope.neighbors };
}
/** Deliberately excludes private emails, Slack IDs, avatar URLs and unselected tasks. */
export function projectShare(ws, raw) {
  const scope = validateScope(raw, ws),
    allowed = scope.kind === "space" ? ws.boards : ws.boards.filter((b) => b.id === scope.boardId),
    visible = new Set(),
    neighbors = new Set();
  const boards = allowed.map((b) => {
    const cols = b.columns
      .filter((c) => scope.kind !== "column" || c.id === scope.columnId)
      .map((c) => {
        let items = c.items;
        if (["item", "items"].includes(scope.kind)) {
          const selected = new Set(scope.itemIds),
            indices = items.map((t, i) => (selected.has(t.id) ? i : -1)).filter((i) => i >= 0),
            show = new Set(indices);
          if (scope.neighbors)
            for (const i of indices) {
              if (i > 0) show.add(i - 1);
              if (i + 1 < items.length) show.add(i + 1);
            }
          items = items
            .filter((t, i) => show.has(i))
            .map((t) => {
              if (!selected.has(t.id)) neighbors.add(t.id);
              return t;
            });
        }
        items.forEach((t) => t.assignees?.forEach((id) => visible.add(id)));
        return { ...clone(c), items: clone(items) };
      })
      .filter((c) => !["item", "items"].includes(scope.kind) || c.items.length);
    return { ...clone(b), columns: cols };
  });
  return {
    schemaVersion: 2,
    id: "shared",
    name: "Shared view",
    people: ws.people
      .filter((p) => visible.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: "",
        email: "",
        slackUserId: "",
        slackUrl: "",
      })),
    integrations: {
      slack: { enabled: false, workspace: "" },
      linear: { enabled: false, baseUrl: "" },
    },
    boards,
    scope,
    neighborIds: [...neighbors],
  };
}
