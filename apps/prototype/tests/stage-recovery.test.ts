import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runStage } from "../tooling/stage-runner";
async function sandbox(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(tmpdir() + "/boards-receipt-");
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const command = (code: string) => [process.execPath, "-e", code];
test("A new failed process cannot retain the previous successful receipt", () =>
  sandbox(async (logDir) => {
    const ok = await runStage({
      stage: "check",
      logDir,
      command: command("process.exit(0)"),
      timeoutMs: 2000,
    });
    expect(ok.success).toBe(true);
    const fail = await runStage({
      stage: "check",
      logDir,
      command: command("process.exit(7)"),
      timeoutMs: 2000,
    });
    const latest = await Bun.file(logDir + "/check.json").json();
    expect(latest.runId).toBe(fail.runId);
    expect(latest.success).toBe(false);
    expect(latest.exitCode).toBe(7);
    expect(fail.runId).not.toBe(ok.runId);
  }));
test("A process waiting on stdin sees EOF rather than hanging", () =>
  sandbox(async (logDir) => {
    const result = await runStage({
      stage: "stdin",
      logDir,
      command: command('const input=await Bun.stdin.text();if(input!=="")process.exit(3);'),
      timeoutMs: 2000,
    });
    expect(result.status).toBe("succeeded");
  }));
test("Silence has a wall-clock deadline and is not reported as success", () =>
  sandbox(async (logDir) => {
    const result = await runStage({
      stage: "silent",
      logDir,
      command: command("setInterval(()=>{},1000)"),
      timeoutMs: 100,
    });
    expect(result.status).toBe("timed_out");
    expect(result.success).toBe(false);
    expect(result.durationMs).toBeLessThan(3000);
  }));
test("Executable-not-found still produces a terminal failure receipt", () =>
  sandbox(async (logDir) => {
    const result = await runStage({
      stage: "spawn",
      logDir,
      command: [logDir + "/missing-executable"],
      timeoutMs: 2000,
    });
    expect(result.status).toBe("spawn_failed");
    expect((await Bun.file(logDir + "/spawn.json").json()).success).toBe(false);
  }));
test("A later run stays latest even when an older run finishes last", () =>
  sandbox(async (logDir) => {
    const older = runStage({
      stage: "overlap",
      logDir,
      command: command("setTimeout(()=>process.exit(9),450)"),
      timeoutMs: 2000,
    });
    let started: any;
    for (let i = 0; i < 100; i++) {
      try {
        started = await Bun.file(logDir + "/overlap.json").json();
        if (started.status === "running") break;
      } catch {}
      await Bun.sleep(5);
    }
    expect(started.status).toBe("running");
    expect(started.success).toBe(false);
    expect(started.childPid).toBeGreaterThan(0);
    const newer = await runStage({
      stage: "overlap",
      logDir,
      command: command("process.exit(0)"),
      timeoutMs: 2000,
    });
    await older;
    expect((await Bun.file(logDir + "/overlap.json").json()).runId).toBe(newer.runId);
  }));
test("Arbitrary stage names cannot escape the receipt directory", () =>
  sandbox(async (logDir) => {
    await expect(
      runStage({ stage: "../other", logDir, command: command("process.exit(0)"), timeoutMs: 2000 }),
    ).rejects.toThrow("Invalid stage options");
  }));
