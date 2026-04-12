from __future__ import annotations

# Monolithic Sandfront terminal edition (single-file build).

"""
sandfront/const.py
──────────────────
All game constants, unit type definitions, building type definitions,
and research definitions for Sandfront Command – Terminal Edition.

These mirror the JS originals as closely as practical; numeric values are
unchanged so game-balance stays consistent with the browser version.
"""

import math

# ---------------------------------------------------------------------------
# World geometry
# ---------------------------------------------------------------------------
CELL            = 8          # world-px per grid cell (used for distance math)
WORLD_CELLS_X   = 128
WORLD_CELLS_Y   = 128
WORLD_WIDTH     = WORLD_CELLS_X * CELL    # 1024 px
WORLD_HEIGHT    = WORLD_CELLS_Y * CELL    # 1024 px

# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------
TEAM_PLAYER = 0
TEAM_AI     = 1

# ---------------------------------------------------------------------------
# Tile types
# ---------------------------------------------------------------------------
TILE_SAND  = 0
TILE_ROCK  = 1
TILE_RIDGE = 2

# ---------------------------------------------------------------------------
# Pathfinding – 8-direction neighbours: (dx, dy, movement_cost)
# ---------------------------------------------------------------------------
NEIGHBORS_8 = [
    ( 1,  0, 1.0  ),
    (-1,  0, 1.0  ),
    ( 0,  1, 1.0  ),
    ( 0, -1, 1.0  ),
    ( 1,  1, 1.414),
    ( 1, -1, 1.414),
    (-1,  1, 1.414),
    (-1, -1, 1.414),
]

# ---------------------------------------------------------------------------
# Economy / resource constants
# ---------------------------------------------------------------------------
RESOURCE_NODE_AMOUNT_MULTIPLIER = 5
OIL_NODE_PAIR_COUNT             = 3
OIL_TRICKLE_INTERVAL            = 1.5   # seconds between oil income ticks
OIL_TRICKLE_AMOUNT              = 9     # spice per tick per oil derrick

# ---------------------------------------------------------------------------
# Ability cooldowns / durations (seconds of game-time)
# ---------------------------------------------------------------------------
CAPTURE_DURATION    = 15
SCAN_DURATION       = 10
SCAN_COOLDOWN       = 45
DRONE_DEPLOY_COOLDOWN = SCAN_COOLDOWN
HACK_COOLDOWN       = 36
HACK_SPICE_REWARD   = 150
PARADROP_COOLDOWN   = 72

# ---------------------------------------------------------------------------
# Fighter constants (simplified for terminal; no runway animation)
# ---------------------------------------------------------------------------
FIGHTER_MISSILES    = 4
FIGHTER_REPAIR_RATE = 18     # HP/s while landed
FIGHTER_REARM_RATE  = 1.2    # missiles/s while landed
FIGHTER_GUARD_RADIUS        = CELL * 9
FIGHTER_GUARD_ACQUIRE_RADIUS= CELL * 5.5
FIGHTER_TURN_RATE           = math.pi * 1.85
FIGHTER_EMERGENCY_HOLD_RADIUS    = CELL * 7
FIGHTER_EMERGENCY_HOLD_DURATION  = 15

# ---------------------------------------------------------------------------
# AI tuning
# ---------------------------------------------------------------------------
MAX_GROUPS          = 10
AI_THINK_INTERVAL   = 1.2    # how often the AI "thinks" (real seconds between calls)
AI_ATTACK_INTERVAL  = 22.0   # game-time seconds between major attack waves

AI_STRUCTURE_MIN_GAP = {
    'refinery':  2,
    'silo':      2,
    'barracks':  3,
    'lab':       3,
    'factory':   3,
    'airfield':  5,
    'turret':    2,
    'hq':        6,
}

# ---------------------------------------------------------------------------
# Ambient scoring thresholds  (oil-race phase)
# ---------------------------------------------------------------------------
AI_OIL_RACE_MAP_SPICE_THRESHOLD = 2600
AI_OIL_CAPTURE_THREAT_MAX       = 4
AI_OIL_HARASS_THREAT_MAX        = 8

# ---------------------------------------------------------------------------
# Unit type definitions
# Keys match original JS UNIT_TYPES; snake_case used for Python.
# ---------------------------------------------------------------------------
UNIT_TYPES: dict[str, dict] = {
    'scout': {
        'label': 'Dust Scout',
        'hp': 70, 'speed': 36, 'sight': 9,
        'range': 44, 'damage': 7, 'reload': 0.75,
        'cost': 80, 'build_time': 7,
        'infantry': True,
    },
    'engineer': {
        'label': 'Engineer',
        'hp': 64, 'speed': 30, 'sight': 8,
        'range': 0, 'damage': 0, 'reload': 0,
        'cost': 90, 'build_time': 8,
        'infantry': True, 'builder': True,
        'repair_rate': 16,
    },
    'harvester': {
        'label': 'Harvester',
        'hp': 150, 'speed': 22, 'sight': 8,
        'range': 0, 'damage': 0, 'reload': 0,
        'cost': 140, 'build_time': 10,
        'vehicle': True, 'capacity': 140, 'gather_rate': 34,
    },
    'transport': {
        'label': 'Troop Transport',
        'hp': 150, 'speed': 40, 'sight': 9,
        'range': 0, 'damage': 0, 'reload': 0,
        'cost': 150, 'build_time': 10,
        'vehicle': True, 'transport_capacity': 6,
    },
    'ambulance': {
        'label': 'Ambulance',
        'hp': 128, 'speed': 25, 'sight': 9,
        'range': 0, 'damage': 0, 'reload': 0,
        'cost': 160, 'build_time': 11,
        'vehicle': True, 'support': True,
        'heal_rate': 2.75, 'heal_radius': 20, 'support_range': 54,
    },
    'tank': {
        'label': 'Siege Tank',
        'hp': 180, 'speed': 20, 'sight': 10,
        'range': 58, 'damage': 18, 'reload': 1.25,
        'cost': 180, 'build_time': 12,
        'vehicle': True,
        'requires': ['factory', 'composite-armor'],
    },
    'fighter': {
        'label': 'Fighter Jet',
        'hp': 136, 'speed': 84, 'sight': 12,
        'range': 86, 'damage': 22, 'reload': 0.42,
        'cost': 240, 'build_time': 17,
        'flying': True,
        'max_missiles': FIGHTER_MISSILES,
        'reveal_multiplier': 3,
    },
    'drone': {
        'label': 'Drone',
        'hp': 50, 'speed': 54, 'sight': 9,
        'range': 0, 'damage': 0, 'reload': 0,
        'cost': 0, 'build_time': 0,
        'flying': True,
        'reveal_multiplier': 3,
    },
    'paratrooper': {
        'label': 'Paratrooper',
        'hp': 62, 'speed': 24, 'sight': 9,
        'range': 0, 'damage': 0, 'reload': 0,
        'cost': 0, 'build_time': 0,
        'infantry': True,
    },
}

# ---------------------------------------------------------------------------
# Building type definitions
# ---------------------------------------------------------------------------
BUILDING_TYPES: dict[str, dict] = {
    'hq': {
        'label': 'Command Hub',
        'size': (3, 3), 'hp': 720, 'sight': 11,
        'cost': 420,
        'queue': ['engineer'],
        'storage': 380,
    },
    'refinery': {
        'label': 'Refinery',
        'size': (3, 3), 'hp': 460, 'sight': 10,
        'cost': 180,
        'queue': ['harvester'],
        'storage': 500,
        'build_requires': ['hq'],
    },
    'silo': {
        'label': 'Spice Silo',
        'size': (2, 2), 'hp': 300, 'sight': 8,
        'cost': 120,
        'storage': 28000,
        'build_requires': ['hq'],
    },
    'oilDerrick': {
        'label': 'Oil Derrick',
        'size': (2, 2), 'hp': 320, 'sight': 9,
        'cost': 140,
        'income_rate': OIL_TRICKLE_AMOUNT / OIL_TRICKLE_INTERVAL,
        'build_requires': ['hq'],
        'on_oil': True,
    },
    'barracks': {
        'label': 'Dust Barracks',
        'size': (3, 3), 'hp': 400, 'sight': 9,
        'cost': 160,
        'queue': ['scout', 'engineer'],
        'build_requires': ['hq'],
    },
    'lab': {
        'label': 'Signal Lab',
        'size': (3, 3), 'hp': 340, 'sight': 9,
        'cost': 210,
        'research': [
            'rangefinding', 'composite-armor', 'scanner',
            'capture', 'drone-tech', 'hacking', 'paradrop-tech',
        ],
        'build_requires': ['barracks'],
    },
    'factory': {
        'label': 'War Factory',
        'size': (4, 3), 'hp': 540, 'sight': 10,
        'cost': 260,
        'queue': ['transport', 'tank', 'ambulance'],
        'build_requires': ['lab', 'rangefinding'],
    },
    'airfield': {
        'label': 'Airfield',
        'size': (6, 3), 'hp': 500, 'sight': 13,
        'cost': 320,
        'queue': ['fighter'],
        'build_requires': ['factory'],
    },
    'turret': {
        'label': 'Turret',
        'size': (2, 2), 'hp': 260, 'sight': 9,
        'cost': 110,
        'turret': True, 'range': 72, 'damage': 11, 'reload': 0.7,
        'build_requires': ['barracks'],
    },
}

