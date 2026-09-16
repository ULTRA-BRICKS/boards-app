import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const origin = "https://boards-app-gamma.vercel.app";
const checks: string[] = [];
async function get(path: string) {
  const response = await fetch(origin + path, {
    signal: AbortSignal.timeout(15000),
    cache: "no-cache",
  });
  assert(response.ok, "HTTP " + response.status + " at " + path);
  return response;
}
const html = await (await get("/")).text();
assert(html.includes("boards-build"));
checks.push("Public HTML");
const manifest = await (await get("/build.json")).json();
assert(/^[a-f0-9]{16}$/.test(manifest.version));
assert(html.includes('content="' + manifest.version + '"'));
checks.push("Manifest and HTML are one generation");
assert(Array.isArray(manifest.assets) && manifest.assets.length <= 30);
for (const path of manifest.assets) {
  assert(/^\/assets\/[\w.-]+$/.test(path));
  const r = await get(path);
  if (path.endsWith(".js")) assert(/javascript/.test(r.headers.get("content-type") || ""));
}
checks.push("All immutable assets and JavaScript MIME");
await get("/type.html");
await get("/sw.js");
checks.push("Type site and service worker");
const api =
  "https://ep-long-pond-ay3myrkz.apirest.c-5.us-east-2.aws.neon.tech/boards_prototype/rest/v1";
const cors = await fetch(api + "/rpc/notebook", {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type,content-profile,accept-profile",
  },
  signal: AbortSignal.timeout(15000),
});
assert(cors.ok);
assert([origin, "*"].includes(cors.headers.get("access-control-allow-origin") || ""));
checks.push("Cloud CORS allows actual deployment origin");
await mkdir("../../docs/metrics", { recursive: true });
const result = {
  build: manifest.version,
  timestamp: new Date().toISOString(),
  checks,
  scope:
    "Unmocked public resources and CORS only. No mutation, token logging or persistence claim.",
};
await Bun.write("../../docs/metrics/live-public-resources.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
