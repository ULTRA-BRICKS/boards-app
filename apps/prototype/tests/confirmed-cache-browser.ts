import { chromium, webkit } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
const engine = process.env.BROWSER === "webkit" ? webkit : chromium,
  browser = await engine.launch({ headless: true }),
  context = await browser.newContext({ serviceWorkers: "block" }),
  page = await context.newPage();
const build = await Bun.build({
  entrypoints: ["lib/confirmed-cache.ts"],
  write: false,
  target: "browser",
  format: "esm",
});
if (!build.success) throw new AggregateError(build.logs);
await context.route("**/cache-module.js", async (route) =>
  route.fulfill({ contentType: "text/javascript", body: await build.outputs[0].text() }),
);
await context.route("**/cache-sandbox", (route) =>
  route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Cache test</title>" }),
);
const key = "x".repeat(43),
  value = createWorkspace();
try {
  await page.goto("http://127.0.0.1:5183/cache-sandbox");
  const results = await page.evaluate(
    async ({ key, value }) => {
      const module = await import("/cache-module.js");
      const scope =
        "boards:tab:" +
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
      const cache = module.confirmedCache(scope, key),
        checks: Record<string, boolean> = {};
      checks.firstWrite = await cache.write(4, value, Date.now());
      checks.restores = (await cache.read())?.version === 4;
      checks.olderWriteRejected = (await cache.write(2, value, Date.now())) === false;
      checks.wrongKeyCannotDecrypt =
        (await module.confirmedCache(scope, "y".repeat(43)).read()) === null;
      const records = await new Promise<any[]>((resolve, reject) => {
        const request = indexedDB.open("boards-confirmed-cache-v1");
        request.onsuccess = () => {
          const db = request.result,
            r = db.transaction("snapshots").objectStore("snapshots").getAll();
          r.onsuccess = () => {
            db.close();
            resolve(r.result);
          };
          r.onerror = () => reject(r.error);
        };
      });
      checks.noPlaintext = records.every(
        (r) =>
          !("value" in r) &&
          !("capability" in r) &&
          !new TextDecoder().decode(r.ciphertext).includes(value.boards[0].title),
      );
      const started = Date.now() - 100;
      await cache.invalidate();
      checks.invalidated = (await cache.read()) === null;
      checks.inflightCannotRepopulate = (await cache.write(5, value, started)) === false;
      await new Promise((r) => setTimeout(r, 4));
      checks.reauthorizedReadCanCache = await cache.write(5, value, Date.now());
      return checks;
    },
    { key, value },
  );
  for (const [name, passed] of Object.entries(results)) assert.equal(passed, true, name);
  await mkdir("../../docs/metrics", { recursive: true });
  const report = {
    browser: engine.name(),
    mode: "Native IndexedDB and WebCrypto, synthetic board; no live private data",
    results,
  };
  await Bun.write(
    "../../docs/metrics/confirmed-cache-" + engine.name() + ".json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
