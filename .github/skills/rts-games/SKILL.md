---
name: rts-games
description: 'Build real-time strategy games as single-page HTML, CSS, and JavaScript apps. Use when creating or refining RTS mechanics, data-driven units and buildings, command routing, combat orders, capture and service systems, air units, fog of war, AI factions, HUDs, and browser-based RTS game loops.'
argument-hint: 'Describe the RTS system, feature, or gameplay slice to build'
user-invocable: true
disable-model-invocation: false
---

# RTS Games

Build robust real-time strategy games for the browser using vanilla HTML, CSS, and JavaScript.

This skill is for RTS work where the game lives primarily in one page and one runtime, with direct ownership of simulation, rendering, input, UI, and AI. It emphasizes patterns that transfer across many RTS designs rather than one specific title.

## When to Use

- Creating a new browser RTS from scratch
- Adding RTS features such as unit orders, buildings, capture, fog, rally points, or factions
- Designing data-driven unit and structure systems
- Implementing special unit classes such as aircraft, healers, scouts, harvesters, or transports
- Refining command semantics for context, move, attack, gather, repair, or capture flows
- Debugging selection, hit-testing, pathing, or AI behavior in a browser RTS
- Building a self-contained offline-capable RTS page with minimal dependencies

## Avoid Using This Skill For

- Turn-based tactics or card battlers without continuous simulation
- Server-authoritative multiplayer architecture
- Engine-specific Unity, Unreal, Godot, or ECS-only workflows
- Framework-heavy app shells where the RTS runtime is not primarily vanilla JS

## Core Design Goals

- Keep gameplay rules explicit and inspectable
- Use data tables for units, buildings, upgrades, and actions
- Separate simulation decisions from input interpretation
- Treat command semantics as game design, not just UI plumbing
- Make geometry and hit-testing intentional and mode-specific
- Validate changes through playtest-driven iteration, not only static code review

## Recommended File and Runtime Shape

For single-page RTS games, prefer a self-contained structure:

- `<head>`: metadata, manifest, icons, theme color, responsive viewport
- `<style>`: design tokens, HUD layout, responsive rules, touch affordances
- `<canvas>` or `<svg>` viewport plus HUD panels and modal overlays
- `<script type="module">`: constants, state, systems, simulation loop, rendering, input, AI
- Tail scripts for app-wide integrations such as parental controls or PWA helpers when needed

Suggested runtime sections inside the script:

1. Constants and data tables
2. State initialization and reset helpers
3. Geometry and hit-testing helpers
4. Input and command routing
5. Order issuance helpers
6. Per-unit and per-building update systems
7. AI and autonomy systems
8. Rendering and HUD updates
9. Save/load and offline integration if needed

## HUD and Controls

### Treat HUD Buttons as Persistent UI, Not Render Output

Action panels, touch strips, and selection HUD controls should usually be created once and updated in place.

Do not rebuild command buttons every frame or on every lightweight selection refresh if you can avoid it.

Prefer this model:

- create button nodes once at startup
- keep stable slot positions for shortcuts when that helps muscle memory
- update labels, disabled state, active state, progress meters, and handlers in place
- hide unused slots instead of destroying and recreating them
- refresh the panel from explicit events such as selection change, deselection, mode change, queue progress tick, or game restore

This reduces:

- flicker from repeated DOM churn
- accidental focus loss
- hotkey bookkeeping bugs
- unnecessary layout and paint work

### Keep Shortcut Semantics Stable

If your HUD exposes numbered or lettered actions, stable positions matter.

Good examples:

- reserve a destructive action such as `Sell` for a fixed final slot
- keep `Move`, `Context`, or similar core actions in predictable positions when practical
- avoid shifting hotkey meaning every time the selection changes if a stable mapping is possible

If some selections need fewer actions, keep the slots but hide the unused ones so the DOM remains stable while the layout can still collapse cleanly.

### Refresh from State Events, Not from the Render Loop

HUD rebuild triggers should be explicit.

Typical triggers:

- selection changed
- selection cleared
- command mode changed
- pending build, rally, or special ability state changed
- queue or cooldown progress crossed a visible update threshold
- save game restored

Separate high-frequency simulation updates from lower-frequency HUD refreshes where possible.

### Example: Fixed Action Button Slots

