import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoadRoutingSubtiles,
  buildIntersectionTraversalPlan,
  carHasCommittedTrafficLightRightOfWay,
  carIsClearingTrafficLightIntersection,
  carHasConflictPriority,
  compareIntersectionRightOfWay,
  compareCarMovementOrder,
  getIntentLaneIndex,
  getOvertakeLaneIndex,
  canUseAdjacentOvertakeLane,
  findDirectedRoadPathTiles,
  findRoadSubtilePath,
  getTurnRelation,
  getPlannedRouteDirection,
  getBlockingTrafficLight,
  getBlockingIntersectionReservation,
  getDirectionDelta,
  getIntersectionBounds,
  getIntersectionManeuverSegments,
  getPendingIntersectionKeys,
  getProjectedCarConflict,
  getProjectedCarPoint,
  getQueuedCarDistance,
  isCommittedIntersectionTurn,
  getRemainingIntersectionReservationKeys,
  getTrafficLightKey,
  getTrafficPriorityScore,
  getTrafficLightClearanceDistance,
  getTrafficLightClearanceThreshold,
  getTrafficLightStopDistance,
  refreshCarTrafficLightCommitment,
  resolveVehicleRoadAnchor,
  reserveIntersectionIntent,
  trimIntersectionSegmentsToAnchor,
} from '../assets/js/microcity-traffic.js';

const GRASS = 0;
const ROAD_H = 1;
const ROAD_V = 2;
const ROAD_X = 3;
const TILE = 16;

function createCrossMap({ missingTopWestExit = false } = {}) {
  const map = Array.from({ length: 6 }, () => Array(6).fill(GRASS));

  for (let x = 0; x < 6; x++) {
    map[2][x] = ROAD_H;
    map[3][x] = ROAD_H;
  }
  for (let y = 0; y < 6; y++) {
    map[y][2] = ROAD_V;
    map[y][3] = ROAD_V;
  }

  map[2][2] = ROAD_X;
  map[2][3] = ROAD_X;
  map[3][2] = ROAD_X;
  map[3][3] = ROAD_X;

  if (missingTopWestExit) map[2][1] = GRASS;
  return map;
}

function isRoadTile(tile) {
  return tile === ROAD_H || tile === ROAD_V || tile === ROAD_X;
}

function supportsHorizontalLaneTile(tile) {
  return tile === ROAD_H || tile === ROAD_X;
}

function supportsVerticalLaneTile(tile) {
  return tile === ROAD_V || tile === ROAD_X;
}

function canDriveDirection(map, tx, ty, dir) {
  const [dx, dy] = getDirectionDelta(dir);
  return isRoadTile(map[ty + dy]?.[tx + dx]);
}

function canDriveDirectionStrict(map, tx, ty, dir) {
  const currentTile = map[ty]?.[tx];
  const supportsDirection = dir === 0 || dir === 2 ? supportsHorizontalLaneTile : supportsVerticalLaneTile;
  if (!supportsDirection(currentTile)) return false;
  const [dx, dy] = getDirectionDelta(dir);
  return supportsDirection(map[ty + dy]?.[tx + dx]);
}

function getHorizontalRoadBaseRowForTest(map, tx, ty) {
  if (ty > 0 && supportsHorizontalLaneTile(map[ty - 1]?.[tx])) return ty - 1;
  if (ty + 1 < map.length && supportsHorizontalLaneTile(map[ty + 1]?.[tx])) return ty;
  return ty;
}

function getVerticalRoadBaseColForTest(map, tx, ty) {
  if (tx > 0 && supportsVerticalLaneTile(map[ty]?.[tx - 1])) return tx - 1;
  if (tx + 1 < (map[0]?.length ?? 0) && supportsVerticalLaneTile(map[ty]?.[tx + 1])) return tx;
  return tx;
}

function normalizeRoadRouteTile(map, tile) {
  if (!tile) return null;
  const currentTile = map[tile.y]?.[tile.x];
  if (currentTile === ROAD_H) {
    return { x: tile.x, y: getHorizontalRoadBaseRowForTest(map, tile.x, tile.y) };
  }
  if (currentTile === ROAD_V) {
    return { x: getVerticalRoadBaseColForTest(map, tile.x, tile.y), y: tile.y };
  }
  return currentTile === ROAD_X ? { x: tile.x, y: tile.y } : null;
}

function getRoadRouteSubtiles(map, tx, ty) {
  return buildRoadRoutingSubtiles({
    tx,
    ty,
    tile: map[ty]?.[tx],
    roadH: ROAD_H,
    roadV: ROAD_V,
    roadX: ROAD_X,
    map,
    driveSide: 'right',
    canDriveDirection: (subtileTx, subtileTy, dir) => canDriveDirectionStrict(map, subtileTx, subtileTy, dir),
  });
}

function getCarHalfExtents(_car, dir = _car.dir) {
  if (dir === 0 || dir === 2) {
    return { x: 4.2, y: 2.7 };
  }
  return { x: 2.7, y: 4.2 };
}

function getLaneCenterForRoad(tx, ty, dir, laneIndex) {
  return {
    x: tx * TILE + 8 + dir * 0.01,
    y: ty * TILE + 8 + laneIndex * 0.01,
  };
}

function getIntersectionTurnWaypoint(tx, ty, fromDir, toDir) {
  return {
    x: tx * TILE + 8 + toDir * 0.01,
    y: ty * TILE + 8 + fromDir * 0.01,
  };
}

