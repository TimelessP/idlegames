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
  const shouldReload = window.confirm(`IdleGames has been updated to ${versionLabel}. Reload now to use the newest build?`);
  if (shouldReload) {
    promptedVersions.add(version);
    worker.postMessage({ type: 'idle-games-skip-waiting' });
  } else {
    // Remember that we've already asked this session to avoid immediate repeat prompts.
    promptedVersions.add(version);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const { APP_VERSION: moduleVersion } = await versionModulePromise;
      const resolvedVersion = moduleVersion || appVersionMeta?.content || storedSwVersion || 'dev';
      const baseSwUrl = new URL(SW_PATH, window.location.href);
      const versionedSwUrl = new URL(baseSwUrl.toString());
      versionedSwUrl.searchParams.set('version', resolvedVersion);

      async function attemptRegistration(url, { logLabel }) {
        try {
          const registration = await navigator.serviceWorker.register(url.toString(), {
            scope: './',
            updateViaCache: 'none'
          });
          return registration;
        } catch (error) {
          console.warn(`Service worker registration failed for ${logLabel}:`, error);
          return null;
        }
      }

      const candidates = [
        { url: versionedSwUrl, logLabel: `${versionedSwUrl.toString()} (versioned)` },
        { url: baseSwUrl, logLabel: `${baseSwUrl.toString()} (plain)` }
      ];

      let registration = null;
      for (const candidate of candidates) {
        let exists = false;
        try {
          const response = await fetch(candidate.url.toString(), { method: 'HEAD', cache: 'no-store' });
          exists = response.ok;
          if (!exists && response.status !== 404) {
            console.warn(`Service worker preflight returned ${response.status} for ${candidate.logLabel}`);
          }
        } catch (error) {
          console.warn(`Service worker preflight failed for ${candidate.logLabel}:`, error);
        }

        if (!exists) {
          console.warn(`Service worker script not found at ${candidate.logLabel}.`);
          continue;
        }

        registration = await attemptRegistration(candidate.url, { logLabel: candidate.logLabel });
        if (registration) {
          if (candidate.url === baseSwUrl) {
            console.warn('Service worker registered without cache-busting query parameter. Verify that sw.js is published for versioned URLs.');
          }
          break;
        }
      }

      if (!registration) {
        console.warn('Service worker script is unavailable. Offline caching will remain disabled until sw.js is deployed for this version.');
        return;
      }

      console.info(`IdleGames ${resolvedVersion} ready. Service worker scope:`, registration.scope);

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
        }
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    } catch (error) {
      console.error('Service worker registration failed:', error);
    }
  });
} else {
  console.info('Service workers are not supported in this browser.');
}
