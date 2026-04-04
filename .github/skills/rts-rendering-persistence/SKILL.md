---
name: rts-rendering-persistence
description: 'Build rendering, minimap, fog, and save systems for RTS games. Use when implementing backbuffer rendering, procedural sprites, minimap layers, fog-of-war visuals, JSON snapshots, restore pipelines, and browser RTS state persistence.'
argument-hint: 'Describe the rendering, fog, minimap, or save/load system to build'
user-invocable: true
disable-model-invocation: false
---

# RTS Rendering and Persistence

Build the visual and recovery systems that make a browser RTS feel complete: rendering, minimap, fog-of-war, effects, and save/load pipelines.

This skill focuses on practical browser RTS runtime systems rather than general frontend styling.

## When to Use

- Adding a render pipeline to a browser RTS
- Designing minimap and fog-of-war layers
- Using a hidden backbuffer for crisp scaling
- Building procedural or runtime-generated sprite atlases
- Implementing save/load or export/import of RTS state
- Designing restore pipelines that rebuild derived caches safely

## Avoid Using This Skill For

- Pure engine-driven rendering pipelines where the browser DOM is not central
- Backend persistence services or cloud sync
- Large-asset streaming or content pipelines outside the RTS runtime

## Core Principles

- Keep authoritative game state separate from rendered output
- Precompute visual assets and static layers when possible
- Render derived visuals from state instead of treating visuals as truth
- Snapshot authoritative state only, then rebuild caches after load
- Keep fog, minimap, and world rendering conceptually separate

## Render Pipeline

### Use a Backbuffer Intentionally

For a browser RTS, a strong pattern is:

1. render the world into an offscreen or hidden buffer
2. scale that buffer into the visible viewport
3. keep image smoothing rules explicit

Benefits:

- predictable retro or crisp style
- lower per-frame cost than arbitrary full-resolution rendering
- simpler minimap and effect compositing
- stable world-space to screen-space reasoning

### Separate Render Layers

Useful world render layers include:

- terrain
- resources
- buildings
- units
- overlays such as rally, capture, attack markers
- projectiles and effects
- fog
- placement ghosts and temporary UI guides

Keep the ordering stable and explicit.

### Procedural Sprite and Atlas Strategy

If you are not using a large art pipeline, precompute sprites at startup.

Good candidates:

- unit atlases by direction and frame
- team-colored unit and building variants
- resource icons
- simple effect markers

Measure or derive useful bounds from the rendered result and reuse them across selection, hit-testing, and visual centering.

## Minimap and Fog

### Use Dedicated Minimap Layers

Do not redraw everything from scratch if you do not need to.

Helpful minimap layer split:

- static terrain layer
- dynamic unit/building blips
- fog overlay layer
- alerts or ping overlays

Static terrain and some fog assets can be rebuilt only when the world or visibility changes materially.

### Fog-of-War Model

Separate at least two concepts:

- explored fog
- currently visible fog

This supports:

- remembered enemy positions
- AI memory driven by visibility
- stronger minimap readability
- recon tools such as scans and drones

When fog is refreshed, ensure related systems also update as needed:

- enemy memory
- minimap fog layer
- UI state derived from visibility

## Effects and Feedback

Small temporary effect systems make RTS combat readable.

Typical effect categories:

- projectile impacts
- heal/service pulses
- capture channel indicators
- minimap alerts
- toasts for major AI or tech events

Keep effects lightweight, short-lived, and state-driven.

## HUD Refresh Strategy

HUDs sit between rendering and application state, but they should not be treated like per-frame canvas output.

### Do Not Rebuild Command DOM Repeatedly

If your RTS uses DOM buttons for actions, touch modes, production queues, or cooldown abilities, prefer persistent elements updated in place.

Good practice:

- create HUD buttons once at startup
- mutate text, progress, active state, disabled state, and handlers in place
- hide unused controls instead of tearing the whole panel down
- update from explicit state transitions rather than from every render pass

This reduces paint churn and prevents visible button flicker in busy RTS HUDs.

### Separate Fast and Slow UI Refresh Paths

Some UI state changes every frame, and some only changes on events.

Examples:

- fast path: canvas world rendering, camera transforms, lightweight screen-space overlays
- slow path: selection card content, action button assignment, menu population, touch-mode availability

When using DOM HUDs, keep these paths separate so the command surface is not rebuilt at render frequency.

## Persistence Model

### Snapshot Authoritative State Only

Persist the real state of the simulation, for example:

- units and buildings
- resources
- team economy and research
- orders and timers
- AI memory and strategic state
- fog exploration state
- camera and UI mode if useful

If UI mode is saved, restore it carefully:

- validate it against the current game version
- normalize deprecated or removed modes to a safe default
- refresh the HUD after restore so buttons, labels, and hotkeys are rebound to live runtime objects

Do not persist purely derived caches if they can be rebuilt.

Examples of derived state to rebuild after restore:

- spatial buckets
- dynamic blocked grids
- team bonuses derived from structures or research
- minimap terrain or fog buffers
- selected-entity derived summaries

### Version Save Data Explicitly

Give saves a schema or version number.

On restore:

- reject incompatible versions deliberately
- migrate old values where practical
- normalize data if balancing constants changed

This matters more than it first appears in long-lived browser game projects.

### Export and Import as First-Class Tools

Browser RTS games benefit from JSON export/import even when autosave exists.

Use export/import for:

- debugging state corruption
- preserving sandbox scenarios
- migrating saves across devices manually
- testing restore behavior repeatedly

## Restore Pipeline

After loading a snapshot, run a deliberate rebuild pipeline.

Recommended steps:

1. restore core entities and teams
2. restore orders, timers, and persistent UI state
3. rebuild occupancy and blocked-cell data
4. rebuild research-derived team bonuses
5. rebuild fog and visibility caches
6. rebuild spatial indices
7. refresh selection and HUD state, including rebinding persistent DOM controls
8. validate camera and viewport state

Do not assume the restored state is immediately ready just because the JSON parsed successfully.

## Debugging Checklist

- Verify render layers draw in the intended order
- Verify minimap terrain does not needlessly redraw every frame
- Verify fog-visible and fog-explored behavior match design intent
- Verify sprite bounds and hit geometry stay aligned after art changes
- Verify save/load preserves orders, timers, AI phase, and memory where intended
- Verify restore rebuilds all derived caches instead of reusing stale transient state
- Verify imported saves fail safely on version mismatch
- Verify saved HUD or touch modes are normalized if the command surface changed between versions
- Verify persistent HUD controls do not keep stale handlers after restore or deselection

## Example Prompts

- `/rts-rendering-persistence Add a backbuffer-based render pipeline with crisp scaling to my browser RTS.`
- `/rts-rendering-persistence Design minimap terrain, fog, and alert layers for an RTS.`
- `/rts-rendering-persistence Add snapshot save/load with JSON export/import and a safe restore pipeline.`
- `/rts-rendering-persistence Review my RTS rendering and persistence systems for hidden performance costs and restore bugs.`

## Good Companion Skills

- `rts-games` for overall runtime and command architecture
- `rts-pathfinding` for movement and occupancy rebuilding after restore
- `rts-ai-doctrine` for visibility-driven memory and tactical decision-making