```javascript
const ACTION_SLOTS = Array.from({ length: 9 }, (_, index) => ({
  key: 'Alt+' + (index + 1),
  element: null,
  iconEl: null,
  labelEl: null,
  progressEl: null,
  clickHandler: null
}));

function initActionHud(container) {
  for (const slot of ACTION_SLOTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-button is-hidden';
    button.innerHTML = `
      <svg class="button-icon" aria-hidden="true"><use href="#icon-context"></use></svg>
      <span class="button-label"></span>
      <span class="action-progress" hidden><span class="action-progress-fill"></span></span>
    `;
    slot.element = button;
    slot.iconEl = button.querySelector('use');
    slot.labelEl = button.querySelector('.button-label');
    slot.progressEl = button.querySelector('.action-progress-fill');
    button.addEventListener('click', () => {
      if (button.disabled || typeof slot.clickHandler !== 'function') return;
      slot.clickHandler();
    });
    container.appendChild(button);
  }
}

function clearActionHud() {
  for (const slot of ACTION_SLOTS) {
    slot.clickHandler = null;
    slot.element.className = 'action-button is-hidden';
    slot.element.disabled = true;
    slot.element.hidden = true;
    slot.labelEl.textContent = '';
    slot.progressEl.parentElement.hidden = true;
    slot.progressEl.style.width = '0%';
  }
}

function setActionSlot(index, item) {
  const slot = ACTION_SLOTS[index];
  if (!slot) return;
  slot.clickHandler = item.onClick;
  slot.element.hidden = false;
  slot.element.disabled = !!item.disabled;
  slot.element.className = 'action-button'
    + (item.active ? ' is-active' : '')
    + (item.danger ? ' is-danger' : '')
    + (item.disabled ? ' is-disabled' : '');
  slot.iconEl.setAttribute('href', '#icon-' + item.icon);
  slot.labelEl.textContent = item.label;
  if (typeof item.progress === 'number') {
    slot.progressEl.parentElement.hidden = false;
    slot.progressEl.style.width = Math.round(item.progress * 100) + '%';
  }
}

function refreshActionHud(selectionState) {
  clearActionHud();
  const items = buildActionsForSelection(selectionState);
  const sell = items.find((item) => item.id === 'sell');
  const regular = items.filter((item) => item.id !== 'sell');
  regular.forEach((item, index) => setActionSlot(index, item));
  if (sell) setActionSlot(ACTION_SLOTS.length - 1, sell);
}
```

Key point:

- the selection changes, but the button nodes do not

### Keep Touch HUD Minimal

Touch strips should not duplicate every command if the action panel already exposes them clearly.

A good split is:

- touch strip for input posture such as `Select`, `Pan`, and maybe `Move`
- action HUD for command semantics such as `Attack`, `Gather`, `Repair`, `Capture`, `Build`, `Sell`, or cooldown abilities

This keeps the touch HUD small and avoids maintaining two competing command surfaces.

## Architecture Pattern
- HUD refreshes do not recreate large DOM sections unnecessarily
- action hotkeys and fixed button positions remain stable across selection changes

### 1. Define the Command Grammar First

Before writing systems, define what a player can mean by a click or tap:

- Empty ground in `Context`
- Enemy entity in `Context`
- Friendly structure in `Context`
- Explicit `Move`, `Attack`, `Gather`, `Repair`, `Capture`
- Special-case unit classes such as aircraft or support units

Write these as game rules, not implementation details. Example questions:

- Does a fighter ground click mean move, loiter, redirect, or land?
- Does a support unit chase any damaged ally, or only certain classes?
- Does `Context` use broad selection hitboxes or strict command hitboxes?

If these meanings are not explicit, regressions appear as “edge cases” later.

### 2. Build Data-Driven Definitions

Keep unit and building capabilities in data tables:

```javascript
const UNIT_TYPES = {
  scout: { speed: 32, sight: 8, range: 22, infantry: true },
  tank: { speed: 24, sight: 10, range: 40, vehicle: true },
  fighter: { speed: 84, sight: 12, range: 86, flying: true, maxMissiles: 4 }
};

const BUILDING_TYPES = {
  barracks: { size: [4, 3], queue: ['scout', 'engineer'] },
  factory: { size: [4, 3], queue: ['tank', 'ambulance'] },
  airfield: { size: [6, 3], queue: ['fighter'] }
};
```

Prefer flags and explicit fields over hard-coded conditionals scattered across the codebase.

