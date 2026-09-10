import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { PLACEHOLDER } from "../server/assets.mjs";
const root = resolve(import.meta.dir, "..");
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex").slice(0, 16);
export async function buildBoard() {
  const out = resolve(root, "dist/board");
  await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
  const worker = await Bun.build({ entrypoints: [resolve(root, "apps/board/font-worker.ts")], outdir: out, target: "browser", format: "esm", minify: true, naming: { entry: "assets/[name]-[hash].[ext]" } });
  if (!worker.success) throw new AggregateError(worker.logs, "Font worker build failed");
  const workerPath = "/assets/" + basename(worker.outputs[0]!.path);
  const result = await Bun.build({
    entrypoints: [resolve(root, "apps/board/boot.mjs")], outdir: out, target: "browser", format: "esm", splitting: true, minify: true,
    naming: { entry: "assets/[name]-[hash].[ext]", chunk: "assets/[name]-[hash].[ext]" },
    define: { __FONT_WORKER__: JSON.stringify(workerPath) },
    plugins: [{ name: "public-source-imports", setup(build) {
      build.onResolve({ filter: /^\/(?:packages\/|app\.mjs|photo-review\.mjs|pages\.ts|font-loader\.ts)/ }, (args) => ({ path: resolve(root, args.path.startsWith("/packages/") ? args.path.slice(1) : "apps/board" + args.path) }));
    } }],
  });
  if (!result.success) throw new AggregateError(result.logs, "Browser bundle failed");
  const boot = result.outputs.find((o) => o.kind === "entry-point");
  if (!boot) throw new Error("Entry output missing");
  const bootPath = "/assets/" + basename(boot.path);
  let html = await readFile(resolve(root, "apps/board/index.html"), "utf8");
  html = html.replace("/boot.mjs", bootPath);
  for (const name of ["style.css", "refinements.css", "interaction.css"]) {
    const css = await readFile(resolve(root, "apps/board", name), "utf8"), publicPath = "/assets/" + name.replace(".css", "-") + hash(css) + ".css";
    await writeFile(out + publicPath, css); await writeFile(out + "/" + name, css);
    html = html.replace("/" + name, publicPath);
  }
  await writeFile(out + "/boot.js", `import ${JSON.stringify(bootPath)};\n`);
  await writeFile(out + "/placeholder.svg", PLACEHOLDER);
  const assets = (await readdir(out + "/assets")).map((p) => "/assets/" + p).sort();
  const digest = createHash("sha256").update(html);
  for (const file of assets) digest.update(await readFile(out + file));
  const version = digest.digest("hex").slice(0, 16);
  html = html.replace("</head>", `<meta name="boards-shell" content="${version}"></head>`);
  await writeFile(out + "/index.html", html);
  const publicAssets = ["/index.html", "/placeholder.svg", ...assets];
  const sw = (await readFile(resolve(root, "apps/board/sw.js"), "utf8")).replace("__SHELL_VERSION__", JSON.stringify(version)).replace("__SHELL_ASSETS__", JSON.stringify(publicAssets));
  await writeFile(out + "/sw.js", sw); await writeFile(out + "/build.json", JSON.stringify({ version, assets: publicAssets }));
  console.log(`Board shell ${version}: ${publicAssets.length} version-coherent public assets`);
}
export async function buildType() {
  const child = Bun.spawn([process.execPath, resolve(root, "scripts/build.mjs"), "--type"], { cwd: root, stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error("Type build failed");
}
if (import.meta.main) { if (process.argv.includes("--type")) await buildType(); else await buildBoard(); }