function makeWaypoint(x, y, exitDir, exitLaneDir, exitLaneIndex, roadTx, roadTy) {
  return { x, y, exitDir, exitLaneDir, exitLaneIndex, roadTx, roadTy };
}

function getPathTravelDistance(startPoint, waypoints) {
  let distance = 0;
  let current = startPoint;
  for (const waypoint of waypoints) {
    const dx = waypoint.x - current.x;
    const dy = waypoint.y - current.y;
    distance += Math.sqrt(dx * dx + dy * dy);
    current = waypoint;
  }
  return distance;
}

function createTrafficLight(overrides = {}) {
  const tl = {
    minX: 10,
    maxX: 11,
    minY: 20,
    maxY: 21,
    state: 'horizontal-green',
    ...overrides,
  };
  tl.tileKeys = new Set();
  for (let y = tl.minY; y <= tl.maxY; y++) {
    for (let x = tl.minX; x <= tl.maxX; x++) {
      tl.tileKeys.add(`${x},${y}`);
    }
  }
  return tl;
}

function signalContainsTile(tl, tx, ty) {
  return !!tl && tl.tileKeys.has(`${tx},${ty}`);
}

function isTrafficLightGreenForDir(tl, dir) {
  const axis = dir === 0 || dir === 2 ? 'horizontal' : 'vertical';
  return tl.state === `${axis}-green`;
}

function carOverlapsTrafficLightIntersection(car, tl) {
  const extents = getCarHalfExtents(car);
  const minX = tl.minX * TILE;
  const maxX = (tl.maxX + 1) * TILE;
  const minY = tl.minY * TILE;
  const maxY = (tl.maxY + 1) * TILE;
  return car.x + extents.x > minX &&
    car.x - extents.x < maxX &&
    car.y + extents.y > minY &&
    car.y - extents.y < maxY;
}

function carsOverlapAtPoints(firstCar, firstPoint, secondCar, secondPoint) {
  const firstExtents = getCarHalfExtents(firstCar);
  const secondExtents = getCarHalfExtents(secondCar);
  return Math.abs(firstPoint.x - secondPoint.x) < firstExtents.x + secondExtents.x - 0.2 &&
    Math.abs(firstPoint.y - secondPoint.y) < firstExtents.y + secondExtents.y - 0.2;
}

test('getIntersectionBounds finds the whole 2x2 cluster from any ROAD_X tile', () => {
  const map = createCrossMap();
  const bounds = getIntersectionBounds({
    map,
    startTile: { x: 3, y: 2 },
    roadX: ROAD_X,
  });

  assert.deepEqual(bounds, { minX: 2, maxX: 3, minY: 2, maxY: 3 });
});

test('getIntersectionManeuverSegments preserves the right-hand U-turn bridge', () => {
  const bounds = { minX: 2, maxX: 3, minY: 2, maxY: 3 };
  const segments = getIntersectionManeuverSegments({
    bounds,
    fromDir: 0,
    toDir: 2,
    driveSide: 'right',
  });

  assert.deepEqual(
    segments.map(segment => ({
      dir: segment.dir,
      turnTo: segment.turnTo ?? null,
      tiles: segment.tiles,
    })),
    [
      { dir: 0, turnTo: 3, tiles: [{ x: 2, y: 3 }, { x: 3, y: 3 }] },
      { dir: 3, turnTo: 2, tiles: [{ x: 3, y: 2 }] },
      { dir: 2, turnTo: null, tiles: [{ x: 2, y: 2 }] },
    ]
  );
});

test('trimIntersectionSegmentsToAnchor keeps only the remaining in-junction path', () => {
  const bounds = { minX: 2, maxX: 3, minY: 2, maxY: 3 };
  const segments = getIntersectionManeuverSegments({
    bounds,
    fromDir: 0,
    toDir: 2,
    driveSide: 'right',
  });

  const trimmed = trimIntersectionSegmentsToAnchor(segments, { x: 3, y: 2 });

  assert.deepEqual(
    trimmed.map(segment => ({
      dir: segment.dir,
      turnTo: segment.turnTo ?? null,
      tiles: segment.tiles,
    })),
    [
      { dir: 3, turnTo: 2, tiles: [{ x: 3, y: 2 }] },
      { dir: 2, turnTo: null, tiles: [{ x: 2, y: 2 }] },
    ]
  );
});

test('buildRoadRoutingSubtiles gives each intersection tile multi-entry and multi-exit directional strips', () => {
  const map = createCrossMap();
  const subtiles = getRoadRouteSubtiles(map, 2, 3);

  assert.equal(subtiles.length, 1);
  assert.deepEqual(subtiles[0].entryDirs, [0, 1, 2, 3]);
  assert.deepEqual(subtiles[0].exitDirs, [0, 1, 2, 3]);
});