# ---------------------------------------------------------------------------
# Research definitions
# ---------------------------------------------------------------------------
RESEARCH: dict[str, dict] = {
    'rangefinding': {
        'label': 'Optics',
        'cost': 160, 'time': 12,
        'requires': ['lab'],
        'desc': '+1 sight for all units and buildings; unlocks factory tech chain.',
    },
    'composite-armor': {
        'label': 'Armour',
        'cost': 220, 'time': 18,
        'requires': ['lab', 'rangefinding'],
        'desc': 'Unlocks Siege Tanks; +12% HP for combat units.',
    },
    'scanner': {
        'label': 'Scanner',
        'cost': 260, 'time': 20,
        'requires': ['lab', 'rangefinding'],
        'desc': f'Unlocks satellite scan ({SCAN_DURATION}s reveal, {SCAN_COOLDOWN}s cooldown).',
    },
    'capture': {
        'label': 'Capture Tech',
        'cost': 190, 'time': 16,
        'requires': ['lab'],
        'desc': 'Lets Dust Scouts capture enemy buildings.',
    },
    'drone-tech': {
        'label': 'Drone Tech',
        'cost': 240, 'time': 18,
        'requires': ['lab', 'rangefinding'],
        'desc': 'Unlocks drone deployment from Command Hubs.',
    },
    'hacking': {
        'label': 'Hacking',
        'cost': 180, 'time': 18,
        'requires': ['lab', 'scanner'],
        'desc': f'Unlocks HQ hack for {HACK_SPICE_REWARD} emergency spice income.',
    },
    'paradrop-tech': {
        'label': 'Paradrop',
        'cost': 320, 'time': 24,
        'requires': ['lab', 'drone-tech', 'hacking'],
        'desc': 'Unlocks scout parachute drops from Command Hubs.',
    },
}

# ---------------------------------------------------------------------------
# Build order: structures an Engineer can place
# ---------------------------------------------------------------------------
BUILDABLE_BY_ENGINEER = [
    'hq', 'refinery', 'silo', 'oilDerrick',
    'barracks', 'lab', 'factory', 'airfield', 'turret',
]

BUILD_HOTKEYS: dict[str, str] = {
    'hq':        'H',
    'refinery':  'R',
    'silo':      'S',
    'oilDerrick':'O',
    'barracks':  'B',
    'lab':       'L',
    'factory':   'F',
    'airfield':  'Y',
    'turret':    'T',
}

# ---------------------------------------------------------------------------
# Terminal visual representation
# Each entry: (char, colour_role)
# Colour roles: 'player_unit', 'enemy_unit', 'player_bldg', 'enemy_bldg',
#               'resource', 'neutral'
# ---------------------------------------------------------------------------
UNIT_CHARS: dict[str, str] = {
    'scout':       's',
    'engineer':    'e',
    'harvester':   'H',
    'transport':   'T',
    'ambulance':   '+',
    'paratrooper': 'p',
    'tank':        '#',
    'fighter':     '~',
    'drone':       'o',
}

BUILDING_CHARS: dict[str, str] = {
    'hq':        '\u256c',   # ╬
    'refinery':  'R',
    'silo':      'S',
    'oilDerrick':'O',
    'barracks':  'B',
    'lab':       'L',
    'factory':   'F',
    'airfield':  '=',
    'turret':    'T',
}

BUILDING_FILL_CHAR = '\u2592'   # ▒  – interior of multi-cell buildings

RESOURCE_CHARS: dict[str, str] = {
    'spice': '*',
    'oil':   '\u25cf',   # ●
}

# Terrain characters drawn when explored-but-not-visible
TERRAIN_DIM_CHARS = {
    TILE_SAND:  '.',
    TILE_ROCK:  ':',
    TILE_RIDGE: '^',
}

# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
MANUAL_ORDER_LOCK = {
    'move': 6, 'attack': 7, 'attackMove': 6,
    'gather': 9, 'repair': 9, 'build': 12, 'board': 6,
}

SUPPORT_BUILDING_BY_ROLE = {
    'infantry': 'barracks',
    'vehicle':  'factory',
}


from dataclasses import dataclass, field
import heapq
import math
import random
from typing import Iterable



@dataclass
class Tile:
    terrain: int = TILE_SAND


@dataclass
class ResourceNode:
    id: int
    kind: str  # spice|oil
    x: int
    y: int
    amount: float


@dataclass
class Unit:
    id: int
    team: int
    kind: str
    x: float
    y: float
    hp: float
    max_hp: float
    order: str = "idle"  # idle|move|attack_move|gather|return|build
    tx: float | None = None
    ty: float | None = None
    target_unit_id: int | None = None
    target_building_id: int | None = None
    target_resource_id: int | None = None
    reload_left: float = 0.0
    cargo: float = 0.0
    manual_lock_left: float = 0.0
    path: list[tuple[int, int]] = field(default_factory=list)
    path_index: int = 0
    path_goal: tuple[int, int] | None = None
    repath_left: float = 0.0

    @property
    def is_alive(self) -> bool:
        return self.hp > 0


@dataclass
class BuildQueueItem:
    kind: str
    remaining: float


@dataclass
class ResearchTask:
    key: str
    remaining: float


@dataclass
class Building:
    id: int
    team: int
    kind: str
    x: int
    y: int
    w: int
    h: int
    hp: float
    max_hp: float
    queue: list[BuildQueueItem] = field(default_factory=list)
    research_task: ResearchTask | None = None
    reload_left: float = 0.0

    @property
    def is_alive(self) -> bool:
        return self.hp > 0


@dataclass
class TeamState:
    spice: float = 600.0
    spice_capacity: float = 1200.0
    selected_unit_id: int | None = None
    selected_building_id: int | None = None
    completed_research: set[str] = field(default_factory=set)
    explored: list[list[bool]] = field(
        default_factory=lambda: [[False] * WORLD_CELLS_X for _ in range(WORLD_CELLS_Y)]
    )
    visible: list[list[bool]] = field(
        default_factory=lambda: [[False] * WORLD_CELLS_X for _ in range(WORLD_CELLS_Y)]
    )


@dataclass
class Event:
    text: str
    ttl: float = 8.0


