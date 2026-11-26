# Layers, history Back, press quarantine, and input on release

Tested in TV+ and Tiny ATC with mouse, touch, keyboard and a gamepad loop.

## Why this matters

These bugs come from a press and its release landing in different contexts:

- **A tap opens a sheet, and the same tap's `click` lands on a button inside the new sheet.** The sheet appears under the finger, so the release hits whatever is there.
- **Enter held on a list item opens a dialog, and the auto-repeat or the keyup activates its first button.**
- **Ghost walks in a game:** the click that closed a menu also told the character to walk to that spot.
- **Back on Android leaves the app instead of closing the dialog.**

The fix is one small module that owns layers, history and quarantine, plus a rule: actions fire on release, and only if the press started in the same layer.

## The LAYERS module

```js
const LAYERS = {
  stack: [],
  init() {
    // Back (any source) pops history; popstate closes layers down to the depth in the state.
    addEventListener('popstate', e => { const d = (e.state && e.state.appLayer) || 0; while (this.stack.length > d) this._close(); });
    // A reload with layer entries still in history: rewind them so Back works normally.
    const st = history.state; if (st && st.appLayer > 0) history.go(-st.appLayer);

    this.downAt = 0; this.downIn = null; this.keyAt = {}; this.enterOn = null;
    document.addEventListener('pointerdown', e => { this.downAt = performance.now(); this.downIn = e.target; }, true);
    document.addEventListener('keydown', e => { if (!e.repeat) this.keyAt[e.key] = performance.now(); }, true);
    const swallow = e => { e.stopImmediatePropagation(); e.preventDefault(); };
    const bd = document.querySelector('#sheets .backdrop');

    // Quarantine: a click whose press began before the top layer opened, or outside it, does nothing.
    // (The backdrop is allowed only if the press also began on the backdrop.)
    document.addEventListener('click', e => {
      const t = this.top(); if (!t || !e.isTrusted || e.detail === 0) return;   // detail 0 = keyboard/synthetic, handled below
      const began = this.downAt >= t.at && (t.el.contains(this.downIn) || (this.downIn === bd && e.target === bd));
      if (!began) swallow(e);
    }, true);

    // Keys: Space/Enter pressed before the layer opened are swallowed (down and up).
    // Enter on a control acts on RELEASE, like Space, and only if still on the same element in the same layer.
    document.addEventListener('keydown', e => { const t = this.top();
      if (t && (e.key === ' ' || e.key === 'Enter') && (this.keyAt[e.key] || 0) < t.at) { swallow(e); return; }
      if (e.key === 'Enter' && e.target.matches && e.target.matches('button, [role="button"], a[href]')) {
        e.preventDefault(); if (!e.repeat) this.enterOn = { el: e.target, depth: this.stack.length }; } }, true);
    document.addEventListener('keyup', e => { const t = this.top();
      if (t && (e.key === ' ' || e.key === 'Enter') && (this.keyAt[e.key] || 0) < t.at) { swallow(e); return; }
      if (e.key === 'Enter' && this.enterOn) { const o = this.enterOn; this.enterOn = null;
        if (o.el === e.target && o.depth === this.stack.length && !o.el.disabled) o.el.click(); } }, true);

    bd.addEventListener('click', () => this.back());
  },
  top() { return this.stack[this.stack.length - 1]; },
  open(title, build, o = {}) {
    const el = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }), body = h('div', { class: 's-body' });
    const head = h('div', { class: 's-head' },
      h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Back', html: ICON.back, onclick: () => this.back() }), h('h2', { text: title }));
    el.append(head, body); document.querySelector('#sheets').append(el);
    const layer = { el, body, at: performance.now(), prev: document.activeElement, onClose: o.onClose, refresh: null,
      title: t => { head.querySelector('h2').textContent = t; } };
    this.stack.push(layer); history.pushState({ appLayer: this.stack.length }, '');
    build(body, layer); this.apply();
    requestAnimationFrame(() => { const f = el.querySelector('[data-autofocus]') || head.querySelector('button'); if (f) f.focus({ preventScroll: true }); });
    return layer;
  },
  back() { if (this.stack.length) history.back(); },                 // always go through history
  closeAll() { if (this.stack.length) history.go(-this.stack.length); },
  _close() { const l = this.stack.pop(); if (!l) return; l.el.remove(); if (l.onClose) l.onClose(); this.apply();
    if (l.prev && document.contains(l.prev)) l.prev.focus({ preventScroll: true }); },
  apply() { const n = this.stack.length; document.querySelector('#sheets').classList.toggle('on', n > 0);
    this.stack.forEach((l, i) => { l.el.hidden = i !== n - 1; }); document.querySelector('#app').inert = n > 0; },
  refreshAll() { for (const l of this.stack) if (l.refresh) l.refresh(); },  // re-render open sheets when data changes
};
```

Notes:

- **Close through history.** Never remove a layer directly when the user presses Back or `<`. Always call `history.back()` so the history stack and the layer stack can't drift apart. To re-render a sheet in place, give it a `draw()` function and call that, instead of closing and reopening.
- **Open sheets after a delay** (`setTimeout(fn, 60)`) when the action that opens them also closes others with `closeAll()`, so the popstate events settle first.
- **Keep state across redraws.** A sheet that redraws on data changes (`layer.refresh`) should keep its scroll position, and skip redrawing while the user is typing in one of its textareas. Pull long-lived children (like a photo carousel) out of the redraw so their state survives.
- **CSS:** sheets are centred cards on desktop and bottom sheets on phones (`max-width: 760px`). A full-screen variant (`.sheet.viewer`) uses `inset: 0` and no radius. Make the full-screen variant's selector more specific than the phone media query's, so it wins.

## Global keys on release

```js
const KEYS = { at: {} };
addEventListener('keydown', e => { if (!e.repeat) KEYS.at[e.key] = LAYERS.stack.length; });
addEventListener('keyup', e => {
  const same = KEYS.at[e.key] === LAYERS.stack.length; delete KEYS.at[e.key];
  if (!same) return;                                    // pressed in another layer: ignore
  if (e.key === 'Escape') { if (LAYERS.stack.length) LAYERS.back(); return; }
  if (LAYERS.stack.length || e.target.closest('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
  // view shortcuts: 1..4 switch views, '/' focuses search, '[' ']' step day or month ...
});
// '/' must preventDefault on keydown or the slash is typed into the search it focuses
addEventListener('keydown', e => { if (e.key === '/' && !LAYERS.stack.length && !e.target.closest('input,textarea')) e.preventDefault(); });
```

Continuous manipulation is the exception to act-on-release, for example holding an arrow key to pan a zoomed photo. Act on keydown with repeat for those, and keep discrete actions (zoom step, next photo) on keyup.

## Gamepad: poll, act on release, same depth

```js
const GAMEPAD = {
  prev: [], depth: [], raf: 0,
  init() { addEventListener('gamepadconnected', () => { if (!this.raf) this.loop(); toast('Controller connected: D-pad to move, A to choose, B to go back.'); }); },
  focusables() { const root = LAYERS.top() ? LAYERS.top().el : document.querySelector('#app');
    return [...root.querySelectorAll('button:not([disabled]), input, textarea, a[href], [tabindex="0"]')].filter(e => e.offsetParent !== null); },
  move(d) { const f = this.focusables(); if (!f.length) return; const i = f.indexOf(document.activeElement);
    const n = f[Math.max(0, Math.min(f.length - 1, i < 0 ? 0 : i + d))]; n.focus(); n.scrollIntoView({ block: 'nearest' }); },
  fire(b) {
    if (VIEWER.pad && VIEWER.pad(b)) return;                     // let a focused special surface claim buttons first
    if (b === 12 || b === 14) this.move(-1); else if (b === 13 || b === 15) this.move(1);   // D-pad
    else if (b === 0) { const a = document.activeElement; if (a && a !== document.body) a.click(); } // A
    else if (b === 1) { if (LAYERS.stack.length) LAYERS.back(); }                            // B
    else if ((b === 4 || b === 5) && !LAYERS.stack.length) { /* LB/RB: previous/next view */ }
  },
  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; if (!pads.length) return;
    const gp = pads[0], now = gp.buttons.map(x => x.pressed), ay = gp.axes[1] || 0;
    now[12] = now[12] || ay < -.6; now[13] = now[13] || ay > .6;          // left stick as D-pad
    now.forEach((on, i) => {
      if (on && !this.prev[i]) this.depth[i] = LAYERS.stack.length;      // remember where the press began
      if (!on && this.prev[i] && this.depth[i] === LAYERS.stack.length) this.fire(i);  // act on release, same layer only
    });
    this.prev = now;
  },
};
```

## Long press without a stray click (touch lists)

A long press opens a menu. Without a guard, the release that follows also fires a `click`, which activates the row. Set a flag on the row when the long press fires, and have the row's click handler consume the flag:

```js
r.main.addEventListener('click', () => { if (r.longPressed) { r.longPressed = false; return; } activate(); });
INPUT.longPress(r.main, () => { r.longPressed = true; openMenu(); });   // ~500 ms timer, cancelled on move > 10px or pointerup
```

## Games: click-to-walk and ghost clicks

- **Walking:** start a walk only from a `click` whose `pointerdown` began on the same world target, after any menus or dialogs have closed. Drop the walk target when a UI layer opens.
- **Hit areas:** stumps, bushes and similar objects need generous hit shapes. A miss on a small object turns into "walk to the ground behind it", which the user reads as a ghost walk down the screen.
- **Repeated actions:** keep these idempotent (picking up, opening a chest), so a duplicated event can't do double work.
