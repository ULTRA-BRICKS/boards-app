import { readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { sources } from "./check-syntax.ts";
const secret = /(?:ghp_[a-zA-Z0-9]{30,}|sk_live_[a-zA-Z0-9]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for (const dir of ["apps", "packages", "server", "scripts"]) for (const file of await sources(dir)) {
  const text = await readFile(file, "utf8"); assert.ok(!secret.test(text), `Credential-like value in ${file}`);
}
for (const site of ["board", "type-site"]) for (const file of await readdir(`dist/${site}`, { recursive: true })) {
  assert.ok(!/\.(ttf|woff2?|otf|sqlite|db|env)$/.test(file), `Private/binary file in static output: ${file}`);
  if (/\.(m?js|html)$/.test(file)) {
    const text = await readFile(`dist/${site}/${file}`, "utf8");
    assert.ok(!text.includes("process.env.DATABASE_URL"), `Server secret access in browser output: ${file}`);
  }
}
const sw = await readFile("apps/board/sw.js", "utf8");
assert.ok(sw.includes("request.method !== 'GET'") || sw.includes('request.method !== "GET"'));
console.log("Source credential patterns and static artifact boundaries checked. This supplements CodeQL/dependency scanning; it is not a security audit.");
