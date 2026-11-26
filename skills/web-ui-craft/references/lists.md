# Lists, galleries and carousels

## Pooled virtual list (thousands of rows)

TV+ handled thousands of channels with about 20 DOM rows. The list holds a tall spacer, and a pool of absolutely positioned rows is re-filled as you scroll.

```js
// markup: <div id="list" class="scroll"><div class="spacer" style="position:relative"></div></div>
// css:   .row { position:absolute; left:0; right:0; height: var(--row-h); }  .row[hidden] { display:none; }
render(resetScroll) {
  const list = $('#list'), sp = list.querySelector('.spacer');
  sp.style.height = (RESULTS.length * this.rowH()) + 'px';
  if (resetScroll) list.scrollTop = 0;
  this.paint(true);
},
rowH() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 76; },
paint(force) {
  const list = $('#list'), rh = this.rowH(), top = list.scrollTop, hgt = list.clientHeight;
  const first = Math.max(0, Math.floor(top / rh) - 4), last = Math.min(RESULTS.length - 1, Math.ceil((top + hgt) / rh) + 4);
  const sp = list.querySelector('.spacer'), need = Math.max(0, last - first + 1);
  while (this.rows.length < need) { const r = this.makeRow(); this.rows.push(r); sp.append(r.el); }
  this.rows.forEach((r, i) => {
    const idx = first + i, item = RESULTS[idx];
    if (!item || i >= need) { r.el.hidden = true; r.idx = -1; return; }
    r.el.hidden = false; r.el.style.top = (idx * rh) + 'px';
    if (force || r.idx !== idx || r.key !== item.key) this.fillRow(r, item, idx);   // only refill when the row's content changed
    r.idx = idx; r.key = item.key;
  });
},
// list.addEventListener('scroll', () => this.paint(), { passive: true });
```

- **Hidden pooled rows stayed visible** because `.row { display: flex }` beats the `hidden` attribute. Always add `.row[hidden] { display: none }`. This applies to any element styled with `display`.
- **Row handlers read `RESULTS[r.idx]` at click time**, not a captured item, because the row is reused.
- **Keyboard:** focusing row *i* scrolls it into range, calls `paint()`, then focuses the pooled row whose `idx === i`.
- **Text scaling:** take the row height from a CSS variable so a text-size setting can change it.

## Simple lists: cap the render, keep focus and scroll

For lists that rebuild on every change (tens to hundreds of cards):

```js
const box = $('#vlist'), sc = $('#vscroll');
const keep = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.k : null, top = sc.scrollTop;
box.innerHTML = '';
const cap = this.cap || 150; for (const v of list.slice(0, cap)) box.append(card(v));       // every focusable child gets data-k="<stable id>"
if (list.length > cap) box.append(h('button', { class: 'btn', type: 'button', 'data-k': 'more', text: `Show more (${list.length - cap} not shown)`, onclick: () => { this.cap = cap + 150; renderList(); } }));
sc.scrollTop = top;
if (keep) { const f = box.querySelector(`[data-k="${CSS.escape(keep)}"]`); if (f) f.focus({ preventScroll: true }); }
```

Reset `this.cap` when the day or filter changes. Stamping a card re-renders the list, and with this the user's focus stays on the button they just pressed.

## Merge rows that belong together

Users scan for "what happened", not "which events were logged". Group events by entity, sort by time, and pair start and end into one item:

```js
for (const e of eventsForEntity) {
  if (e.type === 'START') { if (open) push(open, null); open = e; }      // a second start closes the previous one as "end not seen"
  else { push(open, e); open = null; }                                  // an end with no start is "start not seen"
}
if (open) push(open, null);                                             // still going: "in the area now" if live, else "no departure seen"
```

- **Collapse duplicates** logged by several open clients: same entity, same type, within 60 s.
- **Verdicts:** derive the item's verdict from all its member events (any "refused" wins).
- **Live badges:** refresh them when the set of live entities changes, not on a minute timer.

## Lazy thumbnails with IntersectionObserver and batching

```js
io: new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { PHOTOS.want.add(e.target.dataset.id); PHOTOS.batchSoon(); } }, { rootMargin: '200px' }),
// batch: one request for up to 100 ids; image bytes fetched with the auth header -> blob -> objectURL;
// keep an LRU of ~80 object URLs and revokeObjectURL the evicted ones; unobserve elements that left the DOM.
```

- **Use a cached URL synchronously** (`urls.get(f) || await url(f)`), so re-rendering a list doesn't flash empty thumbnails.
- **Validate server-supplied filenames** before building URLs (`/^[0-9a-f]{64}\.(jpg|png|webp)$/`).
- **Credits:** only `https:` URLs become links, with `rel="noopener noreferrer"` and `target="_blank"`.

## Carousel

- **Navigation:** previous/next buttons (44px round, `stopPropagation`), a "2 / 3" counter, and swipe (pointerdown x versus pointerup x, more than 40px).
- **Taps:** a tap that wasn't a swipe and wasn't on an arrow opens the full-screen viewer (`references/canvas-viewer.md`).
- **Keyboard:** the photo element is `role="button"` with `tabindex="0"` and an aria-label such as "Photo 2 of 3: caption. Open full screen to zoom in". Space acts on keyup.
- **State:** expose `el._go(i)` so the viewer can sync the carousel to the photo last viewed.
- **Redraws:** when a sheet containing a carousel redraws, re-append the same carousel element, or the photo index resets to 1 on every data update.
