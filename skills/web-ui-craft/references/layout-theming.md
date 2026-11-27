# Layout for real estate, and theming

## Frame

```css
:root { --fs: 17px; --tap: 48px; --r: 6px; --nav-h: 64px; --app-h: 100dvh;
  --safe-t: env(safe-area-inset-top, 0px); --safe-r: env(safe-area-inset-right, 0px);
  --safe-b: env(safe-area-inset-bottom, 0px); --safe-l: env(safe-area-inset-left, 0px); }
html, body { height: 100%; overflow: hidden; font: var(--fs)/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-text-size-adjust: 100%; }
#app { position: fixed; inset: 0; height: var(--app-h); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
.view { min-height: 0; display: none; flex-direction: column; overflow: hidden; } .view.on { display: flex; }
.scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
```

```js
// mobile browsers lie about 100vh; follow the visual viewport (keyboard, URL bar)
const vv = () => document.documentElement.style.setProperty('--app-h', (window.visualViewport ? visualViewport.height : innerHeight) + 'px');
vv(); addEventListener('resize', vv); if (window.visualViewport) visualViewport.addEventListener('resize', vv);
```

- **`min-height: 0` everywhere in grid and flex chains.** Without it, inner scrollers grow, the whole page scrolls, and bars slide away.
- **Scrollbars:** `scrollbar-width: thin; scrollbar-color: var(--line) transparent;`. Give a scroller its own gutter lane (`scrollbar-gutter: stable`) when content appearing would otherwise shift the layout.

## Three layouts, chosen by the space actually available

```css
/* wide: list beside a permanent map or detail */
@media (min-width: 1100px) and (min-aspect-ratio: 1/1) {
  #views { grid-template-columns: minmax(400px, 480px) minmax(0, 1fr); }
  #view-map { display: flex !important; grid-column: 2; grid-row: 1; }
  .view:not(#view-map) { grid-column: 1; grid-row: 1; }
  #nav { display: none; } #top-tabs { display: flex !important; }
}
/* short landscape phones: nav becomes a side rail so the list keeps its height */
@media (max-height: 560px) and (orientation: landscape) and (max-width: 1099px) {
  #app { grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  #nav { grid-column: 1; grid-row: 1 / span 2; flex-direction: column; width: calc(88px + var(--safe-l)); }
  #top, #views { grid-column: 2; }
}
```

- **Phone portrait:** a bottom nav with icon and label, plus a small count line ("3 to review") under the main tab.
- **Switching on resize:** listen to `matchMedia(...).addEventListener('change', ...)` and call `invalidateSize()` on maps when the layout changes.

## Headers that scroll away

Put the day stepper, filters, search and summary in a `.vhead` inside the scroller, before the list. On a landscape phone this took the visible list from half a card to the whole screen. Keep the top bar slim: desk or name button, a status dot, clock and settings.

## Filter bars that fit

Segmented controls with long labels overlap on a 390px phone ("Authorised 2Not authorised"). Use short words and icons plus a bold count, and put the long label in `aria-label` and `title`:

```js
for (const [id, label, icon, long] of [['all','All','','All visits'], ['todo','Review','','To review'], ['ok','',ICON.check,'Authorised'], ['bad','',ICON.x,'Not authorised']])
  bar.append(h('button', { class: 'btn', type: 'button', role: 'radio', title: long, 'aria-label': `${long}: ${counts[id]}`,
    'aria-checked': String(cur === id), 'aria-pressed': String(cur === id), html: `${icon}${label ? `<span>${label}</span>` : ''}<b>${counts[id]}</b>`, onclick: () => set(id) }));
```

Reuse the same icons as the inline action buttons (tick and cross stamps), so the filter reads as the same visual language.

## Toolbars that fit: measure, don't guess

```css
#top > * { flex-shrink: 0; }                                   /* items keep their natural width ... */
#top .spacer { flex: 1 1 0; min-width: 0; flex-shrink: 1; }    /* ... only the gap gives way */
#top.compact .lbl { display: none; } #top.compact .btn.lab { width: var(--tap); padding: 0; }
#top.tiny h1 { display: none; }
```

```js
function fitTop() {   // compact in stages, re-measuring after each
  const t = $('#top'), sp = t.querySelector('.spacer');
  const over = () => t.scrollWidth > t.clientWidth || sp.getBoundingClientRect().width < 8;   // the spacer's width is the room left
  t.classList.remove('compact', 'tiny'); if (over()) t.classList.add('compact'); if (over()) t.classList.add('tiny');
}
new ResizeObserver(fitTop).observe($('#top'));   // rotation, panels opening, font scaling
```

