/* App-shell SWR, never private state. A new deployment is installed as one coherent
 * generation. An old worker must not cache new HTML pointing at missing chunks. */
const VERSION = __SHELL_VERSION__;
const ASSETS = __SHELL_ASSETS__;
const PREFIX = "boards-shell-";
const CACHE = PREFIX + VERSION;
const allowed = new Set(ASSETS);
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const navigation =
    request.mode === "navigate" &&
    url.pathname === "/" &&
    [...url.searchParams.keys()].every((k) => ["board", "item"].includes(k));
  const key = navigation ? "/index.html" : url.pathname;
  if ((!navigation && url.search) || !allowed.has(key)) return;
  const update = (async () => {
    const response = await fetch(
      navigation
        ? new Request(new URL("/index.html", self.location.origin), { cache: "no-cache" })
        : request,
    );
    if (response.ok && response.type !== "opaque" && !response.redirected) {
      const sameGeneration =
        key !== "/index.html" ||
        (await response.clone().text()).includes(`name="boards-shell" content="${VERSION}"`);
      if (sameGeneration) await (await caches.open(CACHE)).put(key, response.clone());
    }
    return response;
  })();
  event.waitUntil(update.then(() => undefined).catch(() => undefined));
  event.respondWith(
    (async () => {
      const hit = await (await caches.open(CACHE)).match(key);
      if (hit) return hit;
      try {
        return await update;
      } catch {
        return new Response("Offline. Reconnect to open your cloud notebook.", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        });
      }
    })(),
  );
});
