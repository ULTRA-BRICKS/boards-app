/** Build a complete fetch-style Node 24 handler, without an external asset dependency. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand, staticDeploymentEnvironment } from "./deployment.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
runCommand(process.execPath, ["scripts/bundle-type.mjs"], {
  cwd: root,
  env: staticDeploymentEnvironment(),
});
const html = await readFile(resolve(root, "dist/type-standalone/index.html"), "utf8");
const source = `// Public specimen only. No database, auth or external fetch is used.\nconst html=${JSON.stringify(html)};\nexport default {async fetch(request){\nconst url=new URL(request.url);\nif(url.pathname==='/health')return Response.json({ok:true,site:'Conloca Sans',kind:'static-type-specimen'});\nif(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});\nif(!['/','/index.html'].includes(url.pathname))return new Response('Not found',{status:404});\nreturn new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});\n}};\n`;
await mkdir(resolve(root, "dist/type-neon"), { recursive: true });
await writeFile(resolve(root, "dist/type-neon/index.mjs"), source);
console.log(
  "Neon Function prepared from original source outlines. No prebuilt font or workspace data included.",
);
