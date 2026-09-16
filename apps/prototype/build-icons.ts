import rough from "roughjs";
const generator = rough.generator(),
  names = {
    pages: "stack-2",
    camera: "camera",
    search: "search",
    people: "users",
    share: "share-2",
    settings: "settings-2",
    sound: "volume",
    muted: "volume-off",
    plus: "plus",
    close: "x",
    check: "check",
    assign: "user-plus",
    undo: "arrow-back-up",
    download: "download",
    down: "chevron-down",
    up: "chevron-up",
  },
  icons: Record<string, string> = {};
for (const [name, file] of Object.entries(names)) {
  const svg = await Bun.file(`node_modules/@tabler/icons/icons/outline/${file}.svg`).text();
  let contents = "";
  let index = 0;
  for (const match of svg.matchAll(
    /<(path|circle|ellipse|line|polyline|polygon|rect)\b([^>]*)\/?\s*>/g,
  )) {
    const attr = Object.fromEntries(
      [...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    if (attr.stroke === "none") continue;
    const opts = {
      seed: 1000 + index++,
      roughness: 0.34,
      bowing: 0.18,
      strokeWidth: 1.6,
      disableMultiStroke: true,
    };
    let drawable;
    const n = (key: string) => Number(attr[key]);
    if (match[1] === "path") drawable = generator.path(attr.d, opts);
    if (match[1] === "circle")
      drawable = generator.ellipse(n("cx"), n("cy"), n("r") * 2, n("r") * 2, opts);
    if (match[1] === "ellipse")
      drawable = generator.ellipse(n("cx"), n("cy"), n("rx") * 2, n("ry") * 2, opts);
    if (match[1] === "line") drawable = generator.line(n("x1"), n("y1"), n("x2"), n("y2"), opts);
    if (match[1] === "rect")
      drawable = generator.rectangle(n("x"), n("y"), n("width"), n("height"), opts);
    if (match[1] === "polyline" || match[1] === "polygon") {
      const values = attr.points.split(/[ ,]+/).map(Number),
        points = [];
      for (let i = 0; i < values.length; i += 2) points.push([values[i], values[i + 1]]);
      drawable = generator.linearPath(points, opts);
    }
    if (drawable)
      for (const p of generator.toPaths(drawable))
        contents += `<path d="${p.d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  icons[name] = contents;
}
await Bun.write(
  "lib/icons.ts",
  "// Generated from Tabler (MIT) through RoughJS (MIT); build-time only.\nexport const ICONS:Record<string,string>=" +
    JSON.stringify(icons) +
    ";\n",
);