test('findRoadSubtilePath keeps heading-specific turn state through an intersection', () => {
  const map = createCrossMap();
  const path = findRoadSubtilePath({
    start: { x: 2, y: 5 },
    goal: { x: 5, y: 2 },
    startDir: 3,
    getTileSubtiles: (tx, ty) => getRoadRouteSubtiles(map, tx, ty),
    normalizeTile: tile => normalizeRoadRouteTile(map, tile),
  });

  assert.ok(path);
  assert.deepEqual(
    path.map(subtile => ({ tx: subtile.tx, ty: subtile.ty, approachDir: subtile.approachDir, nextDir: subtile.nextDir })),
    [
      { tx: 2, ty: 5, approachDir: 3, nextDir: 3 },
      { tx: 2, ty: 4, approachDir: 3, nextDir: 3 },
      { tx: 2, ty: 3, approachDir: 3, nextDir: 0 },
      { tx: 3, ty: 3, approachDir: 0, nextDir: 0 },
      { tx: 4, ty: 2, approachDir: 0, nextDir: 0 },
      { tx: 5, ty: 2, approachDir: 0, nextDir: null },
    ]
  );
});

test('findRoadSubtilePath keeps distinct exit states for the same approach subtile when routes diverge', () => {
  const map = createCrossMap();
  const straightPath = findRoadSubtilePath({
    start: { x: 0, y: 2 },
    goal: { x: 5, y: 2 },
    startDir: 0,
    getTileSubtiles: (tx, ty) => getRoadRouteSubtiles(map, tx, ty),
    normalizeTile: tile => normalizeRoadRouteTile(map, tile),
  });
  const turnPath = findRoadSubtilePath({
    start: { x: 0, y: 2 },
    goal: { x: 2, y: 5 },
    startDir: 0,
    getTileSubtiles: (tx, ty) => getRoadRouteSubtiles(map, tx, ty),
    normalizeTile: tile => normalizeRoadRouteTile(map, tile),
  });

  const straightStep = straightPath.find(step => step.tx === 2 && step.ty === 2 && step.approachDir === 0);
  const turnStep = turnPath.find(step => step.tx === 2 && step.ty === 2 && step.approachDir === 0);

  assert.ok(straightStep);
  assert.ok(turnStep);
  assert.equal(straightStep.key, turnStep.key);
  assert.notEqual(straightStep.stateKey, turnStep.stateKey);
  assert.equal(straightStep.nextDir, 0);
  assert.equal(turnStep.nextDir, 1);
});

test('findRoadSubtilePath supports a right-hand turn route through the intersection', () => {
  const map = createCrossMap();
  const path = findRoadSubtilePath({
    start: { x: 0, y: 3 },
    goal: { x: 2, y: 5 },
    startDir: 0,
    getTileSubtiles: (tx, ty) => getRoadRouteSubtiles(map, tx, ty),
    normalizeTile: tile => normalizeRoadRouteTile(map, tile),
  });

  assert.ok(path);
  assert.deepEqual(
    path.map(step => ({ tx: step.tx, ty: step.ty, approachDir: step.approachDir, nextDir: step.nextDir })),
    [
      { tx: 0, ty: 2, approachDir: 0, nextDir: 0 },
      { tx: 1, ty: 2, approachDir: 0, nextDir: 0 },
      { tx: 2, ty: 2, approachDir: 0, nextDir: 1 },
      { tx: 2, ty: 3, approachDir: 1, nextDir: 1 },
      { tx: 2, ty: 4, approachDir: 1, nextDir: 1 },
      { tx: 2, ty: 5, approachDir: 1, nextDir: null },
    ]
  );
});

test('findDirectedRoadPathTiles keeps a north-south route on the same road strip instead of sending cars sideways across it', () => {
  const map = Array.from({ length: 6 }, () => Array(6).fill(GRASS));
  for (let y = 0; y < 6; y++) {
    map[y][2] = ROAD_V;
    map[y][3] = ROAD_V;
  }

  const path = findDirectedRoadPathTiles({
    start: { x: 3, y: 0 },
    goal: { x: 2, y: 5 },
    startDir: 1,
    getTileSubtiles: (tx, ty) => getRoadRouteSubtiles(map, tx, ty),
    normalizeTile: tile => normalizeRoadRouteTile(map, tile),
  });

  assert.deepEqual(path, [
    { x: 2, y: 0, nextDir: 1 },
    { x: 2, y: 1, nextDir: 1 },
    { x: 2, y: 2, nextDir: 1 },
    { x: 2, y: 3, nextDir: 1 },
    { x: 2, y: 4, nextDir: 1 },
    { x: 2, y: 5, nextDir: null },
  ]);
});

test('getPlannedRouteDirection uses the upcoming intersection exit while still on the approach tile', () => {
  const map = createCrossMap();
  const routeTiles = findDirectedRoadPathTiles({
    start: { x: 2, y: 5 },
    goal: { x: 5, y: 2 },
    startDir: 3,
    getTileSubtiles: (tx, ty) => getRoadRouteSubtiles(map, tx, ty),
    normalizeTile: tile => normalizeRoadRouteTile(map, tile),
  });

  assert.equal(getPlannedRouteDirection({
    routeTiles,
    routeIndex: 1,
    map,
    roadX: ROAD_X,
    currentTile: ROAD_V,
  }), 0);

  assert.equal(getPlannedRouteDirection({
    routeTiles,
    routeIndex: 2,
    map,
    roadX: ROAD_X,
    currentTile: ROAD_X,
  }), 0);
});

