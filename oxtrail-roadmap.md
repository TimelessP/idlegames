# Ox Trail — Game Design & Implementation Roadmap

_An Oregon Trail-inspired procedural open-world side-scroller SPA._

## 1. Concept

**Ox Trail** is a single-file HTML/CSS/JS side-scrolling survival-trading game. The player leads an ox wagon across a procedurally generated landscape, managing oxen, inventory, health, and trade while dealing with random events, river crossings, weather, and resource scarcity.

## 2. World Model

### 2a. Procedural Terrain Generation

The world is a continuous horizontal strip divided into **segments** (~400–600 px each). Segment types:

| Type | Features |
|------|----------|
| **Plains** | Grass, flowers, occasional stray ox |
| **Forest** | Trees (choppable for wood), bushes |
| **River** | Water crossing — must convert wagon to raft or ford; fishing spot; water collection point; oxen can drink & graze |
| **Town** | Trading post, repair services, NPC merchants |

Segments are generated on-the-fly as the player moves right. A seed-based PRNG ensures consistent replays. Rivers appear every 3–6 segments; towns every 5–8 segments.

### 2b. Coordinate System

- `CHARACTER_HEIGHT = 56` baseline
- `H = CHARACTER_HEIGHT * 4` (224 px view height)
- Side-scroll camera follows wagon/player
- Ground horizon at `H / 2`, path below, sky above

### 2c. World State

```
worldSegments[]  — generated terrain data
currentSegmentIdx — which segment the camera is in
worldOffsetX     — continuous world x-position
```

## 3. Entities

### 3a. Player Character (PC)

- Walk speed: `WALK_SPEED` (base ~1.2 px/tick)
- Can carry **1 physicalised item** at a time
- Health stat, hunger, thirst
- Gold coins (currency)

### 3b. Ox Wagon

- Speed: `WALK_SPEED / 4.0` per ox (1 ox = quarter walking speed)
- Additional oxen increase speed proportionally (2 oxen = WALK_SPEED / 2, etc.)
- **8 inventory slots** + **1 driver seat** (PC or NPC)
- Drawn by hitched oxen (visible in scene)
- Can be converted to a **raft** at river crossings
- Subject to damage (broken wheel event, etc.)

### 3c. Oxen (Individual)

Each ox has:
- `name` (randomly generated)
- `health` (0–100; 0 = dead)
- `hunger` (0–100; rises over time)
- `thirst` (0–100; rises over time)
- `hitched` (boolean — attached to wagon or roaming)
- `alive` (boolean)

Mechanics:
- Must be **unleashed at rivers** to drink and graze
- Too long without water/food → health decreases → death
- Dead oxen drop **ox meat** + **ox pelt** (inventory items)
- Stray oxen found in the wild can be hitched

### 3d. NPC Characters

- Can be encountered at towns or events
- Can ride in the wagon (occupy driver seat or passenger)
- Optional: hired hands to help carry items

## 4. Physicalised Inventory System

### 4a. Item Types

| Item | Weight | Sell Value | Notes |
|------|--------|-----------|-------|
| **Water Butt** | 2 slots | 5g | Fill at rivers; Action menu: "Drink Water" |
| **Wood** | 1 slot | 3g | Chop from forest trees; used for campfires or sold |
| **Fish** | 1 slot | 4g | Catch at rivers (fishing mini-interaction) |
| **Ox Meat** | 1 slot | 6g | From dead oxen; can eat to restore hunger |
| **Ox Pelt** | 1 slot | 8g | From dead oxen; sellable |
| **Wagon Wheel** | 1 slot | 10g | Spare wheel for repairs |
| **Canopy** | 2 slots | 12g | Attach to wagon for weather protection |
| **Firewood Bundle** | 1 slot | 2g | Quick-start campfire fuel |

### 4b. Carrying Rules

- **Player on foot:** can carry **1 item** at a time
- **Wagon:** 8 inventory slots (items vary in slot cost)
- Items are physicalised — they exist in the world as SVG sprites, can be picked up/dropped/loaded/unloaded

### 4c. Wagon Inventory Actions (Menu-Based)

Uses data-driven menu system (game-menu-system skill):
- View wagon contents
- Load/unload items
- Use items (drink water, eat meat, attach canopy)
- Drop items on ground

## 5. Core Gameplay Loop

```
1. Travel (move wagon rightward across terrain)
2. Encounter segments (plains, forest, river, town)
3. Manage resources (food, water, ox health, wagon condition)
4. Trade in towns (sell pelts/meat/fish/wood, buy supplies)
5. Handle events (storms, broken wheels, stray animals, bandits)
6. Survive to reach the final destination (win condition)
```

### 5a. Travel Mechanics

- Wagon moves automatically when PC is in driver seat and oxen are hitched
- Speed = `(WALK_SPEED / 4.0) * numHitchedOxen`
- PC can walk ahead (faster) or ride the wagon
- Day/night cycle: ~120 seconds real-time per day
- Must camp at night (make campfire for warmth/cooking)

### 5b. River Crossings

