import { afterEach, expect, test } from "bun:test";
import { readSnapshot, writeJSON } from "../lib/session";
const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "sessionStorage", original);
  else delete (globalThis as any).sessionStorage;
});
function storage(record: unknown) {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (key === "test" ? JSON.stringify(record) : null),
      setItem() {},
    },
  });
}
test("an unsaved draft survives the normal 12-hour snapshot expiry", () => {
  storage({
    version: 3,
    saved: Date.now() - 2 * 86400000,
    pending: true,
    value: { draft: "not sent" },
  });
  expect(readSnapshot("test")).not.toBeNull();
});
test("expired clean snapshots do not bypass cloud reload", () => {
  storage({ version: 3, saved: Date.now() - 2 * 86400000, pending: false, value: {} });
  expect(readSnapshot("test")).toBeNull();
});
test("negative versions and future-dated clean snapshots are rejected", () => {
  for (const version of [-1, NaN]) {
    storage({ version, saved: Date.now(), pending: true });
    expect(readSnapshot("test")).toBeNull();
  }
  storage({ version: 1, saved: Date.now() + 86400000, pending: false });
  expect(readSnapshot("test")).toBeNull();
});
test("storage quota failure is reported to the caller, not asserted as durable", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      setItem() {
        throw Error("QuotaExceededError");
      },
    },
  });
  expect(writeJSON("test", { draft: "keep in memory" })).toBe(false);
});