test('buildIntersectionTraversalPlan returns the full right-hand U-turn route without wrong exits', () => {
  const map = createCrossMap();
  const plan = buildIntersectionTraversalPlan({
    map,
    anchor: { x: 1, y: 3 },
    tile: ROAD_H,
    currentDir: 0,
    exitDir: 2,
    laneIndex: 1,
    roadX: ROAD_X,
    driveSide: 'right',
    isRoadTile,
    canDriveDirection: (tx, ty, dir) => canDriveDirection(map, tx, ty, dir),
    getLaneCenterForRoad,
    getIntersectionTurnWaypoint,
    makeWaypoint,
  });

  assert.ok(plan);
  assert.deepEqual(plan.entryTile, { x: 2, y: 3 });
  assert.deepEqual(plan.exitTile, { x: 1, y: 2 });
  assert.deepEqual(plan.intersectionTiles, [
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 2 },
    { x: 2, y: 2 },
  ]);
  assert.deepEqual(
    plan.waypoints.map(waypoint => ({ roadTx: waypoint.roadTx, roadTy: waypoint.roadTy, exitDir: waypoint.exitDir })),
    [
      { roadTx: 2, roadTy: 3, exitDir: 0 },
      { roadTx: 3, roadTy: 3, exitDir: 3 },
      { roadTx: 3, roadTy: 2, exitDir: 2 },
      { roadTx: 2, roadTy: 2, exitDir: 2 },
      { roadTx: 1, roadTy: 2, exitDir: 2 },
    ]
  );
});

test('buildIntersectionTraversalPlan returns the direct right-hand turn traversal', () => {
  const map = createCrossMap();
  const plan = buildIntersectionTraversalPlan({
    map,
    anchor: { x: 1, y: 3 },
    tile: ROAD_H,
    currentDir: 0,
    exitDir: 1,
    laneIndex: 1,
    roadX: ROAD_X,
    driveSide: 'right',
    isRoadTile,
    canDriveDirection: (tx, ty, dir) => canDriveDirection(map, tx, ty, dir),
    getLaneCenterForRoad,
    getIntersectionTurnWaypoint,
    makeWaypoint,
  });

  assert.ok(plan);
  assert.deepEqual(plan.entryTile, { x: 2, y: 3 });
  assert.deepEqual(plan.intersectionTiles, [{ x: 2, y: 3 }]);
  assert.deepEqual(
    plan.waypoints.map(waypoint => ({ roadTx: waypoint.roadTx, roadTy: waypoint.roadTy, exitDir: waypoint.exitDir })),
    [
      { roadTx: 2, roadTy: 3, exitDir: 1 },
      { roadTx: 2, roadTy: 4, exitDir: 1 },
    ]
  );
});

test('buildIntersectionTraversalPlan rejects a U-turn when the exit road would run into a dead end', () => {
  const map = createCrossMap({ missingTopWestExit: true });
  const plan = buildIntersectionTraversalPlan({
    map,
    anchor: { x: 1, y: 3 },
    tile: ROAD_H,
    currentDir: 0,
    exitDir: 2,
    laneIndex: 1,
    roadX: ROAD_X,
    driveSide: 'right',
    isRoadTile,
    canDriveDirection: (tx, ty, dir) => canDriveDirection(map, tx, ty, dir),
    getLaneCenterForRoad,
    getIntersectionTurnWaypoint,
    makeWaypoint,
  });

  assert.equal(plan, null);
});

test('buildIntersectionTraversalPlan trims to the remaining exit when already leaving the intersection', () => {
  const map = createCrossMap();
  const plan = buildIntersectionTraversalPlan({
    map,
    anchor: { x: 2, y: 2 },
    tile: ROAD_X,
    currentDir: 2,
    exitDir: 2,
    laneIndex: 1,
    roadX: ROAD_X,
    driveSide: 'right',
    isRoadTile,
    canDriveDirection: (tx, ty, dir) => canDriveDirection(map, tx, ty, dir),
    getLaneCenterForRoad,
    getIntersectionTurnWaypoint,
    makeWaypoint,
  });

  assert.ok(plan);
  assert.deepEqual(plan.entryTile, { x: 2, y: 2 });
  assert.deepEqual(plan.intersectionTiles, [{ x: 2, y: 2 }]);
  assert.deepEqual(plan.exitTile, { x: 1, y: 2 });
  assert.deepEqual(
    plan.waypoints.map(waypoint => ({ roadTx: waypoint.roadTx, roadTy: waypoint.roadTy, exitDir: waypoint.exitDir })),
    [{ roadTx: 1, roadTy: 2, exitDir: 2 }]
  );
  assert.deepEqual(
    getRemainingIntersectionReservationKeys({
      map,
      roadX: ROAD_X,
      anchor: plan.entryTile,
      waypoints: plan.waypoints,
    }),
    ['2,2']
  );
});

test('resolveVehicleRoadAnchor keeps the committed ROAD_X tile while a U-turn is still being followed', () => {
  const map = createCrossMap();

  assert.deepEqual(resolveVehicleRoadAnchor({
    car: {
      x: 31,
      y: 40,
      roadTx: 2,
      roadTy: 3,
      pendingRoadTx: 1,
      pendingRoadTy: 2,
      waypoints: [{ roadTx: 3, roadTy: 3 }, { roadTx: 1, roadTy: 2 }],
      driverIntent: { approachDir: 0, intersectionEntryTile: { x: 2, y: 3 } },
    },
    map,
    tileSize: TILE,
    isRoadTile,
    findNearestRoad: () => null,
  }), { x: 2, y: 3 });
});

