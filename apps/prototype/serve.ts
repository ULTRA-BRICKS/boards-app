import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../../dist/prototype");
Bun.serve({
  hostname: "127.0.0.1",
  port: 5183,
  async fetch(req) {
    const url = new URL(req.url),
      path =
        url.pathname === "/" || /^\/s\/[a-f0-9]{64}\/?$/.test(url.pathname)
          ? "/index.html"
          : url.pathname;
    if (!/^\/(?:[\w-]+\.(html|js|json|txt)|assets\/[\w.-]+)$/.test(path))
      return new Response("Not found", { status: 404 });
    const file = Bun.file(root + path);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const type = path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : path.endsWith(".html")
          ? "text/html"
          : path.endsWith(".json")
            ? "application/json"
            : "application/octet-stream";
    return new Response(file, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
});
console.log("Prototype fixture server: http://127.0.0.1:5183");
