// Provenance pins: every file in packages/state-lib/scoped must carry a sha256 pin that
// matches its bytes, and existing packages/core/*.provenance.json pins must still match
// (read-only check; this test never rewrites a pin).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const pinsIn = (dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".provenance.json"));

test("scoped: every source file has a pin and every pin matches its file", () => {
  const dir = "packages/state-lib/scoped";
  const sources = readdirSync(join(root, dir)).filter((f) => f.endsWith(".mjs"));
  assert.ok(sources.length >= 4);
  for (const source of sources) {
    assert.ok(existsSync(join(root, dir, `${source.replace(".mjs", "")}.provenance.json`)), `${source} has no provenance pin`);
  }
  for (const pinFile of pinsIn(dir)) {
    const pin = JSON.parse(readFileSync(join(root, dir, pinFile), "utf8"));
    assert.equal(pin.sourceRepository, "this repository (boards-app)");
    assert.equal(pin.sourcePath, `${dir}/${pinFile.replace(".provenance.json", ".mjs")}`);
    assert.match(pin.sourceStatus, /HYP-1490/);
    assert.match(pin.sourceCommit, /^[0-9a-f]{40}$/);
    assert.equal(typeof pin.uncommitted, "boolean");
    assert.equal(pin.sha256, sha256(join(root, pin.sourcePath)), `${pin.sourcePath} changed after pinning`);
  }
});

test("core: existing pins match their vendored files", () => {
  const dir = "packages/core";
  for (const pinFile of pinsIn(dir)) {
    const pin = JSON.parse(readFileSync(join(root, dir, pinFile), "utf8"));
    const file = join(root, dir, pinFile.replace(".provenance.json", ".mjs"));
    assert.equal(pin.sha256, sha256(file), `${pinFile} does not match ${file}`);
  }
});
