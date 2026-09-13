/* Only public shell assets. Never cache private API data, edit keys, profiles or shares. */
const VERSION = __VERSION__, ASSETS = __ASSETS__, CACHE = 'boards-public-' + VERSION;
const allowed = new Set(ASSETS);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('boards-public-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('message', event => { if(event.data?.type === 'ACTIVATE_SAVED_UPDATE') void self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if(request.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname) && !url.search;
  const key = navigation ? '/index.html' : url.pathname;
  if(!allowed.has(key) || (!navigation && url.search)) return;
  const fresh = (async () => {
    const response = await fetch(navigation ? new Request(new URL('/index.html',url),{cache:'no-cache'}) : request);
    if(response.ok && !response.redirected && response.type !== 'opaque') {
      const coherent = key !== '/index.html' || (await response.clone().text()).includes(`name="boards-build" content="${VERSION}"`);
      if(coherent) await (await caches.open(CACHE)).put(key,response.clone());
    } return response;
  })();
  event.waitUntil(fresh.then(()=>{}).catch(()=>{}));
  event.respondWith((async()=>{
    const hit = await (await caches.open(CACHE)).match(key); if(hit) return hit;
    try { return await fresh; } catch { return new Response('Offline — reconnect to open this page.', {status:503,headers:{'Content-Type':'text/plain'}}); }
  })());
});
