---
name: sidescroller-spa-game-dev
description: Build polished single-file side-scroller SPA games with vanilla JS, SVG/DOM rendering, robust input, camera systems, theming, modal UX, and PWA/mobile compatibility. Use when creating or refining production-quality side-scroller web games.
---

# Side-Scroller SPA Game Development

Build a production-quality side-scroller game as a single HTML SPA using vanilla JavaScript, SVG, and CSS.

This skill captures:
- Practical architecture and interaction patterns proven in `rivercrossing.html`
- IdleGames repo conventions (single-file pages, PWA integration, parental gating)
- Reusable Copilot skill-writing practices for reliable, high-signal agent output

## Skill Scope and Triggering (Copilot Authoring Best Practices)

Use this skill when tasks involve:
- Side-scrolling camera behavior in a web game
- Multi-input gameplay (keyboard, touch, pointer)
- Single-page game UI with modals/HUD/stats
- Theme systems (light/dark/system) and responsive layouts
- PWA readiness and mobile install behavior

Avoid using this skill for:
- Backend services, multiplayer networking, or server authoritative simulation
- Framework-heavy app architectures (React/Vue game shell)
- 3D engine workflows that do not use vanilla HTML/CSS/JS patterns

High-quality Copilot skills should be:
- **Specific**: clear domain, clear trigger conditions, clear non-goals
- **Operational**: concrete implementation steps, not only theory
- **Reusable**: patterns and checklists that transfer across games
- **Verifiable**: explicit build/run/test checks and failure diagnostics
- **Maintainable**: update examples and constraints when repo conventions evolve

## Repository-Compatible Architecture

### Single-File Game Structure

For IdleGames pages, keep games self-contained in one HTML file:
- `<head>`: metadata, manifest link, icon links, theme color, page title
- `<style>`: page-level design tokens and responsive rules
- `<body>`: header + stats + viewport + touch controls + modals
- `<script type="module">`: constants, state, loop, rendering, input, UI logic
- Tail scripts: `parental.js` always; `assets/js/pwa.js` when offline/install support is needed

### Suggested File Skeleton

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <link rel="manifest" href="manifest.webmanifest">
  <script src="assets/js/pwa.js" defer></script>
  <style>/* tokens + layout + controls + modals */</style>
</head>
<body>
  <header><!-- title + buttons --></header>
  <div class="stats"><!-- moves/time/etc --></div>
  <div class="game-viewport"><svg id="gameCanvas"></svg></div>
  <div class="bottom-controls"><!-- touch controls --></div>
  <div class="modal" id="helpModal"></div>
  <div class="modal" id="winModal"></div>
  <div class="modal" id="failModal"></div>
  <script type="module">/* game runtime */</script>
  <script src="parental.js" defer></script>
</body>
</html>
```

## World Model and Constants

Define a clear world-space coordinate system and derive all geometry from constants:
- Character scale baseline (`CHARACTER_HEIGHT`)
- Playfield dimensions (`W`, `H`)
- Landscape segmentation (shore/river/path/tree lines)
- Entity anchors (boat docking points, center lines, offsets)

Use derived values aggressively to reduce drift:

```javascript
const CHARACTER_HEIGHT = 56;
const H = CHARACTER_HEIGHT * 4;
const BASE_RIVER_WIDTH = 120;
const RIVER_WIDTH = BASE_RIVER_WIDTH * 4;
const RIVER_LEFT = 100;
const RIVER_RIGHT = RIVER_LEFT + RIVER_WIDTH;
const W = RIVER_RIGHT + 100;
```

## State Design for Deterministic Gameplay

Use one `state` object + one `freshState()` initializer.

State should include:
- Core entities (player, NPC/items, vehicle/platform)
- Side/zone ownership (`left`/`right`/`null` or equivalent)
- Movement and animation counters
- Rule-critical fields (carrying, slot occupancy, attachment/locks)
- Session stats (moves, elapsed, crossings)
- Terminal flags (`gameOver`, `won`)

Pattern:

```javascript
function freshState() {
  return {
    player: { x: 0, y: 0, onVehicle: false, carrying: null },
    vehicle: { x: 0, side: 'left', facing: 1, motionDir: 0 },
    moves: 0,
    elapsed: 0,
    gameOver: false,
    won: false,
  };
}
```

## Input Architecture (Keyboard + Touch + Pointer)

### 1) Unified Key-State Map

Keep continuous movement as key-state booleans and edge-trigger interactions as one-frame latches.

```javascript
const keys = { w:false, a:false, s:false, d:false, e:false };
let eJustPressed = false;
```

### 2) Alternate Bindings

Mirror gameplay actions across:
- `WASD`
- Arrow keys
- `E` and `Enter` for interact
- On-screen buttons for mobile

### 3) Stage Pointer Controls for Accessibility

For one-finger play on mobile and pointer play on desktop:
- Press left/right of player to hold movement
- Press on player to trigger action
- Latch pointer mode until release for stable behavior

Result View mode exception:
- Determine left/right pan intent relative to **viewport center**, not player position
- Re-evaluate direction during pointer drag so crossing center flips pan direction immediately

Reference implementation:

```javascript
svg.addEventListener('pointermove', (ev) => {
  if (stagePointerId !== ev.pointerId) return;
  ev.preventDefault();

  if (state.gameOver && resultViewMode) {
    const world = clientToWorld(ev.clientX, ev.clientY);
    const viewportCenterX = camera.x + camera.viewW * 0.5;
    stagePointerMode = world.x < viewportCenterX ? 'left' : 'right';
  }

  applyStagePointerMode();
});
```

### 4) Prevent Browser Gesture Interference

Use:
- `touch-action: none` on gameplay surfaces
- `contextmenu` suppression on stage/viewport/control bar
- Explicit pointer capture where available

## Camera and SVG Viewport System

### Side-Scroller Camera Follow

Use camera state with dynamic `viewBox`:

```javascript
const camera = { x: 0, y: 0, viewW: W, viewH: H };

