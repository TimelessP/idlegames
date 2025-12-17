const versionModulePromise = import(`./version.js?cache-bust=${Date.now().toString(36)}`);
const SW_PATH = './sw.js';

const promptedVersions = new Set();

function extractWorkerVersion(worker, fallback) {
  if (!worker) return fallback ?? null;
  try {
    const url = new URL(worker.scriptURL, window.location.origin);
    const versionParam = url.searchParams.get('version') || url.searchParams.get('v');
    if (versionParam) {
      return versionParam;
    }
  } catch (error) {
    console.warn('Unable to parse service worker version from script URL', error);
  }
  return fallback ?? null;
}

const appVersionMeta = document.querySelector('meta[name="app-version"]');
const storedSwVersion = (() => {
  try {
    return localStorage.getItem('idle-games-sw-version');
  } catch (error) {
    console.warn('Unable to read stored SW version', error);
    return null;
  }
})();
let refreshing = false;

function promptReload(worker, versionHint) {
  if (!worker) return;
  const version = extractWorkerVersion(worker, versionHint) ?? 'latest';
  if (promptedVersions.has(version)) {
    return;
  }
  const versionLabel = version === 'latest' ? 'the latest version' : `v${version}`;
  // Auto-apply updates without asking: the app always prefers the newest build.
  // Keep a session-level dedupe so we don't repeatedly re-activate the same version.
  promptedVersions.add(version);
  console.info(`IdleGames: activating updated service worker ${versionLabel} without prompting.`);
  worker.postMessage({ type: 'idle-games-skip-waiting' });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const { APP_VERSION: moduleVersion } = await versionModulePromise;
      const resolvedVersion = moduleVersion || appVersionMeta?.content || storedSwVersion || 'dev';
      const baseSwUrl = new URL(SW_PATH, window.location.href);

  const MAX_SW_RETRIES = 10;
  const BASE_RETRY_DELAY_MS = 15000;

      const ensureServiceWorkerRegistration = async (attempt = 0) => {
        const versionedSwUrl = new URL(baseSwUrl.toString());
        versionedSwUrl.searchParams.set('version', resolvedVersion);

        let storedVersionUrl = null;
        if (storedSwVersion && storedSwVersion !== resolvedVersion) {
          storedVersionUrl = new URL(baseSwUrl.toString());
          storedVersionUrl.searchParams.set('version', storedSwVersion);
        }

        const candidates = [
          { url: versionedSwUrl, logLabel: `${versionedSwUrl.toString()} (versioned)` }
        ];

        if (storedVersionUrl) {
          candidates.push({ url: storedVersionUrl, logLabel: `${storedVersionUrl.toString()} (previous version)` });
        }

        candidates.push({ url: baseSwUrl, logLabel: `${baseSwUrl.toString()} (plain)` });

        async function attemptRegistration(url, { logLabel }) {
          try {
            const registration = await navigator.serviceWorker.register(url.toString(), {
              scope: './',
              updateViaCache: 'none'
            });
            return registration;
          } catch (error) {
            console.info(`Service worker registration failed for ${logLabel}:`, error);
            return null;
          }
        }

        let registration = null;
        for (const candidate of candidates) {
          let exists = false;
          try {
            const response = await fetch(candidate.url.toString(), { method: 'HEAD', cache: 'no-store' });
            exists = response.ok;
            if (!exists && response.status !== 404) {
              console.info(`Service worker preflight returned ${response.status} for ${candidate.logLabel}`);
            }
          } catch (error) {
            console.info(`Service worker preflight failed for ${candidate.logLabel}:`, error);
          }

          if (!exists) {
            console.info(`Service worker script not found at ${candidate.logLabel}.`);
            continue;
          }

          registration = await attemptRegistration(candidate.url, { logLabel: candidate.logLabel });
          if (registration) {
            if (storedVersionUrl && candidate.url.toString() === storedVersionUrl.toString()) {
              console.info(`Continuing with previously deployed service worker version (${storedSwVersion}) until ${resolvedVersion} is live.`);
            } else if (candidate.url.toString() === baseSwUrl.toString()) {
              console.info('Service worker registered without cache-busting query parameter. Verify that sw.js is published for versioned URLs.');
            }
            break;
          }
        }

        if (!registration) {
          if (attempt >= MAX_SW_RETRIES) {
            console.info('Service worker script still unavailable after multiple attempts. Offline caching will stay disabled until the new sw.js deploys.');
            return null;
          }
          const delay = Math.min(120000, BASE_RETRY_DELAY_MS * (attempt + 1));
          console.info(`Service worker script not available yet (attempt ${attempt + 1}/${MAX_SW_RETRIES}). Retrying in ${Math.round(delay / 1000)}s.`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          return ensureServiceWorkerRegistration(attempt + 1);
        }

        return registration;
      };

      const registration = await ensureServiceWorkerRegistration();
      if (!registration) {
        return;
      }

      console.info(`IdleGames ${resolvedVersion} ready. Service worker scope:`, registration.scope);

      // Transient update notification: show a small non-blocking banner for 5s
      function showTransientNotification(message, duration = 5000) {
        try {
          const id = 'idle-games-update-notif';
          // Avoid duplicating
          if (document.getElementById(id)) return;
          const el = document.createElement('div');
          el.id = id;
          el.textContent = message;
          el.style.position = 'fixed';
          el.style.left = '50%';
          el.style.transform = 'translateX(-50%)';
          el.style.bottom = '20px';
          el.style.zIndex = 100000;
          el.style.background = 'rgba(0,0,0,0.85)';
          el.style.color = '#fff';
          el.style.padding = '10px 16px';
          el.style.borderRadius = '8px';
          el.style.boxShadow = '0 6px 24px rgba(0,0,0,0.4)';
          el.style.fontSize = '14px';
          el.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
          document.body.appendChild(el);
          setTimeout(() => {
            try { el.style.transition = 'opacity 300ms ease'; el.style.opacity = '0'; } catch (e) {}
            setTimeout(() => { try { el.remove(); } catch (e) {} }, 350);
          }, duration);
        } catch (e) {
          console.warn('Failed to show transient notification', e);
        }
      }
      // If the service worker has a stored version and we haven't shown the "updated" notice
      // for that version yet, show a short 5s notification once.
      try {
        const swVer = localStorage.getItem('idle-games-sw-version');
        const lastNotified = localStorage.getItem('idle-games-last-notified-version');
        if (swVer && swVer !== lastNotified) {
          showTransientNotification('Idle Games updated', 5000);
          localStorage.setItem('idle-games-last-notified-version', swVer);
        }
      } catch (e) {
        // ignore storage errors
      }
      const trackInstalling = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            promptReload(worker, resolvedVersion);
          }
        });
      };

      if (registration.installing) {
        trackInstalling(registration.installing);
      }

      registration.addEventListener('updatefound', () => {
        trackInstalling(registration.installing);
      });

      if (registration.waiting) {
        promptReload(registration.waiting, resolvedVersion);
      }

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (!event.data) return;
        if (event.data.type === 'idle-games-sw-version') {
          const incoming = event.data.appVersion || 'unknown';
          const stored = localStorage.getItem('idle-games-sw-version');
          if (stored && stored !== incoming && registration.waiting) {
            promptReload(registration.waiting, incoming);
          }
          localStorage.setItem('idle-games-sw-version', incoming);
          return;
        }
        if (event.data.type === 'timer-finished') {
          markTimerFinishedInStorage(event.data.timerId);
          return;
        }
        if (event.data.type === 'timer-notification-clicked') {
          // Reserved for future use.
        }
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      scheduleTimerSync(0);
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  });
} else {
  console.info('Service workers are not supported in this browser.');
}

