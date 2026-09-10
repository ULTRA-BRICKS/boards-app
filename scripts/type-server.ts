import { resolve } from "node:path";
import { buildType } from "./build.ts";
await buildType();
const port = Number(process.env.TYPE_PORT || 5174), root = resolve(import.meta.dir, "../dist/type-site");
Bun.serve({ port, hostname: "127.0.0.1", async fetch(req) {
  const path = new URL(req.url).pathname;
  if (!["/", "/index.html", "/style.css", "/type.mjs", "/packages/font/font.mjs", "/packages/font/glyphs.mjs"].includes(path)) return new Response("Not found", { status: 404 });
  const file = Bun.file(root + (path === "/" ? "/index.html" : path));
  return new Response(file, { headers: { "Content-Type": path.endsWith(".mjs") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" } });
} });
console.log(`Type site: http://127.0.0.1:${port}`);