function updateCameraFollow(targetX) {
  const maxCamX = Math.max(0, W - camera.viewW);
  camera.x = Math.max(0, Math.min(maxCamX, targetX - camera.viewW * 0.5));
  camera.y = 0;
}
```

### Pointer Mapping with Dynamic `preserveAspectRatio` (Critical)

When camera/viewport alignment can switch (`xMin` / `xMid` / `xMax`) or aspect changes frequently, **prefer CTM-based conversion** instead of hand-computing offsets.

```javascript
function clientToWorld(clientX, clientY, svg, camera) {
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    return {
      x: camera.x + camera.viewW * 0.5,
      y: camera.y + camera.viewH * 0.5,
    };
  }

  const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: pt.x, y: pt.y };
}
```

Why this matters:
- Avoids left/right touch inversion bugs on landscape devices
- Works regardless of `preserveAspectRatio` mode
- Eliminates fragile assumptions about letterbox offsets

If CTM is unavailable in a target browser context, use manual letterbox math only as a fallback.

### Exact Camera Edge/Center Switching (No Guess Thresholds)

Do not switch camera mode based on arbitrary pixel tolerance. Compute it from the same clamp math used by follow:

```javascript
const maxCamX = Math.max(0, W - camera.viewW);
const desiredX = targetX - camera.viewW * 0.5;

if (desiredX <= 0) {
  camera.x = 0;
  cameraMode = 'left';
} else if (desiredX >= maxCamX) {
  camera.x = maxCamX;
  cameraMode = 'right';
} else {
  camera.x = desiredX;
  cameraMode = 'center';
}
```

Then map mode to SVG alignment deterministically:
- `left` → `xMinYMid meet`
- `center` → `xMidYMid meet`
- `right` → `xMaxYMid meet`

This keeps transitions correct at both world start and world end for any viewport size.

## Game Loop and Simulation Stability

Use fixed timestep simulation with render decoupling:

```javascript
const FIXED_FPS = 20;
const FIXED_DT = 1 / FIXED_FPS;
let accumulator = 0;

