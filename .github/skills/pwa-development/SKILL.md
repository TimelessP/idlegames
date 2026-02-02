---
name: pwa-development
description: Build and optimize Progressive Web Apps (PWAs) with service workers, offline support, and manifest configurations. Use when creating PWAs, implementing offline functionality, or working with service workers.
---

# Progressive Web App (PWA) Development

Progressive Web Apps combine the best of web and mobile apps. **IdleGames' primary PWA requirement is enabling the app to run completely offline**—games and features work without any internet connection.

This skill provides guidance for building robust offline-capable PWAs with service workers, precaching strategies, and manifest configuration—based on IdleGames' production PWA implementation.

## Core PWA Components

### Offline-First as a Primary Requirement

IdleGames is designed to work **completely offline**. Users can:
- Launch the app with no internet connection
- Play all games without connecting to the network
- Save progress locally (localStorage/IndexedDB)
- Get notifications from service worker even when offline
- Have a full app experience without ever connecting

This drives all architectural decisions:
- **Precaching**: All HTML/CSS/JS must be cached before first use
- **No external dependencies**: All third-party libraries (Three.js, Transformers.js) are vendored
- **Local storage**: Game saves stored in localStorage, not sent to server
- **Service worker durability**: SW must handle full offline scenarios indefinitely

The service worker is the critical component—if it fails, the entire offline experience breaks. This is why IdleGames invests heavily in:
- Robust SW registration with retries
- URL normalization to prevent blank screens
- Navigation preload for fast cold starts
- Cache versioning to handle updates safely

### 1. Web App Manifest
Create a `manifest.webmanifest` file with proper icons and display settings:

```json
{
  "name": "IdleGames",
  "short_name": "IdleGames",
  "id": "/idlegames",
  "description": "A curated collection of relaxing idle and puzzle games, plus useful web tools.",
  "start_url": "./index.html",
  "scope": "./",
  "handle_links": "preferred",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#667eea",
  "icons": [
    {
      "src": "assets/appicons/idle-games-512x512px.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "assets/appicons/idle-games-512x512px.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

**Key properties:**
- `id`: Unique identifier, must start with `/`
- `handle_links: "preferred"`: Allows opening links within scope in the app
- `purpose: "maskable"`: Supports adaptive icon displays on different platforms
- Use real image paths (not relative to web root)

### 2. Service Worker Registration with Retry Logic

IdleGames uses a robust registration with cache-busting and retry logic:

```javascript
// assets/js/pwa.js - Production PWA Registration
const versionModulePromise = import(`./version.js?cache-bust=${Date.now().toString(36)}`);
const SW_PATH = './sw.js';
const MAX_SW_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 15000;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const { APP_VERSION: moduleVersion } = await versionModulePromise;
      
      // Build versioned SW URL with cache-busting parameter
      const baseSwUrl = new URL(SW_PATH, window.location.href);
      const versionedSwUrl = new URL(baseSwUrl.toString());
      versionedSwUrl.searchParams.set('version', moduleVersion);

      // Try registration with exponential backoff retry
      const ensureServiceWorkerRegistration = async (attempt = 0) => {
        try {
          // Check if SW script exists before registering
          const response = await fetch(versionedSwUrl.toString(), { 
            method: 'HEAD', 
            cache: 'no-store' 
          });
          
          if (!response.ok) throw new Error(`SW fetch returned ${response.status}`);

          const registration = await navigator.serviceWorker.register(
            versionedSwUrl.toString(),
            {
              scope: './',
              updateViaCache: 'none'  // Always fetch fresh SW
            }
          );

          console.info(`IdleGames ${moduleVersion} ready. Service worker scope:`, registration.scope);
          return registration;
          
        } catch (error) {
          if (attempt >= MAX_SW_RETRIES) {
            console.error('Service worker registration failed after retries:', error);
            return null;
          }
          
          const delay = Math.min(120000, BASE_RETRY_DELAY_MS * (attempt + 1));
          console.info(`SW registration retry ${attempt + 1}/${MAX_SW_RETRIES} in ${Math.round(delay / 1000)}s`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return ensureServiceWorkerRegistration(attempt + 1);
        }
      };

      const registration = await ensureServiceWorkerRegistration();
      if (!registration) return;

      // Handle SW updates
      const trackInstalling = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            // New SW installed, trigger update
            worker.postMessage({ type: 'idle-games-skip-waiting' });
          }
        });
      };

      if (registration.installing) trackInstalling(registration.installing);
      registration.addEventListener('updatefound', () => {
        trackInstalling(registration.installing);
      });

      // Listen for version updates from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'idle-games-sw-version') {
          const incoming = event.data.appVersion;
          localStorage.setItem('idle-games-sw-version', incoming);
          showUpdateNotification('Idle Games updated');
        }
      });

      // Reload when new SW takes control
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });

    } catch (error) {
      console.error('Service worker setup failed:', error);
    }
  });
}
```

**Key patterns:**
- **Cache-busting query params**: Version URLs to force fresh fetches
- **Retry with exponential backoff**: Handle deployment timing issues
- **updateViaCache: 'none'**: Never serve stale SW files
- **HEAD fetch check**: Verify SW exists before registration
- **Auto-reload**: Reload page when new SW activates

### 3. Service Worker Caching Strategy

IdleGames uses a sophisticated hybrid approach:

```javascript
// scripts/sw.template.js - Production Service Worker
const APP_VERSION = '__APP_VERSION__';
const CACHE_NAME = `IdleGames-v${APP_VERSION}`;
const PRECACHE_URLS = __PRECACHE_LIST__;

