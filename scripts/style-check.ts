import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
const window = new Window();
for (const file of ["apps/board/style.css", "apps/board/refinements.css", "apps/board/interaction.css", "apps/type-site/style.css"]) {
  const css = await readFile(file, "utf8");
  if (/!important\s*!important|@import\s+url\(http:/.test(css)) throw new Error("Unsafe style in " + file);
  const sheet = new window.CSSStyleSheet(); sheet.replaceSync(css);
  if (!sheet.cssRules.length) throw new Error("Empty parsed stylesheet " + file);
}
console.log("Styles parse; no insecure CSS imports. Runtime visual and axe checks are separate.");
