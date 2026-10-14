// Deterministic ownership scan for the shipped board entry (apps/board/*.mjs).
// Flags every `let`/`var`, `new Map/Set/WeakMap/WeakSet`, mutable top-level `const` literal and web-storage use that is
// not registered, with a reason, in docs/board-ownership-registry.json. UI state belongs in board-state.mjs
// (state-lib scopes); a registry entry is the explicit, reviewable exception.
// CLI: node scripts/scan-board-state.mjs   (exit 1 on any unregistered or stale entry)
// Not a JS parser: a small lexer (strings, template literals with nested ${}, comments, regex literals) feeding a
// declaration walker. Loop headers (`for (let i ...`) are iteration-local and not state, so they are exempt.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const COLLECTIONS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);
const STORAGE = new Set(["localStorage", "sessionStorage", "indexedDB"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await"]);
const STATEMENT_START = new Set(["const", "let", "var", "function", "export", "import", "class", "if", "for", "while", "return", "async", "switch", "try", "throw"]);
const OPEN = "({[", CLOSE = ")}]";
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdPart = (c) => /[\w$]/.test(c);

/** Source text -> code tokens only: {v, kind, line, nl} (nl = a newline precedes the token). */
function lex(text) {
  const tokens = [];
  let i = 0, line = 1, nl = false;
  const push = (v, kind) => { tokens.push({ v, kind, line, nl }); nl = false; };
  const last = () => tokens.at(-1);
  const regexAllowed = () => {
    const t = last();
    if (!t) return true;
    if (t.kind === "id") return REGEX_AFTER_WORD.has(t.v);
    if (t.kind === "num" || t.kind === "str") return false;
    return !")]}".includes(t.v);
  };
  const skipString = (quote) => {
    i++;
    while (i < text.length && text[i] !== quote) {
      if (text[i] === "\\") i++;
      if (text[i] === "\n") { line++; }
      i++;
    }
    i++;
  };
  const lexTemplate = () => {
    i++; // opening backtick
    while (i < text.length && text[i] !== "`") {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === "$" && text[i + 1] === "{") {
        i += 2;
        push("{", "punct");
        lexCode(true);
        i++; // the closing brace of ${}
        push("}", "punct");
        continue;
      }
      if (text[i] === "\n") line++;
      i++;
    }
    i++;
  };
  function lexCode(inTemplate = false) {
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\n") { line++; nl = true; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; continue; }
      if (c === "/" && text[i + 1] === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) { if (text[i] === "\n") line++; i++; }
        i += 2;
        continue;
      }
      if (c === "'" || c === '"') { push("", "str"); skipString(c); continue; }
      if (c === "`") { push("", "str"); lexTemplate(); continue; }
      if (c === "/" && regexAllowed()) {
        i++;
        let inClass = false;
        while (i < text.length && (text[i] !== "/" || inClass)) {
          if (text[i] === "\\") i++;
          else if (text[i] === "[") inClass = true;
          else if (text[i] === "]") inClass = false;
          i++;
        }
        i++;
        while (i < text.length && isIdPart(text[i])) i++;
        push("", "regex");
        continue;
      }
      if (isIdStart(c)) {
        const start = i;
        while (i < text.length && isIdPart(text[i])) i++;
        push(text.slice(start, i), "id");
        continue;
      }
      if (/\d/.test(c)) {
        while (i < text.length && /[\w.]/.test(text[i])) i++;
        push("0", "num");
        continue;
      }
      if (inTemplate) {
        if (c === "{") depth++;
        if (c === "}") {
          if (depth === 0) return;
          depth--;
        }
      }
      push(c, "punct");
      i++;
    }
  }
  lexCode();
  return tokens;
}

/** Nesting depth before every token, so `top-level` means outside any brace, paren or bracket. */
function depths(tokens) {
  let depth = 0;
  return tokens.map((t) => {
    if (t.kind === "punct" && CLOSE.includes(t.v)) depth = Math.max(0, depth - 1);
    const here = depth;
    if (t.kind === "punct" && OPEN.includes(t.v)) depth++;
    return here;
  });
}

