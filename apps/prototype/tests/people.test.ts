import { test, expect } from "bun:test";
import { openTaskCounts } from "../lib/people";
test("One traversal counts 200 people on a full 1200-item board", () => {
  let visits = 0;
  const people = Array.from({ length: 200 }, (_, i) => "p" + i);
  const items = Array.from({ length: 1200 }, (_, i) => ({
    done: i % 4 === 0,
    get assignees() {
      visits++;
      return [people[i % 200], people[(i + 1) % 200]];
    },
  }));
  const counts = openTaskCounts({ boards: [{ columns: [{ items }] }] });
  expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(1800);
  expect(visits).toBe(900);
});
test("Completed tasks excluded; duplicate assignee on one task counted once", () => {
  const counts = openTaskCounts({
    boards: [
      {
        columns: [
          {
            items: [
              { done: false, assignees: ["a", "a"] },
              { done: true, assignees: ["a"] },
            ],
          },
        ],
      },
    ],
  });
  expect(counts.get("a")).toBe(1);
  expect(counts.get("missing")).toBeUndefined();
});