class SandfrontGame:
    """Core simulation model for Sandfront terminal mode."""

    def __init__(self, seed: int | None = None) -> None:
        self.random = random.Random(seed)
        self.tiles: list[list[Tile]] = [
            [Tile() for _ in range(WORLD_CELLS_X)] for _ in range(WORLD_CELLS_Y)
        ]
        self.resources: dict[int, ResourceNode] = {}
        self.units: dict[int, Unit] = {}
        self.buildings: dict[int, Building] = {}
        self.teams: dict[int, TeamState] = {
            TEAM_PLAYER: TeamState(),
            TEAM_AI: TeamState(),
        }
        self.time_s = 0.0
        self._next_unit_id = 1
        self._next_building_id = 1
        self._next_resource_id = 1
        self._events: list[Event] = []
        self.game_over: bool = False
        self.winner: int | None = None
        self.ai_think_left = AI_THINK_INTERVAL
        self.ai_attack_left = AI_ATTACK_INTERVAL
        self._oil_tick_left = OIL_TRICKLE_INTERVAL

        self._generate_map()
        self._spawn_initial_bases()
        self.recompute_visibility()

    @property
    def recent_events(self) -> list[str]:
        return [ev.text for ev in self._events[:6]]

    def add_event(self, text: str) -> None:
        self._events.insert(0, Event(text=text))
        self._events = self._events[:20]

    def tick(self, dt: float) -> None:
        if self.game_over:
            return
        self.time_s += dt

        for ev in self._events:
            ev.ttl -= dt
        self._events = [ev for ev in self._events if ev.ttl > 0]

        self._update_ai(dt)
        self._update_buildings(dt)
        self._update_units(dt)
        self._update_combat(dt)
        self._cleanup_dead_entities()
        self._update_economy(dt)
        self.recompute_visibility()
        self._check_win_conditions()

    def get_tile(self, x: int, y: int) -> Tile:
        return self.tiles[y][x]

    def terrain_char(self, terrain: int) -> str:
        return TERRAIN_DIM_CHARS.get(terrain, ".")

    def clamp_cell(self, x: int, y: int) -> tuple[int, int]:
        return max(0, min(WORLD_CELLS_X - 1, x)), max(0, min(WORLD_CELLS_Y - 1, y))

    def select_at(self, team: int, x: int, y: int) -> None:
        ts = self.teams[team]
        ts.selected_unit_id = None
        ts.selected_building_id = None

        for unit in self.units.values():
            if unit.team != team:
                continue
            if int(round(unit.x)) == x and int(round(unit.y)) == y:
                ts.selected_unit_id = unit.id
                return

        for b in self.buildings.values():
            if b.team != team:
                continue
            if b.x <= x < b.x + b.w and b.y <= y < b.y + b.h:
                ts.selected_building_id = b.id
                return

    def issue_move_selected(self, team: int, tx: int, ty: int, attack_move: bool = False) -> bool:
        ts = self.teams[team]
        if ts.selected_unit_id is None:
            return False
        unit = self.units.get(ts.selected_unit_id)
        if not unit or not unit.is_alive:
            return False
        cx, cy = self.clamp_cell(tx, ty)
        unit.tx = float(cx)
        unit.ty = float(cy)
        unit.order = "attack_move" if attack_move else "move"
        unit.target_unit_id = None
        unit.target_building_id = None
        unit.target_resource_id = None
        self._clear_unit_path(unit)
        unit.manual_lock_left = MANUAL_ORDER_LOCK["attackMove" if attack_move else "move"]
        return True

    def issue_harvest_selected(self, team: int, tx: int, ty: int) -> bool:
        ts = self.teams[team]
        if ts.selected_unit_id is None:
            return False
        unit = self.units.get(ts.selected_unit_id)
        if not unit or unit.kind != "harvester":
            return False
        node = self._nearest_resource(tx, ty, "spice")
        if node is None:
            return False
        unit.target_resource_id = node.id
        unit.order = "gather"
        unit.tx = float(node.x)
        unit.ty = float(node.y)
        self._clear_unit_path(unit)
        unit.manual_lock_left = MANUAL_ORDER_LOCK["gather"]
        return True

    def issue_attack_selected(self, team: int, tx: int, ty: int) -> bool:
        ts = self.teams[team]
        if ts.selected_unit_id is None:
            return False
        unit = self.units.get(ts.selected_unit_id)
        if not unit or not unit.is_alive:
            return False
        enemy_unit = next(
            (
                u
                for u in self.units.values()
                if u.team != team and int(round(u.x)) == tx and int(round(u.y)) == ty
            ),
            None,
        )
        if enemy_unit is not None:
            unit.target_unit_id = enemy_unit.id
            unit.target_building_id = None
            unit.order = "attack_move"
            unit.manual_lock_left = MANUAL_ORDER_LOCK["attackMove"]
            return True

        enemy_bldg = next(
            (
                b
                for b in self.buildings.values()
                if b.team != team and b.x <= tx < b.x + b.w and b.y <= ty < b.y + b.h
            ),
            None,
        )
        if enemy_bldg is not None:
            unit.target_building_id = enemy_bldg.id
            unit.target_unit_id = None
            unit.order = "attack_move"
            unit.manual_lock_left = MANUAL_ORDER_LOCK["attackMove"]
            return True
        return False

    def issue_stop_selected(self, team: int) -> bool:
        ts = self.teams[team]
        if ts.selected_unit_id is None:
            return False
        unit = self.units.get(ts.selected_unit_id)
        if not unit:
            return False
        unit.order = "idle"
        unit.tx = None
        unit.ty = None
        unit.target_unit_id = None
        unit.target_building_id = None
        unit.target_resource_id = None
        self._clear_unit_path(unit)
        unit.manual_lock_left = 0.0
        return True

    def queue_unit_from_selected_building(self, team: int, index: int) -> tuple[bool, str]:
        ts = self.teams[team]
        if ts.selected_building_id is None:
            return False, "No selected building"
        b = self.buildings.get(ts.selected_building_id)
        if b is None:
            return False, "Selected building no longer exists"
        bdef = BUILDING_TYPES[b.kind]
        queue_types = bdef.get("queue", [])
        if not (0 <= index < len(queue_types)):
            return False, f"No unit in slot {index + 1}"
        ukind = queue_types[index]
        udef = UNIT_TYPES[ukind]
        if not self._can_train_unit(team, ukind):
            reqs = ", ".join(str(req) for req in udef.get("requires", [])) or "requirements unmet"
            return False, f"Cannot train {udef['label']}: requires {reqs}"
        if not self._spend_spice(team, udef["cost"]):
            return False, f"Insufficient spice for {udef['label']} ({udef['cost']})"
        b.queue.append(BuildQueueItem(kind=ukind, remaining=udef["build_time"]))
        return True, f"Queued {udef['label']}"

    def start_research_from_selected(self, team: int, index: int) -> tuple[bool, str]:
        ts = self.teams[team]
        if ts.selected_building_id is None:
            return False, "No selected building"
        b = self.buildings.get(ts.selected_building_id)
        if b is None or b.kind != "lab":
            return False, "Select a Signal Lab"
        if b.research_task is not None:
            return False, f"Research already in progress: {b.research_task.key}"
        keys = BUILDING_TYPES["lab"].get("research", [])
        if not (0 <= index < len(keys)):
            return False, f"No research in slot {index + 1}"
        rkey = keys[index]
        if not self._can_research(team, rkey):
            return False, f"Cannot research {RESEARCH[rkey]['label']} yet"
        rdef = RESEARCH[rkey]
        if not self._spend_spice(team, rdef["cost"]):
            return False, f"Insufficient spice for {rdef['label']} ({rdef['cost']})"
        b.research_task = ResearchTask(key=rkey, remaining=rdef["time"])
        return True, f"Research started: {rdef['label']}"

    def start_next_available_research_from_selected(self, team: int) -> tuple[bool, str]:
        ts = self.teams[team]
        if ts.selected_building_id is None:
            return False, "No selected building"
        b = self.buildings.get(ts.selected_building_id)
        if b is None or b.kind != "lab":
            return False, "Select a Signal Lab"
        if b.research_task is not None:
            return False, f"Research already in progress: {b.research_task.key}"

        keys = BUILDING_TYPES["lab"].get("research", [])
        affordable_available: list[str] = []
        blocked_available: list[str] = []
        for rkey in keys:
            if rkey in ts.completed_research:
                continue
            if self._can_research(team, rkey):
                rdef = RESEARCH[rkey]
                if ts.spice >= float(rdef["cost"]):
                    affordable_available.append(rkey)
                else:
                    blocked_available.append(rkey)

        if affordable_available:
            return self.start_research_from_selected(team, keys.index(affordable_available[0]))
        if blocked_available:
            rkey = blocked_available[0]
            rdef = RESEARCH[rkey]
            return False, f"Need {int(rdef['cost'])} spice for {rdef['label']}"
        if len(ts.completed_research) >= len(keys):
            return False, "All lab research complete"
        return False, "No available research yet (prerequisites unmet)"

    def build_with_selected_engineer(self, team: int, bkind: str, x: int, y: int) -> tuple[bool, str]:
        ts = self.teams[team]
        if ts.selected_unit_id is None:
            return False, "No selected unit"
        unit = self.units.get(ts.selected_unit_id)
        if unit is None or unit.kind != "engineer":
            return False, "Select an engineer"
        if bkind not in BUILDABLE_BY_ENGINEER:
            return False, "Not buildable"
        bdef = BUILDING_TYPES[bkind]
        if not self._can_build_structure(team, bkind):
            return False, "Tech requirements not met"
        if not self._spend_spice(team, bdef["cost"]):
            return False, "Insufficient spice"

        w, h = bdef["size"]
        ox = x - w // 2
        oy = y - h // 2
        if not self._can_place_building(ox, oy, w, h, bkind):
            self.teams[team].spice += bdef["cost"]
            return False, "Cannot place here"

        new_bldg = self._create_building(team, bkind, ox, oy)
        unit.order = "build"
        walk_x, walk_y = self._find_spawn_cell_near_building(new_bldg)
        unit.tx = float(walk_x) if walk_x is not None else float(x)
        unit.ty = float(walk_y) if walk_y is not None else float(y)
        unit.manual_lock_left = MANUAL_ORDER_LOCK["build"]
        return True, "Building placed"

    def visible_for_player(self, x: int, y: int) -> bool:
        return self.teams[TEAM_PLAYER].visible[y][x]

    def explored_for_player(self, x: int, y: int) -> bool:
        return self.teams[TEAM_PLAYER].explored[y][x]

    def entities_at(self, x: int, y: int) -> tuple[Unit | None, Building | None, ResourceNode | None]:
        unit = next((u for u in self.units.values() if int(round(u.x)) == x and int(round(u.y)) == y), None)
        bldg = next((b for b in self.buildings.values() if b.x <= x < b.x + b.w and b.y <= y < b.y + b.h), None)
        res = next((r for r in self.resources.values() if r.x == x and r.y == y and r.amount > 0), None)
        return unit, bldg, res

    def _generate_map(self) -> None:
        for y in range(WORLD_CELLS_Y):
            for x in range(WORLD_CELLS_X):
                n = self.random.random()
                if n < 0.065:
                    terrain = TILE_ROCK
                elif n < 0.09:
                    terrain = TILE_RIDGE
                else:
                    terrain = TILE_SAND
                self.tiles[y][x].terrain = terrain

        for _ in range(90):
            x = self.random.randrange(6, WORLD_CELLS_X - 6)
            y = self.random.randrange(6, WORLD_CELLS_Y - 6)
            amount = (220 + self.random.randint(0, 240)) * RESOURCE_NODE_AMOUNT_MULTIPLIER
            self._create_resource("spice", x, y, float(amount))

        for _ in range(OIL_NODE_PAIR_COUNT):
            x = self.random.randrange(18, WORLD_CELLS_X - 18)
            y = self.random.randrange(18, WORLD_CELLS_Y - 18)
            self._create_resource("oil", x, y, 1.0)
            self._create_resource("oil", WORLD_CELLS_X - 1 - x, WORLD_CELLS_Y - 1 - y, 1.0)

    def _spawn_initial_bases(self) -> None:
        p_base = (10, 10)
        a_base = (WORLD_CELLS_X - 14, WORLD_CELLS_Y - 14)

        self._create_building(TEAM_PLAYER, "hq", p_base[0], p_base[1])
        self._create_building(TEAM_PLAYER, "refinery", p_base[0] + 5, p_base[1] + 1)
        self._create_building(TEAM_PLAYER, "silo", p_base[0] + 2, p_base[1] + 5)

        self._create_building(TEAM_AI, "hq", a_base[0], a_base[1])
        self._create_building(TEAM_AI, "refinery", a_base[0] - 5, a_base[1] - 1)
        self._create_building(TEAM_AI, "silo", a_base[0] - 3, a_base[1] - 5)

        self._create_unit(TEAM_PLAYER, "engineer", p_base[0] + 4, p_base[1] + 4)
        self._create_unit(TEAM_PLAYER, "harvester", p_base[0] + 6, p_base[1] + 4)
        self._create_unit(TEAM_PLAYER, "scout", p_base[0] + 5, p_base[1] + 5)

        self._create_unit(TEAM_AI, "engineer", a_base[0] - 3, a_base[1] - 3)
        self._create_unit(TEAM_AI, "harvester", a_base[0] - 6, a_base[1] - 3)
        self._create_unit(TEAM_AI, "scout", a_base[0] - 5, a_base[1] - 5)

    def _create_resource(self, kind: str, x: int, y: int, amount: float) -> ResourceNode:
        rid = self._next_resource_id
        self._next_resource_id += 1
        node = ResourceNode(id=rid, kind=kind, x=x, y=y, amount=amount)
        self.resources[rid] = node
        return node

    def _create_unit(self, team: int, kind: str, x: float, y: float) -> Unit:
        uid = self._next_unit_id
        self._next_unit_id += 1
        udef = UNIT_TYPES[kind]
        unit = Unit(
            id=uid,
            team=team,
            kind=kind,
            x=x,
            y=y,
            hp=float(udef["hp"]),
            max_hp=float(udef["hp"]),
        )
        self.units[uid] = unit
        return unit

    def _create_building(self, team: int, kind: str, x: int, y: int) -> Building:
        bid = self._next_building_id
        self._next_building_id += 1
        bdef = BUILDING_TYPES[kind]
        w, h = bdef["size"]
        b = Building(
            id=bid,
            team=team,
            kind=kind,
            x=x,
            y=y,
            w=w,
            h=h,
            hp=float(bdef["hp"]),
            max_hp=float(bdef["hp"]),
        )
        self.buildings[bid] = b
        self._refresh_storage_caps()
        return b

    def _refresh_storage_caps(self) -> None:
        for team in (TEAM_PLAYER, TEAM_AI):
            base = 250.0
            cap = base
            for b in self.buildings.values():
                if b.team != team:
                    continue
                cap += float(BUILDING_TYPES[b.kind].get("storage", 0))
            self.teams[team].spice_capacity = cap
            self.teams[team].spice = min(self.teams[team].spice, cap)

    def _update_buildings(self, dt: float) -> None:
        for b in self.buildings.values():
            if b.reload_left > 0:
                b.reload_left = max(0.0, b.reload_left - dt)

            if b.research_task is not None:
                b.research_task.remaining -= dt
                if b.research_task.remaining <= 0:
                    key = b.research_task.key
                    self.teams[b.team].completed_research.add(key)
                    self.add_event(f"{self._team_name(b.team)} completed research: {RESEARCH[key]['label']}")
                    b.research_task = None

            if b.queue:
                b.queue[0].remaining -= dt
                if b.queue[0].remaining <= 0:
                    item = b.queue.pop(0)
                    sx, sy = self._find_spawn_cell_near_building(b)
                    if sx is not None and sy is not None:
                        self._create_unit(b.team, item.kind, sx, sy)
                    else:
                        self.add_event(f"{self._team_name(b.team)} spawn blocked near {BUILDING_TYPES[b.kind]['label']}")

    def _update_units(self, dt: float) -> None:
        for unit in self.units.values():
            if unit.manual_lock_left > 0:
                unit.manual_lock_left = max(0.0, unit.manual_lock_left - dt)
            if unit.reload_left > 0:
                unit.reload_left = max(0.0, unit.reload_left - dt)

            if unit.kind == "harvester":
                self._tick_harvester(unit, dt)
            elif unit.order in ("move", "attack_move", "build") and unit.tx is not None and unit.ty is not None:
                self._move_unit_toward(unit, unit.tx, unit.ty, dt)

    def _tick_harvester(self, unit: Unit, dt: float) -> None:
        udef = UNIT_TYPES[unit.kind]
        cap = float(udef["capacity"])
        gather_rate = float(udef["gather_rate"])

        if unit.order in ("idle", "move", "attack_move") and unit.target_resource_id is None:
            node = self._nearest_resource(int(unit.x), int(unit.y), "spice")
            if node:
                unit.target_resource_id = node.id
                unit.order = "gather"

        if unit.order == "gather":
            node = self.resources.get(unit.target_resource_id or -1)
            if node is None or node.amount <= 0:
                unit.target_resource_id = None
                unit.order = "idle"
                self._clear_unit_path(unit)
                return

            if self._distance_cells(unit.x, unit.y, node.x, node.y) > 1.25:
                self._move_unit_toward(unit, node.x, node.y, dt)
                return

            mined = min(gather_rate * dt, node.amount, cap - unit.cargo)
            node.amount -= mined
            unit.cargo += mined
            if unit.cargo >= cap - 0.0001:
                rx, ry = self._nearest_refinery_cell(unit.team, int(unit.x), int(unit.y))
                if rx is not None and ry is not None:
                    unit.order = "return"
                    unit.tx = float(rx)
                    unit.ty = float(ry)
                    self._clear_unit_path(unit)

        elif unit.order == "return":
            if unit.tx is not None and unit.ty is not None:
                self._move_unit_toward(unit, unit.tx, unit.ty, dt)
                if self._distance_cells(unit.x, unit.y, unit.tx, unit.ty) <= 1.2:
                    ts = self.teams[unit.team]
                    ts.spice = min(ts.spice + unit.cargo, ts.spice_capacity)
                    unit.cargo = 0.0
                    unit.order = "gather"
                    self._clear_unit_path(unit)

    def _clear_unit_path(self, unit: Unit) -> None:
        unit.path.clear()
        unit.path_index = 0
        unit.path_goal = None
        unit.repath_left = 0.0

    def _plan_path_for_unit(self, unit: Unit, tx: int, ty: int) -> list[tuple[int, int]]:
        sx = int(round(unit.x))
        sy = int(round(unit.y))
        gx, gy = self.clamp_cell(tx, ty)

        if not self._is_static_walkable(gx, gy):
            alt = self._nearest_static_walkable(gx, gy, search_radius=10)
            if alt is None:
                return []
            gx, gy = alt

        return self.find_path(sx, sy, gx, gy, max_expansions=1400)

    def _nearest_static_walkable(self, x: int, y: int, search_radius: int = 8) -> tuple[int, int] | None:
        if self._is_static_walkable(x, y):
            return x, y

        best: tuple[int, int] | None = None
        best_d = 1e9
        for r in range(1, search_radius + 1):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    cx = x + dx
                    cy = y + dy
                    if not self._is_static_walkable(cx, cy):
                        continue
                    d = self._distance_cells(x, y, cx, cy)
                    if d < best_d:
                        best_d = d
                        best = (cx, cy)
            if best is not None:
                break
        return best

    def _move_unit_toward(self, unit: Unit, tx: float, ty: float, dt: float) -> None:
        udef = UNIT_TYPES[unit.kind]
        speed_px = float(udef["speed"])
        speed_cells = speed_px / CELL
        if speed_cells <= 0:
            return

        ux, uy = unit.x, unit.y
        step = speed_cells * dt
        goal = self.clamp_cell(int(round(tx)), int(round(ty)))
        unit.repath_left = max(0.0, unit.repath_left - dt)
        needs_repath = unit.path_goal != goal or not unit.path or unit.repath_left <= 0.0
        if needs_repath:
            unit.path = self._plan_path_for_unit(unit, goal[0], goal[1])
            unit.path_goal = goal
            unit.path_index = 1 if len(unit.path) > 1 else 0
            unit.repath_left = 0.55

        wx, wy = tx, ty
        if unit.path:
            while unit.path_index < len(unit.path):
                px, py = unit.path[unit.path_index]
                if self._distance_cells(ux, uy, px, py) <= 0.30:
                    unit.path_index += 1
                else:
                    break
            if unit.path_index < len(unit.path):
                px, py = unit.path[unit.path_index]
                wx, wy = float(px), float(py)

        dist = self._distance_cells(ux, uy, wx, wy)
        if dist < 0.05:
            if unit.order in ("move", "build") and self._distance_cells(ux, uy, tx, ty) < 0.75:
                unit.order = "idle"
                self._clear_unit_path(unit)
            return

        if step >= dist:
            nx, ny = wx, wy
        else:
            nx = ux + (wx - ux) / dist * step
            ny = uy + (wy - uy) / dist * step

        if self._is_walkable(int(round(nx)), int(round(ny)), unit.id):
            unit.x = nx
            unit.y = ny
            return

        # Local detour when the direct line is blocked.
        best: tuple[float, float] | None = None
        best_dist = 1e9
        for dx, dy, _ in NEIGHBORS_8:
            cx = int(round(ux)) + dx
            cy = int(round(uy)) + dy
            if not self._is_walkable(cx, cy, unit.id):
                continue
            d = self._distance_cells(cx, cy, wx, wy)
            if d < best_dist:
                best_dist = d
                best = (float(cx), float(cy))
        if best:
            bx, by = best
            detour_dist = self._distance_cells(ux, uy, bx, by)
            if detour_dist <= step:
                unit.x, unit.y = bx, by
            elif detour_dist > 0:
                unit.x = ux + (bx - ux) / detour_dist * step
                unit.y = uy + (by - uy) / detour_dist * step
        else:
            unit.repath_left = 0.0

    def _update_combat(self, dt: float) -> None:
        for unit in list(self.units.values()):
            if unit.kind in ("harvester", "engineer"):
                continue
            udef = UNIT_TYPES[unit.kind]
            if udef.get("damage", 0) <= 0:
                continue
            target_unit, target_bldg = self._acquire_target_for_unit(unit)
            if target_unit is None and target_bldg is None:
                continue

            if target_unit is not None:
                tx, ty = target_unit.x, target_unit.y
            else:
                if target_bldg is None:
                    continue
                tx, ty = self._building_center(target_bldg)
            d = self._distance_cells(unit.x, unit.y, tx, ty) * CELL
            attack_range = float(udef["range"])
            if d > attack_range:
                if unit.order != "move" or unit.manual_lock_left <= 0:
                    self._move_unit_toward(unit, tx, ty, dt)
                continue
            if unit.reload_left > 0:
                continue
            dmg = float(udef["damage"])
            if target_unit is not None:
                target_unit.hp -= dmg
            elif target_bldg is not None:
                target_bldg.hp -= dmg
            unit.reload_left = float(udef["reload"])

        for b in list(self.buildings.values()):
            bdef = BUILDING_TYPES[b.kind]
            if not bdef.get("turret"):
                continue
            if b.reload_left > 0:
                continue
            target = self._nearest_enemy_unit(b.team, *self._building_center(b), max_px=float(bdef["range"]))
            if target is None:
                continue
            target.hp -= float(bdef["damage"])
            b.reload_left = float(bdef["reload"])

    def _cleanup_dead_entities(self) -> None:
        dead_units = [u.id for u in self.units.values() if u.hp <= 0]
        for uid in dead_units:
            u = self.units.pop(uid)
            self.add_event(f"{self._team_name(u.team)} lost {UNIT_TYPES[u.kind]['label']}")
            for ts in self.teams.values():
                if ts.selected_unit_id == uid:
                    ts.selected_unit_id = None

        dead_buildings = [b.id for b in self.buildings.values() if b.hp <= 0]
        for bid in dead_buildings:
            b = self.buildings.pop(bid)
            self.add_event(f"{self._team_name(b.team)} lost {BUILDING_TYPES[b.kind]['label']}")
            for ts in self.teams.values():
                if ts.selected_building_id == bid:
                    ts.selected_building_id = None
        if dead_buildings:
            self._refresh_storage_caps()

        drained_resources = [rid for rid, r in self.resources.items() if r.kind == "spice" and r.amount <= 0]
        for rid in drained_resources:
            self.resources.pop(rid, None)

    def _update_economy(self, dt: float) -> None:
        self._oil_tick_left -= dt
        if self._oil_tick_left > 0:
            return
        self._oil_tick_left = OIL_TRICKLE_INTERVAL

        for team in (TEAM_PLAYER, TEAM_AI):
            derricks = sum(1 for b in self.buildings.values() if b.team == team and b.kind == "oilDerrick")
            if derricks <= 0:
                continue
            gain = derricks * OIL_TRICKLE_AMOUNT
            ts = self.teams[team]
            ts.spice = min(ts.spice + gain, ts.spice_capacity)

    def recompute_visibility(self) -> None:
        for team in (TEAM_PLAYER, TEAM_AI):
            ts = self.teams[team]
            for y in range(WORLD_CELLS_Y):
                row = ts.visible[y]
                for x in range(WORLD_CELLS_X):
                    row[x] = False

            for u in self.units.values():
                if u.team != team:
                    continue
                sight_cells = UNIT_TYPES[u.kind]["sight"]
                self._apply_vision_disk(ts, int(round(u.x)), int(round(u.y)), int(sight_cells))

            for b in self.buildings.values():
                if b.team != team:
                    continue
                sight_cells = int(BUILDING_TYPES[b.kind].get("sight", 8))
                cx, cy = self._building_center_int(b)
                self._apply_vision_disk(ts, cx, cy, sight_cells)

    def _apply_vision_disk(self, ts: TeamState, cx: int, cy: int, radius: int) -> None:
        y0 = max(0, cy - radius)
        y1 = min(WORLD_CELLS_Y - 1, cy + radius)
        x0 = max(0, cx - radius)
        x1 = min(WORLD_CELLS_X - 1, cx + radius)
        r2 = radius * radius
        for y in range(y0, y1 + 1):
            dy = y - cy
            for x in range(x0, x1 + 1):
                dx = x - cx
                if dx * dx + dy * dy <= r2:
                    ts.visible[y][x] = True
                    ts.explored[y][x] = True

    def _can_train_unit(self, team: int, ukind: str) -> bool:
        udef = UNIT_TYPES[ukind]
        for req in udef.get("requires", []):
            if req in RESEARCH:
                if req not in self.teams[team].completed_research:
                    return False
            else:
                if not any(b.team == team and b.kind == req for b in self.buildings.values()):
                    return False
        return True

    def _can_research(self, team: int, rkey: str) -> bool:
        if rkey in self.teams[team].completed_research:
            return False
        rdef = RESEARCH[rkey]
        for req in rdef.get("requires", []):
            if req in RESEARCH:
                if req not in self.teams[team].completed_research:
                    return False
            else:
                if not any(b.team == team and b.kind == req for b in self.buildings.values()):
                    return False
        return True

    def _can_build_structure(self, team: int, bkind: str) -> bool:
        bdef = BUILDING_TYPES[bkind]
        for req in bdef.get("build_requires", []):
            if req in RESEARCH:
                if req not in self.teams[team].completed_research:
                    return False
            else:
                if not any(b.team == team and b.kind == req for b in self.buildings.values()):
                    return False
        return True

    def _spend_spice(self, team: int, cost: float) -> bool:
        ts = self.teams[team]
        if ts.spice < cost:
            return False
        ts.spice -= cost
        return True

    def _can_place_building(self, x: int, y: int, w: int, h: int, bkind: str) -> bool:
        if x < 0 or y < 0 or x + w > WORLD_CELLS_X or y + h > WORLD_CELLS_Y:
            return False
        for cy in range(y, y + h):
            for cx in range(x, x + w):
                if self.tiles[cy][cx].terrain == TILE_RIDGE:
                    return False
                for b in self.buildings.values():
                    if b.x <= cx < b.x + b.w and b.y <= cy < b.y + b.h:
                        return False
                for u in self.units.values():
                    if int(round(u.x)) == cx and int(round(u.y)) == cy:
                        return False

        if BUILDING_TYPES[bkind].get("on_oil"):
            oil_here = any(r.kind == "oil" and r.x >= x and r.x < x + w and r.y >= y and r.y < y + h for r in self.resources.values())
            if not oil_here:
                return False
        return True

    def _is_walkable(self, x: int, y: int, moving_unit_id: int | None = None) -> bool:
        if not self._is_static_walkable(x, y):
            return False
        for u in self.units.values():
            if moving_unit_id is not None and u.id == moving_unit_id:
                continue
            if int(round(u.x)) == x and int(round(u.y)) == y:
                return False
        return True

    def _is_static_walkable(self, x: int, y: int) -> bool:
        if x < 0 or y < 0 or x >= WORLD_CELLS_X or y >= WORLD_CELLS_Y:
            return False
        if self.tiles[y][x].terrain == TILE_RIDGE:
            return False
        for b in self.buildings.values():
            if b.x <= x < b.x + b.w and b.y <= y < b.y + b.h:
                return False
        return True

    def _distance_cells(self, x1: float, y1: float, x2: float, y2: float) -> float:
        return math.hypot(x2 - x1, y2 - y1)

    def _nearest_resource(self, x: int, y: int, kind: str) -> ResourceNode | None:
        best = None
        best_d = 1e9
        for node in self.resources.values():
            if node.kind != kind or node.amount <= 0:
                continue
            d = self._distance_cells(x, y, node.x, node.y)
            if d < best_d:
                best_d = d
                best = node
        return best

    def _nearest_refinery_cell(self, team: int, x: int, y: int) -> tuple[int | None, int | None]:
        best = None
        best_d = 1e9
        for b in self.buildings.values():
            if b.team != team or b.kind != "refinery":
                continue
            adj = self._find_spawn_cell_near_building(b)
            ax, ay = adj
            if ax is None or ay is None:
                continue
            d = self._distance_cells(x, y, ax, ay)
            if d < best_d:
                best_d = d
                best = (ax, ay)
        if best is None:
            return None, None
        return best

    def _find_spawn_cell_near_building(self, b: Building) -> tuple[int | None, int | None]:
        cx, cy = self._building_center_int(b)
        for r in range(1, 8):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    x = cx + dx
                    y = cy + dy
                    if self._is_walkable(x, y):
                        return x, y
        return None, None

    def _building_center(self, b: Building) -> tuple[float, float]:
        return b.x + b.w / 2.0, b.y + b.h / 2.0

    def _building_center_int(self, b: Building) -> tuple[int, int]:
        cx, cy = self._building_center(b)
        return int(round(cx)), int(round(cy))

    def _nearest_enemy_unit(self, team: int, x: float, y: float, max_px: float) -> Unit | None:
        best = None
        best_d = 1e9
        for u in self.units.values():
            if u.team == team:
                continue
            d_px = self._distance_cells(x, y, u.x, u.y) * CELL
            if d_px <= max_px and d_px < best_d:
                best = u
                best_d = d_px
        return best

    def _acquire_target_for_unit(self, unit: Unit) -> tuple[Unit | None, Building | None]:
        team = unit.team
        udef = UNIT_TYPES[unit.kind]
        range_px = float(udef["range"])

        # Keep current explicit target if valid.
        if unit.target_unit_id is not None:
            tgt_u = self.units.get(unit.target_unit_id)
            if tgt_u and tgt_u.team != team and tgt_u.is_alive:
                return tgt_u, None
            unit.target_unit_id = None

        if unit.target_building_id is not None:
            tgt_b = self.buildings.get(unit.target_building_id)
            if tgt_b and tgt_b.team != team and tgt_b.is_alive:
                return None, tgt_b
            unit.target_building_id = None

        # Search nearby enemy units.
        nearest_u = self._nearest_enemy_unit(team, unit.x, unit.y, max_px=range_px * 1.35)
        if nearest_u is not None:
            return nearest_u, None

        # Attack-move can target buildings as fallback.
        if unit.order == "attack_move":
            nearest_b = None
            nearest_d = 1e9
            for b in self.buildings.values():
                if b.team == team:
                    continue
                bx, by = self._building_center(b)
                d = self._distance_cells(unit.x, unit.y, bx, by) * CELL
                if d < nearest_d:
                    nearest_d = d
                    nearest_b = b
            if nearest_b is not None:
                return None, nearest_b

        return None, None

    def _team_name(self, team: int) -> str:
        return "Player" if team == TEAM_PLAYER else "AI"

    def _check_win_conditions(self) -> None:
        player_hq_alive = any(b.team == TEAM_PLAYER and b.kind == "hq" for b in self.buildings.values())
        ai_hq_alive = any(b.team == TEAM_AI and b.kind == "hq" for b in self.buildings.values())
        if player_hq_alive and ai_hq_alive:
            return
        self.game_over = True
        if player_hq_alive and not ai_hq_alive:
            self.winner = TEAM_PLAYER
            self.add_event("Victory. Enemy command hub destroyed.")
        elif ai_hq_alive and not player_hq_alive:
            self.winner = TEAM_AI
            self.add_event("Defeat. Your command hub was destroyed.")
        else:
            self.winner = None
            self.add_event("Draw.")

    def _update_ai(self, dt: float) -> None:
        self.ai_think_left -= dt
        self.ai_attack_left -= dt

        if self.ai_think_left <= 0:
            self.ai_think_left = AI_THINK_INTERVAL
            self._ai_macro()

        if self.ai_attack_left <= 0:
            self.ai_attack_left = AI_ATTACK_INTERVAL
            self._ai_attack_wave()

    def _ai_macro(self) -> None:
        # Keep economy and production flowing with minimal script-like behavior.
        team = TEAM_AI
        aits = self.teams[team]

        # Make AI auto-harvest with idle harvesters.
        for u in self.units.values():
            if u.team == team and u.kind == "harvester" and u.order == "idle":
                node = self._nearest_resource(int(u.x), int(u.y), "spice")
                if node:
                    u.target_resource_id = node.id
                    u.order = "gather"

        # Build tech progression via nearest engineer.
        engineer = next((u for u in self.units.values() if u.team == team and u.kind == "engineer"), None)
        if engineer:
            owned = {b.kind for b in self.buildings.values() if b.team == team}
            for bkind in ("barracks", "lab", "factory", "airfield", "turret"):
                if bkind in owned:
                    continue
                if not self._can_build_structure(team, bkind):
                    continue
                cost = float(BUILDING_TYPES[bkind]["cost"])
                if aits.spice < cost:
                    continue
                bx = int(round(engineer.x + self.random.randint(-6, 6)))
                by = int(round(engineer.y + self.random.randint(-6, 6)))
                bx, by = self.clamp_cell(bx, by)
                ok = self._ai_place_building(engineer, bkind, bx, by)
                if ok:
                    break

        # Queue units from owned production buildings.
        for b in self.buildings.values():
            if b.team != team or len(b.queue) >= 3:
                continue
            queue_list = BUILDING_TYPES[b.kind].get("queue", [])
            if not queue_list:
                continue
            preferred = [k for k in queue_list if self._can_train_unit(team, k)]
            if not preferred:
                continue
            # Economy first, combat after.
            if "harvester" in preferred:
                harvesters = sum(1 for u in self.units.values() if u.team == team and u.kind == "harvester")
                if harvesters < 3:
                    ukind = "harvester"
                else:
                    ukind = self.random.choice([k for k in preferred if k != "harvester"] or preferred)
            else:
                ukind = self.random.choice(preferred)
            ucost = float(UNIT_TYPES[ukind]["cost"])
            if aits.spice >= ucost:
                aits.spice -= ucost
                b.queue.append(BuildQueueItem(kind=ukind, remaining=float(UNIT_TYPES[ukind]["build_time"])))

        # Run research opportunistically.
        lab = next((b for b in self.buildings.values() if b.team == team and b.kind == "lab"), None)
        if lab and lab.research_task is None:
            for rkey in BUILDING_TYPES["lab"]["research"]:
                if not self._can_research(team, rkey):
                    continue
                rcost = float(RESEARCH[rkey]["cost"])
                if aits.spice < rcost:
                    continue
                aits.spice -= rcost
                lab.research_task = ResearchTask(key=rkey, remaining=float(RESEARCH[rkey]["time"]))
                break

    def _ai_attack_wave(self) -> None:
        player_hq = next((b for b in self.buildings.values() if b.team == TEAM_PLAYER and b.kind == "hq"), None)
        if player_hq is None:
            return
        tx, ty = self._building_center(player_hq)
        for u in self.units.values():
            if u.team != TEAM_AI:
                continue
            if u.kind in ("harvester", "engineer"):
                continue
            u.order = "attack_move"
            u.tx = tx
            u.ty = ty
            u.manual_lock_left = 12.0

    def _ai_place_building(self, engineer: Unit, bkind: str, x: int, y: int) -> bool:
        bdef = BUILDING_TYPES[bkind]
        cost = float(bdef["cost"])
        team = engineer.team
        ts = self.teams[team]
        if ts.spice < cost:
            return False
        w, h = bdef["size"]
        ox = x - w // 2
        oy = y - h // 2
        if not self._can_place_building(ox, oy, w, h, bkind):
            return False
        ts.spice -= cost
        self._create_building(team, bkind, ox, oy)
        engineer.order = "build"
        engineer.tx = float(x)
        engineer.ty = float(y)
        engineer.manual_lock_left = MANUAL_ORDER_LOCK["build"]
        return True

    def find_path(self, sx: int, sy: int, tx: int, ty: int, max_expansions: int = 800) -> list[tuple[int, int]]:
        """A* path for future expansion; currently movement uses local steering.

        Keeping this implementation in the engine makes later AI and formation
        upgrades straightforward without reworking the package structure.
        """
        if (sx, sy) == (tx, ty):
            return [(sx, sy)]
        if not self._is_static_walkable(tx, ty):
            return []

        open_heap: list[tuple[float, int, tuple[int, int]]] = []
        heapq.heappush(open_heap, (0.0, 0, (sx, sy)))
        g_cost: dict[tuple[int, int], float] = {(sx, sy): 0.0}
        parent: dict[tuple[int, int], tuple[int, int]] = {}
        serial = 1
        expanded = 0

        while open_heap and expanded < max_expansions:
            _, _, node = heapq.heappop(open_heap)
            expanded += 1
            if node == (tx, ty):
                break
            nx, ny = node
            for dx, dy, w in NEIGHBORS_8:
                cx, cy = nx + dx, ny + dy
                if not self._is_static_walkable(cx, cy):
                    continue
                cand = g_cost[node] + w
                if cand >= g_cost.get((cx, cy), 1e18):
                    continue
                g_cost[(cx, cy)] = cand
                parent[(cx, cy)] = node
                h = math.hypot(tx - cx, ty - cy)
                heapq.heappush(open_heap, (cand + h, serial, (cx, cy)))
                serial += 1

        if (tx, ty) not in parent:
            return []
        path = [(tx, ty)]
        cur = (tx, ty)
        while cur != (sx, sy):
            cur = parent[cur]
            path.append(cur)
        path.reverse()
        return path

    def iter_player_visible_units(self) -> Iterable[Unit]:
        vis = self.teams[TEAM_PLAYER].visible
        for u in self.units.values():
            ux, uy = int(round(u.x)), int(round(u.y))
            if 0 <= ux < WORLD_CELLS_X and 0 <= uy < WORLD_CELLS_Y and vis[uy][ux]:
                yield u

    def iter_player_visible_buildings(self) -> Iterable[Building]:
        vis = self.teams[TEAM_PLAYER].visible
        for b in self.buildings.values():
            seen = False
            for y in range(b.y, b.y + b.h):
                for x in range(b.x, b.x + b.w):
                    if 0 <= x < WORLD_CELLS_X and 0 <= y < WORLD_CELLS_Y and vis[y][x]:
                        seen = True
                        break
                if seen:
                    break
            if seen:
                yield b

    def iter_player_visible_resources(self) -> Iterable[ResourceNode]:
        vis = self.teams[TEAM_PLAYER].visible
        for r in self.resources.values():
            if r.amount <= 0:
                continue
            if vis[r.y][r.x]:
                yield r


