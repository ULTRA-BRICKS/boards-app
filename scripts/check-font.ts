import assert from "node:assert/strict";
import { create } from "fontkit";
import { buildFont } from "../packages/font/font.mjs";
const font = create(Buffer.from(buildFont()));
assert.deepEqual(Object.keys(font.variationAxes).sort(), ["wdth", "wght"]);
let instances = 0;
for (const wght of [300, 400, 520, 575, 800]) for (const wdth of [85, 93, 100, 113, 125]) {
  const instance = font.getVariation({ wght, wdth });
  for (const glyph of instance.glyphsForString("Landing ЁёжЯя 0123456789")) {
    if (!glyph.path.commands.length) continue;
    const box = glyph.bbox; assert.ok(Number.isFinite(box.minX) && Number.isFinite(box.maxX));
  }
  instances++;
}
console.log(`fontkit validated ${instances} instances in memory; no font files emitted`);