1. Wagon stops at river edge
2. Player must **convert wagon to raft** (Action menu)
3. Raft floats across (player steers like rivercrossing.html boat)
4. On far shore, raft converts back to wagon
5. While at river: can fish, fill water butt, unleash oxen to drink/graze

### 5c. Campfire System

- Requires 1 wood item
- Place campfire on ground (becomes world entity)
- Functions: cook meat/fish (restores more hunger), warmth at night, light
- Campfire burns for ~30 seconds game-time then extinguishes

### 5d. Weather System

- Random weather events: clear, rain, storm
- Storm: reduces visibility, damages canopy-less wagon, oxen stress
- Rain: slower travel, rivers swell (harder crossing)
- Canopy on wagon protects from weather damage

### 5e. Overnight Stops

- When day transitions to night, wagon should stop
- Player prompted to make camp
- Canopy protects from adverse weather overnight
- Oxen rest and recover some health if fed/watered

## 6. Trading System

### 6a. Town Mechanics

- NPC merchant with buy/sell interface (menu-based)
- Sell: ox pelts, meat, fish, wood, water
- Buy: wagon wheels, canopy, water butt, food rations
- Prices vary by town (procedural)
- Gold coins as currency

### 6b. Trade Menu (game-menu-system)

```js
MENUS.townTrade: {
  isRoot: true,
  title: 'TRADING POST',
  overview: 'Buy and sell goods:',
  itemBuilder: 'buildTradeItems',
  actions: [{ label: 'Close', behavior: 'close' }]
}
```

## 7. Event Encounters

| Event | Effect | Resolution |
|-------|--------|-----------|
| **Broken Wheel** | Wagon immobilised | Use spare wheel from inventory, or walk to town |
| **Stray Ox** | Wild ox appears | Approach and hitch (Action) |
| **Bandit** | Lose random item | Fight (risk HP) or surrender item |
| **Illness** | PC health drops | Rest + eat food to recover |
| **Storm** | Damage to wagon/oxen | Canopy reduces damage; shelter if possible |
| **Snake Bite** | Ox health drops | Find herbs or wait it out |
| **Friendly Traveller** | NPC offers trade/info | Interact to trade or get map info |

Events trigger randomly per segment traversal (~15% chance per segment).

## 8. Win/Lose Conditions