// Install: Precache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => 
      cache.addAll(PRECACHE_URLS)
    )
  );
  self.skipWaiting(); // Activate immediately
});

// Activate: Clean old caches and enable navigation preload
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Enable navigation preload for faster cold starts
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    
    // Delete old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    
    await self.clients.claim();
    
    // Notify all clients of new version
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => {
      client.postMessage({ type: 'idle-games-sw-version', appVersion: APP_VERSION });
    });
  })());
});

// Fetch: Navigation vs. Asset strategy
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestURL = new URL(event.request.url);
  
  // Skip own service worker
  if (requestURL.pathname === '/sw.js' || requestURL.pathname === '/sw.js/') return;
  
  // Same-origin only
  if (requestURL.origin !== self.location.origin) return;

  // **CRITICAL: Normalize directory URLs to index.html**
  let normalizedRequest = event.request;
  if (requestURL.pathname.endsWith('/')) {
    const indexUrl = new URL(requestURL.href);
    indexUrl.pathname = requestURL.pathname + 'index.html';
    normalizedRequest = new Request(indexUrl.href, {
      method: event.request.method,
      headers: event.request.headers,
      mode: event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
      credentials: event.request.credentials,
      redirect: event.request.redirect
    });
  }

  const isNavigation = event.request.mode === 'navigate';
  
  // Navigation: Cache-first with network race
  if (isNavigation) {
    event.respondWith(handleNavigation(isNavigation, event.preloadResponse, normalizedRequest));
  } else {
    // Assets: Network-first with cache fallback
    event.respondWith(handleAsset(normalizedRequest));
  }
});

