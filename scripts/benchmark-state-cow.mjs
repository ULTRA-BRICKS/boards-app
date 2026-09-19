import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createDocumentStore } from "../packages/core/document-store.mjs";
const sizes = [30, 300, 1200],
  backends = ["baseline", "state-lib", "state-lib-cow"];
function fixture(count) {
  return {
    schemaVersion: 1,
    name: "Synthetic board",
    boards: [
      {
        id: "board",
        title: "Board",
        columns: Array.from({ length: Math.ceil(count / 200) }, (_, column) => ({
          id: `c${column}`,
          title: `Column ${column}`,
          items: Array.from({ length: Math.min(200, count - column * 200) }, (_, i) => ({
            id: `${column * 200 + i}`,
            text: `Task ${column * 200 + i}`,
            done: false,
            assignees: [],
          })),
        })),
      },
    ],
  };
}
const operations = {
  root: (s, i) =>
    s.change((d) => {
      d.name = `Edit ${i}`;
    }),
  item: (s, i) =>
    s.change((d) => {
      const items = d.boards[0].columns[0].items;
      const item = items[i % items.length];
      item.done = !item.done;
      item.text = `Edit ${i}`;
    }),
  sparse: (s, i) =>
    s.change((d) => {
      for (const col of d.boards[0].columns)
        for (let j = 0; j < col.items.length; j += 10) col.items[j].text = `Sparse ${i}`;
    }),
  all: (s, i) =>
    s.change((d) => {
      for (const col of d.boards[0].columns) for (const item of col.items) item.text = `All ${i}`;
    }),
  move: (s, i) =>
    s.change((d) => {
      const cols = d.boards[0].columns;
      const source = cols[i % cols.length],
        target = cols[(i + 1) % cols.length];
      const item = source.items.shift();
      if (item) target.items.push(item);
    }),
  noop: (s) => s.change(() => {}),
  history: (s) => {
    assert(s.undo());
    assert(s.redo());
  },
};
const quantile = (xs, q) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)];
const summary = [],
  raw = [];
for (const count of sizes) {
  for (const [operation, run] of Object.entries(operations)) {
    const samples = Object.fromEntries(backends.map((backend) => [backend, []]));
    const iterations = operation === "all" ? 20 : 80;
    for (let trial = -3; trial < 17; trial++) {
      const ordered = trial % 2 ? [...backends].reverse() : backends;
      const outcomes = [];
      for (const backend of ordered) {
        const store = createDocumentStore({ backend, initial: fixture(count), limit: 40 });
        if (operation === "history")
          store.change((d) => {
            d.name = "History";
          });
        const begin = performance.now();
        for (let i = 0; i < iterations; i++) run(store, i);
        const elapsed = (performance.now() - begin) / iterations;
        if (trial >= 0) samples[backend].push(elapsed);
        outcomes.push(structuredClone(store.read()));
        store.dispose();
      }
      for (const outcome of outcomes.slice(1)) assert.deepEqual(outcome, outcomes[0]);
    }
    for (const backend of backends) {
      const row = {
        count,
        operation,
        backend,
        iterationsPerTrial: iterations,
        trials: 17,
        medianBatchMeanMs: quantile(samples[backend], 0.5),
        p95BatchMeanMs: quantile(samples[backend], 0.95),
        minBatchMeanMs: Math.min(...samples[backend]),
        maxBatchMeanMs: Math.max(...samples[backend]),
      };
      summary.push(row);
      raw.push({ ...row, samples: samples[backend] });
    }
    console.info(
      count,
      operation,
      ...backends.map((backend) => `${backend}=${quantile(samples[backend], 0.5).toFixed(5)}ms`),
    );
  }
}
const directory = resolve(process.env.PILOT_EVIDENCE || "test-results/state-cow");
mkdirSync(directory, { recursive: true });
const hashes = Object.fromEntries(
  [
    "packages/core/document-store.mjs",
    "packages/core/document-store-baseline.mjs",
    "packages/core/json-draft.mjs",
    "scripts/benchmark-state-cow.mjs",
  ].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]),
);
const gates = [];
for (const count of sizes)
  for (const operation of Object.keys(operations)) {
    const a = summary.find(
      (x) => x.count === count && x.operation === operation && x.backend === "baseline",
    );
    const b = summary.find(
      (x) => x.count === count && x.operation === operation && x.backend === "state-lib-cow",
    );
    gates.push({
      count,
      operation,
      medianRatio: b.medianBatchMeanMs / a.medianBatchMeanMs,
      strictSampleGate: b.maxBatchMeanMs <= a.minBatchMeanMs,
    });
  }
writeFileSync(
  resolve(directory, "controller.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      node: process.version,
      method:
        "17 alternating batches after 3 warmups per condition. Means per operation, not individual interaction percentiles. Factory/import and DOM/network excluded; actual public document/history controller used. All outcomes compared after each trial. Baseline lacks immutability guarantees; state-lib full-copy is the stronger semantic comparator.",
      hashes,
      summary,
      raw,
      gates,
      universalPromotion: gates.every((g) => g.strictSampleGate),
    },
    null,
    2,
  ) + "\n",
);
