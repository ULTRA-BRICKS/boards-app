export type Item = { id: string; text: string; done: boolean; assignees: string[]; tag?: string };
export type Document = {
  boards: { id: string; title: string; columns: { id: string; title: string; items: Item[] }[] }[];
};
export type ItemRecord = {
  boardId: string;
  columnId: string;
  position: number;
  text: string;
  done: boolean;
  assignees: string[];
  tag: string;
};
export type ItemChange = {
  boardId: string;
  itemId: string;
  kind: "created" | "changed" | "deleted";
  before: ItemRecord | null;
  after: ItemRecord | null;
  fields: string[];
};
export function itemIndex(document: Document): Map<string, ItemRecord> {
  const result = new Map<string, ItemRecord>();
  for (const board of document.boards)
    for (const column of board.columns)
      column.items.forEach((item, position) => {
        const key = JSON.stringify([board.id, item.id]);
        if (result.has(key)) throw Error("Duplicate item ID within a board");
        result.set(key, {
          boardId: board.id,
          columnId: column.id,
          position,
          text: item.text,
          done: item.done,
          assignees: [...new Set(item.assignees)].sort(),
          tag: item.tag || "",
        });
      });
  return result;
}
export function changedItems(previous: Document, next: Document): ItemChange[] {
  const before = itemIndex(previous),
    after = itemIndex(next),
    events: ItemChange[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key) || null,
      b = after.get(key) || null,
      [boardId, itemId] = JSON.parse(key);
    const fields = (Object.keys(a || b!) as (keyof ItemRecord)[]).filter((field) => {
      if (field !== "assignees") return a?.[field] !== b?.[field];
      const left = a?.assignees,
        right = b?.assignees;
      return (
        !left ||
        !right ||
        left.length !== right.length ||
        left.some((value, index) => value !== right[index])
      );
    });
    if (fields.length)
      events.push({
        boardId,
        itemId,
        kind: !a ? "created" : !b ? "deleted" : "changed",
        before: a,
        after: b,
        fields,
      });
  }
  return events;
}
export function newlyAssigned(event: ItemChange): string[] {
  return event.after?.assignees.filter((id) => !event.before?.assignees.includes(id)) || [];
}
export function historyLimit(requested: unknown): number {
  const limit = Number(requested || 30);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 30;
}
