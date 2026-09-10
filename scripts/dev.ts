import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchHandler } from "../server/fetch-adapter.ts";
import { buildBoard } from "./build.ts";
const root = resolve(import.meta.dir, ".."); process.chdir(root);
if (process.argv.includes("--demo")) {
  if (process.env.DATABASE_URL) throw new Error("Demo mode refuses a cloud DATABASE_URL.");
  process.env.LOCAL_TEST_MODE = "1";
}
const port = Number(process.env.PORT || 5173);
process.env.APP_ORIGIN ||= `http://127.0.0.1:${port}`;
if (process.env.LOCAL_TEST_MODE === "1") await mkdir(".data", { recursive: true });
await buildBoard(); const dispatch = fetchHandler();
const mime: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".json": "application/json" };
const out = resolve("dist/board");
Bun.serve({ port, hostname: "127.0.0.1", idleTimeout: 60, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/s/")) return dispatch(request);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!/^\/(?:[a-zA-Z0-9_-]+\.(?:html|js|css|svg|json)|assets\/[a-zA-Z0-9_.-]+)$/.test(path)) return new Response("Not found", { status: 404 });
  const file = Bun.file(out + path);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  const ext = path.slice(path.lastIndexOf("."));
  return new Response(file, { headers: { "Content-Type": mime[ext] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...(path === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}) } });
} });
console.log(`Bun board: ${process.env.APP_ORIGIN}`);
