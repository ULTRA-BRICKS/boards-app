import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
const base = "https://boards-app-gamma.vercel.app";
if (process.env.BOARDS_LIVE_WRITE !== "1")
  throw Error("Set BOARDS_LIVE_WRITE=1 to test in a new isolated notebook.");
const manifest = await (await fetch(base + "/build.json", { cache: "no-store" })).json();
assert.equal(manifest.version, process.env.EXPECTED_BUILD);
const auth = await (await fetch(base + "/cloud/token/anonymous", { cache: "no-store" })).json();
assert.equal(typeof auth.token, "string");
const cap = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
async function rpc(name: string, body: unknown) {
  const r = await fetch(base + "/cloud/rpc/" + name, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  assert(r.ok, "RPC failed with status " + r.status);
  return r.json();
}
const state = createWorkspace();
state.name = "PRIVATE_SPACE_NOT_IN_METADATA";
let version = (await rpc("notebook", { capability: cap, expected_version: 0, document: state }))
  .version;
const checks: any[] = [];
await mkdir("../../docs/metrics", { recursive: true });
await mkdir("../../docs/screenshots", { recursive: true });
for (const scope of [
  { kind: "board", boardId: "roadmap" },
  { kind: "column", boardId: "roadmap", columnId: "product" },
  { kind: "item", boardId: "roadmap", itemIds: ["p2"], neighbors: true },
  { kind: "items", boardId: "roadmap", itemIds: ["p1", "p2"] },
  { kind: "space" },
]) {
  const { token } = await rpc("share_notebook", { capability: cap, scope });
  assert(/^[a-f0-9]{64}$/.test(token));
  const link = base + "/s/" + token;
  const response = await fetch(link, { cache: "no-store" });
  assert.equal(response.status, 200);
  assert(response.headers.get("x-robots-tag")?.includes("noindex"));
  const html = await response.text();
  assert(html.includes("og:image"));
  assert(/name="robots"[^>]+noindex/.test(html));
  assert(html.includes("summary_large_image"));
  assert(!html.includes(cap));
  assert(!html.includes(state.name));
  const png = await fetch(link + "/og.png", { cache: "no-store" });
  assert.equal(png.status, 200);
  assert(png.headers.get("x-robots-tag")?.includes("noindex"));
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal(png.headers.get("cache-control"), "no-store");
  const image = Buffer.from(await png.arrayBuffer());
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
  if (scope.kind === "item")
    await Bun.write("../../docs/screenshots/share-item-preview.png", image);
  if (scope.kind === "item") {
    const item = state.boards[0].columns[1].items.find((t: any) => t.id === "p2"),
      previous = item.text;
    item.text = "Freshly saved preview text";
    version = (
      await rpc("notebook", { capability: cap, expected_version: version, document: state })
    ).version;
    const fresh = await (await fetch(link, { cache: "no-store" })).text();
    assert(fresh.includes("Freshly saved preview text"));
    const changed = Buffer.from(
      await (await fetch(link + "/og.png", { cache: "no-store" })).arrayBuffer(),
    );
    assert(!changed.equals(image));
    item.text = previous;
    version = (
      await rpc("notebook", { capability: cap, expected_version: version, document: state })
    ).version;
  }
  await rpc("share_notebook", { capability: cap, revoke_token: token });
  assert.equal((await fetch(link, { cache: "no-store" })).status, 404);
  assert.equal((await fetch(link + "/og.png", { cache: "no-store" })).status, 404);
  checks.push({
    scope: scope.kind,
    metadata: true,
    noindexHTMLAndImage: true,
    anonymousRead: true,
    image: "1200x630",
    revokedHTML: 404,
    revokedImage: 404,
    latestStateChecked: scope.kind === "item",
  });
}
const result = {
  build: manifest.version,
  mode: "Unmocked public HTTPS; freshly created isolated notebook, no supplied user data modified",
  checks,
};
await Bun.write("../../docs/metrics/live-previews.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