// Ensure deep links supplied by OS/app launch open the intended URL instead of always showing start_url.
if ('launchQueue' in window && typeof window.launchQueue.setConsumer === 'function') {
  window.launchQueue.setConsumer((launchParams) => {
    const target = launchParams?.targetURL;
    if (target && target !== window.location.href) {
      window.location.href = target;
    }
  });
}

const TIMER_STORAGE_KEY = 'idlegames-timers';
const TIMER_SETTINGS_STORAGE_KEY = 'idlegames-timers-settings';
const TIMERS_FALLBACK_URL = new URL('./timers.html', window.location.origin).href;
let timerSyncTimeoutId = null;

function readJSONStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function timerNotifyEnabled(timer, globalSettingsSnapshot) {
  const pref = timer?.notifyPreference || 'inherit';
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return !!(globalSettingsSnapshot && globalSettingsSnapshot.notify);
}

function collectRunningTimersForSync() {
  const timers = readJSONStorage(TIMER_STORAGE_KEY, []);
  const settings = readJSONStorage(TIMER_SETTINGS_STORAGE_KEY, { notify: true });
  if (!Array.isArray(timers)) return [];
  return timers
    .filter((timer) => timer
      && timer.running
      && typeof timer.endTime === 'number'
      && timerNotifyEnabled(timer, settings))
    .map((timer) => ({
      id: timer.id,
      name: timer.name || 'Timer',
      endTime: timer.endTime,
      startUrl: timer.startUrl || TIMERS_FALLBACK_URL,
      notify: true
    }));
}

function markTimerFinishedInStorage(timerId) {
  if (!timerId) return;
  try {
    const timers = readJSONStorage(TIMER_STORAGE_KEY, null);
    if (!Array.isArray(timers)) return;
    let updated = false;
    for (const timer of timers) {
      if (timer && timer.id === timerId) {
        if (timer.running || !timer.finished || timer.remaining !== 0 || timer.endTime) {
          timer.running = false;
          timer.finished = true;
          timer.remaining = 0;
          timer.endTime = null;
          updated = true;
        }
        break;
      }
    }
    if (updated) {
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timers));
    }
  } catch (error) {
    console.warn('Unable to update timer state from service worker message', error);
  }
}

async function sendTimerSyncMessage() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const timersPayload = collectRunningTimersForSync();
    const registration = await navigator.serviceWorker.ready;
    const target = registration.active || navigator.serviceWorker.controller;
    target?.postMessage({ type: 'timer-sync', timers: timersPayload });
  } catch (error) {
    // Service worker not ready; will retry later.
  }
}

function scheduleTimerSync(delay = 0) {
  if (!('serviceWorker' in navigator)) return;
  if (timerSyncTimeoutId) {
    clearTimeout(timerSyncTimeoutId);
  }
  timerSyncTimeoutId = setTimeout(() => {
    timerSyncTimeoutId = null;
    sendTimerSyncMessage();
  }, delay);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('storage', (event) => {
    if (event.key === TIMER_STORAGE_KEY || event.key === TIMER_SETTINGS_STORAGE_KEY) {
      scheduleTimerSync(0);
    }
  });

  setInterval(() => {
    scheduleTimerSync(0);
  }, 60000);
}
