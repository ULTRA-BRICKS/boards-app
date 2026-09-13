import { installFont, buildFont, GLYPH_COUNT } from "/packages/font/font.mjs";
await installFont();
for (const id of ["weight", "width"]) {
  const input = document.getElementById(id);
  input.addEventListener("input", () => {
    document.documentElement.style.setProperty("--" + id, input.value);
    document.getElementById(id + "-value").textContent = input.value;
  });
}
document.getElementById("build").onclick = () => {
  const bytes = buildFont(),
    url = URL.createObjectURL(new Blob([bytes], { type: "font/ttf" })),
    a = document.createElement("a");
  a.href = url;
  a.download = "ConlocaSans-Variable.ttf";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  document.getElementById("result").textContent =
    `Built on your device: ${GLYPH_COUNT} glyphs · wght 300–800 · wdth 85–125.`;
};
