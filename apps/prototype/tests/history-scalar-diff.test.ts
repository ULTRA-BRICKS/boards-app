import { test, expect } from "bun:test";
import { changedItems, type Document } from "../accounts/history";
test("Single edit in a large snapshot does not serialize unchanged item text for comparison", () => {
  const marker = "unchanged text ".repeat(40),
    previous: Document = {
      boards: [
        {
          id: "board",
          title: "Board",
          columns: [
            {
              id: "column",
              title: "Column",
              items: Array.from({ length: 1200 }, (_, i) => ({
                id: "item-" + i,
                text: marker,
                done: false,
                assignees: ["b", "a"],
              })),
            },
          ],
        },
      ],
    };
  const next = structuredClone(previous);
  next.boards[0].columns[0].items[500].done = true;
  const original = JSON.stringify;
  let textSerializations = 0;
  let events;
  try {
    JSON.stringify = ((value: any, ...args: any[]) => {
      if (value === marker) textSerializations++;
      return (original as any)(value, ...args);
    }) as typeof JSON.stringify;
    events = changedItems(previous, next);
  } finally {
    JSON.stringify = original;
  }
  expect(events).toHaveLength(1);
  expect(events![0].fields).toEqual(["done"]);
  expect(textSerializations).toBe(0);
});
test("Reordered duplicate assignees are equivalent, but creation and deletion retain complete field history", () => {
  const previous: Document = {
      boards: [
        {
          id: "b",
          title: "",
          columns: [
            {
              id: "c",
              title: "",
              items: [{ id: "i", text: "Task", done: false, assignees: ["a", "b", "a"] }],
            },
          ],
        },
      ],
    },
    next = structuredClone(previous);
  next.boards[0].columns[0].items[0].assignees = ["b", "a"];
  expect(changedItems(previous, next)).toHaveLength(0);
  next.boards[0].columns[0].items = [];
  const removed = changedItems(previous, next)[0];
  expect(removed.kind).toBe("deleted");
  expect(removed.fields).toContain("assignees");
  expect(removed.before?.text).toBe("Task");
  expect(changedItems(next, previous)[0].kind).toBe("created");
});