### 3. Model Orders as State Machines

Each unit should have an order object with a small number of clear states:

- `idle`
- `move`
- `attack`
- `attack-move`
- `gather`
- `return`
- `repair`
- `capture`
- `support`
- `service`
- `guard`
- `strike`
- `landing`, `takeoff`, `waypoint`, or other specialized states

For special units, use dedicated orders instead of overloading generic ones. Aircraft especially benefit from explicit runway and mission states.

### 4. Separate Order Issuance from Order Execution

Keep three layers distinct:

- Input interpretation: what the click means
- Order issuance: which order object gets assigned
- Order execution: how that order is updated frame to frame

This keeps command bugs local. For example, if a fighter behaves incorrectly in `Context` mode, fix the interpretation layer first before rewriting flight logic.

### 5. Compose Long Missions Instead of Adding Boolean Flags

When units need multi-step behavior, prefer order composition over piles of flags such as `isReturning`, `isLanding`, `isRearming`, and `isRedirecting`.

Use nested or chained orders instead:

- `takeoff -> strike`
- `strike -> return -> landing`
- `waypoint -> guard`
- `service -> resume previous logistics order`

This allows complex missions without exploding the number of top-level states.

Guideline:

- Use explicit order objects
- Allow `nextOrder` or equivalent continuation fields where needed
- Clone nested orders carefully when redirecting or resuming missions
- Keep phase-like substate inside the order object when the behavior is truly local to that order

This pattern is especially valuable for aircraft, transports, and support units.

### 6. Track Occupancy and Assignment in Separate Layers

RTS games often have several distinct occupancy systems that should not be conflated:

- Grid-cell occupancy for walking and pathing
- Building footprint occupancy for placement
- Transport occupancy for embarked units
- Airfield or hangar occupancy for aircraft
- Claim or reservation systems for units moving toward the same goal

Treat each as a separate subsystem with its own lifecycle rules.

Good practice:

- Release claims before reissuing movement or boarding orders
- Reclaim or settle when the unit reaches a stable resting state
- Use explicit back-references for scarce slots such as hangars or airfields
- Clear assignment references on death, capture, or structure destruction

## Geometry and Hit-Testing

### Use Explicit Geometry Objects

For each building or unit, compute geometry once in a helper and give the fields stable names:

- `footprint`
- `sprite`
- `hit`
- `visualCenter`
- `fire`

Be consistent with rectangle shapes. If a rectangle uses `x/y/right/bottom`, do not later read `left/top` from it.

### Split Selection Hitboxes from Command Hitboxes

This is one of the most important RTS patterns.

Selection and command targeting often need different geometry:

- Broad selection bounds make large art easier to click
- Strict command bounds prevent false positives on nearby empty ground
- Landing zones or interaction zones may need yet another shape

Use separate helpers when semantics differ:

- `getSelectionTargetAtWorldPoint(...)`
- `getCommandTargetAtWorldPoint(...)`
- `getLandingTargetAtWorldPoint(...)`

Do not share one oversized hitbox for every interaction type.

### Score Competing Overlaps Instead of Returning First Match

When multiple large objects overlap or nearly overlap, do not return the first match from an array. Score candidates using distance to footprint or visual center and choose the best match.

### Derive Bounds Instead of Guessing Them

If sprites are generated procedurally or drawn into canvases, derive tight visual bounds from the rendered result instead of hard-coding hit extents by hand.

This improves:

- selection feel
- damage registration
- visual centering
- future maintainability when sprite art changes

Even when exact alpha-derived bounds are too expensive to compute every frame, they can often be measured once at startup and reused thereafter.

### Audit Rectangle Shapes Aggressively

One of the easiest ways to create serious selection and command bugs is to mix rectangle conventions.

Examples of incompatible shapes:

- `x/y/width/height`
- `x/y/right/bottom`
- `left/top/right/bottom`

Choose a small number of standard rectangle shapes and keep helper contracts explicit. If you must use more than one shape, convert between them in named helpers instead of reading mixed field names ad hoc.

## World and Simulation Model

### Grid + World Coordinates

For RTS games, it is often useful to keep both:

- Cell space for placement, pathing, occupancy, and fog
- World space for movement, combat, rendering, and input

Use helpers to convert between the two and keep that conversion centralized.

### Fixed-Step Simulation

