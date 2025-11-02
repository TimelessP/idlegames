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

  if (requestURL.pathname === '/sw.js' || requestURL.pathname === '/sw.js/') return;

  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;

  const handleNetworkFirst = async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const networkResponse = await fetch(event.request, { cache: 'no-store' });
      if (networkResponse && networkResponse.ok && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
        await cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  };

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNetworkFirst());
    return;
  }

  event.respondWith(handleNetworkFirst());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'idle-games-skip-waiting') {
    self.skipWaiting();
  }
});
