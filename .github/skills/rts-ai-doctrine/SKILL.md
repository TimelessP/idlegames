---
name: rts-ai-doctrine
description: 'Design layered AI for real-time strategy games. Use when building RTS economy phases, scouting, enemy memory, tactical assignments, air doctrine, objective scoring, and non-cheating browser RTS opponents.'
argument-hint: 'Describe the AI layer, doctrine, or faction behavior to build'
user-invocable: true
disable-model-invocation: false
---

# RTS AI Doctrine

Build RTS AI that feels deliberate rather than omniscient, reactive, or randomly scripted.

This skill focuses on layered AI for browser RTS games, especially single-page HTML/CSS/JS implementations where the same runtime owns simulation, economy, scouting, memory, and tactical orders.

## When to Use

- Creating AI factions for an RTS
- Designing economy, production, and expansion logic
- Adding scouting, recon, and memory-based target selection
- Assigning tactical roles to scouts, tanks, support units, and aircraft
- Building phase-driven AI behavior such as normal play, siege, or resource-race modes
- Making AI use the same unit command systems as the player instead of cheating

## Avoid Using This Skill For

- Server-authoritative PvP matchmaking AI
- ML-based opponent training systems
- Deterministic puzzle scripting without economy or tactical layers
- Simple wave spawners that do not make strategic decisions

## Core Principles

- Separate economy, strategy, and tactics into distinct layers
- Let AI reason from memory and visibility, not perfect information
- Score objectives instead of hardcoding a single script
- Reuse the same order issuance helpers that player units use
- Prefer plausible, explainable behavior over maximum efficiency

## Layered RTS AI Model

### 1. Economy Layer

This layer decides:

- what to build next
- what to produce next
- when to expand
- when to research
- when to stabilize income versus when to push military

Good economy AI usually depends on summary counts rather than raw scans each time.

Track and reason about:

- current resource stockpile and storage capacity
- counts by unit and building type
- unlocked tech and prerequisites
- shortages such as no refinery, no scouts, no engineers, or no anti-air

### 2. Strategic Phase Layer

Add explicit high-level phases, for example:

- `normal`
- `defensive-recovery`
- `resource-race`
- `siege`
- `expansion`

Phases should be triggered by measurable state:

- remaining map resources
- current income pressure
- base losses
- known enemy tech or threat concentration
- whether map control is slipping

This makes AI easier to tune and debug than one giant decision tree.

### 3. Tactical Assignment Layer

This layer assigns unit roles based on the current strategic phase and visible opportunities.

Examples:

- scouts to recon unexplored or stale areas
- engineers to structure placement or repair
- support vehicles to damaged allied clusters
- strike aircraft to visible high-value targets
- loiter aircraft to contested objectives or threat corridors

Keep tactical assignment separate from economy production logic.

### 4. Unit Execution Layer

Once a role is chosen, use the same order model as the rest of the game:

- `move`
- `attack-move`
- `guard`
- `strike`
- `capture`
- `service`

Do not build a second hidden AI-only movement system unless absolutely necessary.

## AI Memory and Reconnaissance

### Memory, Not Omniscience

AI should act on what it has seen or inferred.

A useful memory record stores:

- entity id
- kind and type
- last known position
- last seen time
- health if known
- any strategic tags such as “high-value” or “resource owner”

### Reconciliation Rules

When the AI regains vision:

- update matching memories
- delete disproven memories
- downgrade confidence in stale information

This creates meaningful recon and prevents AI from feeling unfair.

### Staleness and Decay

Do not let old intel drive behavior indefinitely.

Useful patterns:

- objective score decays with time since last seen
- stale threat estimates lose weight gradually
- recon tasks become higher priority when important memories are old

## Objective Scoring

Use scoring rather than fixed if/else scripts for:

- expansion locations
- resource capture opportunities
- harassment routes
- defensive reactions
- air patrol points
- high-value strike targets

Common scoring inputs:

- distance from friendly hubs
- threat nearby
- value of the structure or unit
- whether the target is visible now
- how recently it was seen
- current strategic phase

Add hysteresis when helpful so the AI does not thrash between nearly equal objectives.

## Production and Tech Heuristics

Use summary counts and capability gaps to drive production.

Examples:

- if no engineer exists, produce one before greedier tech
- if income is low and storage is blocked, prioritize economy infrastructure
- if airfields exist but no fighter is available, queue aircraft production
- if support ratio is too low for the combat force, add support units
- if the enemy fielded air threats, prioritize anti-air capable assets or scouts

Prefer explicit heuristics to invisible “weights” unless the weights are exposed and tested.

## Air Doctrine

Aircraft need doctrine, not raw movement.

Useful doctrines include:

- direct strike on a visible high-value target
- loiter guard over a resource, objective, or remembered threat point
- return to service and relaunch to a queued mission

Recommended behavior split:

- one aircraft may commit to a visible direct strike target
- additional aircraft may loiter over the strategic objective or approach corridor
- AI should only assign direct strike when the target is current and meaningful

## Scouts, Recon, and Resource Play

Scouts should not merely idle near base.

Good scout workflows:

1. unexplored grid sweep
2. stale-memory refresh
3. resource recon
4. harassment or capture when conditions are favorable

In resource-race or expansion phases, scout priorities should lean toward:

- resource node ownership
- capture feasibility
- local threat around neutral objectives

## Tactical Safety Rules

Add explicit rules for fragile units.

Examples:

- engineers retreat from active threats
- ambulances avoid entering effective enemy range unless protected
- recon drones avoid redundant coverage if another unit already sees the area
- aircraft avoid landing or retasking into impossible service states

These small rules often matter more than broad AI strategy.

## AI Workflow for New Features

When adding a new AI-capable system, follow this procedure:

1. Add the new unit or structure to the asset count summary.
2. Decide which strategic phase values it.
3. Decide what objective or role it serves.
4. Add a tactical assignment helper.
5. Reuse player-facing order helpers where possible.
6. Add safety and stale-intel rules.
7. Playtest with constrained scenarios, not only full matches.

## Debugging Checklist

- Verify the AI can explain its current phase in terms of measurable state
- Verify it is not using hidden information the player could not know
- Verify objective scores change in understandable ways when the map changes
- Verify units are not being reassigned every tick without hysteresis
- Verify aircraft, scouts, and support units receive role-appropriate orders
- Verify stale memories are refreshed or abandoned over time
- Verify production heuristics do not deadlock on missing prerequisites

## Example Prompts

- `/rts-ai-doctrine Add layered AI phases for economy, recon, siege, and resource-race behavior.`
- `/rts-ai-doctrine Design memory-driven scouting and attack targeting for a browser RTS opponent.`
- `/rts-ai-doctrine Make AI fighters choose between direct strike and loiter patrol based on visible objectives.`
- `/rts-ai-doctrine Review my RTS AI for cheating behavior, brittle heuristics, and missing hysteresis.`

## Good Companion Skills

- `rts-games` for overall architecture and command semantics
- `rts-pathfinding` for movement, occupancy, and traversal logic
- `rts-rendering-persistence` for minimaps, fog, and save/restore systems
