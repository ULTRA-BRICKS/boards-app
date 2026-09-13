import { test, expect } from "bun:test";
import { avatar, collapsedCount, colors, esc, hash, initial, strikePath } from "../lib/paper";
import { notebookCacheKey, anonymousExpiry } from "../lib/session";
for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 12, 100, 1200])
  test("N+2 exact threshold " + length, () => {
    expect(collapsedCount(length)).toBe(length <= 5 ? length : 3);
    expect(collapsedCount(length, true)).toBe(length);
  });
for (const [name, letter] of [
  ["Danny", "D"],
  [" нико ", "Н"],
  ["ёжик", "Ё"],
  ["Mariam", "M"],
  ["", "?"],
  ["🙂 test", "🙂"],
  ["ქართული", "Ქ"],
])
  test("Unicode initial " + name, () => expect(initial(name)).toBe(letter));
test("200 members have distinct repeatable color backgrounds", () => {
  const people = Array.from({ length: 200 }, (_, i) => ({ id: "person-" + i }));
  const values = colors(people);
  expect(new Set(values.values()).size).toBe(200);
  expect([...values]).toEqual([...colors(people)]);
});
for (const bad of [
  "javascript:alert(1)",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "https://private.example/image",
  '" onerror=alert(1)',
])
  test("unsafe image does not become an img " + bad, () => {
    expect(avatar({ id: "a", name: "<test>", avatar: bad }, "hsl(1 62% 85%)")).not.toContain(
      "<img",
    );
  });
test("first-letter fallback escapes HTML", () => {
  expect(avatar({ id: "a", name: "<name" }, "hsl(1 62% 85%)")).toContain("&lt;");
  expect(esc('<script>"&')).toBe("&lt;script&gt;&quot;&amp;");
});
for (let i = 0; i < 64; i++)
  test("handdrawn strike is bounded and deterministic " + i, () => {
    const a = strikePath(130, 20, hash("task-" + i)),
      b = strikePath(130, 20, hash("task-" + i));
    expect(a).toEqual(b);
    expect(a.width).toBeGreaterThanOrEqual(1.3);
    expect(a.width).toBeLessThan(1.81);
    for (const p of a.d.slice(1).split(" L")) {
      const [x, y] = p.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(130);
      expect(y).toBeGreaterThanOrEqual(19.3);
      expect(y).toBeLessThanOrEqual(20.7);
    }
  });
test("cache keys do not contain editing capabilities", async () => {
  const cap = "a".repeat(43),
    key = await notebookCacheKey(cap);
  expect(key).not.toContain(cap);
  expect(key).not.toBe(await notebookCacheKey("b".repeat(43)));
});
test("only unexpired anonymous tokens are reusable", () => {
  const make = (role: string, exp: number) => "x." + btoa(JSON.stringify({ role, exp })) + ".x";
  expect(anonymousExpiry(make("authenticated", Date.now() / 1000 + 120))).toBe(0);
  expect(anonymousExpiry("bad")).toBe(0);
  expect(anonymousExpiry(make("anonymous", Date.now() / 1000 + 120))).toBeGreaterThan(Date.now());
});