import curses



class Colors:
    HUD = 1
    TERRAIN = 2
    TERRAIN_DIM = 3
    PLAYER_UNIT = 4
    ENEMY_UNIT = 5
    PLAYER_BLDG = 6
    ENEMY_BLDG = 7
    SPICE = 8
    OIL = 9
    CURSOR = 10
    WARNING = 11
    FOG = 12


class Renderer:
    """Curses renderer for Sandfront terminal mode."""

    def __init__(self, stdscr: curses.window) -> None:
        self.stdscr = stdscr
        self._init_colors()

    def _init_colors(self) -> None:
        if not curses.has_colors():
            return
        curses.start_color()
        curses.use_default_colors()

        curses.init_pair(Colors.HUD, curses.COLOR_BLACK, curses.COLOR_YELLOW)
        curses.init_pair(Colors.TERRAIN, curses.COLOR_YELLOW, -1)
        curses.init_pair(Colors.TERRAIN_DIM, curses.COLOR_BLACK, -1)
        curses.init_pair(Colors.PLAYER_UNIT, curses.COLOR_GREEN, -1)
        curses.init_pair(Colors.ENEMY_UNIT, curses.COLOR_RED, -1)
        curses.init_pair(Colors.PLAYER_BLDG, curses.COLOR_CYAN, -1)
        curses.init_pair(Colors.ENEMY_BLDG, curses.COLOR_MAGENTA, -1)
        curses.init_pair(Colors.SPICE, curses.COLOR_YELLOW, -1)
        curses.init_pair(Colors.OIL, curses.COLOR_BLUE, -1)
        curses.init_pair(Colors.CURSOR, curses.COLOR_BLACK, curses.COLOR_WHITE)
        curses.init_pair(Colors.WARNING, curses.COLOR_RED, curses.COLOR_YELLOW)
        curses.init_pair(Colors.FOG, curses.COLOR_BLACK, -1)

    def screen_to_world(
        self,
        sx: int,
        sy: int,
        cam_x: int,
        cam_y: int,
        map_top: int,
        map_h: int,
        map_w: int,
    ) -> tuple[int, int] | None:
        if sy < map_top or sy >= map_top + map_h:
            return None
        wx = cam_x + sx
        wy = cam_y + (sy - map_top)
        if not (0 <= wx < WORLD_CELLS_X and 0 <= wy < WORLD_CELLS_Y):
            return None
        return wx, wy

    def render(
        self,
        game: SandfrontGame,
        cam_x: int,
        cam_y: int,
        cursor_x: int,
        cursor_y: int,
        paused: bool,
        fps: float,
    ) -> tuple[int, int, int]:
        self.stdscr.erase()
        max_y, max_x = self.stdscr.getmaxyx()

        map_top = 2
        map_h = max(8, max_y - 10)
        map_w = max(20, max_x)

        self._draw_top_bar(game, max_x, paused, fps)
        self._draw_map(game, cam_x, cam_y, map_top, map_h, map_w)
        self._draw_cursor(cam_x, cam_y, cursor_x, cursor_y, map_top, map_h, map_w)
        self._draw_bottom_panels(game, max_y, max_x, cursor_x, cursor_y)

        self.stdscr.noutrefresh()
        curses.doupdate()
        return map_top, map_h, map_w

    def _draw_top_bar(self, game: SandfrontGame, max_x: int, paused: bool, fps: float) -> None:
        p = game.teams[TEAM_PLAYER]
        status = "PAUSED" if paused else "LIVE"
        line = (
            f" Sandfront Terminal | {status} | Spice {int(p.spice)}/{int(p.spice_capacity)}"
            f" | Units {sum(1 for u in game.units.values() if u.team == TEAM_PLAYER)}"
            f" | Enemy {sum(1 for u in game.units.values() if u.team == TEAM_AI)}"
            f" | FPS {fps:4.1f}"
        )
        self._addstr_clipped(0, 0, line.ljust(max_x), curses.color_pair(Colors.HUD) | curses.A_BOLD)
        controls = " Arrows/WASD cursor  Shift+IJKL camera  SPACE select  M move  V atk-move  G gather  C stop  1-9 queue  U research-next  Alt+1..9 research-slot  H/R/S/O/B/L/F/Y/T build  Q quit"
        self._addstr_clipped(1, 0, controls.ljust(max_x), curses.A_DIM)

    def _draw_map(self, game: SandfrontGame, cam_x: int, cam_y: int, map_top: int, map_h: int, map_w: int) -> None:
        for sy in range(map_h):
            wy = cam_y + sy
            if wy < 0 or wy >= WORLD_CELLS_Y:
                continue
            for sx in range(map_w):
                wx = cam_x + sx
                if wx < 0 or wx >= WORLD_CELLS_X:
                    continue

                if not game.explored_for_player(wx, wy):
                    self._putch(map_top + sy, sx, " ", curses.color_pair(Colors.FOG))
                    continue

                ch = game.terrain_char(game.get_tile(wx, wy).terrain)
                attr = curses.color_pair(Colors.TERRAIN_DIM)
                if game.visible_for_player(wx, wy):
                    attr = curses.color_pair(Colors.TERRAIN)
                self._putch(map_top + sy, sx, ch, attr)

        for r in game.iter_player_visible_resources():
            sx = r.x - cam_x
            sy = r.y - cam_y
            if 0 <= sx < map_w and 0 <= sy < map_h:
                attr = curses.color_pair(Colors.SPICE if r.kind == "spice" else Colors.OIL)
                self._putch(map_top + sy, sx, RESOURCE_CHARS[r.kind], attr | curses.A_BOLD)

        for b in game.iter_player_visible_buildings():
            attr = curses.color_pair(Colors.PLAYER_BLDG if b.team == TEAM_PLAYER else Colors.ENEMY_BLDG)
            char = BUILDING_CHARS.get(b.kind, "#")
            for yy in range(b.h):
                for xx in range(b.w):
                    wx = b.x + xx
                    wy = b.y + yy
                    sx = wx - cam_x
                    sy = wy - cam_y
                    if not (0 <= sx < map_w and 0 <= sy < map_h):
                        continue
                    if yy in (0, b.h - 1) or xx in (0, b.w - 1):
                        draw = char
                    else:
                        draw = BUILDING_FILL_CHAR
                    self._putch(map_top + sy, sx, draw, attr)

        for u in game.iter_player_visible_units():
            sx = int(round(u.x)) - cam_x
            sy = int(round(u.y)) - cam_y
            if 0 <= sx < map_w and 0 <= sy < map_h:
                attr = curses.color_pair(Colors.PLAYER_UNIT if u.team == TEAM_PLAYER else Colors.ENEMY_UNIT)
                self._putch(map_top + sy, sx, UNIT_CHARS.get(u.kind, "?"), attr | curses.A_BOLD)

    def _draw_cursor(
        self,
        cam_x: int,
        cam_y: int,
        cursor_x: int,
        cursor_y: int,
        map_top: int,
        map_h: int,
        map_w: int,
    ) -> None:
        sx = cursor_x - cam_x
        sy = cursor_y - cam_y
        if 0 <= sx < map_w and 0 <= sy < map_h:
            try:
                ch = self.stdscr.inch(map_top + sy, sx) & 0xFF
                base = chr(ch) if 32 <= ch <= 126 else "X"
            except curses.error:
                base = "X"
            self._putch(map_top + sy, sx, base, curses.color_pair(Colors.CURSOR) | curses.A_BOLD)

    def _draw_bottom_panels(
        self,
        game: SandfrontGame,
        max_y: int,
        max_x: int,
        cursor_x: int,
        cursor_y: int,
    ) -> None:
        y = max_y - 7
        if y < 3:
            return

        p = game.teams[TEAM_PLAYER]
        selected = "Selection: none"
        if p.selected_unit_id is not None and p.selected_unit_id in game.units:
            u = game.units[p.selected_unit_id]
            selected = f"Selection Unit {u.id}: {u.kind} HP {int(u.hp)}/{int(u.max_hp)} Order {u.order}"
        elif p.selected_building_id is not None and p.selected_building_id in game.buildings:
            b = game.buildings[p.selected_building_id]
            selected = f"Selection Building {b.id}: {b.kind} HP {int(b.hp)}/{int(b.max_hp)}"
        self._addstr_clipped(y, 0, selected.ljust(max_x), curses.A_BOLD)

        unit, bldg, res = game.entities_at(cursor_x, cursor_y)
        hover = f"Cursor {cursor_x:03d},{cursor_y:03d}"
        if unit is not None:
            hover += f" | Unit {unit.kind} team {'P' if unit.team == TEAM_PLAYER else 'E'} HP {int(unit.hp)}"
        if bldg is not None:
            hover += f" | Building {bldg.kind} team {'P' if bldg.team == TEAM_PLAYER else 'E'} HP {int(bldg.hp)}"
        if res is not None:
            hover += f" | Resource {res.kind} {int(res.amount)}"
        self._addstr_clipped(y + 1, 0, hover.ljust(max_x), curses.A_DIM)

        queue_info = self._queue_panel(game)
        self._addstr_clipped(y + 2, 0, queue_info.ljust(max_x), curses.color_pair(Colors.PLAYER_BLDG))

        research_info = self._research_panel(game)
        self._addstr_clipped(y + 3, 0, research_info.ljust(max_x), curses.color_pair(Colors.PLAYER_UNIT))

        logs = game.recent_events
        for i in range(2):
            text = logs[i] if i < len(logs) else ""
            self._addstr_clipped(y + 4 + i, 0, text.ljust(max_x), curses.A_DIM)

    def _queue_panel(self, game: SandfrontGame) -> str:
        ts = game.teams[TEAM_PLAYER]
        if ts.selected_building_id is None or ts.selected_building_id not in game.buildings:
            return "Build Queue: select a building to queue units (1-9)."
        b = game.buildings[ts.selected_building_id]
        qtypes = BUILDING_TYPES[b.kind].get("queue", [])
        if not qtypes:
            return "Build Queue: selected building has no unit production."

        entries: list[str] = []
        for idx, kind in enumerate(qtypes, start=1):
            entries.append(f"{idx}:{kind}")
        line = "Queue " + "  ".join(entries)
        if b.queue:
            current = b.queue[0]
            line += f" | Producing {current.kind} ({current.remaining:0.1f}s)"
        return line

    def _research_panel(self, game: SandfrontGame) -> str:
        ts = game.teams[TEAM_PLAYER]
        if ts.selected_building_id is None or ts.selected_building_id not in game.buildings:
            return "Research: select Signal Lab. U starts next available; Alt+1..9 chooses a specific slot."
        b = game.buildings[ts.selected_building_id]
        if b.kind != "lab":
            return "Research: selected building is not a Signal Lab."
        if b.research_task is not None:
            return f"Research in progress: {b.research_task.key} ({b.research_task.remaining:0.1f}s)"
        completed = ", ".join(sorted(ts.completed_research)) or "none"
        return f"Research complete: {completed}"

    def _putch(self, y: int, x: int, ch: str, attr: int = 0) -> None:
        try:
            self.stdscr.addstr(y, x, ch, attr)
        except curses.error:
            pass

    def _addstr_clipped(self, y: int, x: int, text: str, attr: int = 0) -> None:
        max_y, max_x = self.stdscr.getmaxyx()
        if y < 0 or y >= max_y or x >= max_x:
            return
        clipped = text[: max_x - x]
        try:
            self.stdscr.addstr(y, x, clipped, attr)
        except curses.error:
            pass


