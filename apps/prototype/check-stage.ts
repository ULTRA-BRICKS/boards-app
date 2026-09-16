import { runStage, logTail } from "./tooling/stage-runner";
const commands: Record<string, string[]> = {
  unit: ["bun", "run", "test"],
  lint: ["bun", "run", "lint"],
  format: ["bun", "run", "format:check"],
  build: ["bun", "run", "build"],
  chromium: ["bun", "tests/ui.ts"],
  webkit: ["bun", "tests/ui.ts"],
  "accounts-types": ["bun", "run", "typecheck:accounts"],
  "accounts-chromium": ["bun", "tests/account-screens.ts"],
  "accounts-webkit": ["bun", "tests/account-screens.ts"],
  "loading-chromium": ["bun", "tests/loading-regressions.ts"],
  "loading-webkit": ["bun", "tests/loading-regressions.ts"],
};
const stage = process.argv[2];
if (!Object.hasOwn(commands, stage))
  throw Error("Unknown stage; choose " + Object.keys(commands).join(", "));
process.chdir(import.meta.dir);
const result = await runStage({
  stage,
  logDir: "../../.private/stages",
  command: commands[stage],
  timeoutMs: 180000,
  env: { ...process.env, BROWSER: stage.endsWith("webkit") ? "webkit" : "chromium" },
});
console.log(JSON.stringify(result));
console.log(await logTail(result.logPath).catch(() => "No log: executable did not start."));
process.exit(result.exitCode ?? 1);