Prefer a fixed simulation step with decoupled render timing. This keeps AI, combat cooldowns, pathing, and capture timers stable under fluctuating frame rates.

### One Shared State Tree

Keep a single authoritative runtime state object containing:

- Teams and resources
- Units and buildings
- Fog and memory
- Camera and HUD state
- Effects and projectiles
- Pending actions and input modes

Use initializer functions like `freshState()` and entity spawn helpers to avoid drift between created objects.

### Spatial Indexing Beats Repeated Full Scans

Once your RTS has more than a small handful of units and buildings, repeated whole-array scans become a hidden performance tax.

Use spatial buckets, uniform grids, or another simple partitioning strategy so these queries operate on nearby candidates only:

- enemies in weapon range
- nearby allies for support healing
- nearby buildings for selection or capture
- local threat estimates for AI

Design the query API around intent, not storage details:

- `forEachNearbyUnit(...)`
- `forEachNearbyBuilding(...)`
- `findEnemyInRange(...)`

This keeps gameplay systems readable while still scaling.

### Prefer Aggregation Passes for AI and HUD Logic

If many systems need the same summary facts, compute them once and pass them around.

Examples:

- counts of each unit and building type
- current strategic resource totals
- high-level threat estimates
- derived team capabilities from completed research

Aggregation passes make AI reasoning easier to debug and reduce repeated filtering work.

## Command Routing Workflow

Use this procedure whenever you add a new commandable behavior.

1. Define what the action means in `Context`, explicit mode, keyboard, and touch workflows.
2. Decide whether the action is ground-targeted, unit-targeted, building-targeted, or area-targeted.
3. Add or refine the issuance helper, not only the update loop.
4. Add the execution logic as a dedicated order handler.
5. Update help text, HUD labels, and action descriptions.
6. Playtest the ambiguous cases: empty ground, enemy building, friendly building, overlapping large sprites, and repeated re-issues.

Branching logic examples:

- If the click is on a friendly service building, a damaged support-compatible unit should service instead of moving.
- If the click is on open ground and the unit is a fighter, that may mean guard or redirect instead of simple move.
- If the click is on an enemy and the unit is a healer, it should probably ignore the hostile command entirely.

Also test these subtle command-routing cases:

- broad selection hitboxes versus strict command hitboxes
- explicit hostile-building modes versus open-ground context mode
- support-service clicks that should override movement
- landed aircraft receiving context commands near enemy structures
- overlapping building, resource, and runway interaction zones

## Aircraft Patterns

Aircraft in RTS games usually need dedicated logic and should not be treated like fast tanks.

### Recommended Aircraft States

- `landed`
- `takeoff`
- `guard`
- `waypoint`
- `strike`
- `return`
- `landing`

### Recommended Aircraft Mission Design

- Ground click can mean patrol or loiter rather than literal hover
- Direct attack can mean target-locked repeated passes
- Opportunistic loiter attack can mean free retargeting within a radius
- Exhausted aircraft should return for service and optionally relaunch to a queued mission

### Key Decision Split

Differentiate these two mission types explicitly:

- Direct strike: stay on the chosen target until the mission ends
- Loiter/guard combat: reevaluate better targets while operating near a patrol center

### Flight Control Principles

- Use turn-limited steering, not instant heading snaps
- Use different turn behavior for outbound and inbound attack runs when needed
- Preserve run state between frames for repeat passes
- Use runway geometry explicitly for takeoff and landing
- Treat selection, landing, and attack targeting as different geometry problems

### Separate Locked Attack Runs from Opportunistic Combat Loiter

Aircraft often need two distinct attack behaviors:

- locked direct strike: stay on the designated target, make repeat passes, ignore incidental opportunities
- opportunistic loiter engagement: reevaluate nearby targets while operating around a center point

Do not reuse the same target-selection logic for both. A direct strike should feel disciplined; a loiter patrol should feel adaptive.

### Use Repeat-Pass State for Aircraft Attacks

For repeated aircraft attacks, a useful pattern is:

1. inbound run
2. fire if within range and cone
3. outbound extension
4. reacquire a stable run bearing
5. begin the next inbound pass

Store run-local state such as:

- pass phase
- attack side
- run bearing
- stand-off distance

Without stable per-pass state, aircraft often devolve into indefinite circular orbiting.

## Support, Service, Capture, and Logistics

### Support Units

