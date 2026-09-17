import { test, expect } from "bun:test";
import { confirmedSnapshot, shouldReplaceConfirmed, CONFIRMED_TTL } from "../lib/confirmed-cache";
import { createWorkspace } from "../../../packages/core/workspace.mjs";
const now = Date.parse("2026-09-16T16:00:00Z"),
  value = createWorkspace();
test("Only positively versioned acknowledged snapshots qualify as device cache", () => {
  for (const version of [0, -1, NaN, 1.5])
    expect(confirmedSnapshot({ version, value, saved: now }, now)).toBeNull();
  expect(confirmedSnapshot({ version: 3, value, saved: now, pending: true }, now)).toBeNull();
  expect(confirmedSnapshot({ version: 3, value, saved: now }, now)?.version).toBe(3);
});
test("Expired, future and malformed snapshots are not shown as cached boards", () => {
  for (const saved of [now - CONFIRMED_TTL - 1, now + 10000, NaN])
    expect(confirmedSnapshot({ version: 1, value, saved }, now)).toBeNull();
  for (const value of [null, {}, { boards: [] }])
    expect(confirmedSnapshot({ version: 1, value, saved: now }, now)).toBeNull();
});
test("Slower older reads cannot overwrite newer acknowledged versions", () => {
  const record = (version: number) => ({ version, value, saved: now });
  expect(shouldReplaceConfirmed(record(5), record(3), now)).toBe(false);
  expect(shouldReplaceConfirmed(record(3), record(5), now)).toBe(true);
  expect(shouldReplaceConfirmed(null, record(1), now)).toBe(true);
});