- **The flex-shrink trap.** Flex items shrink by default. Buttons squeeze until their labels overlap, while `scrollWidth` never exceeds `clientWidth`, so the measurement says "fits" and nothing compacts. This shipped in QR Studio and only showed on a narrow portrait phone. `flex-shrink: 0` on the items fixes it.
- **Slack goes on the spacer, not on scrollWidth.** `scrollWidth` is never less than `clientWidth`, so a test like `scrollWidth > clientWidth - 4` is always true and the bar compacts even on a wide desktop. This shipped too, and only a desktop screenshot caught it. Measure the spacer instead: it is the room left over.
- **Stages:** drop button labels first (keep `aria-label`), then the title. Never hide an action.

### Action rows inside cards (grids of wheels, timers, items)

A card's button row shrinks as more cards share the grid. Labels with `white-space: nowrap` in a fixed `grid-template-columns` row then spill over each other, and grid items' default `min-width: auto` lets a button grow instead, so nothing ever "overflows". Measure each row itself:

```css
.acts .btn { min-width: 0; overflow: hidden; }   /* the label now overflows its own button, so it can be measured */
.acts.compact .lbl { display: none; }
```

```js
function fitActs(acts) { acts.classList.remove('compact'); if ([...acts.querySelectorAll('.btn')].some(b => b.scrollWidth > b.clientWidth - 2)) acts.classList.add('compact'); }
const actsRO = new ResizeObserver(es => es.forEach(e => fitActs(e.target)));   // one observer for every card's row
```

- Every button gets `aria-label` and `title` with its full name, set wherever its label changes.
- **Re-measure when a label changes**, not only on resize: "Resume" or "Restart" is wider than "Start", so a card that fit while running can overflow once paused.
- Decide per card: a single wide card keeps its labels while narrow cards in a busy grid show icons.

## Card grids and phone rows

- **Phones:** below about 600px, turn grid cards into compact rows (thumbnail about 124px wide on the left, title and two lines of text beside it). This roughly doubled the number of games visible on the launcher, compared with full-width cards.
- **The whole card is one link** (picture, title, description); secondary actions (favourite, watch) sit in a footer outside the link, because a link can't contain buttons. No separate "Open" button.
- **One-line tag rows:** `display: flex; flex-wrap: wrap; height: 1.75em; overflow: hidden;`. Tags that don't fit drop out whole instead of being cut mid-word.
- **Descriptions:** clamp to two lines (`-webkit-line-clamp: 2`). Keep catalogue descriptions short (about 60 to 110 characters) so they aren't cut off with an ellipsis.
- **Badges** ("New", "Beta") are text pills over the picture, not colour alone.

## Galleries

`grid-template-columns: repeat(auto-fill, minmax(168px, 1fr))` gives two columns on a 390px phone and in a 480px side column. 230px gave one huge card per row. Keep overlay buttons (such as a favourite star) out of the photo area if the photo has carousel arrows: put them in the text row.

## Theming

Let CSS follow the system, so Automatic needs no JavaScript at all. The `<html>` element carries `data-theme="system" | "light" | "dark"`:

```html
<html lang="en" data-theme="system">
<head><script>   /* before any CSS paints: no white flash in dark mode */
  try { const t = localStorage.getItem('app-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
</script>
```

```css
:root { /* light tokens */ color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark tokens */ color-scheme: dark; } }
:root[data-theme="dark"] { /* dark tokens again */ color-scheme: dark; }
body { background: var(--bg); }   /* always set explicitly */
```

After a theme change, set `meta[name=theme-color]` to `css('--surface')` so the phone's status bar matches.

### Hover states are part of the theme

A single `.btn:hover { background: var(--surface-2) }` only suits plain buttons. Filled buttons (primary, solid danger, a per-card colour) then get no feedback, or flip to the plain grey with white text on it. Give every filled variant a hover derived from its own colour, and wrap hovers in `@media (hover: hover)` so touch screens don't keep a sticky hover:

```css
@media (hover: hover) {
  .btn.primary:hover:not([disabled]) { background: color-mix(in srgb, var(--accent) 82%, var(--text)); }   /* darker in light, lighter in dark */
  .btn[aria-pressed="true"]:hover:not([disabled]) { background: color-mix(in srgb, var(--accent-soft) 72%, var(--accent)); }
  .card .btn.primary:hover:not([disabled]) { background: color-mix(in srgb, var(--card-colour) 82%, var(--text)); }   /* own colour, higher specificity */
  .btn[disabled]:hover { background: var(--surface); }   /* disabled never reacts */
}
```

Check every hand-rolled clickable too (nav items, chips, toast actions, full-screen close buttons): if it has no hover, it looks dead under a mouse.

### Text selection is part of the theme

The browser's default blue highlight clashes with both themes. Theme it with tokens:

```css
:root { --sel-bg: #c9cbf6; --sel-fg: #14171c; }                 /* light: soft accent, dark text */
/* dark: --sel-bg: #454a9c; --sel-fg: #ffffff; */
::selection { background: var(--sel-bg); color: var(--sel-fg); }
/* inverted surfaces (a toast is var(--text) on var(--bg)) need their own, or the highlight vanishes */
.toast::selection, .toast *::selection { background: var(--accent); color: var(--on-accent); }
```

Example token sets:

