// Mutation tests for scripts/scan-board-state.mjs: the scan must stay quiet on the real tree and must fail
// the moment a new piece of unregistered UI state appears in apps/board/*.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scanSource, checkAgainstRegistry, scanBoard } from "../scripts/scan-board-state.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const registry = JSON.parse(readFileSync(root + "docs/board-ownership-registry.json", "utf8"));
const FILE = "apps/board/app.mjs";
const kinds = (text) => scanSource(FILE, text).map((f) => `${f.kind}:${f.scope}:${f.name}`);

test("the shipped tree matches the registry exactly", () => {
  const report = scanBoard({ root, registry });
  assert.deepEqual(report.unregistered, []);
  assert.deepEqual(report.stale, []);
  assert.deepEqual(report.files.sort(), readdirSync(root + "apps/board").filter((f) => f.endsWith(".mjs")).map((f) => `apps/board/${f}`).sort());
});

test("every registry entry carries a justification and a known kind", () => {
  for (const entry of registry.entries) {
    assert.ok(["let", "var", "collection", "literal", "storage"].includes(entry.kind), entry.name);
    assert.ok(typeof entry.why === "string" && entry.why.length > 15, `${entry.file} ${entry.name} needs a real reason`);
    assert.ok(Number.isInteger(entry.count) && entry.count > 0);
  }
});

test("mutations: each new kind of state is detected", () => {
  assert.deepEqual(kinds("let leaked = 0;"), ["let:top-level:leaked"]);
  assert.deepEqual(kinds("var a=1,b=2;"), ["var:top-level:a", "var:top-level:b"]);
  assert.deepEqual(kinds("function f(){let cache=null;return ()=>cache}"), ["let:closure:cache"]);
  assert.deepEqual(kinds("const seen=new Set();"), ["collection:top-level:seen"]);
  assert.deepEqual(kinds("function f(){const m=new Map();}"), ["collection:closure:m"]);
  assert.deepEqual(kinds("const w=new WeakMap(),x=new WeakSet();"), ["collection:top-level:w", "collection:top-level:x"]);
  assert.deepEqual(kinds("const TABLE={a:1};"), ["literal:top-level:TABLE"]);
  assert.deepEqual(kinds("const LIST=[1,2];"), ["literal:top-level:LIST"]);
  assert.deepEqual(kinds("localStorage.setItem('k','v');"), ["storage:top-level:localStorage"]);
  assert.deepEqual(kinds("const s=window.sessionStorage;"), ["storage:top-level:sessionStorage"]);
  assert.deepEqual(kinds("document.cookie='a=b';"), ["storage:top-level:document.cookie"]);
});

test("not state: strings, templates, comments, regexes, loop counters, frozen values and arrow consts", () => {
  const quiet = [
    "const a='let x = new Map()';",
    'const b="var y; localStorage";',
    "const c=`let z=1 ${1+1} new Set()`;",
    "// let q = 1; new Map()\nconst d=1;",
    "/* var r; sessionStorage */ const e=2;",
    "const f=/let g|new Map/.test('x');",
    "for(let i=0;i<3;i++){}",
    "for(let key of []){}",
    "const FROZEN=Object.freeze({a:1});",
    "const fn=()=>({a:1});",
    "const {a,b}=window;",
    "const t=`${[1].map(n=>{const k={v:n};return k.v})}`;",
  ];
  for (const text of quiet) assert.deepEqual(kinds(text), [], text);
});

test("template literal expressions are code: state inside ${} is still seen", () => {
  assert.deepEqual(kinds("const t=`${(()=>{let hidden=1;return hidden})()}`;"), ["let:closure:hidden"]);
});

test("checkAgainstRegistry reports unregistered findings, wrong counts and stale entries", () => {
  const findings = scanSource(FILE, "let one=1;function f(){let one=2}");
  const entry = { file: FILE, kind: "let", name: "one", scope: "top-level", count: 1, why: "a documented reason" };
  const closure = { ...entry, scope: "closure" };
  assert.deepEqual(checkAgainstRegistry(findings, [entry, closure], [FILE]), { unregistered: [], stale: [] });
  const missing = checkAgainstRegistry(findings, [entry], [FILE]);
  assert.equal(missing.unregistered.length, 1);
  assert.match(missing.unregistered[0], /closure/);
  const two = checkAgainstRegistry(scanSource(FILE, "let one=1;"), [{ ...entry, count: 2 }], [FILE]);
  assert.equal(two.stale.length, 1, "a count mismatch is reported");
  const gone = checkAgainstRegistry([], [entry], [FILE]);
  assert.equal(gone.stale.length, 1, "an entry with no matching source is stale");
});

test("scanBoard flags a mutated file while the unmutated registry is unchanged", () => {
  const read = (file) => readFileSync(root + file, "utf8");
  const mutate = (suffix) => ({ root, registry, read: (file) => (file === FILE ? read(file) + suffix : read(file)) });
  assert.deepEqual(scanBoard(mutate("\n")).unregistered, []);
  for (const suffix of ["\nlet leaked=0;", "\nconst bag=new Map();", "\nconst ITEMS=[];", "\nlocalStorage.getItem('x');", "\nfunction late(){var v=1}"]) {
    assert.ok(scanBoard(mutate(suffix)).unregistered.length > 0, suffix);
  }
});
