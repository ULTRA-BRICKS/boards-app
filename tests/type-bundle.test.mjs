import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
test("independent type bundle is self-contained source, with no font binaries or workspace endpoints", () => {
  const result = spawnSync(process.execPath, ["scripts/bundle-type.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const html = readFileSync("dist/type-standalone/index.html", "utf8");
  assert.match(html, /Conloca Sans/);
  assert.match(html, /new FontFace/);
  assert.doesNotMatch(
    html,
    /src="\/|href="\/|\/api\/|DATABASE_URL|base64,|import .* from |export (?:const|function)/,
  );
});
