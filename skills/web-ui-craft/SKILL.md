---
name: web-ui-craft
description: Hard-won UI techniques for building or reworking browser apps, especially single-file HTML/JS apps, PWAs, dashboards, media players, map apps and browser games. Covers screen-real-estate-first layouts, sheets/modals driven by browser history (Back closes the top one), press-on-release input with press quarantine across mouse, touch, keyboard and gamepad, older-eyes accessibility, light/dark theming (including third-party widgets like Leaflet), big pooled lists, photo carousels and a full-screen pan/zoom canvas viewer, eased cameras, multi-user sync with ETag merge and live shared text, and Playwright testing with mocked, slow and hung backends. Use this skill whenever you write or rework any web UI, HTML app, game UI, PWA, kiosk or dashboard, add a modal, sheet, list, filter bar, map or photo viewer, add multi-user or offline sync, or test a web app, even if the user does not mention UI technique, accessibility or input handling by name.
---

# Web UI craft

These are the techniques that made three real apps (a papercraft RPG, an IPTV
player with thousands of channels, and a multi-user airfield watch app) feel right
to their user after many rounds of hands-on testing. Each rule exists because
its absence caused a real bug or a real complaint. Read the "why" so you can apply
the idea to situations not listed here.

The reference files hold tested code. Read the one you need when you reach that
part of the work:

| Topic | File | Read when |
|---|---|---|
| Layers, sheets, history Back, press quarantine, act-on-release keys, gamepad, long press | `references/layers-input.md` | any modal, sheet, menu, dialog or non-trivial input |
| Layout for real estate, viewport height, docks that fit, filter bars, theming tokens, re-theming widgets, status colours, toasts | `references/layout-theming.md` | building or reworking a screen |
| Pooled virtual list, render caps, focus/scroll preservation, lazy thumbnails, carousels | `references/lists.md` | lists over ~150 items, galleries, re-rendering lists |
| Multi-user sync: ETag merge loop, versioned dirty marks, three-way text merge, caret-safe live text, polling, timeouts, compatibility | `references/sync.md` | anything saved to a shared server record |
| Full-screen pan/zoom canvas viewer; eased cameras (2D and 3D) | `references/canvas-viewer.md` | photo/image inspection, maps, any camera or zoom |
| Playwright harness: routed files, mocks, slow/hung/failing backends, two users, pinch via CDP, screenshots | `references/testing.md` | before reporting anything as working |

## The standing rules

Apply all of these by default. They are cheap when designed in and expensive to retrofit.

1. **Screen real estate first.** Decoration that costs space is the most common complaint about a UI that looks nice in a screenshot. Prefer flat surfaces, thin borders, one accent colour. Put filters and summaries *inside* the scrolling list so they scroll away. Collapse duplicates into one item: an arrival and its departure become one card, "In 11:57 → Out 12:22 · 25 min", not two rows. On wide screens, show the list and the detail or map side by side permanently. On phones, show one view at a time with a bottom nav. On short landscape phones, use a side rail so the list keeps its height.

2. **Nothing resizes the main view unexpectedly.** Give scrollbars their own lane (`scrollbar-gutter: stable` or an overlay-free layout). Toasts float and never push content. Measure the viewport with `visualViewport` into a CSS variable instead of trusting `100vh` on mobile. If a toolbar might not fit, measure it (`scrollWidth > clientWidth`) and switch it to icon-only. Never guess from breakpoints: a guess clipped the Settings button on a landscape phone.

3. **Act on release, and only where the press began.** Mouse and touch: use `click`, never `pointerdown`, for actions. Keys: Enter on a button acts on keyup, like Space. Gamepad: act on button release. In every case, ignore a release whose press started in another layer or on another object. This kills a whole family of bugs: a tap that opens a sheet and also activates the button underneath, held keys leaking into a new dialog, and "ghost walks" in games.

4. **Modals are layers backed by browser history.** Each sheet calls `history.pushState`. Back (browser, Android, mouse button, Escape, gamepad B) closes only the top layer. With no layer open, Back leaves the page normally. Every sheet has a visible `<` back button at top left. While a layer is open, the app underneath is `inert`. Presses that began before the layer opened are quarantined. Restore focus to the opener when the layer closes.

5. **Readable for older eyes, fat-finger friendly, every input device.**
   - Size: base font about 17px, targets at least 48px, generous line height, tabular numbers for times and counts.
   - Feedback: focus rings visible with `:focus-visible`, WCAG AA contrast in both themes, `prefers-reduced-motion` respected.
   - Input: everything reachable by mouse, touch, keyboard and gamepad. Colour is never the only signal: pair it with a label, an icon, a size or a ring.

