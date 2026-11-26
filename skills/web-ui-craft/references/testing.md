# Testing a web app with Playwright (headless Chromium)

## Serve everything through routes

No local server is needed, and none can time out. Route the page, the CDN libraries (a sandbox often blocks them; install the same version locally with `npm i leaflet@1.9.4`) and every API:

```js
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { localStorage.setItem('app_token', 'tok'); localStorage.setItem('app_prefs', JSON.stringify({ sound: false })); });
await ctx.route('**/*', async r => {
  const u = new URL(r.request().url()), m = r.request().method();
  if (u.hostname === 'unpkg.com') return r.fulfill({ body: u.pathname.endsWith('.css') ? LEAFLET_CSS : LEAFLET_JS, contentType: u.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' });
  if (u.hostname.endsWith('tile.openstreetmap.org')) return r.fulfill({ body: solidPng(256, 256, [225, 232, 220]), contentType: 'image/png' });
  if (u.hostname !== 'app.local') return r.abort();
  if (u.pathname === '/app.html') return r.fulfill({ body: HTML, contentType: 'text/html' });
  // ... API mocks, see below
});
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
```

- **Images:** generate PNGs in Node (zlib plus CRC chunks). Use a grid pattern for zoom tests, so magnification is visible in screenshots.
- **Calling app code:** top-level `const` modules are reachable from `page.evaluate(() => LIVE.poll())`, which beats waiting for timers.

## Mock the backend honestly, including its bad days

- **KV with real ETag semantics:** `GET` returns `{value}` plus an `ETag`; `PUT` checks `If-Match` and returns 412 on mismatch.
- **Forced conflict:** a `conflictOnce` flag mutates the stored record between the client's read and its write. That proves the merge path ran and kept both changes.
- **Slow PUT** (`putDelay`) to test typing during an in-flight save.
- **A dependency that never answers** (`return;` without fulfilling), one that's slow, and one that returns 500 or 429. A mock that always answers instantly hid a boot-order bug that stopped all syncing on real devices. Run the multi-user test once with each other endpoint hung.
- **Old client:** delete the new fields from the stored record and bump the ETag, then check that nothing is lost.
- **Moving data:** for live feeds, keep a `planes` array in the test, update positions between `page.evaluate(() => LIVE.poll())` calls, and assert the resulting events.

## Two users

Create two contexts that share one in-memory store. Type in A; wait about one poll interval; assert B's textarea and the stored value. Also check:

- **Concurrent edits:** B types at the start while A types at the end; both survive, and B's `selectionStart` hasn't moved.
- **Status line:** it names the desk and shows a ticking "checked for changes" time.

## Input semantics worth asserting

- **Act on release:** `keyboard.down('Enter')`, wait, assert nothing opened; `keyboard.up('Enter')`, assert it opened.
- **Back:** `page.goBack()` closes the top sheet only, and `page.url()` still shows the app.
- **Escape** closes the top layer.
- **Pinch** (Playwright has no multi-touch API): use CDP.

```js
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
for (let d = 30; d <= 120; d += 10) { await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await wait(16); }
await touch('touchEnd', []);
```

- **Easing:** read the state 40 ms after a programmatic zoom and assert it is between start and target. That shows it's eased, not snapped.

## Layout checks

- `document.documentElement.scrollWidth <= innerWidth` at 390×844, 844×390 and desktop.
- Screenshots at phone portrait, phone landscape and desktop, in light and dark. Open them and look before reporting: overlapping segment labels, a clipped toolbar button, a star on top of a carousel arrow and "March 2025 null" were all found by eye.
- Use deviceScaleFactor 2 for screenshots a person will see, 1 for ones only you inspect.

## Reporting

List what passed and how it was tested (mocked endpoints, simulated touch). Also list what wasn't tested: real server, real photos and tiles, a real phone, a real gamepad, audio, notifications. When a check fails, decide whether the app or the test is wrong before changing code. Two "failures" in this work were the test's fault: a toast stack trimmed to 3, and an edge clamp doing its job.