from dataclasses import dataclass
import curses


@dataclass
class InputAction:
    quit: bool = False
    pause_toggle: bool = False
    camera_dx: int = 0
    camera_dy: int = 0
    cursor_dx: int = 0
    cursor_dy: int = 0
    select: bool = False
    move: bool = False
    attack_move: bool = False
    harvest: bool = False
    stop: bool = False
    queue_slot: int | None = None
    research_slot: int | None = None
    research_next: bool = False
    build_hotkey: str | None = None
    mouse_left: tuple[int, int] | None = None
    mouse_right: tuple[int, int] | None = None


class InputHandler:
    """Translate curses key events into semantic game actions."""

    def __init__(self) -> None:
        self._build_hotkeys = {"h", "r", "s", "o", "b", "l", "f", "y", "t"}
        self._queue_hotkeys = {
            "1": 0, "2": 1, "3": 2, "4": 3, "5": 4,
            "6": 5, "7": 6, "8": 7, "9": 8,
            "!": 0, "@": 1, "#": 2, "$": 3, "%": 4,
            "^": 5, "&": 6, "*": 7, "(": 8,
        }
        self._pending_alt = False

    def poll(self, stdscr: curses.window) -> InputAction:
        action = InputAction()
        while True:
            ch = stdscr.getch()
            if ch == -1:
                break
            self._consume_key(stdscr, ch, action)
        return action

    def _consume_key(self, stdscr: curses.window, ch: int, action: InputAction) -> None:
        if ch == 27:
            self._pending_alt = True
            return

        if ch in (ord("q"), ord("Q")):
            self._pending_alt = False
            action.quit = True
            return
        if ch in (ord(" "), ord("\n"), curses.KEY_ENTER):
            self._pending_alt = False
            action.select = True
            return
        if ch in (ord("p"), ord("P")):
            self._pending_alt = False
            action.pause_toggle = True
            return

        if ch in (curses.KEY_LEFT,):
            self._pending_alt = False
            action.cursor_dx -= 1
            return
        if ch in (curses.KEY_RIGHT,):
            self._pending_alt = False
            action.cursor_dx += 1
            return
        if ch in (curses.KEY_UP,):
            self._pending_alt = False
            action.cursor_dy -= 1
            return
        if ch in (curses.KEY_DOWN,):
            self._pending_alt = False
            action.cursor_dy += 1
            return

        if ch in (ord("a"), ord("A")):
            self._pending_alt = False
            action.cursor_dx -= 1
            return
        if ch in (ord("d"), ord("D")):
            self._pending_alt = False
            action.cursor_dx += 1
            return
        if ch in (ord("w"), ord("W")):
            self._pending_alt = False
            action.cursor_dy -= 1
            return
        if ch in (ord("x"), ord("X")):
            self._pending_alt = False
            action.cursor_dy += 1
            return

        if ch == ord("J"):
            self._pending_alt = False
            action.camera_dx -= 2
            return
        if ch == ord("L"):
            self._pending_alt = False
            action.camera_dx += 2
            return
        if ch == ord("I"):
            self._pending_alt = False
            action.camera_dy -= 2
            return
        if ch == ord("K"):
            self._pending_alt = False
            action.camera_dy += 2
            return

        if ch in (ord("m"), ord("M")):
            self._pending_alt = False
            action.move = True
            return
        if ch in (ord("v"), ord("V")):
            self._pending_alt = False
            action.attack_move = True
            return
        if ch in (ord("g"), ord("G")):
            self._pending_alt = False
            action.harvest = True
            return
        if ch in (ord("c"), ord("C")):
            self._pending_alt = False
            action.stop = True
            return

        if ch in (ord("u"), ord("U")):
            self._pending_alt = False
            action.research_next = True
            return

        if ch == curses.KEY_MOUSE:
            self._pending_alt = False
            self._consume_mouse(action)
            return

        try:
            raw_char = chr(ch)
        except ValueError:
            self._pending_alt = False
            return

        if self._pending_alt and raw_char in self._queue_hotkeys:
            action.research_slot = self._queue_hotkeys[raw_char]
            self._pending_alt = False
            return

        if raw_char in self._queue_hotkeys:
            action.queue_slot = self._queue_hotkeys[raw_char]
            self._pending_alt = False
            return

        char = raw_char.lower()

        self._pending_alt = False

        if char in self._build_hotkeys:
            action.build_hotkey = char

    def _consume_mouse(self, action: InputAction) -> None:
        try:
            _id, mx, my, _z, bstate = curses.getmouse()
        except curses.error:
            return
        if bstate & (curses.BUTTON1_CLICKED | curses.BUTTON1_PRESSED):
            action.mouse_left = (mx, my)
        if bstate & (curses.BUTTON3_CLICKED | curses.BUTTON3_PRESSED):
            action.mouse_right = (mx, my)