6. **No emoji in the UI.** Use inline SVG icons from one `ICON` map, using `currentColor` so they theme. Emoji render differently per platform, can't be themed, and look like clip art next to real UI.

7. **Ease camera properties; let direct manipulation be direct.** When the program moves a view (zoom buttons, fit, focusing a target, a 3D camera's position, look-at point, angle or zoom), ease the change with frame-rate-independent damping. Never snap, and never start a new tween from the target (that caused "inverse easing then a snap"). When a finger or mouse is dragging or pinching, follow it exactly with no easing, or it feels laggy.

8. **Theme with tokens.** All colours are CSS custom properties on `:root`, redefined under `[data-theme="dark"]`. Offer Automatic, Light and Dark, and follow the system when set to Automatic. Re-theme third-party widgets (map zoom buttons, attribution) instead of leaving them white in dark mode. Canvas and SVG drawing read colours from the tokens at draw time and redraw when the theme changes.

9. **Status colours must stay distinguishable.** When adding a category colour, check it against the existing ones. Gold next to amber is unreadable at a glance, so make "to review" orange. If one category (such as favourites) must not hide another that matters more (such as a security status), encode it in a second channel, e.g. gold fill with a ring in the status colour. Add a small legend.

10. **Shared data never loses anyone's work.** Saving to a shared record means read, merge, write with `If-Match`, retry on 409/412. Track unsaved edits with versioned dirty marks. Merge text three ways. Insert others' text without moving the writer's caret. Background loops are independent, and every request has a timeout. Show sync state in plain words ("Shared on Desk 1111 · checked for changes 14:46:46"). See `references/sync.md`. A silent sync failure is the worst kind.

11. **Rework without breaking the contract.**
    - Keep: the backend API, storage keys and record shape. Add fields only as optional, and keep writing legacy fields that older clients read.
    - If old data is ambiguous: migrate it explicitly, e.g. file the old "This month" note under the current month.
    - Tell the user: which old copies still open in browsers will misbehave, and that everyone should reload after deploy.

12. **Report honestly.** Say what was tested, how, and what wasn't: real server, real device, real gamepad, audio, notifications. Tests against mocks prove less than they look. A mock that always answers instantly hid a boot-order bug that broke live sync on real devices.

## Workflow for a new app or a rework

1. **Read the existing app fully** if there is one. List its contract: endpoints, payload shapes and validators, storage keys, URL parameters, IDs. Also list the problems you can see: duplicate rows, lost writes, wasted space, unused settings.
2. **Plan views around the user's real daily task**, e.g. "check what came and went today". Make that the first screen, with one-tap actions inline, and push everything else one level deeper.
3. **Structure a single file** with a section index comment at the top (§1 CSS, §2 HTML, §3 state, ...). Use small module objects (`STATE`, `KV`, `VIEW`, `LAYERS`, `SHEETS`, `INPUT`), a tiny DOM builder `h(tag, attrs, ...kids)` that skips `null`, an `ICON` map and an `esc()` helper. Watch out: a plain `Element.append(x, null)` writes the text "null"; only your `h()` filters nulls.
4. **Build the layer and input layer first** (`references/layers-input.md`), then views, then sheets.
5. **Test with Playwright** (`references/testing.md`):
   - Mocks: route every endpoint, including slow, hung and failing variants.
   - Users: run two browser contexts for anything shared.
   - Screenshots: phone portrait (390×844), phone landscape (844×390) and desktop, in light and dark.
   - Assert: no horizontal overflow and no page errors.
   - Look: open the screenshots yourself before reporting.
6. **Deliver** the file with a short report: what changed, compatibility notes, what wasn't tested.

## Quick checklist before delivering

- [ ] Every action fires on release; a press started elsewhere does nothing.
- [ ] Back closes the top sheet; with none open, Back leaves the page; `<` button on every sheet.
- [ ] App underneath is inert while a sheet is open; focus returns to the opener.
- [ ] Targets ≥ 48px, base text ≈ 17px, focus visible, both themes pass contrast.
- [ ] No emoji; icons are SVG with `currentColor`.
- [ ] No horizontal scroll at 390px wide; toolbar fits or compacts; landscape phone usable.
- [ ] Lists keep scroll position and focus across re-renders; big lists are pooled or capped.
- [ ] Program-driven view changes ease; drags and pinches are direct; reduced motion respected.
- [ ] Third-party widgets themed; canvas colours redraw on theme change.
- [ ] Shared saves merge and retry; edits during an in-flight save survive; sync status visible.
- [ ] Every fetch has a timeout; independent loops don't wait on each other.
- [ ] Old data and old clients considered; legacy fields still written.
- [ ] Report says what was and wasn't tested.
