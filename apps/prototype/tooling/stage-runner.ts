import { mkdir, rename, symlink } from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
export type StageOptions = {
  stage: string;
  logDir: string;
  command: string[];
  timeoutMs: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
};
export type StageReceipt = {
  stage: string;
  runId: string;
  started: string;
  finished?: string;
  ownerPid: number;
  childPid: number | null;
  timeoutMs: number;
  durationMs: number;
  status: "starting" | "running" | "succeeded" | "failed" | "timed_out" | "spawn_failed";
  exitCode: number | null;
  success: boolean;
  logPath: string;
};
async function writeReceipt(path: string, receipt: StageReceipt) {
  const temporary = path + "." + crypto.randomUUID() + ".tmp";
  await Bun.write(temporary, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}
async function latestLink(directory: string, name: string, target: string) {
  const temporary = resolve(directory, "." + name + "." + crypto.randomUUID() + ".link");
  await symlink(target, temporary);
  await rename(temporary, resolve(directory, name));
}
/** One result per execution. No secrets, command text, or environment values enter receipts. */
export async function runStage(options: StageOptions): Promise<StageReceipt> {
  if (
    !/^[a-z][a-z0-9-]{0,40}$/.test(options.stage) ||
    !options.command.length ||
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 3600000
  )
    throw new Error("Invalid stage options");
  const root = resolve(options.logDir),
    runId = crypto.randomUUID(),
    relative = ".runs/" + options.stage + "-" + runId;
  await mkdir(resolve(root, ".runs"), { recursive: true, mode: 0o700 });
  const receiptPath = resolve(root, relative + ".json"),
    logPath = resolve(root, relative + ".log");
  const result: StageReceipt = {
    stage: options.stage,
    runId,
    started: new Date().toISOString(),
    ownerPid: process.pid,
    childPid: null,
    timeoutMs: options.timeoutMs,
    durationMs: 0,
    status: "starting",
    exitCode: null,
    success: false,
    logPath,
  };
  const begin = performance.now();
  let fd: number | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined,
    force: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  await writeReceipt(receiptPath, result);
  // Only the start changes latest; an older, slower completion cannot replace a newer run.
  await latestLink(root, options.stage + ".json", relative + ".json");
  try {
    fd = openSync(logPath, "wx", 0o600);
    await latestLink(root, options.stage + ".log", relative + ".log");
    child = Bun.spawn(options.command, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdin: "ignore",
      stdout: fd,
      stderr: fd,
    });
    result.childPid = child.pid;
    result.status = "running";
    await writeReceipt(receiptPath, result);
    timeout = setTimeout(() => {
      timedOut = true;
      child?.kill("SIGTERM");
      force = setTimeout(() => {
        if (child?.exitCode === null) child.kill("SIGKILL");
      }, 750);
    }, options.timeoutMs);
    const code = await child.exited;
    result.exitCode = timedOut ? 124 : code;
    result.status = timedOut ? "timed_out" : code === 0 ? "succeeded" : "failed";
    result.success = result.status === "succeeded";
  } catch {
    if (child) {
      child.kill("SIGKILL");
      await child.exited;
    }
    result.status = "spawn_failed";
    result.exitCode = 1;
    result.success = false;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (force) clearTimeout(force);
    if (fd !== undefined) closeSync(fd);
    result.durationMs = Math.round(performance.now() - begin);
    result.finished = new Date().toISOString();
    await writeReceipt(receiptPath, result);
  }
  return result;
}
export async function logTail(path: string, lines = 16): Promise<string> {
  const file = Bun.file(path),
    start = Math.max(0, file.size - 65536);
  const text = await file.slice(start).text();
  return text.split("\n").slice(-lines).join("\n");
}
