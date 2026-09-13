import { mkdir } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
const commands: Record<string, string[]> = {
  unit: ["bun", "run", "test"],
  lint: ["bun", "run", "lint"],
  format: ["bun", "run", "format:check"],
  build: ["bun", "run", "build"],
  chromium: ["bun", "tests/ui.ts"],
  webkit: ["bun", "tests/ui.ts"],
};
const stage = process.argv[2];
if (!Object.hasOwn(commands, stage))
  throw Error("Choose unit, lint, format, build, chromium or webkit.");
process.chdir(import.meta.dir);
const logDir = "../../.private/stages";
await mkdir(logDir, { recursive: true });
const started = new Date().toISOString(),
  begin = performance.now();
const fd = openSync(`${logDir}/${stage}.log`, "w", 0o600);
let exitCode = 1;
try {
  const child = Bun.spawn(commands[stage], {
    stdout: fd,
    stderr: fd,
    env: { ...process.env, ...(stage === "webkit" ? { BROWSER: "webkit" } : {}) },
  });
  const timeout = setTimeout(() => child.kill(), 180000);
  exitCode = await child.exited;
  clearTimeout(timeout);
} finally {
  closeSync(fd);
}
const report = {
  stage,
  started,
  durationMs: Math.round(performance.now() - begin),
  exitCode,
  success: exitCode === 0,
};
await Bun.write(`${logDir}/${stage}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
console.log((await Bun.file(`${logDir}/${stage}.log`).text()).split("\n").slice(-16).join("\n"));
process.exit(exitCode);
