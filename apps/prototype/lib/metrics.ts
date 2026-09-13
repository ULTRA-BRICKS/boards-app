import { onINP } from "web-vitals";
let inp: number | null = null;
onINP(
  (metric) => {
    inp = Math.round(metric.value);
  },
  { reportAllChanges: true },
);
type Metric = { name: string; ms: number };
const events: Metric[] = [],
  longTasks: number[] = [];
let lcp = 0,
  cls = 0;
export function mark(name: string) {
  if (!/^[a-z-]{1,40}$/.test(name)) return;
  if (events.some((e) => e.name === name)) return;
  events.push({ name, ms: Math.round(performance.now()) });
  performance.mark("boards:" + name);
}
export function measureAction(name: string, start: number) {
  events.push({ name: "action-" + name, ms: Math.round(performance.now() - start) });
  if (events.length > 100) events.shift();
}
export function report() {
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return {
    build: document.querySelector('meta[name="boards-build"]')?.getAttribute("content"),
    measurements: events.slice(),
    inp,
    lcp: Math.round(lcp),
    cls: Math.round(cls * 1000) / 1000,
    longTasks: longTasks.slice(-40),
    navigation: nav
      ? {
          ttfb: Math.round(nav.responseStart - nav.startTime),
          dom: Math.round(nav.domContentLoadedEventEnd),
          load: Math.round(nav.loadEventEnd),
        }
      : null,
    resources: performance.getEntriesByType("resource").map((e) => ({
      kind: e.name.includes("/rpc/")
        ? "cloud-rpc"
        : e.name.includes("/anonymous")
          ? "anonymous-token"
          : new URL(e.name, location.href).origin === location.origin
            ? "app-asset"
            : "other",
      duration: Math.round(e.duration),
    })),
    serviceWorker: !!navigator.serviceWorker?.controller,
  };
}
for (const type of ["longtask", "largest-contentful-paint", "layout-shift"])
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (type === "longtask") longTasks.push(Math.round(entry.duration));
        if (type === "largest-contentful-paint") lcp = entry.startTime;
        if (type === "layout-shift" && !(entry as any).hadRecentInput) cls += (entry as any).value;
      }
    }).observe({ type, buffered: true });
  } catch {}
Object.defineProperty(window, "boardsMetrics", { value: report, writable: false });
// No task text, URL fragments, names, tokens, or external analytics requests.
mark("module-ready");
