import { mkdir, rm, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import "./build-icons";
const root = resolve(import.meta.dir, "../.."),
  out = resolve(root, "dist/prototype");
await rm(out, { recursive: true, force: true });
await mkdir(out + "/assets", { recursive: true });
const worker = await Bun.build({
  entrypoints: [import.meta.dir + "/lib/font-worker.ts"],
  outdir: out,
  target: "browser",
  format: "esm",
  minify: true,
  naming: "assets/[name]-[hash].[ext]",
});
if (!worker.success) throw new AggregateError(worker.logs, "Font worker build failed");
const result = await Bun.build({
  entrypoints: [import.meta.dir + "/app.mjs"],
  outdir: out,
  target: "browser",
  format: "esm",
  minify: true,
  naming: "assets/[name]-[hash].[ext]",
  define: { FONT_WORKER: JSON.stringify("/assets/" + basename(worker.outputs[0].path)) },
});
if (!result.success) throw new AggregateError(result.logs, "Board build failed");
const type = await Bun.build({
  entrypoints: [root + "/apps/type-site/type.mjs"],
  outdir: out,
  target: "browser",
  format: "esm",
  minify: true,
  naming: "assets/type-[hash].[ext]",
  plugins: [
    {
      name: "font-source",
      setup(b) {
        b.onResolve({ filter: /^\/packages\// }, (args) => ({ path: root + args.path }));
      },
    },
  ],
});
if (!type.success) throw new AggregateError(type.logs, "Type site build failed");
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const base = await readFile(root + "/apps/board/style.css", "utf8"),
  ui = await readFile(import.meta.dir + "/ui.css", "utf8");
const cssName = "/assets/paper-" + digest(base + ui) + ".css";
await writeFile(out + cssName, base + "\n" + ui);
const typeCSS = await readFile(root + "/apps/type-site/style.css", "utf8"),
  typeCSSName = "/assets/type-" + digest(typeCSS) + ".css";
await writeFile(out + typeCSSName, typeCSS);
let html = await readFile(import.meta.dir + "/shell.html", "utf8");
html = html
  .replace("__STYLE__", cssName)
  .replace("__SCRIPT__", "/assets/" + basename(result.outputs[0].path));
let typeHTML = await readFile(root + "/apps/type-site/index.html", "utf8");
typeHTML = typeHTML
  .replace("/style.css", typeCSSName)
  .replace("/type.mjs", "/assets/" + basename(type.outputs[0].path));
await writeFile(out + "/type.html", typeHTML);
const assets = (await readdir(out + "/assets")).map((p) => "/assets/" + p).sort();
const hash = createHash("sha256").update(html);
for (const file of assets) hash.update(await readFile(out + file));
const version = hash.digest("hex").slice(0, 16);
html = html.replace("__BUILD__", version);
await writeFile(out + "/index.html", html);
const sw = (await readFile(import.meta.dir + "/sw.js", "utf8"))
  .replace("__VERSION__", JSON.stringify(version))
  .replace("__ASSETS__", JSON.stringify(["/index.html", ...assets]));
await writeFile(out + "/sw.js", sw);
await writeFile(out + "/build.json", JSON.stringify({ version, assets }));
await copyFile(import.meta.dir + "/vercel.json", out + "/vercel.json");
console.log(JSON.stringify({ version, assets: assets.length, out }));
