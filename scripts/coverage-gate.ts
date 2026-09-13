import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
const text = await readFile("coverage/unit/lcov.info", "utf8");
const records = text
  .split("end_of_record")
  .filter((v) => v.includes("SF:"))
  .map((v) => {
    const get = (k: string) => Number(new RegExp("^" + k + ":(\\d+)", "m").exec(v)?.[1] || 0);
    return {
      file: /^SF:(.+)$/m.exec(v)![1]!.replace(process.cwd() + "/", ""),
      lines: get("LF"),
      covered: get("LH"),
      functions: get("FNF"),
      functionsCovered: get("FNH"),
    };
  })
  .filter((r) => /^(server|packages\/core)\//.test(r.file));
const expected = (
  await Promise.all(
    ["server", "packages/core"].map(async (dir) =>
      (await readdir(dir))
        .filter((p) => /\.(mjs|ts)$/.test(p) && !p.endsWith(".d.ts"))
        .map((p) => dir + "/" + p),
    ),
  )
).flat();
for (const file of expected)
  if (!records.some((r) => r.file === file)) throw new Error("No coverage record for " + file);
const totals = records.reduce(
  (a, r) => ({
    lines: a.lines + r.lines,
    covered: a.covered + r.covered,
    functions: a.functions + r.functions,
    functionsCovered: a.functionsCovered + r.functionsCovered,
  }),
  { lines: 0, covered: 0, functions: 0, functionsCovered: 0 },
);
const report = {
  scope:
    "All server/ and packages/core/ modules. Browser UI/SW are exercised separately, NOT counted in this percentage.",
  linePercent: (100 * totals.covered) / totals.lines,
  functionPercent: (100 * totals.functionsCovered) / totals.functions,
  files: records,
};
await mkdir("test-results", { recursive: true });
await writeFile("test-results/coverage-summary.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, files: undefined }, null, 2));
if (report.linePercent < 80 || report.functionPercent < 80)
  throw new Error("Core/server coverage below 80%");
for (const file of ["server/identity.mjs", "server/app.mjs", "server/http.mjs"]) {
  const r = records.find((r) => r.file === file)!;
  if (r.covered / r.lines < 0.8) throw new Error(file + " below 80% lines");
}
