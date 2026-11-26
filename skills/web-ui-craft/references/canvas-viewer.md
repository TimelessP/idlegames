# Full-screen pan/zoom canvas viewer, and eased cameras

## The easing rule

Keep a **current** and a **target** for every camera property. Programmatic changes (buttons, keys, double-tap, "fit", "focus on X") move the target. Each frame moves current toward target with frame-rate-independent damping:

```js
const k = reduceMotion ? 1 : 1 - Math.exp(-dt / 70);       // dt in ms; ~70 ms time constant feels quick but smooth
cur.x += (tgt.x - cur.x) * k;  // same for y, scale (2D) or position, look-at, angle, zoom (3D)
```

- **Never start a fresh tween from the target, and never mix a tween with a direct set.** That's what produced "inverse easing, then a snap" on a game zoom.
- **Lerping scale and offset together with the same k keeps a zoom anchor fixed:** screen point = x + ix·s, so if both ends map the anchor to the same pixel, every frame between does too.
- **Direct manipulation (drag, pinch) sets current and target together**, so the image stays exactly under the finger.
- **Stop the rAF loop** when every property is within epsilon (1e-4 for scale, 0.05 px for offsets).

For 3D cameras: ease position, look-at point, orbit angle and zoom distance as separate damped values toward their targets. Clamp targets, never currents, so the easing itself never jumps.

## Viewer (tested: wheel, drag, pinch via CDP touch, double-tap, keys, buttons, Back)

```js
// state: V = { img, W, H, cur:{s,x,y}, tgt:{s,x,y}, raf, last }   (x,y = image top-left in CSS px)
const fitS = () => Math.min(V.W / V.img.naturalWidth, V.H / V.img.naturalHeight);
const maxS = () => Math.max(fitS() * 8, 4);
const clamp = t => { const w = V.img.naturalWidth * t.s, hh = V.img.naturalHeight * t.s;   // no gutters beside a photo larger than the view
  t.x = w <= V.W ? (V.W - w) / 2 : Math.min(0, Math.max(V.W - w, t.x));
  t.y = hh <= V.H ? (V.H - hh) / 2 : Math.min(0, Math.max(V.H - hh, t.y)); return t; };
const draw = () => { const d = devicePixelRatio || 1; g.setTransform(d, 0, 0, d, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, V.W, V.H);
  g.imageSmoothingQuality = 'high'; g.drawImage(V.img, V.cur.x, V.cur.y, V.img.naturalWidth * V.cur.s, V.img.naturalHeight * V.cur.s); };
const tick = t => { const dt = Math.min(64, t - (V.last || t)); V.last = t; const k = reduce ? 1 : 1 - Math.exp(-dt / 70); let moving = false;
  for (const p of ['s', 'x', 'y']) { const dv = V.tgt[p] - V.cur[p]; if (Math.abs(dv) > (p === 's' ? 1e-4 : .05)) { V.cur[p] += dv * k; moving = true; } else V.cur[p] = V.tgt[p]; }
  draw(); V.raf = moving ? requestAnimationFrame(tick) : 0; if (!moving) V.last = 0; };
const kick = () => { if (!V.raf) V.raf = requestAnimationFrame(tick); };
const snap = () => { V.cur = { ...V.tgt }; draw(); };
const fit = (ease = true) => { V.tgt = clamp({ s: fitS(), x: 0, y: 0 }); ease ? kick() : snap(); };
const zoomAt = (f, px = V.W / 2, py = V.H / 2, ease = true) => {
  const base = ease ? V.tgt : V.cur, s2 = Math.min(maxS(), Math.max(fitS(), base.s * f));
  const ix = (px - base.x) / base.s, iy = (py - base.y) / base.s;          // image point under (px,py)
  V.tgt = clamp({ s: s2, x: px - ix * s2, y: py - iy * s2 }); ease ? kick() : snap(); };
const pan = (dx, dy, ease = true) => { const b = ease ? V.tgt : V.cur; V.tgt = clamp({ s: b.s, x: b.x + dx, y: b.y + dy }); ease ? kick() : snap(); };
```

Input:

```js
// canvas: touch-action:none; cursor:grab
const pts = new Map(); let pinch = null, tap = null, lastTap = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); V.tgt = { ...V.cur };
  tap = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null; pinch = null; });
cv.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId), now = local(e);
  if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap = null;
  if (pts.size === 1) { pts.set(e.pointerId, now); pan(now[0] - prev[0], now[1] - prev[1], false); return; }      // drag: direct
  pts.set(e.pointerId, now); const [a, b] = [...pts.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (pinch && pinch.dist > 0) { pan(mid[0] - pinch.mid[0], mid[1] - pinch.mid[1], false); zoomAt(dist / pinch.dist, mid[0], mid[1], false); } // pinch: direct
  pinch = { mid, dist }; });
// pointerup: two quick taps within 350 ms and 30 px -> zoomed ? fit() : zoomAt(2.5, x, y)
cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = local(e);
  zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? .05 : .0018)), x, y, !e.ctrlKey); }, { passive: false });  // ctrl = trackpad pinch: direct
// keys: arrows pan while held (keydown with repeat); + - 0 [ ] act on keyup; Left/Right change photo when not zoomed
// gamepad: D-pad pans (or changes photo at fit), LB/RB photo, X/Y zoom, A toggles zoom
```

Sizing and lifecycle:

- **Sizing:** a `ResizeObserver` on the body sets `V.W/H` and `canvas.width = W * devicePixelRatio`. If the view was at fit, fit again; otherwise clamp and snap.
- **Loading:** `img.decode()` before the first draw. A generation counter drops results from a photo the user has already moved past.
- **Layer:** open as a full-screen layer (`.sheet.viewer`), so Back closes only the viewer. On close, disconnect the observer, cancel the rAF, and sync the carousel to the last photo viewed.
- **Credits:** keep the photo credit visible in a bottom gradient, with a control bar (previous, counter, next | zoom out, fit, zoom in) using dark buttons on a translucent bar.

Testing gotcha: a "point under the cursor stays put" check fails near a letterboxed edge. The clamp correctly shifts the image to avoid a gutter. Anchor-test away from edges, and check which side is wrong before changing code.