async function handleNavigation(isNav, preloadResponse, request) {
  const cache = await caches.open(CACHE_NAME);
  
  // Try preload response first (already requested in parallel)
  if (preloadResponse) {
    try {
      const response = await preloadResponse;
      if (response?.ok) {
        cache.put(request, response.clone());
        return response;
      }
    } catch (e) {
      // Preload failed, continue to cache
    }
  }

  const cached = await cache.match(request, { ignoreSearch: true });
  
  // Race network against 2s timeout
  const networkPromise = fetch(request, { cache: 'no-store' })
    .then(async (response) => {
      if (response?.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Return cached if network is slow, else wait for network
    const timeoutPromise = new Promise((resolve) => 
      setTimeout(() => resolve(null), 2000)
    );
    const networkResult = await Promise.race([networkPromise, timeoutPromise]);
    return networkResult?.ok ? networkResult : cached;
  }

  // No cache: must wait for network
  const networkResult = await networkPromise;
  if (networkResult) return networkResult;

  // Last resort: index.html fallback
  const fallback = await cache.match('./index.html');
  if (fallback) return fallback;

  throw new Error('No cached content available');
}

async function handleAsset(request) {
  try {
    const networkResponse = await fetch(request, { cache: 'no-store' });
    if (networkResponse?.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}
```

**Strategy breakdown:**
- **Navigation requests**: Use preload response (parallel fetch) + cache race (2s timeout)
  - Prioritizes cached version for instant load (offline-first)
  - Tries network in parallel but doesn't wait if cache exists
  - Falls back to index.html if all else fails
- **Asset requests**: Network-first with cache fallback
  - Updates assets when online
  - Uses cache immediately when offline
- **Directory normalization**: `/idlegames/` → `/idlegames/index.html` (prevents blank screens)
- **Navigation preload**: Enabled for faster cold starts
- **Precache busting**: Version in cache name forces full refresh on updates

**Critical for offline scenarios:**
- Navigation race timeout (2s) ensures offline users see cached content immediately
- Fallback to index.html prevents blank screens when network fails
- Assets cache gracefully if network unavailable
- The app remains fully functional with zero network connectivity

### 4. URL Normalization (CRITICAL for Offline)

This is the most important PWA feature—it prevents blank screens for offline users who bookmarked the directory URL:

```javascript
// In service worker fetch handler
const requestURL = new URL(event.request.url);

// Normalize /idlegames/ to /idlegames/index.html
if (requestURL.pathname.endsWith('/')) {
  const indexUrl = new URL(requestURL.href);
  indexUrl.pathname = requestURL.pathname + 'index.html';
  normalizedRequest = new Request(indexUrl.href, {
    method: event.request.method,
    headers: event.request.headers,
    // Navigate requests need mode: 'same-origin' for Request constructor
    mode: event.request.mode === 'navigate' ? 'same-origin' : event.request.mode,
    credentials: event.request.credentials,
    redirect: event.request.redirect
  });
}
```

**Why this matters in offline scenarios:**
- Users bookmark/share: `https://example.com/app/` (with trailing slash)
- Manifest specifies `start_url: "./index.html"`
- When launching offline, device may request the bookmarked directory URL
- If SW can't find it in cache, user sees blank screen while offline
- **The SW can't reload to fix this**—it completely controls responses
- Without normalization, offline users are stranded with broken app

**Real-world example:**
- Day 1: User visits with internet, app caches successfully
- Day 2: User goes to subway (no wifi), taps app icon on home screen
- Device requests `/idlegames/` (the bookmarked URL)
- If SW doesn't normalize, it looks for `/idlegames/` in cache (not found)
- Result: Blank screen, user can't play games

**Testing:**
```bash
# Test with trailing slash (the dangerous case)
http://localhost:4173/              # Must work offline
http://localhost:4173/index.html    # Must also work offline
```

### 5. Manifest Icons Setup

Properly sized and formatted icons for all platforms:

```json
{
  "icons": [
    {
      "src": "assets/appicons/idle-games-512x512px.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"  // Supports adaptive icons
    },
    {
      "src": "assets/appicons/idle-games-512x512px.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

**Icon requirements:**
- **512x512**: Primary icon for splash screens and app stores
- **192x192**: Home screen icon (Android)
- **`purpose: maskable`**: Allows OS to apply adaptive icon masks
- Use PNG format for transparency support
- Test on actual devices (simulator may not match)

**HTML meta tag for iOS:**
```html
<link rel="apple-touch-icon" href="assets/appicons/idle-games-180x180.png">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#667eea">
```

## Best Practices

### 1. Versioning and Cache Busting

**Generate version from package.json:**
```javascript
// scripts/build-sw.mjs
const packageJson = JSON.parse(await fs.readFile('./package.json', 'utf8'));
const appVersion = packageJson.version;

// Generate version module
const versionModule = `export const APP_VERSION = '${appVersion}';`;
await fs.writeFile('assets/js/version.js', versionModule);

// Replace in SW template
const swContent = swTemplate
  .replaceAll('__APP_VERSION__', appVersion)
  .replace('__PRECACHE_LIST__', JSON.stringify(precacheList));

await fs.writeFile('dist/sw.js', swContent);
```

**Use version in cache name and URLs:**
```javascript
const CACHE_NAME = `IdleGames-v${APP_VERSION}`;  // Old caches auto-deleted

// Version query param for cache busting
const versionedSwUrl = new URL('./sw.js');
versionedSwUrl.searchParams.set('version', resolvedVersion);
```

### 2. Precaching Strategy for Offline-First

**Offline-first requirement changes precaching approach:**

For an app that must work completely offline, precaching is not optional—it's fundamental. IdleGames precaches all code and assets needed for the full experience:

```javascript
const PRECACHE_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.json', '.webmanifest',
  '.png', '.svg', '.ico', '.woff2'
  // All essential static assets
]);

async function collectPrecache(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await collectPrecache(path.join(dir, entry.name));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (PRECACHE_EXTENSIONS.has(ext)) {
        precacheList.push(entry.name);
      }
    }
  }
}
```

**What must be precached for offline:**
- ✅ All HTML pages (index.html, game pages, etc.)
- ✅ All JavaScript (game code, vendor libs like Three.js)
- ✅ All CSS stylesheets
- ✅ All images, SVGs, icons
- ✅ Fonts (critical for display)
- ✅ Manifest and metadata

**What you can skip precaching:**
- ❌ Large video/audio files (users download on demand)
- ❌ User-specific data (fetch on startup if online)
- ❌ Dynamic content (rare for offline apps)
- ❌ External resources (by definition, not available offline)

**Size considerations:**
- IdleGames' precache is intentionally comprehensive
- Precache size is a one-time install cost
- Users accept larger initial downloads for offline reliability
- The benefit (works anywhere, anytime) justifies the size

### 3. Navigation Preload for Cold Starts

Navigation preload allows the browser to fetch the next page while the SW is starting:

```javascript
// In SW activate
if (self.registration.navigationPreload) {
  await self.registration.navigationPreload.enable();
}

