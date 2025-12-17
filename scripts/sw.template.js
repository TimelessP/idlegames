const APP_VERSION = '__APP_VERSION__';
const CACHE_NAME = `IdleGames-v${APP_VERSION}`;
const PRECACHE_URLS = __PRECACHE_LIST__;
const TIMER_ICON_PATH = 'assets/appicons/idle-games-512x512px.png';

const timerData = new Map();
const timerTimeouts = new Map();

function clearTimerSchedule(id) {
  const timeoutId = timerTimeouts.get(id);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  timerTimeouts.delete(id);
  timerData.delete(id);
}

function scheduleTimer(timer) {
  clearTimerSchedule(timer.id);
  timerData.set(timer.id, timer);
  const delay = Math.max(0, timer.endTime - Date.now());
  const timeoutId = setTimeout(() => fireTimer(timer.id), delay);
  timerTimeouts.set(timer.id, timeoutId);
}

function handleTimerSync(timers = []) {
  const incomingIds = new Set();
  timers.forEach((raw) => {
    if (!raw || typeof raw.id === 'undefined' || typeof raw.endTime === 'undefined') return;
    const id = String(raw.id);
    const normalized = {
      id,
      name: raw.name || 'Timer',
      endTime: Number(raw.endTime),
      startUrl: raw.startUrl || './timers.html',
      notify: raw.notify !== false
    };
    if (Number.isNaN(normalized.endTime)) return;
    incomingIds.add(id);
    scheduleTimer(normalized);
  });

  Array.from(timerData.keys()).forEach((id) => {
    if (!incomingIds.has(id)) {
      clearTimerSchedule(id);
    }
  });
}

function handleTimerCancel(id) {
  if (typeof id === 'undefined') return;
  clearTimerSchedule(String(id));
}

async function fireTimer(id) {
  const timer = timerData.get(id);
  if (!timer) {
    clearTimerSchedule(id);
    return;
  }
  clearTimerSchedule(id);
  await notifyTimerCompletion(timer);
}

async function notifyTimerCompletion(timer) {
  if (timer.notify !== false) {
    try {
      await self.registration.showNotification('Timer Complete!', {
        body: `${timer.name || 'Timer'} has finished`,
        icon: TIMER_ICON_PATH,
        tag: `timer-${timer.id}`,
        renotify: true,
        data: { url: timer.startUrl || './timers.html', timerId: timer.id }
      });
    } catch (error) {
      // Notification permission might be missing; ignore.
    }
  }

  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'timer-finished', timerId: timer.id });
    }
  } catch (error) {
    // No clients available to notify.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Enable navigation preload if supported - this fixes cold-start blank screen
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    
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

  // Normalize directory URLs to index.html (e.g., /idlegames/ -> /idlegames/index.html)
  let normalizedRequest = event.request;
  if (requestURL.pathname.endsWith('/')) {
    const indexUrl = new URL(requestURL.href);
    indexUrl.pathname = requestURL.pathname + 'index.html';
    normalizedRequest = new Request(indexUrl.href, {
      method: event.request.method,
      headers: event.request.headers,
      // The Request constructor rejects `mode: 'navigate'`. Normalize to 'same-origin'
      // when dealing with navigations so we can construct a valid Request.
      mode: event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
      credentials: event.request.credentials,
      redirect: event.request.redirect
    });
  }

  const handleRequest = async (isNavigation, preloadResponse, request) => {
    const cache = await caches.open(CACHE_NAME);
    
    // For navigation requests, use preload response if available (fixes cold-start)
    if (isNavigation) {
      // Try navigation preload first (already started in parallel)
      if (preloadResponse) {
        try {
          const response = await preloadResponse;
          if (response && response.ok) {
            cache.put(request, response.clone());
            return response;
          }
        } catch (e) {
          // Preload failed, fall through to cache
        }
      }
      
      const cached = await cache.match(request, { ignoreSearch: true });
      
      // Race network against a timeout - show cached content quickly if network is slow
      const networkPromise = fetch(request, { cache: 'no-store' })
        .then(async (response) => {
          if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);
      
      // If we have cache, race with short timeout; otherwise wait for network
      if (cached) {
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
        const networkResult = await Promise.race([networkPromise, timeoutPromise]);
        // Return network if it won and succeeded, otherwise return cache
        return networkResult && networkResult.ok ? networkResult : cached;
      }
      
      // No cache - must wait for network or fail
      const networkResult = await networkPromise;
      if (networkResult) return networkResult;
      
      // Last resort: try index.html from cache
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
      
      throw new Error('No cached content available');
    }
    
    // Non-navigation: network first with cache fallback
    try {
      const networkResponse = await fetch(request, { cache: 'no-store' });
      if (networkResponse && networkResponse.ok && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch (error) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      throw error;
    }
  };

  const isNavigation = event.request.mode === 'navigate';
  event.respondWith(handleRequest(isNavigation, isNavigation ? event.preloadResponse : null, normalizedRequest));
});

self.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;
  const { type } = event.data;
  if (type === 'idle-games-skip-waiting') {
    self.skipWaiting();
    return;
  }
  if (type === 'timer-sync') {
    handleTimerSync(event.data.timers || []);
    return;
  }
  if (type === 'timer-cancel') {
    handleTimerCancel(event.data.timerId);
  }
});

self.addEventListener('notificationclick', (event) => {
  const targetUrl = event.notification?.data?.url;
  event.notification?.close();
  if (!targetUrl) return;
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if (client.url === targetUrl && 'focus' in client) {
        await client.focus();
        client.postMessage({ type: 'timer-notification-clicked', timerId: event.notification?.data?.timerId });
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