- **Win:** Reach the final town (segment #30 or configurable destination distance)
- **Lose:** PC health reaches 0, or all oxen dead with no way to continue
- Score based on: gold accumulated, oxen surviving, items collected, time taken

## 9. UI Layout

### 9a. Header
- Title: "🐂 Ox Trail"
- Buttons: New Game, Help (?), Theme toggle, Menu (☰)

### 9b. Stats Bar
- Day counter
- Gold coins
- PC Health
- Distance remaining

### 9c. Game Viewport
- SVG side-scroller with camera follow
- Procedural terrain rendering
- Entities: wagon, oxen, player, items, NPCs, campfires

### 9d. Bottom Controls
- ◀ (left) | Action | ▶ (right)
- Action button context-sensitive (interact/pick up/drop/menu)

### 9e. HUD Overlay
- Context hints (like rivercrossing.html)
- Event notifications

### 9f. Modals
- Help/How to Play
- Win screen (with share)
- Game Over screen
- Town Trade screen

### 9g. Action Menu (game-menu-system)
- Opens when pressing Action near interactive objects
- Data-driven with behavior attributes
- Wagon inventory management
- Campfire creation
- Fishing
- Water collection
- Ox management (unleash/hitch/feed)

## 10. Technical Architecture

### 10a. Single-File Structure
Following repo conventions:
```html
<!DOCTYPE html>
<html lang="en">
<head><!-- meta, manifest, pwa.js, theme --></head>
<style><!-- all CSS --></style>
<body>
  <header><!-- title + controls --></header>
  <div class="stats"><!-- day, gold, health, distance --></div>
  <div class="game-viewport"><svg id="gameCanvas"></svg></div>
  <div class="bottom-controls"><!-- ◀ Action ▶ --></div>
  <!-- Modals: help, win, gameover, trade -->
  <script type="module"><!-- ALL game logic --></script>
  <script src="parental.js" defer></script>
</body>
</html>
```

### 10b. State Object
```js
function freshState() {
  return {
    player: { x, y, health, hunger, thirst, gold, carrying, facing, onWagon, side },
    wagon: { x, y, speed, facing, motionDir, slots: [null x 8], hasCanopy, wheelHealth, isRaft },
    oxen: [{ name, health, hunger, thirst, hitched, alive, x, y }],
    world: { segments: [], currentIdx: 0, offsetX: 0, seed, dayTime, weather, day },
    campfires: [],
    groundItems: [],
    events: { active: null, queue: [] },
    npcs: [],
    moves: 0, elapsed: 0, distanceTravelled: 0, destinationDistance: 3000,
    gameOver: false, won: false,
  };
}
```

### 10c. Fixed Timestep Loop
```js
const FIXED_FPS = 20;
const FIXED_DT = 1 / FIXED_FPS;
// Same pattern as rivercrossing.html
```

### 10d. Procedural Generation (PRNG)
```js
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
```

### 10e. Camera System
Side-scroll follow on wagon or player, whichever is leading. Dynamic viewBox.

### 10f. SVG Rendering
- Static scenery per segment (cached/redrawn on segment change)
- Dynamic group for entities (cleared each frame)
- Theme-aware palettes (light/dark/system)

### 10g. Input
- WASD + Arrow keys for movement
- E / Enter for interact
- On-screen touch controls (◀ Action ▶)
- Stage pointer controls (tap left/right of player)
- M or menu button for wagon/action menu

### 10h. Menu System (game-menu-system skill)
- `MENUS` object with all menu definitions
- Stack-based navigation
- `behavior` attributes: keep-open, back, close, submenu
- In-place value refresh for ox stats, inventory counts
- Rebuild on list changes (items added/removed)

## 11. Implementation Order

1. ✅ HTML skeleton + CSS (header, stats, viewport, controls, modals)
2. ✅ Constants, world geometry, state object
3. ✅ PRNG + procedural segment generation
4. ✅ SVG scenery rendering (sky, ground, trees, water, towns)
5. ✅ Camera system + viewport fitting
6. ✅ Player character rendering + movement
7. ✅ Ox rendering + individual stats
8. ✅ Wagon rendering + movement mechanics
9. ✅ Input layer (keyboard, touch, pointer)
10. ✅ Fixed timestep game loop
11. ✅ Physicalised inventory (items in world, pick up, drop, carry)
12. ✅ Wagon inventory slots (load/unload via menu)
13. ✅ Action menu system (data-driven menus)
14. ✅ River crossing (wagon→raft conversion, steering)
15. ✅ Fishing mechanic
16. ✅ Water collection (water butt)
17. ✅ Wood chopping
18. ✅ Campfire system
19. ✅ Day/night cycle
20. ✅ Weather system
21. ✅ Canopy mechanics
22. ✅ Ox management (unleash, hitch, feed, water, death→meat/pelt)
23. ✅ Town trading system
24. ✅ Random event encounters
25. ✅ Win/lose conditions + scoring
26. ✅ Help modal, share, theme toggle
27. ✅ PWA integration (pwa.js, parental.js)

## 12. Action Menu Rework

### Problem
When mounted on the wagon, the Action button shows "Wagon Menu" and goes straight to Wagon Inventory. Players have no intuitive path from the Action button to Ox Management, Status, Make Camp, etc. — they must discover the separate ☰ hamburger button, which isn't obvious.

### Analysis: Position-Dependent vs Always-Available

**Position-dependent actions** (require proximity to a world feature):
| Action | Condition | On Wagon? |
|--------|-----------|-----------|
| Drop item | Carrying an item | ✗ (seated) |
| Pick up item | Near ground item | ✗ (seated) |
| Board Wagon | Near wagon, on foot | ✗ (already on) |
| River actions | Near river | ✗ (auto-crossing) |
| Chop Wood | Forest + near tree | ✗ (seated) |
| Trade | In a town | ✓ (stop & trade) |
| Camp (existing) | Near campfire | ✓ (stop & use) |
| Hitch own ox | Near unhitched ox | ✗ |
| Hitch stray ox | Near stray ox | ✗ |

**Always-available management:**
| Action | Notes |
|--------|-------|
| Wagon Inventory → | Submenu: view/load/unload items |
| Ox Management → | Submenu: hitch/unleash/feed oxen |
| Status → | Submenu: journey stats |

**Conditionally-available management:**
| Action | Condition |
|--------|-----------|
| Make Camp | Not on water (needs wood — checked at execution) |
| Dismount | Only when on wagon |

### Unified Action Menu Design

Pressing Action **always** opens a unified menu. Context-sensitive nearby actions appear first, followed by always-available management options:

```
ACTIONS
───── NEARBY ─────         (divider — only shown if ≥1 context action)
[Pick up Fish]             (position-dependent actions)
[Board Wagon]
───── MANAGE ─────         (divider)
[Wagon Inventory →]        (always)
[Ox Management →]          (always)
[Make Camp]                 (always, except on water)
[Status →]                 (always)
[Dismount]                 (only when on wagon)
Close
```

### Button Label
- Default: "Menu"
- When context actions nearby: "Menu •" (subtle dot indicator)

### ☰ Hamburger Button
Remains unchanged as a shortcut to MENUS.main (management-only). Power users who discover it get quicker access without the context section.

### Implementation Steps
1. Remove early return from `getContextActions()` for on-wagon — instead, collect only actions valid from wagon seat (Trade, Camp)
2. Add `MENUS.actionMenu` with `itemBuilder: 'buildActionMenuItems'`
3. `buildActionMenuItems()` merges context actions + management items
4. `handleInteract()` always opens `actionMenu`
5. `updateActionLabel()` shows "Menu" or "Menu •" based on nearby context actions
6. Submenus (wagonInventory, oxManagement, status) stay as-is with `isRoot: false` and "Back" action

## 13. File Outputs

- `oxtrail-roadmap.md` — this document
- `oxtrail.html` — the complete game SPA