function gameLoop(ts) {
  const dt = computeFrameDt(ts);
  accumulator += dt;
  while (accumulator >= FIXED_DT) {
    stepSimulation(FIXED_DT);
    accumulator -= FIXED_DT;
  }
  render();
  requestAnimationFrame(gameLoop);
}
```

Benefits:
- Consistent rule outcomes across devices
- Predictable movement and collisions
- Fewer frame-rate-dependent bugs

## Interaction and Rule Integrity

Implement interactions as explicit state machine guards:
- Vehicle-only interactions separated from shore interactions
- “Cannot steer while carrying” constraints
- Single cargo slot enforcement
- Explicit attach/detach states
- Pickup by nearest center distance, not list order

Pattern:

```javascript
if (onVehicle) {
  if (nearHelm && carrying) deny();
  if (nearCargo && carrying && cargoOccupied) deny();
  if (nearCargo && carrying && !cargoOccupied) placeCargo();
  if (nearCargo && !carrying && cargoOccupied) pickCargo();
}
```

Run fail/win checks after state-changing interactions (especially drop events) according to puzzle rules.

## Transition Quality: No Position Snaps

Board/disembark transitions should preserve horizontal continuity wherever possible:
- Avoid forced `x` teleport on boat enter/exit
- Allow only necessary vertical alignment to deck/path baseline
- Keep movement feeling physically continuous

## Rendering Pipeline and Layering

Use two-phase rendering:
- Static world pass (`drawScenery`) for sky/water/terrain/foliage
- Dynamic pass (`dynamicGroup`) for entities and frame-animated artifacts

Layer order matters:
1. Sky/background
2. Terrain/water
3. Ripples/effects
4. Vehicle/entities
5. HUD/hints/modals (HTML overlay)

Theme-dependent scene palettes should be centralized in `getScenePalette()`.

## Modal UX and Result View Mode

For game-over states, provide:
- Primary modal actions (`Play Again`, `Try Again`, share)
- A `View` action to close modal but keep result state active
- Reopen behavior on explicit interaction while in result-view mode
- View-mode panning semantics tied to camera viewport center for intuitive off-screen navigation

This allows players to inspect the final scene without losing context.

## Theme System: System/Light/Dark

Use tri-state mode with persistence:
- `system` follows `prefers-color-scheme`
- `light` and `dark` force explicit mode
- Persist mode in `localStorage`
- Repaint world on theme changes

Pattern:

```javascript
const mode = localStorage.getItem('theme-mode') ?? 'system';
const resolved = mode === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
document.documentElement.setAttribute('data-theme', resolved);
```

## Mobile, PWA, and Installability

Include modern install metadata:
- `manifest.webmanifest`
- `mobile-web-app-capable`
- Apple web app meta tags
- `apple-touch-icon`

For IdleGames, remember:
- `assets/js/pwa.js` handles SW registration/version flow
- Service worker URL normalization for trailing-slash launches is critical and must not be broken

## Performance Practices for This Pattern

- Keep per-frame DOM writes minimal (batch or update only on value changes)
- Rebuild static scenery only when needed (e.g., theme switch/new game)
- Avoid allocating excessive objects inside tight loops
- Clamp frame delta (`dt`) to avoid recovery spikes

## Verification Workflow (IdleGames)

After meaningful edits:
1. Check diagnostics for edited files
2. Run `npm run build`
3. If service worker or PWA behavior changed, run `npm run serve` and verify trailing-slash launch + offline behavior

For input/camera changes, validate manually:
- Desktop keyboard + mouse
- Mobile/touch controls
- Pointer mapping at different viewport aspect ratios
- Boarding/disembark transitions
- Game-over modal reopen flows

## Common Failure Modes and Fixes

### Pointer feels offset from visuals
- Cause: ignoring SVG rendered-letterbox offsets
- Fix: convert client coordinates using rendered viewport offset and scale

### View mode pans wrong direction
- Cause: comparing stage click against player world position while player is off-screen
- Fix: compare pointer world X against `camera.x + camera.viewW * 0.5` and update this continuously during drag

### Runtime error from early variable use
- Cause: event handlers referencing stage/camera before initialization
- Fix: initialize core references before binding handlers

### Unexpected repeat interactions after reset
- Cause: stale key states/latches
- Fix: clear all key flags and one-shot latches in `startNewGame()`

### Boat/platform control feels janky
- Cause: mixed attachment states and movement commands
- Fix: strict attach/detach state transitions and command gating

## Implementation Playbook for Copilot

When asked to build or upgrade a side-scroller SPA game, execute in this order:
1. Define constants and derived world geometry
2. Implement `freshState()` with all gameplay invariants
3. Build input layer (keyboard, touch, pointer) with latches
4. Implement fixed timestep loop and simulation update functions
5. Implement camera + responsive viewport fitting
6. Render static scenery, then dynamic entities
7. Add interactions and rule checks
8. Add HUD/stats/modals and result-view behavior
9. Add tri-state theme with persistence + repaint
10. Add PWA/mobile metadata and repository-required scripts
11. Validate with diagnostics + build + manual control checks

## Definition of Done

A task using this skill is complete when:
- Gameplay rules are deterministic and exploit-resistant
- Controls work equivalently across keyboard/touch/pointer
- Camera behavior is stable and intuitive across aspect ratios
- Modals, share/view/retry flows are coherent
- Theme switching works for system/light/dark and persists
- Build succeeds and no new diagnostics errors are introduced
- Page remains consistent with IdleGames conventions
