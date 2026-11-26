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

```js
fitDock() { const d = $('#dock'); d.classList.remove('compact'); if (d.scrollWidth > d.clientWidth + 1) d.classList.add('compact'); },
// .compact hides labels and makes buttons icon-only (with aria-label kept)
new ResizeObserver(() => HUD.fitDock()).observe($('#stage'));   // rotation, panels opening, font scaling
```

## Galleries

`grid-template-columns: repeat(auto-fill, minmax(168px, 1fr))` gives two columns on a 390px phone and in a 480px side column. 230px gave one huge card per row. Keep overlay buttons (such as a favourite star) out of the photo area if the photo has carousel arrows: put them in the text row.

## Theming

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
- **Position per layout:** above the bottom nav on phones; top of the map column on wide screens, clear of legends and controls.
- **Use:** confirmations and events ("Favourite G-ABCD is nearby (2.1 nm)"), never for errors the user must act on. Those go in place, e.g. a banner with a button: "No airfield area is set. [Draw the area]".

## Accessibility details that came up

- `role="radio"`/`aria-checked` plus `aria-pressed` on segmented buttons; `role="tab"`/`aria-selected` on view tabs.
- Every icon-only button has an `aria-label` and a `title`, and state changes update them ("Authorised (press to clear)").
- Summaries are `aria-live` ("5 arrivals, 4 departures, 1 overflight, 3 to review"), with plurals handled.
- Tags and timestamps use `font-variant-numeric: tabular-nums`.
- `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`. Easing code checks the same media query and uses k = 1.