test('resolveVehicleRoadAnchor switches to the car\'s current tile once the U-turn plan is finished', () => {
  const map = createCrossMap();

  assert.deepEqual(resolveVehicleRoadAnchor({
    car: {
      x: 31,
      y: 40,
      roadTx: 2,
      roadTy: 3,
      pendingRoadTx: null,
      pendingRoadTy: null,
      waypoints: [],
      driverIntent: null,
    },
    map,
    tileSize: TILE,
    isRoadTile,
    findNearestRoad: () => null,
  }), { x: 1, y: 2 });
});

test('traffic-light clearance stays negative before the intersection and positive only after clearing it', () => {
  const tl = { minX: 10, maxX: 11, minY: 20, maxY: 21 };

  assert.equal(
    getTrafficLightClearanceDistance({
      tl,
      car: { x: 150, y: 0, dir: 0 },
      tileSize: TILE,
    }),
    -42
  );
  assert.equal(
    getTrafficLightClearanceDistance({
      tl,
      car: { x: 195, y: 0, dir: 0 },
      tileSize: TILE,
    }),
    3
  );
  assert.equal(
    getTrafficLightClearanceDistance({
      tl,
      car: { x: 0, y: 315, dir: 1 },
      tileSize: TILE,
    }),
    -37
  );
  assert.equal(
    getTrafficLightClearanceDistance({
      tl,
      car: { x: 0, y: 357, dir: 1 },
      tileSize: TILE,
    }),
    5
  );

  const threshold = getTrafficLightClearanceThreshold({
    car: { dir: 0 },
    getCarHalfExtents: (_car, dir) => dir === 0 || dir === 2 ? { x: 4.2, y: 2.7 } : { x: 2.7, y: 4.2 },
  });
  assert.ok(Math.abs(threshold - 8.2) < 0.0001);
});

test('getRemainingIntersectionReservationKeys dedupes anchor and remaining ROAD_X waypoints', () => {
  const map = createCrossMap();
  const keys = getRemainingIntersectionReservationKeys({
    map,
    roadX: ROAD_X,
    anchor: { x: 2, y: 3 },
    waypoints: [
      { roadTx: 2, roadTy: 3 },
      { roadTx: 3, roadTy: 3 },
      { roadTx: 3, roadTy: 3 },
      { roadTx: 3, roadTy: 2 },
      { roadTx: 1, roadTy: 2 },
    ],
  });

  assert.deepEqual(keys, ['2,3', '3,3', '3,2']);
});

test('getPendingIntersectionKeys can plan missing intent before evaluating reservations', () => {
  const map = createCrossMap();
  const car = { waypoints: [], driverIntent: null };
  const keys = getPendingIntersectionKeys({
    map,
    roadX: ROAD_X,
    car,
    anchor: { x: 1, y: 3 },
    ensureWaypoints(currentCar) {
      currentCar.driverIntent = { approachDir: 0 };
      currentCar.waypoints = [
        { roadTx: 2, roadTy: 3 },
        { roadTx: 3, roadTy: 3 },
        { roadTx: 1, roadTy: 3 },
      ];
      return true;
    },
  });

  assert.deepEqual(keys, ['2,3', '3,3']);
});

test('getBlockingIntersectionReservation keeps existing reservations authoritative', () => {
  const map = createCrossMap();
  const car = {
    id: 1,
    driverIntent: { approachDir: 0 },
    waypoints: [{ roadTx: 2, roadTy: 3 }, { roadTx: 3, roadTy: 3 }],
  };
  const reservedBy = { id: 2 };

  const blocking = getBlockingIntersectionReservation({
    map,
    roadX: ROAD_X,
    car,
    anchor: { x: 1, y: 3 },
    intersectionReservations: new Map([['2,3', reservedBy]]),
  });

  assert.equal(blocking, reservedBy);
});

test('getBlockingIntersectionReservation blocks an opposite left turn when the junction tiles are already reserved', () => {
  const map = createCrossMap();
  const northboundLeft = {
    id: 1,
    driverIntent: { approachDir: 1, intersectionEntryTile: { x: 2, y: 2 } },
    waypoints: [
      { roadTx: 2, roadTy: 2 },
      { roadTx: 2, roadTy: 3 },
      { roadTx: 3, roadTy: 3 },
      { roadTx: 4, roadTy: 3 },
    ],
  };
  const southboundLeft = {
    id: 2,
    driverIntent: { approachDir: 3, intersectionEntryTile: { x: 3, y: 3 } },
    waypoints: [
      { roadTx: 3, roadTy: 3 },
      { roadTx: 3, roadTy: 2 },
      { roadTx: 2, roadTy: 2 },
      { roadTx: 1, roadTy: 2 },
    ],
  };
  const reservations = new Map([
    ['2,2', northboundLeft],
    ['2,3', northboundLeft],
    ['3,3', northboundLeft],
  ]);

  const blocking = getBlockingIntersectionReservation({
    map,
    roadX: ROAD_X,
    car: southboundLeft,
    anchor: { x: 3, y: 4 },
    intersectionReservations: reservations,
  });

  assert.equal(blocking, northboundLeft);
});

test('reserveIntersectionIntent only claims unreserved remaining junction keys', () => {
  const map = createCrossMap();
  const car = {
    id: 1,
    waypoints: [{ roadTx: 2, roadTy: 3 }, { roadTx: 3, roadTy: 3 }],
  };
  const otherCar = { id: 9 };
  const reservations = new Map([['3,3', otherCar]]);

  reserveIntersectionIntent({
    map,
    roadX: ROAD_X,
    intersectionReservations: reservations,
    car,
    anchor: { x: 2, y: 3 },
  });

  assert.equal(reservations.get('2,3'), car);
  assert.equal(reservations.get('3,3'), otherCar);
});

