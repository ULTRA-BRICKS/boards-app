import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
for (const broken of [true, false])
  test(
    "Undefined editor callbacks are " + (broken ? "rejected" : "not falsely reported"),
    async () => {
      const dir = await mkdtemp(resolve(tmpdir(), "boards-lint-"));
      try {
        const file = dir + "/boot.mjs";
        await Bun.write(
          file,
          (broken ? "" : "function commit() {}\n") + 'commit(); document.title="Example | Boards";',
        );
        const child = Bun.spawn(
          [resolve("node_modules/.bin/oxlint"), "-c", resolve(".oxlintrc.json"), file],
          { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
        );
        const output =
          (await new Response(child.stdout).text()) + (await new Response(child.stderr).text());
        const code = await child.exited;
        expect(code).toBe(broken ? 1 : 0);
        if (broken) {
          expect(output).toContain("no-undef");
          expect(output).toContain("commit");
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
