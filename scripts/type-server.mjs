import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  port = Number(process.env.TYPE_PORT || 5174);
createServer(async (req, res) => {
  const p = new URL(req.url, "http://localhost").pathname;
  let path;
  if (p === "/") path = "apps/type-site/index.html";
  else if (["/style.css", "/type.mjs"].includes(p)) path = "apps/type-site" + p;
  else if (/^\/packages\/font\/[a-z-]+\.mjs$/.test(p)) path = p.slice(1);
  else {
    res.statusCode = 404;
    return res.end("Not found");
  }
  try {
    res.setHeader(
      "Content-Type",
      path.endsWith(".mjs") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
    );
    res.end(await readFile(resolve(root, path)));
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Separate type site: http://127.0.0.1:${port}`));
