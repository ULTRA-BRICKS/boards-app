import { test, expect } from "bun:test";
import { stackMarkup } from "../lib/stack";
const page = (id: string, title = id) => ({ id, title });
const sheets = (html: string) => (html.match(/class="stack-sheet /g) || []).length;
test("One existing page offers a single fresh sheet, not two", () => {
  const html = stackMarkup([page("current")], "current");
  expect(sheets(html)).toBe(1);
  expect((html.match(/A fresh page/g) || []).length).toBe(1);
});
test("A real neighbor is not padded with an invented fresh page", () => {
  const html = stackMarkup([page("current"), page("next", "Next week")], "current");
  expect(sheets(html)).toBe(1);
  expect(html).toContain("Next week");
  expect(html).not.toContain("A fresh page");
});
test("Only two distinct real neighbors are previewed in a larger stack", () => {
  const html = stackMarkup([page("one"), page("two"), page("three"), page("four")], "two");
  expect(sheets(html)).toBe(2);
  expect(html).toContain("one");
  expect(html).toContain("three");
  expect(html).not.toContain("four");
});
test("Empty real title is Untitled, never an invitation to create", () => {
  const html = stackMarkup([page("current"), page("other", "")], "current");
  expect(html).toContain("Untitled");
  expect(html).not.toContain("A fresh page");
});
test("Preview labels cannot inject markup", () => {
  const html = stackMarkup([page("current"), page("other", "<img onerror=alert(1)>")], "current");
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img");
});
test("Read-only single-page shares do not advertise creating a page", () => {
  expect(stackMarkup([page("current")], "current", true)).toBe("");
});
test("Read-only multiple-page shares retain actual navigation", () => {
  const html = stackMarkup([page("current"), page("other", "Shared next page")], "current", true);
  expect(sheets(html)).toBe(1);
  expect(html).toContain("Shared next page");
  expect(html).not.toContain("A fresh page");
});