import argparse
import curses
import time



def run_headless(seconds: float, seed: int | None) -> int:
    game = SandfrontGame(seed=seed)
    dt = 0.1
    steps = max(1, int(seconds / dt))
    for _ in range(steps):
        game.tick(dt)
        if game.game_over:
            break
    p = game.teams[TEAM_PLAYER]
    print(
        f"Headless run complete | t={game.time_s:.1f}s | spice={int(p.spice)}"
        f" | units={len(game.units)} | buildings={len(game.buildings)} | game_over={game.game_over}"
    )
    return 0


def run_curses(stdscr: curses.window, seed: int | None) -> int:
    curses.curs_set(0)
    stdscr.nodelay(True)
    stdscr.keypad(True)
    try:
        curses.mousemask(curses.ALL_MOUSE_EVENTS | curses.REPORT_MOUSE_POSITION)
    except curses.error:
        pass

    game = SandfrontGame(seed=seed)
    renderer = Renderer(stdscr)
    input_handler = InputHandler()

    ts = game.teams[TEAM_PLAYER]
    if ts.selected_unit_id is None:
        # Select first player unit at startup for fast command flow.
        first = next((u for u in game.units.values() if u.team == TEAM_PLAYER), None)
        if first:
            game.select_at(TEAM_PLAYER, int(round(first.x)), int(round(first.y)))

    cursor_x, cursor_y = 12, 12
    cam_x, cam_y = 0, 0
    paused = False
    build_by_hotkey = {k.lower(): b for b, k in BUILD_HOTKEYS.items()}

    TARGET_FPS = 20
    FRAME_TIME = 1.0 / TARGET_FPS

    last_t = time.perf_counter()
    fps = 0.0
    map_top, map_h, map_w = renderer.render(game, cam_x, cam_y, cursor_x, cursor_y, paused, fps)

    while True:
        now = time.perf_counter()
        dt = min(0.08, now - last_t)
        if dt < FRAME_TIME:
            time.sleep(FRAME_TIME - dt)
            now = time.perf_counter()
            dt = min(0.08, now - last_t)
        if dt <= 0:
            dt = 0.016
        last_t = now
        fps = (0.92 * fps) + (0.08 * (1.0 / max(1e-6, dt)))

        action = input_handler.poll(stdscr)
        if action.quit:
            return 0
        if action.pause_toggle:
            paused = not paused

        cursor_x = _clamp(cursor_x + action.cursor_dx, 0, WORLD_CELLS_X - 1)
        cursor_y = _clamp(cursor_y + action.cursor_dy, 0, WORLD_CELLS_Y - 1)

        cam_x = _clamp(cam_x + action.camera_dx, 0, max(0, WORLD_CELLS_X - map_w))
        cam_y = _clamp(cam_y + action.camera_dy, 0, max(0, WORLD_CELLS_Y - map_h))

        # Keep cursor inside viewport for smooth keyboard play.
        if cursor_x < cam_x + 2:
            cam_x = _clamp(cursor_x - 2, 0, max(0, WORLD_CELLS_X - map_w))
        if cursor_x > cam_x + map_w - 3:
            cam_x = _clamp(cursor_x - map_w + 3, 0, max(0, WORLD_CELLS_X - map_w))
        if cursor_y < cam_y + 2:
            cam_y = _clamp(cursor_y - 2, 0, max(0, WORLD_CELLS_Y - map_h))
        if cursor_y > cam_y + map_h - 3:
            cam_y = _clamp(cursor_y - map_h + 3, 0, max(0, WORLD_CELLS_Y - map_h))

        if action.mouse_left is not None:
            world = renderer.screen_to_world(
                action.mouse_left[0],
                action.mouse_left[1],
                cam_x,
                cam_y,
                map_top,
                map_h,
                map_w,
            )
            if world:
                cursor_x, cursor_y = world
                game.select_at(TEAM_PLAYER, cursor_x, cursor_y)

        if action.mouse_right is not None:
            world = renderer.screen_to_world(
                action.mouse_right[0],
                action.mouse_right[1],
                cam_x,
                cam_y,
                map_top,
                map_h,
                map_w,
            )
            if world:
                cursor_x, cursor_y = world
                _issue_context_command(game, cursor_x, cursor_y)

        if action.select:
            game.select_at(TEAM_PLAYER, cursor_x, cursor_y)

        if action.move:
            if game.issue_move_selected(TEAM_PLAYER, cursor_x, cursor_y, attack_move=False):
                game.add_event(f"Move order to {cursor_x},{cursor_y}")
        if action.attack_move:
            if not game.issue_attack_selected(TEAM_PLAYER, cursor_x, cursor_y):
                game.issue_move_selected(TEAM_PLAYER, cursor_x, cursor_y, attack_move=True)
            game.add_event(f"Attack-move order to {cursor_x},{cursor_y}")
        if action.harvest:
            if game.issue_harvest_selected(TEAM_PLAYER, cursor_x, cursor_y):
                game.add_event("Harvester ordered to gather")
        if action.stop:
            if game.issue_stop_selected(TEAM_PLAYER):
                game.add_event("Unit stopped")

        if action.queue_slot is not None:
            ok, msg = game.queue_unit_from_selected_building(TEAM_PLAYER, action.queue_slot)
            game.add_event(msg)

        if action.research_next:
            ok, msg = game.start_next_available_research_from_selected(TEAM_PLAYER)
            game.add_event(msg)
        elif action.research_slot is not None:
            ok, msg = game.start_research_from_selected(TEAM_PLAYER, action.research_slot)
            game.add_event(msg)

        if action.build_hotkey is not None:
            bkind = build_by_hotkey.get(action.build_hotkey.lower())
            if bkind:
                ok, msg = game.build_with_selected_engineer(TEAM_PLAYER, bkind, cursor_x, cursor_y)
                game.add_event(msg)
                if ok:
                    game.select_at(TEAM_PLAYER, cursor_x, cursor_y)

        if not paused:
            game.tick(dt)

        map_top, map_h, map_w = renderer.render(game, cam_x, cam_y, cursor_x, cursor_y, paused, fps)


def _issue_context_command(game: SandfrontGame, wx: int, wy: int) -> None:
    if game.issue_attack_selected(TEAM_PLAYER, wx, wy):
        game.add_event(f"Attack command at {wx},{wy}")
        return
    if game.issue_harvest_selected(TEAM_PLAYER, wx, wy):
        game.add_event("Harvest command")
        return
    if game.issue_move_selected(TEAM_PLAYER, wx, wy, attack_move=False):
        game.add_event(f"Move command at {wx},{wy}")


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sandfront Command terminal edition")
    parser.add_argument("--seed", type=int, default=None, help="Deterministic map seed")
    parser.add_argument("--headless", action="store_true", help="Run simulation without curses")
    parser.add_argument("--seconds", type=float, default=20.0, help="Headless runtime")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.headless:
        return run_headless(seconds=args.seconds, seed=args.seed)
    return curses.wrapper(lambda stdscr: run_curses(stdscr, seed=args.seed))


if __name__ == "__main__":
    raise SystemExit(main())
