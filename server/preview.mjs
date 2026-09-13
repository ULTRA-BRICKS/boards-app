/** Projection-to-layout adapter. Preserve storage text; reflow whitespace only in previews. */
import * as renderer from "./preview-renderer.mjs";
export { textWidth, wrapText, fitText } from "./preview-renderer.mjs";
function compact(view) {
  const copy = structuredClone(view);
  for (const b of copy.boards)
    for (const c of b.columns)
      for (const t of c.items) t.text = t.text.replace(/\s+/gu, " ").trim();
  return copy;
}
export const makePreview = (view) => renderer.makePreview(compact(view));
export const renderPNG = (view) => renderer.renderPNG(compact(view));
export const renderSVG = (view) => renderer.renderSVG(compact(view));