Split “can heal nearby” from “should chase as a support target.”

Example:

- Ambulance aura may heal nearby aircraft or drones
- Ambulance chase logic may deliberately ignore them

This avoids coupling proximity healing to pursuit behavior.

### Service Buildings

Support compatibility should be explicit:

- Infantry to barracks
- Vehicles to factory
- Drones or aircraft to airfield if the design calls for it

Service should be a real order with:

- eligibility checks
- move-to-service behavior
- timed or pulsed repair
- resume order logic when appropriate

For support units, logistics units, and aircraft, service should also answer these design questions explicitly:

- who may use which building type
- who may receive passive nearby healing versus active chase-based support
- what should happen after service completes
- whether service clears, preserves, or resumes the previous mission

### Capture Rules

Capture should be capability-based, not structure-name special-casing. If a building is hostile and the capturing unit has the required tech and role, it should generally be capturable unless the design explicitly forbids it.

When capture bugs occur, inspect both layers separately:

- capture eligibility rules
- command targeting and hit-testing for the target building

## AI Workflow

RTS AI benefits from layered decision-making rather than a single monolithic planner.

### Recommended Layers

1. Economy: workers, production, expansion, tech
2. Strategic phase: normal, siege, oil race, defensive recovery, and similar modes
3. Tactical assignment: scouts, support units, strike units, aircraft
4. Memory and reconnaissance: visible enemies, stale knowledge, priority objectives

### AI Fighter Doctrine Pattern

Give AI air units explicit doctrine:

- Direct strike when a current visible target is worth committing to
- Loiter/guard over a strategic objective when scouting, denying, or waiting for contact
- Relaunch from airfields by assigning missions through the same queueing path as the player

Avoid issuing raw movement to aircraft if the design intent is patrol or attack.

### AI Needs Memory, Not Omniscience

For better-feeling RTS AI, maintain remembered enemy information rather than reading the whole game state directly.

A good memory model stores:

- type and id
- last known position
- last seen time
- rough health if known
- whether the memory is still trustworthy

Then add memory reconciliation rules:

- update memory when an enemy is visible
- remove or decay memory when re-visibility disproves it
- reduce trust in stale objectives over time

This makes recon, scanners, drones, and scouting systems tactically meaningful.

### Score Objectives Instead of Hardcoding One AI Goal

For expansion, harassment, recon, or resource races, score objectives rather than using a single static script.

Typical factors:

- current strategic phase
- distance from friendly hubs
- last seen recency
- threat score nearby
- whether the objective is already owned or contested

This helps AI shift naturally between economy, denial, recon, and attack play.

## Rendering and Asset Strategy

### Decouple Simulation Resolution from Display Resolution

A strong browser RTS pattern is to render into a fixed or bounded backbuffer, then scale that output to the display.

Benefits:

- stable retro aesthetic
- predictable HUD composition
- lower rendering cost
- easier sprite and minimap management

If you use a pixel-art style, keep the simulation and UI crisp by controlling the render surface explicitly rather than drawing at arbitrary device resolution.

### Precompute What You Can

Good candidates for startup-time precomputation include:

- recolored sprite atlases by team
- derived sprite bounds
- static minimap terrain layers
- static fog masks or terrain overlays

Avoid recomputing expensive visual data every frame when it only changes on reset, resize, or visibility refresh.

## Persistence and Recovery

### Snapshot Full State, Then Rebuild Derived Caches

For RTS save systems, snapshot authoritative state only, then recompute all derived caches on restore.

Authoritative examples:

- units, buildings, resources, teams
- orders, timers, research, economy, AI memory
- camera, fog exploration, key mission state

Derived examples to rebuild after restore:

- pathfinding blockers
- spatial buckets
- fog visibility caches
- selected entity summaries
- sprite-dependent geometry caches if needed

This is more resilient than persisting transient caches directly.

### Version Save Data Explicitly

Give snapshots a version and handle mismatches deliberately.

When constants change between builds, consider upgrade logic instead of silent failure. For example, resource multipliers or production timings may need normalization during restore.

## Input Unification

### Translate All Inputs into Shared Commands

Mouse, keyboard, and touch should converge into the same command helpers whenever possible.

Prefer this layering:

- raw input events set drag mode, cursor state, or intent
- input layer resolves world coordinates and mode semantics
- shared helpers issue select, move, attack, gather, capture, or rally commands

