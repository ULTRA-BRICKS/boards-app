declare module "fontkit" {
  interface Glyph { bbox: { minX: number; minY: number; maxX: number; maxY: number }; path: { commands: unknown[] }; }
  interface Font { variationAxes: Record<string, { min: number; max: number; default: number }>; getVariation(values: Record<string, number>): Font; glyphsForString(value: string): Glyph[]; }
  export function create(data: Buffer): Font;
}
