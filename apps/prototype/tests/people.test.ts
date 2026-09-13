import { test, expect } from "bun:test";
import { openTaskCounts, mapLimited } from "../lib/people";
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
for (const limit of [1, 2, 4, 8])
  test("Bounded concurrency " + limit + " retains input order", async () => {
    let active = 0,
      maximum = 0;
    const result = await mapLimited(
      Array.from({ length: 30 }, (_, i) => i),
      limit,
      async (i) => {
        active++;
        maximum = Math.max(active, maximum);
        await Bun.sleep((i % 3) + 1);
        active--;
        return i * 2;
      },
    );
    expect(result).toEqual(Array.from({ length: 30 }, (_, i) => i * 2));
    expect(maximum).toBeLessThanOrEqual(limit);
    expect(maximum).toBe(limit);
  });
for (const limit of [0, -1, 17, NaN, 1.5])
  test("Invalid concurrency rejects " + limit, async () => {
    await expect(mapLimited([1], limit, async (i) => i)).rejects.toThrow();
  });
test("Empty list makes no provider calls", async () => {
  let calls = 0;
  expect(
    await mapLimited([], 4, async () => {
      calls++;
    }),
  ).toEqual([]);
  expect(calls).toBe(0);
});
test("Aborted jobs return their explicit fallback without unbounded wait", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await mapLimited([1, 2, 3, 4, 5], 2, async () => {
    if (controller.signal.aborted) return "initial";
    return "photo";
  });
  expect(result).toEqual(["initial", "initial", "initial", "initial", "initial"]);
});