test('compareIntersectionRightOfWay makes a permissive left turn yield to opposite straight traffic', () => {
  const leftTurnCar = {
    driverIntent: { approachDir: 1 },
    dir: 1,
    pendingDir: 0,
  };
  const straightCar = {
    driverIntent: { approachDir: 3 },
    dir: 3,
    pendingDir: 3,
  };

  assert.equal(compareIntersectionRightOfWay({ car: leftTurnCar, other: straightCar }), -1);
  assert.equal(compareIntersectionRightOfWay({ car: straightCar, other: leftTurnCar }), 1);
});

test('carHasConflictPriority gives opposite straight traffic priority over a left turn before entry', () => {
  const framesToSeconds = frames => frames / 60;
  const leftTurnCar = {
    id: 1,
    vehicleType: 'civilian',
    mode: 'cruising',
    waiting: framesToSeconds(120),
    driverIntent: { approachDir: 1 },
    dir: 1,
    pendingDir: 0,
  };
  const straightCar = {
    id: 2,
    vehicleType: 'civilian',
    mode: 'cruising',
    waiting: 0,
    driverIntent: { approachDir: 3 },
    dir: 3,
    pendingDir: 3,
  };

  assert.equal(carHasConflictPriority({
    car: leftTurnCar,
    other: straightCar,
    getResponderPhase: () => false,
    isCarInIntersection: () => false,
    framesToSeconds,
  }), false);
  assert.equal(carHasConflictPriority({
    car: straightCar,
    other: leftTurnCar,
    getResponderPhase: () => false,
    isCarInIntersection: () => false,
    framesToSeconds,
  }), true);
});

test('getIntentLaneIndex picks the inner lane for left turns and the outer lane for right turns', () => {
  assert.equal(getTurnRelation(1, 0), 'left');
  assert.equal(getTurnRelation(1, 2), 'right');
  assert.equal(getIntentLaneIndex({
    currentDir: 1,
    nextDir: 0,
    preferredLaneIndex: 1,
    innerLaneIndex: 0,
    outerLaneIndex: 1,
  }), 0);
  assert.equal(getIntentLaneIndex({
    currentDir: 1,
    nextDir: 2,
    preferredLaneIndex: 0,
    innerLaneIndex: 0,
    outerLaneIndex: 1,
  }), 1);
});

test('getOvertakeLaneIndex uses the current lane and preserves an active overtake target', () => {
  assert.equal(getOvertakeLaneIndex({
    currentLaneIndex: 0,
    preferredLaneIndex: 1,
  }), 1);
  assert.equal(getOvertakeLaneIndex({
    currentLaneIndex: 1,
    preferredLaneIndex: 1,
  }), 0);
  assert.equal(getOvertakeLaneIndex({
    currentLaneIndex: 0,
    preferredLaneIndex: 1,
    activeLaneIndex: 1,
  }), 1);
});

test('traffic priority favors active responders over waiting civilians', () => {
  const framesToSeconds = frames => frames / 60;
  const responder = { id: 1, vehicleType: 'ambulance', mode: 'medical-response', waiting: framesToSeconds(15) };
  const civilian = { id: 2, vehicleType: 'civilian', mode: 'cruising', waiting: framesToSeconds(300) };
  const getResponderPhase = car => car.mode === 'medical-response';
  const isCarInIntersection = car => car === responder;

  const responderScore = getTrafficPriorityScore({
    car: responder,
    getResponderPhase,
    isCarInIntersection,
    framesToSeconds,
  });
  const civilianScore = getTrafficPriorityScore({
    car: civilian,
    getResponderPhase,
    isCarInIntersection,
    framesToSeconds,
  });

  assert.ok(responderScore > civilianScore);
  assert.equal(carHasConflictPriority({
    car: responder,
    other: civilian,
    getResponderPhase,
    isCarInIntersection,
    framesToSeconds,
  }), true);
});

test('compareCarMovementOrder uses waiting time to break equal-priority ties', () => {
  const framesToSeconds = frames => frames / 60;
  const getResponderPhase = () => false;
  const isCarInIntersection = () => false;
  const first = { id: 1, vehicleType: 'civilian', mode: 'cruising', waiting: framesToSeconds(30) };
  const second = { id: 2, vehicleType: 'civilian', mode: 'cruising', waiting: framesToSeconds(300) };

  assert.ok(compareCarMovementOrder({
    first,
    second,
    getResponderPhase,
    isCarInIntersection,
    framesToSeconds,
  }) > 0);
});

test('getTrafficLightStopDistance respects approach direction', () => {
  const tl = createTrafficLight();

  assert.equal(getTrafficLightStopDistance({ tl, car: { x: 150, y: 0, dir: 0 }, tileSize: TILE }), 4);
  assert.equal(getTrafficLightStopDistance({ tl, car: { x: 0, y: 314, dir: 1 }, tileSize: TILE }), 0);
  assert.equal(getTrafficLightStopDistance({ tl, car: { x: 210, y: 0, dir: 2 }, tileSize: TILE }), 12);
  assert.equal(getTrafficLightStopDistance({ tl, car: { x: 0, y: 365, dir: 3 }, tileSize: TILE }), 7);
});

