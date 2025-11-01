const APP_VERSION = '__APP_VERSION__';
const CACHE_NAME = `IdleGames-v${APP_VERSION}`;
const PRECACHE_URLS = __PRECACHE_LIST__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'idle-games-sw-version', appVersion: APP_VERSION });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestURL = new URL(event.request.url);
  if (requestURL.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response && response.ok && response.type === 'basic') {
        cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
      throw error;
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'idle-games-skip-waiting') {
    self.skipWaiting();
  }
});
