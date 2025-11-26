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
