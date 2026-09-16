import { test, expect } from "bun:test";
import { normalizeSpaces, spaceLocation, keyFromSpaceLink } from "../lib/space-directory";
const key = "k".repeat(43);
test("A space switch uses its own capability and removes the old board/share fragment", () => {
  const location = spaceLocation(
    "https://boards.example/?version=1#key=OLD&share=PUBLIC&board=wrong",
    key,
    "Another space",
  );
  const u = new URL(location);
  expect(new URLSearchParams(u.hash.slice(1)).get("key")).toBe(key);
  expect(u.hash).not.toContain("OLD");
  expect(u.hash).not.toContain("share=");
  expect(u.hash).not.toContain("wrong");
});
test("Directory is bounded, deduplicated and drops malformed records", () => {
  const rows = normalizeSpaces([
    { key, name: "One", visited: 1 },
    { key, name: "Duplicate", visited: 2 },
    { key: "INVALID", name: "bad", visited: 3 },
    ...Array.from({ length: 40 }, (_, i) => ({
      key: String(i).padStart(43, "0"),
      name: "Space " + i,
      visited: i,
    })),
  ]);
  expect(rows).toHaveLength(25);
  expect(rows[0].name).toBe("One");
  expect(rows.some((s) => s.name === "bad")).toBe(false);
});
test("Only same-origin editing links can be added to the space picker", () => {
  expect(keyFromSpaceLink("https://boards.example/#key=" + key, "https://boards.example")).toBe(
    key,
  );
  for (const value of [
    "https://evil.example/#key=" + key,
    "https://boards.example/#share=" + key,
    "https://boards.example/s/" + key,
  ])
    expect(() => keyFromSpaceLink(value, "https://boards.example")).toThrow();
});