test('carIsClearingTrafficLightIntersection only goes true after overlap, anchor entry, or positive clearance', () => {
  const tl = createTrafficLight();

  assert.equal(carIsClearingTrafficLightIntersection({
    car: { x: 170, y: 330, dir: 0 },
    tl,
    tileSize: TILE,
    getCarHalfExtents,
    carOverlapsTrafficLightIntersection,
    signalContainsTile,
  }), true);

  assert.equal(carIsClearingTrafficLightIntersection({
    car: { x: 40, y: 40, dir: 0 },
    tl,
    anchor: { x: 10, y: 20 },
    tileSize: TILE,
    getCarHalfExtents,
    carOverlapsTrafficLightIntersection,
    signalContainsTile,
  }), true);

  assert.equal(carIsClearingTrafficLightIntersection({
    car: { x: 195, y: 0, dir: 0 },
    tl,
    tileSize: TILE,
    getCarHalfExtents,
    carOverlapsTrafficLightIntersection,
    signalContainsTile,
  }), true);

  assert.equal(carIsClearingTrafficLightIntersection({
    car: { x: 150, y: 0, dir: 0 },
    tl,
    tileSize: TILE,
    getCarHalfExtents,
    carOverlapsTrafficLightIntersection,
    signalContainsTile,
  }), false);
});

test('refreshCarTrafficLightCommitment only commits once a green-lit car has actually entered', () => {
  const tl = createTrafficLight({ state: 'horizontal-green' });
  const car = {
    x: 153,
    y: 0,
    dir: 0,
    trafficLightCommitKey: null,
    driverIntent: { intersectionEntryTile: { x: 10, y: 20 }, approachDir: 0 },
  };
  const getCarDriverIntent = currentCar => currentCar.driverIntent;

  assert.equal(refreshCarTrafficLightCommitment({
    car,
    anchor: { x: 9, y: 20 },
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    carOverlapsTrafficLightIntersection,
  }), null);
  assert.equal(car.trafficLightCommitKey, null);

  car.x = 154;
  assert.equal(refreshCarTrafficLightCommitment({
    car,
    anchor: { x: 9, y: 20 },
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    carOverlapsTrafficLightIntersection,
  }), tl);
  assert.equal(car.trafficLightCommitKey, getTrafficLightKey(tl));
});

test('refreshCarTrafficLightCommitment clears stale commitment when the car is no longer entitled to it', () => {
  const tl = createTrafficLight({ state: 'horizontal-green' });
  const car = {
    x: 150,
    y: 0,
    dir: 0,
    trafficLightCommitKey: getTrafficLightKey(tl),
    driverIntent: null,
  };

  assert.equal(refreshCarTrafficLightCommitment({
    car,
    anchor: { x: 9, y: 20 },
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent: currentCar => currentCar.driverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    carOverlapsTrafficLightIntersection,
  }), null);
  assert.equal(car.trafficLightCommitKey, null);
});

test('getBlockingTrafficLight blocks red approaches but lets committed clearing cars continue', () => {
  const tl = createTrafficLight({ state: 'vertical-green' });
  const car = {
    x: 150,
    y: 0,
    dir: 0,
    trafficLightCommitKey: null,
    driverIntent: { intersectionEntryTile: { x: 10, y: 20 }, approachDir: 0 },
  };
  const getCarDriverIntent = currentCar => currentCar.driverIntent;

  assert.equal(getBlockingTrafficLight({
    car,
    anchor: { x: 9, y: 20 },
    currentTile: ROAD_H,
    roadX: ROAD_X,
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    carOverlapsTrafficLightIntersection,
  }), tl);

  car.trafficLightCommitKey = getTrafficLightKey(tl);
  car.x = 195;
  assert.equal(carHasCommittedTrafficLightRightOfWay({
    car,
    tl,
    anchor: { x: 12, y: 20 },
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    carOverlapsTrafficLightIntersection,
  }), true);
  assert.equal(getBlockingTrafficLight({
    car,
    anchor: { x: 12, y: 20 },
    currentTile: ROAD_H,
    roadX: ROAD_X,
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    carOverlapsTrafficLightIntersection,
  }), null);
});

test('getBlockingTrafficLight also blocks a green approach when the exit lane has no room', () => {
  const tl = createTrafficLight({ state: 'horizontal-green' });
  const car = {
    x: 150,
    y: 0,
    dir: 0,
    trafficLightCommitKey: null,
    driverIntent: { intersectionEntryTile: { x: 10, y: 20 }, approachDir: 0 },
  };

  assert.equal(getBlockingTrafficLight({
    car,
    anchor: { x: 9, y: 20 },
    currentTile: ROAD_H,
    roadX: ROAD_X,
    trafficLights: [tl],
    tileSize: TILE,
    getCarHalfExtents,
    getCarDriverIntent: currentCar => currentCar.driverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    hasTrafficLightExitRoom: () => false,
    carOverlapsTrafficLightIntersection,
  }), tl);
});

test('getQueuedCarDistance only considers the nearest same-lane lead vehicle', () => {
  const car = { x: 100, y: 100, dir: 0, laneIndex: 0 };
  const best = getQueuedCarDistance({
    car,
    cars: [
      car,
      { x: 120, y: 100, dir: 0, laneIndex: 0 },
      { x: 112, y: 108, dir: 0, laneIndex: 1 },
      { x: 90, y: 100, dir: 0, laneIndex: 0 },
      { x: 110, y: 100, dir: 1, laneIndex: 0 },
    ],
    getCarLaneIndex: currentCar => currentCar.laneIndex,
    getCarHalfExtents,
  });

  assert.ok(Math.abs(best - 11.6) < 0.0001);
});

