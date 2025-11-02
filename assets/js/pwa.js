const versionModulePromise = import(`./version.js?cache-bust=${Date.now().toString(36)}`);

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

function promptReload(worker) {
  if (!worker) return;
  const shouldReload = window.confirm('IdleGames has been updated. Reload now to use the latest version?');
  if (shouldReload) {
    worker.postMessage({ type: 'idle-games-skip-waiting' });
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
            promptReload(worker);
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
        promptReload(registration.waiting);
      }

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (!event.data) return;
        if (event.data.type === 'idle-games-sw-version') {
          const incoming = event.data.appVersion || 'unknown';
          const stored = localStorage.getItem('idle-games-sw-version');
          if (stored && stored !== incoming && registration.waiting) {
            promptReload(registration.waiting);
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
