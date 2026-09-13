import { parseSync } from "oxc-parser";
import { resolve } from "node:path";
import { readdir, readFile } from "node:fs/promises";
export async function sources(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const lists = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sources(resolve(root, entry.name))
        : Promise.resolve(/\.(?:js|mjs|ts)$/.test(entry.name) ? [resolve(root, entry.name)] : []),
    ),
  );
  return lists.flat();
}
export async function checkSyntax() {
  let count = 0;
  for (const dir of ["apps", "packages", "server", "scripts", "api"])
    for (const path of await sources(dir)) {
      const result = parseSync(path, await readFile(path, "utf8"));
      if (result.errors.length) throw new Error(`${path}: ${JSON.stringify(result.errors)}`);
      count++;
    }
  console.log(`Oxc parsed ${count} source files`);
}
if (import.meta.main) await checkSyntax();