test('isCommittedIntersectionTurn stays true only for an active turn after entering the junction', () => {
  assert.equal(isCommittedIntersectionTurn({
    car: {
      dir: 0,
      pendingDir: 1,
      driverIntent: { intersectionEntryTile: { x: 2, y: 3 } },
    },
    currentTile: ROAD_X,
    roadX: ROAD_X,
  }), true);

  assert.equal(isCommittedIntersectionTurn({
    car: {
      dir: 0,
      pendingDir: 0,
      driverIntent: { intersectionEntryTile: { x: 2, y: 3 } },
    },
    currentTile: ROAD_X,
    roadX: ROAD_X,
  }), false);

  assert.equal(isCommittedIntersectionTurn({
    car: {
      dir: 0,
      pendingDir: 1,
      driverIntent: { intersectionEntryTile: { x: 2, y: 3 } },
    },
    currentTile: ROAD_H,
    roadX: ROAD_X,
  }), false);
});

test('canUseAdjacentOvertakeLane blocks overtakes when the target lane is occupied through the forward corridor', () => {
  const car = { x: 100, y: 100, dir: 0 };
  const clear = canUseAdjacentOvertakeLane({
    car,
    cars: [car, { x: 136, y: 94, dir: 0 }],
    altLaneCenter: { x: 100, y: 94 },
    getCarHalfExtents,
    previewDistance: 48,
  });

  assert.equal(clear, false);
});

test('canUseAdjacentOvertakeLane allows overtakes when the target lane stays clear through the preview corridor', () => {
  const car = { x: 100, y: 100, dir: 0 };
  const clear = canUseAdjacentOvertakeLane({
    car,
    cars: [car, { x: 182, y: 94, dir: 0 }],
    altLaneCenter: { x: 100, y: 94 },
    getCarHalfExtents,
    previewDistance: 48,
  });

  assert.equal(clear, true);
});

test('canUseAdjacentOvertakeLane can ignore a nearby car that is still in the current adjacent lane when using a tighter lane-assist tolerance', () => {
  const car = { x: 100, y: 100, dir: 0 };
  const clear = canUseAdjacentOvertakeLane({
    car,
    cars: [car, { x: 112, y: 100, dir: 0 }],
    altLaneCenter: { x: 100, y: 94 },
    getCarHalfExtents,
    previewDistance: 36,
    lateralPadding: 0.25,
  });

  assert.equal(clear, true);
});

test('getProjectedCarPoint follows chained waypoints across multiple segments', () => {
  const point = getProjectedCarPoint({
    car: {
      x: 0,
      y: 0,
      waypoints: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
    distance: 15,
  });

  assert.deepEqual(point, { x: 10, y: 5 });
});

test('getProjectedCarConflict returns a safe distance for lower-priority overlap and null for higher priority', () => {
  const movingCar = {
    id: 1,
    x: 0,
    y: 0,
    dir: 0,
    waypoints: [{ x: 12, y: 0 }],
  };
  const blockingCar = { id: 2, x: 15, y: 0, dir: 0 };

  const conflict = getProjectedCarConflict({
    car: movingCar,
    travel: 12,
    cars: [movingCar, blockingCar],
    carsOverlapAtPoints,
    carHasConflictPriority: () => false,
  });

  assert.equal(conflict.other, blockingCar);
  assert.equal(conflict.safeDistance, 6);

  assert.equal(getProjectedCarConflict({
    car: movingCar,
    travel: 12,
    cars: [movingCar, blockingCar],
    carsOverlapAtPoints,
    carHasConflictPriority: () => true,
  }), null);
});

test('getProjectedCarConflict catches a U-turn overlap when the exit lane is occupied on arrival', () => {
  const map = createCrossMap();
  const plan = buildIntersectionTraversalPlan({
    map,
    anchor: { x: 1, y: 3 },
    tile: ROAD_H,
    currentDir: 0,
    exitDir: 2,
    laneIndex: 1,
    roadX: ROAD_X,
    driveSide: 'right',
    isRoadTile,
    canDriveDirection: (tx, ty, dir) => canDriveDirection(map, tx, ty, dir),
    getLaneCenterForRoad,
    getIntersectionTurnWaypoint,
    makeWaypoint,
  });

  const startPoint = getLaneCenterForRoad(1, 3, 0, 1);
  const movingCar = {
    id: 1,
    x: startPoint.x,
    y: startPoint.y,
    dir: 0,
    waypoints: plan.waypoints,
  };
  const arrivalWaypoint = plan.waypoints[plan.waypoints.length - 1];
  const blockingCar = {
    id: 2,
    x: arrivalWaypoint.x,
    y: arrivalWaypoint.y,
    dir: 2,
  };
  const travel = getPathTravelDistance(startPoint, plan.waypoints);

  const conflict = getProjectedCarConflict({
    car: movingCar,
    travel,
    cars: [movingCar, blockingCar],
    carsOverlapAtPoints,
    carHasConflictPriority: () => false,
  });

  assert.equal(conflict.other, blockingCar);
  assert.ok(conflict.safeDistance < travel);
  assert.ok(conflict.safeDistance > 0);
});