// In SW fetch
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      // Use preloaded response (already fetching in parallel)
      event.preloadResponse
        .then(response => response || fetchWithFallback(event.request))
        .catch(() => fetchWithFallback(event.request))
    );
  }
});
```

### 4. Handling Slow Networks

Use a race between network and cache with timeout:

```javascript
// Return cached immediately if network is slow
const cached = await cache.match(request);
const networkPromise = fetch(request, { cache: 'no-store' });
const timeoutPromise = new Promise(resolve => 
  setTimeout(() => resolve(null), 2000)  // 2s timeout
);

if (cached) {
  const networkResult = await Promise.race([networkPromise, timeoutPromise]);
  return networkResult?.ok ? networkResult : cached;
}
```

### 5. Update Notifications

Show subtle notification when app updates:

```javascript
// Show 5-second transient notification
function showTransientNotification(message, duration = 5000) {
  const el = document.createElement('div');
  el.textContent = message;
  el.style.position = 'fixed';
  el.style.bottom = '20px';
  el.style.background = 'rgba(0,0,0,0.85)';
  el.style.color = '#fff';
  el.style.padding = '10px 16px';
  el.style.borderRadius = '8px';
  el.style.zIndex = '100000';
  
  document.body.appendChild(el);
  
  setTimeout(() => {
    el.style.transition = 'opacity 300ms ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 350);
  }, duration);
}

// Show when version changes
const swVer = localStorage.getItem('idle-games-sw-version');
const lastNotified = localStorage.getItem('idle-games-last-notified-version');
if (swVer && swVer !== lastNotified) {
  showTransientNotification('App updated');
  localStorage.setItem('idle-games-last-notified-version', swVer);
}
```

## Testing Checklist

**Critical: Offline Testing is Non-Optional**

Every deployment must verify offline functionality works completely:

**Local Testing:**
```bash
npm run build    # Build to dist/
npm run serve    # Start server on http://localhost:4173
```

**Chrome DevTools (offline mode):**
1. Open DevTools → **Network** tab
2. Check **Offline** checkbox (top-left corner)
3. Reload page—should load fully from cache
4. All game features should work without network
5. Uncheck Offline—should reconnect seamlessly

**Chrome DevTools Inspection:**
1. **Application tab** → Service Workers: Verify registration
2. **Application tab** → Cache Storage: Inspect `IdleGames-vX.X.X` cache
3. **Network tab**: Set throttling (slow 3G) to test race conditions
4. Verify precache list includes all game files

**Real Device Testing (Essential):**
```
✓ Install app on home screen (varies by OS)
✓ Close browser completely (kill background process)
✓ Reopen PWA from home screen icon
✓ Works offline (airplane mode or disable wifi)
✓ Directory URL loads: https://example.com/idlegames/
✓ All games playable offline
✓ Game saves persist offline
✓ Multiple game sessions work offline
✓ URL normalization works (/idlegames/ = /idlegames/index.html)
```
✓ Handles slow networks gracefully
✓ Update notification appears
✓ New version auto-activates after reload
```

