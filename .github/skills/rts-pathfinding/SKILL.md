---
name: rts-pathfinding
description: 'Implement movement, occupancy, and pathfinding for RTS games. Use when building grid traversal, traversal costs, reservations, spawn cells, approach cells, transport unloading, and formation-friendly browser RTS movement.'
argument-hint: 'Describe the pathfinding, occupancy, or movement problem to solve'
user-invocable: true
disable-model-invocation: false
---

# RTS Pathfinding

Build movement systems for RTS games that remain readable, performant, and robust as unit count and order complexity increase.

This skill focuses on grid-aware pathfinding, occupancy, traversal rules, and practical movement workflows for browser RTS games.

## When to Use

- Adding pathfinding to an RTS
- Designing movement around blocked cells and building footprints
- Adding different traversal costs for sand, rock, water, ridges, or roads
- Implementing reservations, claims, or occupancy rules
- Handling spawn cells, unload positions, and build-approach cells
- Debugging units getting stuck, piling up, or clipping through structures

## Avoid Using This Skill For

- Pure steering-only swarm games without grid logic
- Physics-heavy vehicular movement where there is no discrete occupancy model
- Turn-based shortest-path previews without continuous unit simulation

## Core Principles

- Separate placement occupancy from live unit occupancy
- Make traversability a function of terrain plus mover capability
- Use claims and reservations to reduce unit pileups
- Recompute the minimum necessary derived state when entities move
- Distinguish “find a path” from “decide where the unit should stand”

## Coordinate Model

Use both:

- cell coordinates for occupancy, placement, and fog
- world coordinates for unit motion, combat, and rendering

Keep conversions centralized and predictable.

Examples:

- `pxToCell(...)`
- `cellToWorld(...)`
- `worldToKey(cellX, cellY)`

## Traversal Rules

### Terrain Capability

Traversal should depend on the mover, not only the tile.

Useful questions:

- can infantry traverse the tile?
- can vehicles traverse it with penalty?
- can flying units ignore it?
- should ridges block movement, line of sight, or both?

Keep these in helpers such as:

- `getMoverDefinition(...)`
- `canMoverTraverseTile(...)`
- `getTerrainTraversalPenalty(...)`
- `getTerrainSpeedMultiplier(...)`

### Occupancy Layers

Maintain distinct occupancy maps for:

- static blocked cells from terrain/buildings
- dynamic blocked cells from units
- building cells or construction claims
- optional unit reservations for future destinations

Do not merge them into one opaque structure if they have different update lifecycles.

## Pathfinding Workflow

For a typical RTS path request:

1. Convert world start and goal to cell-space intent.
2. Decide whether the goal is a point, a ring around a target, or an approach cell.
3. Query pathability with current mover rules.
4. Run the path search.
5. Convert the resulting cell path back into world-space movement targets.
6. Allow path repair or replanning if the route becomes invalid.

If units repeatedly fail to reach goals, the problem is often in goal selection, not in the A* implementation itself.

## Goal Selection Patterns

### Find a Reachable Nearby Cell, Not Just the Exact Target Cell

RTS units often need to reach a usable area rather than one exact point.

Examples:

- nearest free cell around a structure
- spawn cell around a factory or barracks
- unload cells around a transport
- build approach cell around a planned footprint
- capture or repair ring around a structure

Write dedicated helpers for those tasks instead of overloading the core pathfinder.

### Use Ring Searches for Placement and Unload Logic

A practical pattern is to search expanding rings around a footprint or transport until a valid cell is found.

This is often enough for:

- transport disembark
- building spawns
- emergency placement fallback
- engineer approach targets

Score candidates by path length or distance to rally point, not just Euclidean proximity.

## Claims and Reservations

### Release and Reclaim Deliberately

If a unit is moving, building, boarding, unloading, or servicing, decide whether it should keep or release its current claim.

Good rules:

- release claims before significant retasking
- reclaim when settled or idle
- clear stale claims on destruction, boarding, capture, or transport death

### Prevent Silent Overbooking

Use explicit capacity and occupancy checks for:

- transports
- airfields or hangars
- service bays if modeled
- build queues or spawn pads if limited

This is the same family of problem as path occupancy, even if the storage model differs.

## Performance Patterns

### Spatial Indexing for Local Queries

Pathfinding alone is not the only expensive part. Nearby-unit and nearby-building lookups also grow quickly.

Use a spatial grid or buckets to accelerate:

- threat checks
- support range checks
- melee or crush targeting
- nearby structure detection

### Rebuild What Changed

Avoid full-world recomputation every frame when possible.

Typical derived data to update only as needed:

- dynamic blocked cells after unit movement
- spatial buckets after movement
- placement validity after building add/remove

## Path Repair and Replanning

Units should not recompute full paths every frame, but they also should not stubbornly follow dead routes forever.

Useful triggers for replanning:

- current path blocked by dynamic occupancy
- target changed meaningfully
- unit has made too little progress for too long
- terrain rules changed due to building placement or destruction

Budget replanning with timers where needed.

## Formations and Group Movement

If you want formation-friendly movement, start with these principles:

- separate group destination from per-unit offsets
- assign nearby valid cells rather than identical exact goals
- preserve rough ordering where possible
- allow formation decay under combat pressure instead of forcing rigid alignment

Do not try to make A* solve formation shape directly in the first version.

## Debugging Checklist

- Verify terrain traversal rules match unit class expectations
- Verify units do not enter blocked building footprints
- Verify spawn and unload cells are valid and non-overlapping
- Verify claims are released on death, boarding, or retasking
- Verify the path search is not being asked to solve impossible exact goals unnecessarily
- Verify replanning happens often enough to recover, but not so often that units jitter
- Verify pathing bugs are distinguished from command-meaning bugs

## Example Prompts

- `/rts-pathfinding Add grid pathfinding with terrain penalties and dynamic unit blocking to my browser RTS.`
- `/rts-pathfinding Design spawn-cell, unload-cell, and approach-cell helpers for buildings and transports.`
- `/rts-pathfinding Review my RTS movement system for stuck units, stale claims, and bad goal selection.`
- `/rts-pathfinding Add path repair and reservation logic so units stop bunching around narrow spaces.`

## Good Companion Skills

- `rts-games` for command semantics and unit order modeling
- `rts-ai-doctrine` for scout routing, tactical objective use, and role assignment
- `rts-rendering-persistence` for fog, minimaps, and save/restore integration
