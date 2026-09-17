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
  await page.addInitScript(() => {
    let opens = 0,
      scans = 0;
    Object.defineProperty(window, "cacheIO", { get: () => ({ opens, scans }) });
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...args: Parameters<IDBFactory["open"]>) => {
      opens++;
      return open(...args);
    }) as IDBFactory["open"];
    const cursor = IDBIndex.prototype.openKeyCursor;
    IDBIndex.prototype.openKeyCursor = function (...args) {
      scans++;
      return cursor.apply(this, args);
    };
  });
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
      const before = (window as any).cacheIO;
      for (let version = 6; version <= 10; version++) await cache.write(version, value, Date.now());
      const after = (window as any).cacheIO;
      checks.autosavesReuseConnection = after.opens === before.opens;
      checks.autosavesSkipUnnecessaryPruning = after.scans === before.scans;
      for (let n = 0; n < 30; n++) {
        const other = "boards:tab:" + n.toString(16).padStart(64, "0");
        await module.confirmedCache(other, key).write(1, value, Date.now());
      }
      const count = await new Promise<number>((resolve, reject) => {
        const r = indexedDB.open("boards-confirmed-cache-v1");
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("snapshots").objectStore("snapshots").count();
          q.onsuccess = () => {
            db.close();
            resolve(q.result);
          };
          q.onerror = () => reject(q.error);
        };
      });
      checks.boundedTo24Snapshots = count <= 24;
      const original = IDBDatabase.prototype.transaction;
      const failed = new WeakSet<IDBDatabase>();
      let marked = false;
      IDBDatabase.prototype.transaction = function (...args: any[]) {
        if (this.name === "boards-confirmed-cache-v1" && !marked) {
          failed.add(this);
          marked = true;
        }
        if (failed.has(this)) throw new DOMException("Closed test connection", "InvalidStateError");
        return original.apply(this, args as any);
      };
      try {
        await cache.write(40, value, Date.now());
      } catch {}
      try {
        checks.closedConnectionRecovers = await cache.write(41, value, Date.now());
      } catch {
        checks.closedConnectionRecovers = false;
      } finally {
        IDBDatabase.prototype.transaction = original;
      }

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
