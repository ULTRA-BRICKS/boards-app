type Entry = {
  event: string;
  operation?: string;
  code?: string;
  status?: number;
  ms?: number;
  at: string;
};
const events = new Set([
  "boot",
  "request.started",
  "request.finished",
  "request.failed",
  "auth.cached",
  "auth.renew",
  "open.started",
  "open.cached",
  "open.ready",
  "open.failed",
  "recovery.retry",
  "recovery.cloud",
  "save.failed",
  "save.ready",
  "online",
  "offline",
  "runtime.error",
]);
const operations = new Set([
  "auth",
  "read",
  "create",
  "save",
  "share",
  "revoke",
  "read-share",
  "open",
]);
const codes = new Set([
  "NETWORK",
  "TIMEOUT",
  "HTTP",
  "CONFLICT",
  "UNAVAILABLE",
  "BAD_RESPONSE",
  "ABORT",
  "UNKNOWN",
]);
export function journal(limit = 120) {
  const entries: Entry[] = [];
  return {
    record(event: string, meta: Record<string, unknown> = {}) {
      if (!events.has(event)) return;
      const entry: Entry = { event, at: new Date().toISOString() };
      if (operations.has(String(meta.operation))) entry.operation = String(meta.operation);
      if (codes.has(String(meta.code))) entry.code = String(meta.code);
      if (Number.isInteger(meta.status) && Number(meta.status) >= 100 && Number(meta.status) <= 599)
        entry.status = Number(meta.status);
      if (Number.isFinite(meta.ms) && Number(meta.ms) >= 0)
        entry.ms = Math.round(Math.min(Number(meta.ms), 300000));
      entries.push(entry);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
    },
    snapshot() {
      return entries.map((e) => ({ ...e }));
    },
  };
}
const log = journal();
export function diagnose(event: string, meta: Record<string, unknown> = {}) {
  log.record(event, meta);
}
export function diagnostics() {
  return {
    schema: 1,
    build:
      typeof document === "undefined"
        ? null
        : document.querySelector('meta[name="boards-build"]')?.getAttribute("content"),
    online: typeof navigator === "undefined" ? null : navigator.onLine,
    events: log.snapshot(),
  };
}
export function downloadDiagnostics() {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(diagnostics(), null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "boards-diagnostics.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
if (typeof window !== "undefined") {
  Object.defineProperty(window, "boardsDiagnostics", { value: diagnostics });
  window.addEventListener("online", () => diagnose("online"));
  window.addEventListener("offline", () => diagnose("offline"));
  window.addEventListener("error", () => diagnose("runtime.error"));
  window.addEventListener("unhandledrejection", () => diagnose("runtime.error"));
  diagnose("boot");
}