```css
:root { --bg:#f4f5f7; --surface:#fff; --surface-2:#eef0f3; --line:#d9dde3; --text:#15181d; --text-2:#4b5260; --text-3:#6e7684;
  --accent:#1f5fbf; --accent-soft:#e3ecfa; --ok:#1d7a43; --ok-soft:#e1f3e8; --bad:#b3261e; --bad-soft:#fbe5e3; --warn:#8a5a00; --warn-soft:#fbf0d9; color-scheme: light; }
:root[data-theme="dark"] { --bg:#0f1115; --surface:#171a20; --surface-2:#1f232b; --line:#2d323c; --text:#eef0f4; --text-2:#b8bfcc; --text-3:#8b93a3;
  --accent:#6ea8ff; --accent-soft:#1c2a42; --ok:#5fd08c; --ok-soft:#15301f; --bad:#ff7a70; --bad-soft:#3a1b19; --warn:#f0c060; --warn-soft:#352a12; color-scheme: dark; }
```

```js
function applyTheme() {
  const dark = PREFS.theme === 'dark' || (PREFS.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  redrawCanvasAndMapLayers();            // anything that baked colours in must redraw
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();   // read tokens for canvas/SVG
```

- **Dark map tiles without a second tile server:** `.leaflet-tile-pane .tiles { filter: var(--tiles-filter); }`. In dark mode use `brightness(.62) invert(1) contrast(2) hue-rotate(185deg) saturate(.45) brightness(.88)`.
- **Re-theme widget chrome** with tokens and `!important` where the library inlines styles:

```css
.leaflet-bar { border: 1px solid var(--line) !important; border-radius: var(--r) !important; box-shadow: 0 2px 8px rgba(0,0,0,.18) !important; overflow: hidden; }
.leaflet-bar a, .leaflet-bar a:hover { background: var(--surface) !important; color: var(--text) !important; border-bottom: 1px solid var(--line) !important; }
.leaflet-bar a:hover { background: var(--surface-2) !important; } .leaflet-bar a.leaflet-disabled { color: var(--text-3) !important; }
.leaflet-control-zoom a { width: var(--tap) !important; height: var(--tap) !important; line-height: var(--tap) !important; }
.leaflet-container .leaflet-control-attribution { background: color-mix(in srgb, var(--surface) 82%, transparent); color: var(--text-2); }
```

- **Map markers:** use `L.divIcon` with inline SVG coloured from tokens. Cache a key per marker (`heading|status|favourite|theme`) and only call `setIcon` when the key changes, so a 20 fps update loop stays cheap.

## Status colours

- **Pick hues that differ in more than lightness:** red (refused), orange (to review), green (approved), blue (outside or inactive), gold (favourite). Don't use amber and gold together.
- **Use a second channel for overlapping categories.** A favourite inside the zone gets a gold body with a ring in the status colour, so the alarm colour is never hidden.
- **Use size for importance** (planes inside the zone are bigger), and show a legend drawn with the same SVG function as the markers.
- **Repeat the colour as words where people decide:** tags like "Refused before" or "Authorised before" on cards; a left border colour plus a text tag.

## Toasts and announcements

- **Behaviour:** an `aria-live="polite"` container with `pointer-events: none`, at most 3 toasts (drop the oldest), and an SVG icon before the text.
- **Undo toasts:** a toast may carry one action button, which re-enables `pointer-events: auto` on itself only. Keep it up for at least 8 seconds. Snapshot the state before the change (`structuredClone` or JSON) and restore it in the action:

```js
function toast(msg, type = 'info', ms = 3200, action = null) {
  const t = h('div', { class: 'toast' }, h('span', { text: msg }));
  if (action) t.append(h('button', { class: 'act', type: 'button', text: action.label, onclick: () => { t.remove(); action.fn(); } }));
  $('#toasts').append(t); setTimeout(() => t.remove(), action ? Math.max(ms, 8000) : ms);
}
const before = clone(STATE.design); STATE.design = clone(DEFAULTS.design); redraw();
toast('Design reset.', 'info', 8000, { label: 'Undo', fn: () => { STATE.design = before; redraw(); } });
```
- **Position per layout:** above the bottom nav on phones; top of the map column on wide screens, clear of legends and controls.
- **Use:** confirmations and events ("Favourite G-ABCD is nearby (2.1 nm)"), never for errors the user must act on. Those go in place, e.g. a banner with a button: "No airfield area is set. [Draw the area]".

## Accessibility details that came up

- `role="radio"`/`aria-checked` plus `aria-pressed` on segmented buttons; `role="tab"`/`aria-selected` on view tabs.
- Every icon-only button has an `aria-label` and a `title`, and state changes update them ("Authorised (press to clear)").
- Summaries are `aria-live` ("5 arrivals, 4 departures, 1 overflight, 3 to review"), with plurals handled.
- Tags and timestamps use `font-variant-numeric: tabular-nums`.
- `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`. Easing code checks the same media query and uses k = 1.