This prevents three separate implementations of the same gameplay rule.

### Use Drag Modes Instead of Input-Type Special Cases

For browser RTS games that support touch and mouse together, assign meaning to the drag interaction itself:

- selection drag
- pan drag
- command drag

Then let pointer type and HUD mode decide which drag mode is active. This is generally more robust than branching deeply on mouse versus touch inside core gameplay logic.

## HUD and UX

Keep command meaning visible to the player.

Update these whenever behaviors change:

- Order summary label
- Order status text
- Selection help text
- Context-mode help copy
- Error toasts for invalid actions

If a behavior is subtle, it must be legible in the HUD. Otherwise players will interpret consistent rules as bugs.

## Debugging and Iteration Workflow

When a gameplay bug appears, use this workflow.

1. Reproduce with one precise interaction sequence.
2. Identify which layer is wrong:
   - targeting geometry
   - command interpretation
   - order issuance
   - order update logic
   - AI reassignment
3. Read the smallest seam that explains the bug.
4. Fix the root rule, not only the visible symptom.
5. Revalidate adjacent cases that share the same helper.
6. Run diagnostics and build.
7. Playtest the changed behavior and at least one nearby edge case.

Typical examples:

- Broad selection helpers causing wrong command targets
- Shared hitboxes used for both selection and landing
- State machines missing a resume-order edge case
- Aircraft retargeting logic incorrectly reused between direct attack and loiter attack
- Rectangle shape mismatches like `x/y` versus `left/top`
- stale AI memory continuing to drive tactics after vision changed
- passive healing logic incorrectly coupled to support-target chasing
- transport, hangar, or service occupancy becoming desynchronized on death or capture

## Completion Criteria

A feature is not done just because it compiles. Consider it complete when:

- The command meaning is consistent in `Context` and explicit modes
- HUD/help text reflects the real behavior
- The unit state machine reaches valid end states without loops or dead states
- Nearby edge cases were tested, not only the happy path
- AI behavior uses the same core systems where possible
- Build and diagnostics pass

## Verification Checklist

- Verify selection on units, buildings, and overlapping large art
- Verify context command behavior on empty ground, enemy targets, and friendly support structures
- Verify special units with bespoke semantics such as aircraft, scouts, and support vehicles
- Verify direct orders and autonomous behaviors do not interfere with each other unexpectedly
- Verify target prioritization matches the intended design order
- Verify service, capture, and rally systems still work after geometry or command changes
- Verify air and transport occupancy is cleaned up after destruction, capture, or reassignment
- Verify save/restore rebuilds derived state correctly instead of persisting stale caches
- Verify AI objectives and memory decay still behave plausibly after strategic changes
- Run `npm run build` or the project’s equivalent build step

## Example Prompts

- `/rts-games Create a single-file browser RTS with harvesters, scouts, tanks, fog of war, and a minimal AI opponent.`
- `/rts-games Add aircraft with takeoff, landing, loiter, strike, and return-to-airfield behavior.`
- `/rts-games Design a context-command system for an RTS where fighters, harvesters, scouts, and ambulances all interpret clicks differently.`
- `/rts-games Refactor my RTS hit-testing so selection, attack targeting, landing zones, and capture targeting use separate helpers.`
- `/rts-games Add AI doctrine for air units that can loiter over objectives or commit to direct strikes.`
- `/rts-games Review this RTS unit-order system for edge cases, regressions, and missing HUD feedback.`
- `/rts-games Add save/load support to a browser RTS and design the restore pipeline so derived state is rebuilt safely.`
- `/rts-games Design a support and logistics layer with ambulances, transports, service buildings, and occupancy rules.`
- `/rts-games Add RTS spatial indexing for nearby-unit queries, threat scans, healing, and target acquisition.`

## Weak Spots to Clarify in a Future Revision

This first version is strong on single-page browser RTS architecture, aircraft, command routing, and playtest-driven debugging. The main areas that could be sharpened further are:

- whether you want a stronger focus on canvas rendering versus SVG or DOM rendering
- whether you want explicit pathfinding and formation patterns documented in more depth
- whether you want a separate companion reference for AI doctrine, economy loops, and faction scripting
- whether you want persistence and restore strategies split into a separate browser-game save systems skill

If you want, the next revision can specialize this skill toward one of those directions without making it title-specific.