import test from "node:test";
import assert from "node:assert/strict";
import { opposedActions } from "../packages/core/intent.mjs";
import { rank, lexical } from "../packages/core/search.mjs";

test("opposite leading commands and negations are not duplicate intent", () => {
  for (const [a, b] of [
    ["Enable analytics", "Disable analytics"],
    ["Add a page", "Remove a page"],
    ["Включить аналитику", "Отключить аналитику"],
    ["Please enable tracking", "Do not enable tracking"],
    ["Не удалить страницу", "Удалить страницу"],
    ["Publish the site", "Unpublish the site"],
  ])
    assert.equal(opposedActions(a, b), true, `${a} / ${b}`);
});
test("opposition is not guessed from non-leading words or unrelated action domains", () => {
  for (const [a, b] of [
    ["Add a disable button", "Add an enable button"],
    ["Create release notes", "Enable analytics"],
    ["Fix billing", "Repair payments"],
    ["Don't disable analytics", "Enable analytics"],
  ])
    assert.equal(opposedActions(a, b), false);
});
test("near-identical vectors cannot bypass the opposite-action duplicate guard", () => {
  const docs = [{ id: "a", title: "Disable analytics", text: "Disable analytics" }];
  const options = { queryVector: [1, 0], vectors: new Map([["a", [1, 0]]]) };
  assert.equal(rank("Enable analytics", docs, { ...options, duplicate: true }).length, 0);
  assert.equal(
    rank("Enable analytics", docs, options).length,
    1,
    "normal search must still retrieve related opposing work",
  );
});
test("function-word-only overlap cannot outrank semantic meaning", () => {
  const docs = [
    { id: "seo", title: "Optimize for SEO", text: "Optimize for SEO" },
    { id: "onboarding", title: "Improve onboarding", text: "Improve onboarding" },
  ];
  assert.deepEqual(lexical("welcome flow for new users", docs), []);
  assert.deepEqual(lexical("for the", docs), []);
  assert.equal(lexical("SEO", docs)[0].id, "seo");
});
