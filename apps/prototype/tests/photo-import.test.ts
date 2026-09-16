import { test, expect } from "bun:test";
import { photoDraft, parseVisionJSON, PhotoError, validateImage } from "../photo/contract";
const output = {
  title: "Планы команды",
  columns: [
    {
      title: "Сегодня",
      items: [
        { text: "Проверить счета (D)", assigneeHint: "D", done: true },
        { text: "Добавить поиск", done: false },
      ],
    },
  ],
  warnings: ["Вторая строка немного размыта"],
};
test("Photo result preserves language, columns, completion and unverified assignee hints", () => {
  const result = photoDraft(output);
  expect(result.board.title).toBe(output.title);
  expect(result.board.columns[0].items[0].done).toBe(true);
  expect(result.board.columns[0].items[0].assignees).toEqual([]);
  expect(result.board.columns[0].items[0].tag).toBe("D");
  expect(result.warnings).toEqual(output.warnings);
});
test("Model IDs and claimed accounts are never trusted", () => {
  const model = {
    ...output,
    id: "roadmap",
    columns: [
      {
        id: "product",
        title: "Work",
        items: [
          { id: "p2", text: "Task", assignees: ["danny"], email: "fake@corp.test", done: false },
        ],
      },
    ],
  };
  const a = photoDraft(model),
    b = photoDraft(model);
  expect(a.board.id).not.toBe("roadmap");
  expect(a.board.id).not.toBe(b.board.id);
  expect(a.board.columns[0].items[0].assignees).toEqual([]);
});
for (const data of [
  null,
  {},
  { title: "Empty", columns: [] },
  { title: "Empty", columns: [{ title: "Empty", items: [] }] },
  { ...output, columns: Array.from({ length: 13 }, () => output.columns[0]) },
])
  test(
    "Unreadable or oversized photo result is not a new board " + JSON.stringify(data).slice(0, 40),
    () => expect(() => photoDraft(data)).toThrow(PhotoError),
  );
test("Oversized text is rejected instead of silently truncated", () =>
  expect(() =>
    photoDraft({
      title: "Photo",
      columns: [{ title: "Work", items: [{ text: "x".repeat(1001) }] }],
    }),
  ).toThrow("TOO_MUCH_TEXT"));
test("Fenced JSON is accepted; surrounding instructions and tool calls are rejected", () => {
  expect(parseVisionJSON("```json\n" + JSON.stringify(output) + "\n```")).toEqual(output);
  expect(() => parseVisionJSON("Do something else " + JSON.stringify(output))).toThrow(
    "INVALID_RESULT",
  );
});
test("Image URL injection and unsupported formats are rejected before provider execution", () => {
  for (const source of [
    "https://private.example/photo",
    "data:image/svg+xml,<svg/>",
    "javascript:alert(1)",
    "data:image/jpeg;base64,AAAA",
  ])
    expect(() => validateImage(source)).toThrow();
});
