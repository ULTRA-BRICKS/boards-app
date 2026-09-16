import { test, expect } from "bun:test";
import { savePhotoAndCleanDraft } from "../photo/save-result";
test("A failed cloud save never removes the recoverable draft", async () => {
  let removed = false;
  await expect(
    savePhotoAndCleanDraft(
      async () => {
        throw Error("cloud offline");
      },
      async () => {
        removed = true;
      },
    ),
  ).rejects.toThrow("cloud offline");
  expect(removed).toBe(false);
});
test("Failed local cleanup cannot misreport a successful cloud save", async () => {
  const result = await savePhotoAndCleanDraft(
    async () => {},
    async () => {
      throw Error("idb unavailable");
    },
  );
  expect(result.saved).toBe(true);
  expect(result.draftRemoved).toBe(false);
});
test("Normal success records both completed stages", async () => {
  const events: string[] = [];
  const result = await savePhotoAndCleanDraft(
    async () => {
      events.push("cloud");
    },
    async () => {
      events.push("cleanup");
    },
  );
  expect(result).toEqual({ saved: true, draftRemoved: true });
  expect(events).toEqual(["cloud", "cleanup"]);
});
