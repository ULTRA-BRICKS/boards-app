import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync } from "node:zlib";
import assert from "node:assert/strict";
const report = [];
for (const site of ["board", "type-site"]) {
  let bytes = 0, gzip = 0, brotli = 0;
  for (const file of await readdir(`dist/${site}`, { recursive: true })) {
    if (!/\.(?:html|css|js|mjs|svg)$/.test(file)) continue;
    const data = await readFile(`dist/${site}/${file}`);
    bytes += data.length; gzip += gzipSync(data).length; brotli += brotliCompressSync(data).length;
  }
  report.push({ site, bytes, gzip, brotli });
  assert.ok(gzip < (site === "board" ? 60_000 : 50_000), `${site} exceeds compressed transfer budget: ${gzip}`);
}
await mkdir("test-results", { recursive: true });
await writeFile("test-results/bundle-budget.json", JSON.stringify(report, null, 2));
console.log(report);
