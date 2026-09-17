import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const origin = "https://boards.example",
  assets = ["/index.html", "/assets/app-a123.js", "/placeholder.svg"];
const html = (version: string) => `<html><meta name="boards-build" content="${version}"></html>`;
async function worker(version = "a") {
  const listeners: Record<string, (event: any) => void> = {},
    stores = new Map<string, Map<string, Response>>();
  let calls = 0,
    claimed = false,
    next: () => Promise<Response> = async () => new Response("fresh");
  const caches = {
    async keys() {
      return [...stores.keys()];
    },
    async delete(key: string) {
      return stores.delete(key);
    },
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name)!;
      return {
        async addAll(paths: string[]) {
          paths.forEach((p) =>
            map.set(p, new Response(p === "/index.html" ? html(version) : "old")),
          );
        },
        async match(path: string) {
          return map.get(path)?.clone();
        },
        async put(path: string, value: Response) {
          map.set(path, value.clone());
        },
      };
    },
  };
  const code = (await readFile("sw.js", "utf8"))
    .replace("__VERSION__", JSON.stringify(version))
    .replace("__ASSETS__", JSON.stringify(assets));
  runInNewContext(code, {
    URL,
    Request,
    Response,
    AbortSignal,
    caches,
    fetch: () => {
      calls++;
      return next();
    },
    self: {
      location: { origin },
      clients: {
        async claim() {
          claimed = true;
        },
      },
      addEventListener(name: string, fn: (e: any) => void) {
        listeners[name] = fn;
      },
    },
  });
  async function event(
    name: string,
    request?: { url: string; method: string; mode: string },
    waitForBackground = true,
  ) {
    const wait: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    listeners[name]!({
      request,
      waitUntil(p: Promise<unknown>) {
        wait.push(p);
      },
      respondWith(p: Promise<Response>) {
        response = p;
      },
    });
    const result = response ? await response : undefined;
    if (waitForBackground) await Promise.all(wait);
    else void Promise.all(wait).catch(() => {});
    return result;
  }
  const request = (path: string, method = "GET", navigate = false) => ({
    url: new URL(path, origin).href,
    method,
    mode: navigate ? "navigate" : "cors",
  });
  return {
    event,
    request,
    stores,
    caches,
    setNext(fn: () => Promise<Response>) {
      next = fn;
    },
    get calls() {
      return calls;
    },
    get claimed() {
      return claimed;
    },
  };
}
test("shell install is a public allowlist and does not force-activate over open editors", async () => {
  const w = await worker();
  await w.event("install");
  expect([...w.stores.get("boards-public-a")!.keys()]).toEqual(assets);
  expect(w.claimed).toBeFalse();
});
test("shell never intercepts private data, mutations or sign-in query links", async () => {
  const w = await worker();
  await w.event("install");
  for (const path of [
    "/api/state",
    "/api/people",
    "/api/auth/verify",
    "/s/capability",
    "/?verify=token",
    "https://other.example/assets/app-a123.js",
  ])
    expect(await w.event("fetch", w.request(path, "GET", path.startsWith("/?")))).toBeUndefined();
  expect(await w.event("fetch", w.request("/assets/app-a123.js", "POST"))).toBeUndefined();
  expect(w.calls).toBe(0);
});
test("shell SWR returns cached assets and revalidates for the next read", async () => {
  const w = await worker();
  await w.event("install");
  expect(await (await w.event("fetch", w.request("/assets/app-a123.js")))!.text()).toBe("old");
  expect(await (await w.event("fetch", w.request("/assets/app-a123.js")))!.text()).toBe("fresh");
  expect(w.calls).toBe(2);
});
test("old service worker cannot cache new HTML with an incompatible chunk generation", async () => {
  const w = await worker("a");
  await w.event("install");
  w.setNext(async () => new Response(html("b")));
  expect(
    await (await w.event("fetch", w.request("/#board=one&item=two", "GET", true)))!.text(),
  ).toBe(html("a"));
  expect(await (await (await w.caches.open("boards-public-a")).match("/index.html"))!.text()).toBe(
    html("a"),
  );
});
test("matching shell generation is revalidated, and offline cache misses return explicit 503", async () => {
  const w = await worker();
  await w.event("install");
  w.setNext(async () => new Response(html("a") + "updated"));
  await w.event("fetch", w.request("/", "GET", true));
  expect(
    await (await (await w.caches.open("boards-public-a")).match("/index.html"))!.text(),
  ).toContain("updated");
  w.stores.get("boards-public-a")!.delete("/assets/app-a123.js");
  w.setNext(async () => {
    throw Error("Offline");
  });
  expect((await w.event("fetch", w.request("/assets/app-a123.js")))!.status).toBe(503);
});
test("activation removes only old board shells and leaves unrelated caches alone", async () => {
  const w = await worker();
  await w.caches.open("unrelated");
  await w.caches.open("boards-public-old");
  await w.event("install");
  await w.event("activate");
  expect(await w.caches.keys()).toEqual(["unrelated", "boards-public-a"]);
  expect(w.claimed).toBeTrue();
});
test("same-build version link uses the cached shell instead of bypassing SWR", async () => {
  const w = await worker("a");
  await w.event("install");
  w.setNext(async () => {
    throw Error("Offline");
  });
  const response = await w.event("fetch", w.request("/?__boards_build=a", "GET", true));
  expect(response?.status).toBe(200);
  expect(await response!.text()).toBe(html("a"));
});
test("old-version and credential queries are not normalized into public HTML cache", async () => {
  const w = await worker("a");
  await w.event("install");
  for (const query of [
    "?__boards_build=b",
    "?__boards_build=a&key=private",
    "?__boards_build=a&__boards_build=b",
  ])
    expect(await w.event("fetch", w.request("/" + query, "GET", true))).toBeUndefined();
  expect(w.calls).toBe(0);
});
test("cached navigation resolves while revalidation is still waiting on the network", async () => {
  const w = await worker("a");
  await w.event("install");
  let finish: (r: Response) => void = () => {};
  w.setNext(() => new Promise((resolve) => (finish = resolve)));
  const response = await Promise.race([
    w.event("fetch", w.request("/?__boards_build=a", "GET", true), false),
    Bun.sleep(150).then(() => null),
  ]);
  finish(new Response(html("a")));
  expect(response?.status).toBe(200);
  expect(await response!.text()).toBe(html("a"));
});
test("CacheStorage failure falls back to the network, not a failed response", async () => {
  const w = await worker("a");
  await w.event("install");
  w.caches.open = async () => {
    throw Error("Cache unavailable");
  };
  w.setNext(async () => new Response(html("a")));
  const response = await w.event("fetch", w.request("/", "GET", true));
  expect(response?.status).toBe(200);
  expect(await response!.text()).toBe(html("a"));
});
