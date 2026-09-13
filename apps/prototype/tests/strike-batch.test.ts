import { afterEach, expect, test } from "bun:test";
import { drawStrikes } from "../lib/paper";
const original = Object.getOwnPropertyDescriptor(globalThis, "document");
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "document", original);
  else delete (globalThis as any).document;
});
test("1200 completed rows are measured before any SVG is attached", () => {
  const operations: string[] = [];
  const element = () => ({ classList: { add() {} }, setAttribute() {}, append() {} });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createRange: () => ({
        selectNodeContents() {},
        getClientRects() {
          operations.push("read");
          return [{ width: 120, height: 24, top: 0, left: 0 }];
        },
      }),
      createElementNS: element,
    },
  });
  const rows = Array.from({ length: 1200 }, (_, i) => ({
    classList: { contains: () => true },
    dataset: { item: String(i) },
    querySelector(selector: string) {
      return selector === ".ink-strike"
        ? {
            remove() {
              operations.push("remove");
            },
          }
        : {
            firstChild: {},
            isContentEditable: false,
            getBoundingClientRect() {
              operations.push("read");
              return { width: 120, height: 24, top: 0, left: 0 };
            },
            append() {
              operations.push("write");
            },
          };
    },
  }));
  drawStrikes(rows as any);
  const firstWrite = operations.indexOf("write"),
    lastRead = operations.lastIndexOf("read");
  expect(firstWrite).toBeGreaterThan(lastRead);
  expect(operations.filter((x) => x === "write")).toHaveLength(1200);
});
