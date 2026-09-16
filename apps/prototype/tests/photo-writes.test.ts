import { test, expect } from "bun:test";
import { coalescedWriter } from "../photo/draft-writer";
test("A burst of edits persists the newest draft without one queued copy per keystroke", async () => {
  let text = "",
    writes: string[] = [];
  const writer = coalescedWriter(
    async () => {
      writes.push(text);
    },
    () => {},
  );
  for (let i = 0; i < 30; i++) {
    text += "x";
    writer.mark();
  }
  await writer.flush();
  expect(writes).toEqual(["x".repeat(30)]);
});
test("Edits during an active write coalesce into a single following write", async () => {
  let text = "one",
    release: () => void = () => {};
  const writes: string[] = [];
  const writer = coalescedWriter(
    async () => {
      writes.push(text);
      if (writes.length === 1) await new Promise<void>((r) => (release = r));
    },
    () => {},
  );
  writer.mark();
  await Bun.sleep(0);
  for (let i = 0; i < 20; i++) {
    text = "latest " + i;
    writer.mark();
  }
  release();
  await writer.flush();
  expect(writes).toEqual(["one", "latest 19"]);
});
test("Failed draft persistence is retryable and explicit flush never reports false durability", async () => {
  let failed = true;
  const writer = coalescedWriter(
    async () => {
      if (failed) throw Error("quota");
    },
    () => {},
  );
  writer.mark();
  await expect(writer.flush()).rejects.toThrow("quota");
  failed = false;
  await writer.flush();
  expect(writer.dirty).toBe(false);
});