**Mobile-Specific:**
- iOS: Safari → Share → Add to Home Screen
- Android Chrome: Menu → Install app
- Test on low-memory devices (older phones)

## Debugging Service Worker Issues

**Offline-First Debugging Approach:**

For an offline-first app, the SW is the entire system. If it fails, users have zero access to the app. Debug strategically:

**Critical problems (offline breaks):**

1. **Blank screen when offline**
   - Users can't access app at all when internet is unavailable
   - Check URL normalization is working (trailing slash handling)
   - Verify precache list includes `./index.html` and all game HTML files
   - Check SW has correct PRECACHE_LIST injected
   - Test: Enable offline mode in DevTools → page should load instantly

2. **Missing game files offline**
   - Some games work, others show errors when offline
   - Check precache includes all `.js` and `.html` for that game
   - Verify vendor libraries (Three.js, Transformers.js) are in cache
   - Inspect: DevTools → Application → Cache Storage → check what's cached

3. **Old version still showing**
   - Users get outdated game after update
   - Clear browser cache and localStorage
   - Verify SW is registered with new version
   - Check CACHE_NAME includes version number
   - Ensure version.js was regenerated at build time

4. **Can't play offline but online works**
   - This indicates precache is broken or incomplete
   - Verify all assets in precache list are actually in dist/
   - Check precache extensions list includes needed file types
   - Enable offline mode → should still load instantly

3. **Network request not caching**
   - SW might not intercept third-party requests
   - Check origin matches (CORS issues)
   - Verify response.ok check (4xx/5xx responses skipped)

4. **Slow cold starts**
   - Enable navigation preload
   - Check precache list size
   - Profile with DevTools Performance tab

**Debug console logs:**
```javascript
// In SW
console.info(`IdleGames ${APP_VERSION} ready`);
console.info(`Caching ${PRECACHE_URLS.length} files`);

// In app
console.info(`Service worker registration successful`);
console.info(`App version: ${APP_VERSION}`);
```

## Production Rollout

**Offline-First Deployment Checklist:**

Before deploying any version, offline functionality must be verified:

1. Update version in `package.json`
2. Run `npm run build` (regenerates version.js and precache list)
3. **Enable offline mode in DevTools** → Test all games work
4. Test with slow 3G throttling → Should still load from cache
5. Test directory URL offline: `http://localhost:4173/` (not index.html)
6. Verify all game saves persist across sessions offline
7. Commit and push to main branch
8. GitHub Actions deployment
9. **On production: Enable offline mode again** → Verify one more time

**Critical offline verification before deployment:**
```
✓ App loads completely offline
✓ All games are playable offline  
✓ Game saves work offline
✓ Directory URLs work offline (/idlegames/)
✓ Precache includes all HTML, JS, CSS, assets
✓ No "Resource not found" errors in offline mode
✓ Performance acceptable on slow networks
```

**Rollback if needed:**
If offline breaks after deployment:
1. Users are stranded—cannot access app without internet
2. Immediately revert commit with broken version
3. Fix issue locally
4. Bump package.json version again
5. Redeploy emergency fix

**Why this is critical:**
- Users may rely on offline functionality (commuting, areas without coverage)
- Broken SW prevents even online access until fixed
- Once deployed, users get broken version automatically via SW
- Testing is the only defense—you cannot hotpatch deployed SWs