export function scanSource(file, text) {
  const tokens = lex(text), at = depths(tokens), found = [];
  const scopeAt = (index) => (at[index] === 0 ? "top-level" : "closure");
  const add = (kind, name, index) => found.push({ file, kind, name, scope: scopeAt(index), line: tokens[index].line });
  const is = (index, value) => tokens[index]?.v === value && tokens[index].kind !== "str";

  /** Walks the declarators of one let/var/const statement starting after the keyword. */
  const declarators = (keyword, from) => {
    let i = from;
    while (i < tokens.length) {
      const start = i;
      if (is(i, "{") || is(i, "[")) {
        let nest = 0;
        do {
          if (OPEN.includes(tokens[i].v) && tokens[i].kind === "punct") nest++;
          if (CLOSE.includes(tokens[i].v) && tokens[i].kind === "punct") nest--;
          i++;
        } while (i < tokens.length && nest > 0);
        if (keyword !== "const") add(keyword, "{destructured}", start);
      } else if (tokens[i]?.kind === "id") {
        const name = tokens[i].v;
        i++;
        if (keyword !== "const") add(keyword, name, start);
        if (keyword === "const" && is(i, "=") && at[start] === 0 && tokens[i + 1] && (is(i + 1, "{") || is(i + 1, "["))) {
          add("literal", name, start);
        }
      } else return;
      // Skip the initializer up to the next declarator separator at this nesting level.
      let nest = 0;
      while (i < tokens.length) {
        const t = tokens[i];
        if (t.kind === "punct" && OPEN.includes(t.v)) nest++;
        else if (t.kind === "punct" && CLOSE.includes(t.v)) { if (nest === 0) return; nest--; }
        else if (nest === 0 && t.kind === "punct" && t.v === ";") return;
        else if (nest === 0 && t.kind === "punct" && t.v === ",") break;
        else if (nest === 0 && t.nl && t.kind === "id" && STATEMENT_START.has(t.v)) return;
        i++;
      }
      if (i >= tokens.length) return;
      i++; // the comma
    }
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "id") continue;
    const member = is(i - 1, ".");
    if (member && !STORAGE.has(t.v)) continue;
    if (t.v === "let" || t.v === "var" || t.v === "const") {
      const next = tokens[i + 1];
      const valid = next && (next.kind === "id" || is(i + 1, "{") || is(i + 1, "["));
      const loopHeader = is(i - 1, "(") && tokens[i - 2]?.v === "for" || is(i - 1, "(") && tokens[i - 2]?.v === "await" && tokens[i - 3]?.v === "for";
      if (valid && !loopHeader) declarators(t.v, i + 1);
    } else if (t.v === "new" && COLLECTIONS.has(tokens[i + 1]?.v) && is(i + 2, "(")) {
      const named = is(i - 1, "=") && tokens[i - 2]?.kind === "id" ? tokens[i - 2].v : "(expression)";
      add("collection", named, i);
    } else if (STORAGE.has(t.v)) {
      add("storage", t.v, i);
    } else if (t.v === "document" && is(i + 1, ".") && tokens[i + 2]?.v === "cookie") {
      add("storage", "document.cookie", i);
    }
  }
  return found;
}

const keyOf = (f) => `${f.file}|${f.kind}|${f.scope}|${f.name}`;

/** Compares findings with registry entries ({file, kind, scope, name, count, why}). */
export function checkAgainstRegistry(findings, entries, files) {
  const unregistered = [], stale = [], groups = new Map();
  for (const f of findings) (groups.get(keyOf(f)) ?? groups.set(keyOf(f), []).get(keyOf(f))).push(f);
  const registered = new Map(entries.map((e) => [keyOf(e), e]));
  for (const [key, list] of groups) {
    const entry = registered.get(key), first = list[0];
    const where = `${first.file}:${first.line}`;
    if (!entry) unregistered.push(`${where} unregistered ${first.kind} (${first.scope}) "${first.name}": move it into board-state.mjs or register it with a reason`);
    else if (list.length > entry.count) unregistered.push(`${where} ${list.length} occurrences of ${first.kind} (${first.scope}) "${first.name}" but ${entry.count} registered`);
    else if (list.length < entry.count) stale.push(`registry says ${entry.count} x ${first.kind} (${first.scope}) "${first.name}" in ${first.file}, found ${list.length}`);
  }
  for (const [key, entry] of registered) {
    if (!groups.has(key)) stale.push(`registry entry ${entry.kind} (${entry.scope}) "${entry.name}" in ${entry.file} no longer exists in the source`);
    else if (!files.includes(entry.file)) stale.push(`registry entry for unscanned file ${entry.file}`);
  }
  return { unregistered, stale };
}

export function scanBoard({ root, registry, read = (file) => readFileSync(resolve(root, file), "utf8") }) {
  const files = readdirSync(resolve(root, "apps/board")).filter((f) => f.endsWith(".mjs")).map((f) => `apps/board/${f}`);
  const findings = files.flatMap((file) => scanSource(file, read(file)));
  return { files, findings, ...checkAgainstRegistry(findings, registry.entries, files) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const registry = JSON.parse(readFileSync(resolve(root, "docs/board-ownership-registry.json"), "utf8"));
  const report = scanBoard({ root, registry });
  for (const line of [...report.unregistered, ...report.stale]) console.error(line);
  console.log(`scanned ${report.files.length} files, ${report.findings.length} findings, ${report.unregistered.length} unregistered, ${report.stale.length} stale`);
  process.exit(report.unregistered.length || report.stale.length ? 1 : 0);
}
