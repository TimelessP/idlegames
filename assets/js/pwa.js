const versionModulePromise = import(`./version.js?cache-bust=${Date.now().toString(36)}`);

const promptedVersions = new Set();

function extractWorkerVersion(worker, fallback) {
  if (!worker) return fallback ?? null;
  try {
    const url = new URL(worker.scriptURL, window.location.origin);
    const versionParam = url.searchParams.get('v');
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
      const swPath = `sw.js?v=${encodeURIComponent(resolvedVersion)}`;

      const registration = await navigator.serviceWorker.register(swPath, {
        scope: './',
        updateViaCache: 'none'
      });
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
