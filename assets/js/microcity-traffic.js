export function createRoadTileKey(tx, ty) {
  return `${tx},${ty}`;
}

export function getDirectionDelta(dir) {
  return [[1, 0], [0, 1], [-1, 0], [0, -1]][dir] || [0, 0];
}

export function getTurnRelation(fromDir, toDir) {
  if (!Number.isInteger(fromDir) || !Number.isInteger(toDir) || fromDir === toDir) return 'straight';
  if (toDir === (fromDir + 3) % 4) return 'left';
  if (toDir === (fromDir + 1) % 4) return 'right';
  if (toDir === (fromDir + 2) % 4) return 'uturn';
  return 'straight';
}

export function getIntentLaneIndex({
  currentDir,
  nextDir,
  preferredLaneIndex,
  outerLaneIndex = 1,
  innerLaneIndex = 0,
  overtakeLaneIndex = null,
}) {
  const turnRelation = getTurnRelation(currentDir, nextDir);
  if (turnRelation === 'left' || turnRelation === 'uturn') return innerLaneIndex;
  if (turnRelation === 'right') return outerLaneIndex;
  if (Number.isInteger(overtakeLaneIndex) && nextDir === currentDir) return overtakeLaneIndex;
  return preferredLaneIndex;
}

export function getOvertakeLaneIndex({
  currentLaneIndex,
  preferredLaneIndex,
  activeLaneIndex = null,
  getAdjacentLaneIndexFn = laneIndex => laneIndex === 0 ? 1 : 0,
}) {
  if (Number.isInteger(activeLaneIndex)) return activeLaneIndex;
  const baseLaneIndex = Number.isInteger(currentLaneIndex) ? currentLaneIndex : preferredLaneIndex;
  if (!Number.isInteger(baseLaneIndex)) return null;
  return getAdjacentLaneIndexFn(baseLaneIndex);
}

export function createRoadSubtileKey(tx, ty, approachDir) {
  return `${tx},${ty}:${approachDir}`;
}

export function getRoadSubtileExitPriority(approachDir) {
  return [approachDir, (approachDir + 1) % 4, (approachDir + 3) % 4, (approachDir + 2) % 4];
}

export function buildRoadRoutingSubtiles({
  tx,
  ty,
  tile,
  roadH,
  roadV,
  roadX,
  map,
  driveSide = 'right',
  canDriveDirection,
  canApproachDirection,
  getExitPriority = getRoadSubtileExitPriority,
  createSubtileKey = createRoadSubtileKey,
}) {
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || typeof canDriveDirection !== 'function') return [];

  const createSubtile = (approachDir, exitDirs, kind) => ({
    key: createSubtileKey(tx, ty, approachDir),
    tx,
    ty,
    tile,
    kind,
    approachDir,
    entryDirs: [approachDir],
    exitDirs: [...new Set((exitDirs || []).filter(Number.isInteger))],
  });

  if (tile === roadH) {
    return [0, 2].map(approachDir => createSubtile(
      approachDir,
      canDriveDirection(tx, ty, approachDir) ? [approachDir] : [],
      'corridor'
    ));
  }

  if (tile === roadV) {
    return [1, 3].map(approachDir => createSubtile(
      approachDir,
      canDriveDirection(tx, ty, approachDir) ? [approachDir] : [],
      'corridor'
    ));
  }

  if (tile !== roadX) return [];

  const canApproach = typeof canApproachDirection === 'function'
    ? canApproachDirection
    : ({ tx: subtileTx, ty: subtileTy, approachDir }) => {
      const [dx, dy] = getDirectionDelta(approachDir);
      return canDriveDirection(subtileTx - dx, subtileTy - dy, approachDir);
    };

  const entryDirs = [0, 1, 2, 3].filter(approachDir => canApproach({ tx, ty, approachDir }));
  const exitDirs = [0, 1, 2, 3].filter(exitDir => canDriveDirection(tx, ty, exitDir));
  if (!entryDirs.length && !exitDirs.length) return [];

  return [{
    key: `${tx},${ty}:${entryDirs.join('|') || 'none'}->${exitDirs.join('|') || 'none'}`,
    tx,
    ty,
    tile,
    kind: 'intersection',
    approachDir: entryDirs.length === 1 ? entryDirs[0] : null,
    entryDirs,
    exitDirs,
  }];
}

export function findRoadSubtilePath({
  start,
  goal,
  startDir = null,
  getTileSubtiles,
  normalizeTile = tile => tile ? { x: tile.x, y: tile.y } : null,
  maxVisited = Number.MAX_SAFE_INTEGER,
  getExitPriority = getRoadSubtileExitPriority,
  getDirectionDelta: getDelta = getDirectionDelta,
  getRoadTileKey = createRoadTileKey,
}) {
  if (!start || !goal || typeof getTileSubtiles !== 'function') return null;

  const routeStart = normalizeTile(start);
  const routeGoal = normalizeTile(goal);
  if (!routeStart || !routeGoal) return null;

  const subtileCache = new Map();
  const subtileByKey = new Map();
  const routeStateCache = new Map();
  const routeStateByKey = new Map();
  const getTileKey = tilePoint => getRoadTileKey(tilePoint.x, tilePoint.y);
  const getSubtilesForTile = tilePoint => {
    const tileKey = getTileKey(tilePoint);
    if (!subtileCache.has(tileKey)) {
      const subtiles = (getTileSubtiles(tilePoint.x, tilePoint.y) || []).map(subtile => ({ ...subtile }));
      subtileCache.set(tileKey, subtiles);
      for (const subtile of subtiles) subtileByKey.set(subtile.key, subtile);
    }
    return subtileCache.get(tileKey);
  };
  const getRouteStateKey = (subtile, entryDir = null, exitDir = null) => `${subtile.key}:${Number.isInteger(entryDir) ? entryDir : 'start'}->${Number.isInteger(exitDir) ? exitDir : 'stop'}`;
  const getRouteStatesForTile = tilePoint => {
    const tileKey = getTileKey(tilePoint);
    if (!routeStateCache.has(tileKey)) {
      const states = [];
      for (const subtile of getSubtilesForTile(tilePoint)) {
        const entryDirs = [...new Set((subtile.entryDirs || []).filter(Number.isInteger))];
        const exitDirs = [...new Set((subtile.exitDirs || []).filter(Number.isInteger))];
        const stateEntryDirs = entryDirs.length ? entryDirs : [null];
        const stateExitDirs = exitDirs.length ? exitDirs : [null];

        for (const entryDir of stateEntryDirs) {
          const orderedExitDirs = Number.isInteger(entryDir)
            ? (getExitPriority(entryDir) || []).filter(exitDir => stateExitDirs.includes(exitDir))
            : stateExitDirs;
          const resolvedExitDirs = orderedExitDirs.length ? orderedExitDirs : stateExitDirs;
          for (const exitDir of resolvedExitDirs) {
            const state = {
              stateKey: getRouteStateKey(subtile, entryDir, exitDir),
              entryDir,
              exitDir,
              subtile,
            };
            states.push(state);
            routeStateByKey.set(state.stateKey, state);
          }
        }
      }
      routeStateCache.set(tileKey, states);
    }
    return routeStateCache.get(tileKey);
  };

  const matchesStartDir = state => !Number.isInteger(startDir) || state.entryDir === startDir;
  const startStates = getRouteStatesForTile(routeStart);
  const activeStartStates = startStates.filter(matchesStartDir);
  const queue = activeStartStates.length ? [...activeStartStates] : [...startStates];
  if (!queue.length) return null;

  const prev = new Map();
  const seen = new Set(queue.map(state => state.stateKey));
  let queueIndex = 0;
  let visited = 0;
  let goalStateKey = null;

  if (routeStart.x === routeGoal.x && routeStart.y === routeGoal.y) {
    goalStateKey = queue[0].stateKey;
  }

  while (!goalStateKey && queueIndex < queue.length && visited < maxVisited) {
    const current = queue[queueIndex++];
    visited += 1;
    if (current.subtile.tx === routeGoal.x && current.subtile.ty === routeGoal.y) {
      goalStateKey = current.stateKey;
      break;
    }

    if (!Number.isInteger(current.exitDir)) continue;

    const [dx, dy] = getDelta(current.exitDir);
    const nextTile = normalizeTile({ x: current.subtile.tx + dx, y: current.subtile.ty + dy });
    if (!nextTile) continue;
    for (const nextState of getRouteStatesForTile(nextTile)) {
      if (nextState.entryDir !== current.exitDir) continue;
      if (seen.has(nextState.stateKey)) continue;
      seen.add(nextState.stateKey);
      prev.set(nextState.stateKey, current.stateKey);
      queue.push(nextState);
    }
  }

  if (!goalStateKey) return null;

  const reversedPath = [];
  let currentStateKey = goalStateKey;
  while (currentStateKey) {
    const state = routeStateByKey.get(currentStateKey);
    if (!state) return null;
    reversedPath.push({
      ...state.subtile,
      stateKey: state.stateKey,
      approachDir: state.entryDir,
      exitDir: state.exitDir,
      nextDir: null,
    });
    currentStateKey = prev.get(currentStateKey) ?? null;
  }

  const path = reversedPath.reverse();
  for (let index = 0; index < path.length - 1; index++) {
    path[index].nextDir = Number.isInteger(path[index].exitDir) ? path[index].exitDir : null;
  }
  if (path.length) path[path.length - 1].nextDir = null;
  return path;
}

export function findDirectedRoadPathTiles({
  start,
  goal,
  startDir = null,
  canDriveDirection,
  getTileSubtiles,
  normalizeTile = tile => tile ? { x: tile.x, y: tile.y } : null,
  maxVisited = Number.MAX_SAFE_INTEGER,
  getDirectionDelta: getDelta = getDirectionDelta,
  getRoadTileKey = createRoadTileKey,
}) {
  if (typeof getTileSubtiles === 'function') {
    const subtilePath = findRoadSubtilePath({
      start,
      goal,
      startDir,
      getTileSubtiles,
      normalizeTile,
      maxVisited,
      getDirectionDelta: getDelta,
      getRoadTileKey,
    });
    return subtilePath ? subtilePath.map(subtile => ({ x: subtile.tx, y: subtile.ty, nextDir: subtile.nextDir })) : null;
  }

  if (!start || !goal || typeof canDriveDirection !== 'function') return null;

  const routeStart = normalizeTile(start);
  const routeGoal = normalizeTile(goal);
  if (!routeStart || !routeGoal) return null;
  if (routeStart.x === routeGoal.x && routeStart.y === routeGoal.y) {
    return [{ x: routeStart.x, y: routeStart.y }];
  }

  const queue = [{ x: routeStart.x, y: routeStart.y }];
  const prev = new Map();
  const seen = new Set([getRoadTileKey(routeStart.x, routeStart.y)]);
  let queueIndex = 0;
  let visited = 0;

  while (queueIndex < queue.length && visited < maxVisited) {
    const current = queue[queueIndex++];
    visited += 1;
    if (current.x === routeGoal.x && current.y === routeGoal.y) break;

    for (const dir of [0, 1, 2, 3]) {
      if (!canDriveDirection(current.x, current.y, dir)) continue;
      const [dx, dy] = getDelta(dir);
      const next = normalizeTile({ x: current.x + dx, y: current.y + dy });
      if (!next) continue;
      const nextKey = getRoadTileKey(next.x, next.y);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      prev.set(nextKey, current);
      queue.push(next);
    }
  }

  const goalKey = getRoadTileKey(routeGoal.x, routeGoal.y);
  if (!seen.has(goalKey)) return null;

  const path = [];
  let current = routeGoal;
  while (current) {
    path.push(current);
    if (current.x === routeStart.x && current.y === routeStart.y) break;
    current = prev.get(getRoadTileKey(current.x, current.y));
  }
  path.reverse();
  return path;
}

export function getPlannedRouteDirection({
  routeTiles,
  routeIndex,
  map,
  roadX,
  currentTile,
}) {
  const currentStep = routeTiles?.[routeIndex];
  if (!currentStep) return null;

  const currentNextDir = Number.isInteger(currentStep.nextDir) ? currentStep.nextDir : null;
  if (currentTile === roadX) return currentNextDir;

  const nextStep = routeTiles?.[routeIndex + 1];
  if (!nextStep) return currentNextDir;
  if (map?.[nextStep.y]?.[nextStep.x] === roadX && Number.isInteger(nextStep.nextDir)) {
    return nextStep.nextDir;
  }

  return currentNextDir;
}

export function resolveVehicleRoadAnchor({
  car,
  map,
  tileSize,
  isRoadTile,
  findNearestRoad,
}) {
  if (!car || !map?.length || !(tileSize > 0) || typeof isRoadTile !== 'function') return null;

  const mapWidth = map[0]?.length ?? 0;
  const mapHeight = map.length;
  const getAnchorIfRoad = (tx, ty) => {
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return null;
    if (!(tx >= 0 && tx < mapWidth && ty >= 0 && ty < mapHeight)) return null;
    return isRoadTile(map[ty]?.[tx]) ? { x: tx, y: ty } : null;
  };

  const storedAnchor = getAnchorIfRoad(car.roadTx, car.roadTy);
  const currentAnchor = getAnchorIfRoad(
    Number.isFinite(car.x) ? Math.floor(car.x / tileSize) : null,
    Number.isFinite(car.y) ? Math.floor(car.y / tileSize) : null
  );
  const hasCommittedManeuver = !!car.waypoints?.length || !!car.driverIntent ||
    Number.isInteger(car.pendingRoadTx) || Number.isInteger(car.pendingRoadTy);

  if (hasCommittedManeuver && storedAnchor) return storedAnchor;
  if (currentAnchor) return currentAnchor;
  if (storedAnchor) return storedAnchor;
  return typeof findNearestRoad === 'function' ? findNearestRoad(car.x, car.y) : null;
}

export function getTrafficLightClearanceDistance({ tl, car, tileSize, dir = car?.dir }) {
  if (!tl || !car) return Infinity;
  switch (dir) {
    case 0:
      return car.x - ((tl.maxX + 1) * tileSize);
    case 1:
      return car.y - ((tl.maxY + 1) * tileSize);
    case 2:
      return tl.minX * tileSize - car.x;
    default:
      return tl.minY * tileSize - car.y;
  }
}

export function getTrafficLightClearanceThreshold({ car, dir = car?.dir, getCarHalfExtents }) {
  if (!car || typeof getCarHalfExtents !== 'function') return Infinity;
  const extents = getCarHalfExtents(car, dir);
  if (!extents) return Infinity;
  const forwardExtent = dir === 0 || dir === 2 ? extents.x : extents.y;
  return forwardExtent + 4;
}

export function getTrafficLightKey(tl) {
  return tl ? `${tl.minX},${tl.minY},${tl.maxX},${tl.maxY}` : null;
}

export function getTrafficLightStopDistance({ tl, car, tileSize, dir = car?.dir, stopOffset = 6 }) {
  if (!tl || !car) return Infinity;
  switch (dir) {
    case 0:
      return tl.minX * tileSize - stopOffset - car.x;
    case 1:
      return tl.minY * tileSize - stopOffset - car.y;
    case 2:
      return car.x - ((tl.maxX + 1) * tileSize + stopOffset);
    default:
      return car.y - ((tl.maxY + 1) * tileSize + stopOffset);
  }
}

export function carIsClearingTrafficLightIntersection({
  car,
  tl,
  anchor = null,
  tileSize,
  getCarHalfExtents,
  carOverlapsTrafficLightIntersection = () => false,
  signalContainsTile = () => false,
  getClearanceDistance = getTrafficLightClearanceDistance,
  getClearanceThreshold = getTrafficLightClearanceThreshold,
}) {
  if (!car || !tl) return false;
  if (carOverlapsTrafficLightIntersection(car, tl)) return true;
  if (anchor && signalContainsTile(tl, anchor.x, anchor.y)) return true;
  const clearanceDistance = getClearanceDistance({ tl, car, tileSize, dir: car.dir });
  return clearanceDistance >= 0 && clearanceDistance < getClearanceThreshold({ car, dir: car.dir, getCarHalfExtents });
}

export function getCarIntentTrafficLight({
  car,
  anchor,
  trafficLights = [],
  getCarDriverIntent,
  signalContainsTile,
}) {
  if (typeof getCarDriverIntent !== 'function' || typeof signalContainsTile !== 'function') return null;
  const intent = getCarDriverIntent(car, anchor);
  if (!intent?.intersectionEntryTile) return null;
  for (const tl of trafficLights) {
    if (signalContainsTile(tl, intent.intersectionEntryTile.x, intent.intersectionEntryTile.y)) {
      return { tl, intent };
    }
  }
  return null;
}

export function carHasCommittedTrafficLightRightOfWay({
  car,
  tl,
  anchor,
  trafficLights = [],
  tileSize,
  getCarHalfExtents,
  getCarDriverIntent,
  signalContainsTile,
  getLightKey = getTrafficLightKey,
  isClearingTrafficLightIntersection = carIsClearingTrafficLightIntersection,
  getIntentTrafficLight = getCarIntentTrafficLight,
  getStopDistance = getTrafficLightStopDistance,
  carOverlapsTrafficLightIntersection = () => false,
}) {
  if (!car || !tl) return false;
  if (car.trafficLightCommitKey !== getLightKey(tl)) return false;
  if (isClearingTrafficLightIntersection({
    car,
    tl,
    anchor,
    tileSize,
    getCarHalfExtents,
    signalContainsTile,
    carOverlapsTrafficLightIntersection,
  })) {
    return true;
  }

  const intentTrafficLight = getIntentTrafficLight({
    car,
    anchor,
    trafficLights,
    getCarDriverIntent,
    signalContainsTile,
  });
  if (intentTrafficLight?.tl && getLightKey(intentTrafficLight.tl) === car.trafficLightCommitKey) {
    return getStopDistance({ tl, car, tileSize, dir: car.dir }) <= 0;
  }

  return false;
}

export function refreshCarTrafficLightCommitment({
  car,
  anchor,
  trafficLights = [],
  tileSize,
  getCarHalfExtents,
  getCarDriverIntent,
  signalContainsTile,
  isTrafficLightGreenForDir,
  getLightKey = getTrafficLightKey,
  isClearingTrafficLightIntersection = carIsClearingTrafficLightIntersection,
  getIntentTrafficLight = getCarIntentTrafficLight,
  hasCommittedTrafficLightRightOfWay = carHasCommittedTrafficLightRightOfWay,
  getStopDistance = getTrafficLightStopDistance,
  carOverlapsTrafficLightIntersection = () => false,
}) {
  const getTrafficLightByKey = lightKey => trafficLights.find(tl => getLightKey(tl) === lightKey) || null;
  const committedTl = getTrafficLightByKey(car?.trafficLightCommitKey);
  if (committedTl && !hasCommittedTrafficLightRightOfWay({
    car,
    tl: committedTl,
    anchor,
    trafficLights,
    tileSize,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    getLightKey,
    isClearingTrafficLightIntersection,
    getIntentTrafficLight,
    getStopDistance,
    carOverlapsTrafficLightIntersection,
  })) {
    car.trafficLightCommitKey = null;
  }

  if (car?.trafficLightCommitKey) return getTrafficLightByKey(car.trafficLightCommitKey);

  const intentTrafficLight = getIntentTrafficLight({
    car,
    anchor,
    trafficLights,
    getCarDriverIntent,
    signalContainsTile,
  });
  if (!intentTrafficLight) return null;

  const { tl, intent } = intentTrafficLight;
  if (typeof isTrafficLightGreenForDir !== 'function' || !isTrafficLightGreenForDir(tl, intent.approachDir ?? car.dir)) return null;

  if (isClearingTrafficLightIntersection({
    car,
    tl,
    anchor,
    tileSize,
    getCarHalfExtents,
    signalContainsTile,
    carOverlapsTrafficLightIntersection,
  }) || getStopDistance({ tl, car, tileSize, dir: car.dir }) <= 0) {
    car.trafficLightCommitKey = getLightKey(tl);
    return tl;
  }

  return null;
}

export function getBlockingTrafficLight({
  car,
  anchor,
  currentTile,
  roadX,
  trafficLights = [],
  tileSize,
  getCarHalfExtents,
  getCarDriverIntent,
  signalContainsTile,
  isTrafficLightGreenForDir,
  getLightKey = getTrafficLightKey,
  refreshTrafficLightCommitment = refreshCarTrafficLightCommitment,
  getIntentTrafficLight = getCarIntentTrafficLight,
  isClearingTrafficLightIntersection = carIsClearingTrafficLightIntersection,
  hasTrafficLightExitRoom = () => true,
  carOverlapsTrafficLightIntersection = () => false,
}) {
  if (!anchor || currentTile === roadX) return null;

  const committedTl = refreshTrafficLightCommitment({
    car,
    anchor,
    trafficLights,
    tileSize,
    getCarHalfExtents,
    getCarDriverIntent,
    signalContainsTile,
    isTrafficLightGreenForDir,
    getLightKey,
    isClearingTrafficLightIntersection,
    getIntentTrafficLight,
    carOverlapsTrafficLightIntersection,
  });
  const intentTrafficLight = getIntentTrafficLight({
    car,
    anchor,
    trafficLights,
    getCarDriverIntent,
    signalContainsTile,
  });
  if (!intentTrafficLight) return null;

  const { tl, intent } = intentTrafficLight;
  if (committedTl && getLightKey(committedTl) === getLightKey(tl)) return null;
  if (isClearingTrafficLightIntersection({
    car,
    tl,
    anchor,
    tileSize,
    getCarHalfExtents,
    signalContainsTile,
    carOverlapsTrafficLightIntersection,
  })) {
    return null;
  }
  if (typeof isTrafficLightGreenForDir === 'function' && isTrafficLightGreenForDir(tl, intent.approachDir ?? car.dir)) {
    return hasTrafficLightExitRoom({ car, tl, anchor, intent }) ? null : tl;
  }
  return tl;
}

export function getIntersectionBounds({ map, startTile, roadX, getRoadTileKey = createRoadTileKey }) {
  if (!startTile || !map?.length || map[startTile.y]?.[startTile.x] !== roadX) return null;
  const mapWidth = map[0]?.length ?? 0;
  const mapHeight = map.length;
  const queue = [{ x: startTile.x, y: startTile.y }];
  const seen = new Set([getRoadTileKey(startTile.x, startTile.y)]);
  let minX = startTile.x;
  let maxX = startTile.x;
  let minY = startTile.y;
  let maxY = startTile.y;

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    minX = Math.min(minX, current.x);
    maxX = Math.max(maxX, current.x);
    minY = Math.min(minY, current.y);
    maxY = Math.max(maxY, current.y);

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nextKey = getRoadTileKey(next.x, next.y);
      if (seen.has(nextKey)) continue;
      if (!(next.x >= 0 && next.x < mapWidth && next.y >= 0 && next.y < mapHeight)) continue;
      if (map[next.y]?.[next.x] !== roadX) continue;
      seen.add(nextKey);
      queue.push(next);
    }
  }

  return { minX, maxX, minY, maxY };
}

export function getIntersectionDirectionalTiles(bounds, dir) {
  if (!bounds) return [];
  if (dir === 0) {
    const tiles = [];
    for (let x = bounds.minX; x <= bounds.maxX; x++) tiles.push({ x, y: bounds.maxY });
    return tiles;
  }
  if (dir === 2) {
    const tiles = [];
    for (let x = bounds.maxX; x >= bounds.minX; x--) tiles.push({ x, y: bounds.minY });
    return tiles;
  }
  if (dir === 1) {
    const tiles = [];
    for (let y = bounds.minY; y <= bounds.maxY; y++) tiles.push({ x: bounds.minX, y });
    return tiles;
  }
  const tiles = [];
  for (let y = bounds.maxY; y >= bounds.minY; y--) tiles.push({ x: bounds.maxX, y });
  return tiles;
}

export function getIntersectionSharedTile(fromTiles, toTiles, getRoadTileKey = createRoadTileKey) {
  const toIndexByKey = new Map(toTiles.map((tilePoint, index) => [getRoadTileKey(tilePoint.x, tilePoint.y), index]));
  for (let index = 0; index < fromTiles.length; index++) {
    const tilePoint = fromTiles[index];
    const tileKey = getRoadTileKey(tilePoint.x, tilePoint.y);
    if (!toIndexByKey.has(tileKey)) continue;
    return {
      tile: { x: tilePoint.x, y: tilePoint.y },
      fromIndex: index,
      toIndex: toIndexByKey.get(tileKey),
    };
  }
  return null;
}

export function getIntersectionManeuverSegments({ bounds, fromDir, toDir, driveSide = 'right', getRoadTileKey = createRoadTileKey }) {
  const entryTiles = getIntersectionDirectionalTiles(bounds, fromDir);
  if (!entryTiles.length) return null;

  if (toDir === fromDir) {
    return [{ dir: fromDir, tiles: entryTiles }];
  }

  if (toDir === (fromDir + 2) % 4) {
    const bridgeDir = driveSide === 'left' ? (fromDir + 1) % 4 : (fromDir + 3) % 4;
    const bridgeTiles = getIntersectionDirectionalTiles(bounds, bridgeDir);
    const exitTiles = getIntersectionDirectionalTiles(bounds, toDir);
    const sharedEntry = getIntersectionSharedTile(entryTiles, bridgeTiles, getRoadTileKey);
    const sharedExit = getIntersectionSharedTile(bridgeTiles, exitTiles, getRoadTileKey);
    if (!sharedEntry || !sharedExit) return null;

    return [
      { dir: fromDir, tiles: entryTiles, turnTo: bridgeDir },
      { dir: bridgeDir, tiles: bridgeTiles.slice(sharedEntry.toIndex + 1, sharedExit.fromIndex + 1), turnTo: toDir },
      { dir: toDir, tiles: exitTiles.slice(sharedExit.toIndex + 1) },
    ].filter(segment => segment.tiles.length || Number.isInteger(segment.turnTo));
  }

  const exitTiles = getIntersectionDirectionalTiles(bounds, toDir);
  const sharedTurn = getIntersectionSharedTile(entryTiles, exitTiles, getRoadTileKey);
  if (!sharedTurn) return null;

  return [
    { dir: fromDir, tiles: entryTiles.slice(0, sharedTurn.fromIndex + 1), turnTo: toDir },
    { dir: toDir, tiles: exitTiles.slice(sharedTurn.toIndex + 1) },
  ].filter(segment => segment.tiles.length || Number.isInteger(segment.turnTo));
}

export function trimIntersectionSegmentsToAnchor(segments, anchor) {
  if (!anchor) return segments;
  const trimmed = [];
  let found = false;

  for (const segment of segments) {
    if (found) {
      trimmed.push({ ...segment, tiles: [...segment.tiles] });
      continue;
    }

    const tileIndex = segment.tiles.findIndex(tilePoint => tilePoint.x === anchor.x && tilePoint.y === anchor.y);
    if (tileIndex < 0) continue;
    trimmed.push({ ...segment, tiles: segment.tiles.slice(tileIndex) });
    found = true;
  }

  return found ? trimmed : null;
}

export function getIntersectionTraversalTiles({ map, startTile, exitDir, roadX, isRoadTile, getDirectionDelta: getDelta = getDirectionDelta, maxSteps = 6 }) {
  if (!startTile || !map?.length || typeof isRoadTile !== 'function') return null;
  const mapWidth = map[0]?.length ?? 0;
  const mapHeight = map.length;
  const tiles = [];
  let current = startTile;

  for (let step = 0; step < maxSteps; step++) {
    const [dx, dy] = getDelta(exitDir);
    const next = { x: current.x + dx, y: current.y + dy };
    if (!(next.x >= 0 && next.x < mapWidth && next.y >= 0 && next.y < mapHeight && isRoadTile(map[next.y][next.x]))) {
      return null;
    }
    tiles.push(next);
    current = next;
    if (map[current.y]?.[current.x] !== roadX) return tiles;
  }

  return null;
}

export function buildIntersectionTraversalPlan({
  map,
  anchor,
  tile,
  currentDir,
  exitDir,
  laneIndex,
  roadX,
  driveSide = 'right',
  isRoadTile,
  canDriveDirection,
  getRoadTileKey = createRoadTileKey,
  getDirectionDelta: getDelta = getDirectionDelta,
  getLaneCenterForRoad,
  getIntersectionTurnWaypoint,
  makeWaypoint,
}) {
  if (!map?.length || !anchor) return null;
  if (typeof isRoadTile !== 'function' || typeof canDriveDirection !== 'function') return null;
  if (typeof getLaneCenterForRoad !== 'function' || typeof getIntersectionTurnWaypoint !== 'function' || typeof makeWaypoint !== 'function') return null;

  let intersectionTile = null;
  if (tile === roadX) {
    intersectionTile = anchor;
  } else {
    const [dx, dy] = getDelta(currentDir);
    const candidate = { x: anchor.x + dx, y: anchor.y + dy };
    if (map[candidate.y]?.[candidate.x] !== roadX) return null;
    intersectionTile = candidate;
  }

  if (!Number.isInteger(exitDir) || !canDriveDirection(intersectionTile.x, intersectionTile.y, exitDir)) return null;

  const bounds = getIntersectionBounds({ map, startTile: intersectionTile, roadX, getRoadTileKey });
  if (!bounds) return null;

  const maneuverSegments = getIntersectionManeuverSegments({ bounds, fromDir: currentDir, toDir: exitDir, driveSide, getRoadTileKey });
  if (!maneuverSegments?.length) return null;

  const activeSegments = tile === roadX
    ? trimIntersectionSegmentsToAnchor(maneuverSegments, anchor)
    : maneuverSegments.map(segment => ({ ...segment, tiles: [...segment.tiles] }));
  if (!activeSegments?.length) return null;

  const waypoints = [];
  const intersectionTiles = [];
  const seenIntersectionTiles = new Set();
  const addIntersectionTile = tilePoint => {
    if (!tilePoint) return;
    if (map[tilePoint.y]?.[tilePoint.x] !== roadX) return;
    const tileKey = getRoadTileKey(tilePoint.x, tilePoint.y);
    if (seenIntersectionTiles.has(tileKey)) return;
    seenIntersectionTiles.add(tileKey);
    intersectionTiles.push({ x: tilePoint.x, y: tilePoint.y });
  };

  let finalTile = intersectionTile;
  let skipCurrentTile = tile === roadX;

  for (const segment of activeSegments) {
    for (const tilePoint of segment.tiles) addIntersectionTile(tilePoint);

    const waypointLimit = segment.turnTo ? segment.tiles.length - 1 : segment.tiles.length;
    const waypointStart = skipCurrentTile ? 1 : 0;
    for (let index = waypointStart; index < waypointLimit; index++) {
      const runTile = segment.tiles[index];
      const lanePoint = getLaneCenterForRoad(runTile.x, runTile.y, segment.dir, laneIndex);
      waypoints.push(makeWaypoint(
        lanePoint.x,
        lanePoint.y,
        segment.dir,
        segment.dir,
        laneIndex,
        runTile.x,
        runTile.y
      ));
      finalTile = runTile;
    }

    if (Number.isInteger(segment.turnTo)) {
      const turnTile = segment.tiles[segment.tiles.length - 1];
      if (!turnTile) return null;
      const turnPoint = getIntersectionTurnWaypoint(turnTile.x, turnTile.y, segment.dir, segment.turnTo, laneIndex, laneIndex);
      if (!turnPoint) return null;
      waypoints.push(makeWaypoint(
        turnPoint.x,
        turnPoint.y,
        segment.turnTo,
        segment.turnTo,
        laneIndex,
        turnTile.x,
        turnTile.y
      ));
      finalTile = turnTile;
    }

    skipCurrentTile = false;
  }

  const traversalTiles = getIntersectionTraversalTiles({ map, startTile: finalTile, exitDir, roadX, isRoadTile, getDirectionDelta: getDelta });
  if (!traversalTiles?.length) return null;

  for (const traversalTile of traversalTiles) {
    addIntersectionTile(traversalTile);
    const lanePoint = getLaneCenterForRoad(traversalTile.x, traversalTile.y, exitDir, laneIndex);
    waypoints.push(makeWaypoint(
      lanePoint.x,
      lanePoint.y,
      exitDir,
      exitDir,
      laneIndex,
      traversalTile.x,
      traversalTile.y
    ));
  }

  return {
    exitDir,
    laneIndex,
    waypoints,
    entryTile: intersectionTile,
    intersectionTiles,
    exitTile: traversalTiles[traversalTiles.length - 1],
  };
}

export function getRemainingIntersectionReservationKeys({
  map,
  roadX,
  waypoints = [],
  anchor = null,
  getRoadTileKey = createRoadTileKey,
}) {
  const keys = [];
  const seen = new Set();
  const addTileKey = (tx, ty) => {
    if (!Number.isInteger(tx) || !Number.isInteger(ty)) return;
    if (map[ty]?.[tx] !== roadX) return;
    const tileKey = getRoadTileKey(tx, ty);
    if (seen.has(tileKey)) return;
    seen.add(tileKey);
    keys.push(tileKey);
  };

  if (anchor && map[anchor.y]?.[anchor.x] === roadX) {
    addTileKey(anchor.x, anchor.y);
  }

  for (const waypoint of waypoints || []) {
    addTileKey(waypoint?.roadTx, waypoint?.roadTy);
  }

  return keys;
}

export function getPendingIntersectionKeys({
  map,
  roadX,
  car,
  anchor,
  ensureWaypoints,
  getRoadTileKey = createRoadTileKey,
}) {
  if (!anchor || map[anchor.y]?.[anchor.x] === roadX) return [];

  const needsPlan = !car?.waypoints?.length || !car?.driverIntent;
  if (needsPlan) {
    if (typeof ensureWaypoints !== 'function' || !ensureWaypoints(car)) return [];
  }

  return getRemainingIntersectionReservationKeys({
    map,
    roadX,
    waypoints: car?.waypoints,
    anchor,
    getRoadTileKey,
  });
}

export function getBlockingIntersectionReservation({
  map,
  roadX,
  car,
  anchor,
  intersectionReservations,
  ensureWaypoints,
  getRoadTileKey = createRoadTileKey,
}) {
  const keys = getPendingIntersectionKeys({
    map,
    roadX,
    car,
    anchor,
    ensureWaypoints,
    getRoadTileKey,
  });

  for (const key of keys) {
    const reservedBy = intersectionReservations.get(key);
    if (reservedBy && reservedBy !== car) {
      return reservedBy;
    }
  }

  return null;
}

export function reserveIntersectionIntent({
  map,
  roadX,
  intersectionReservations,
  car,
  anchor,
  getRoadTileKey = createRoadTileKey,
}) {
  if (!anchor || map[anchor.y]?.[anchor.x] !== roadX) return intersectionReservations;

  for (const key of getRemainingIntersectionReservationKeys({
    map,
    roadX,
    waypoints: car?.waypoints,
    anchor,
    getRoadTileKey,
  })) {
    const reservedBy = intersectionReservations.get(key);
    if (!reservedBy || reservedBy === car) {
      intersectionReservations.set(key, car);
    }
  }

  return intersectionReservations;
}

export function compareIntersectionRightOfWay({
  car,
  other,
  getTurnRelationFn = getTurnRelation,
}) {
  const carApproachDir = car?.driverIntent?.approachDir ?? car?.dir;
  const otherApproachDir = other?.driverIntent?.approachDir ?? other?.dir;
  const carExitDir = Number.isInteger(car?.pendingDir) ? car.pendingDir : car?.dir;
  const otherExitDir = Number.isInteger(other?.pendingDir) ? other.pendingDir : other?.dir;
  if (![carApproachDir, otherApproachDir, carExitDir, otherExitDir].every(Number.isInteger)) return 0;

  const oppositeApproach = otherApproachDir === (carApproachDir + 2) % 4;
  if (!oppositeApproach) return 0;

  const carTurn = getTurnRelationFn(carApproachDir, carExitDir);
  const otherTurn = getTurnRelationFn(otherApproachDir, otherExitDir);
  const carMustYield = carTurn === 'left' || carTurn === 'uturn';
  const otherMustYield = otherTurn === 'left' || otherTurn === 'uturn';
  if (carMustYield === otherMustYield) return 0;
  return otherMustYield ? 1 : -1;
}

export function getTrafficPriorityScore({ car, getResponderPhase, isCarInIntersection, framesToSeconds }) {
  let score = 0;
  if (typeof getResponderPhase === 'function' && getResponderPhase(car)) score += 100;
  if (car?.vehicleType === 'police' || car?.vehicleType === 'ambulance' || car?.vehicleType === 'fire') score += 40;
  if (typeof isCarInIntersection === 'function' && isCarInIntersection(car)) score += 20;
  const waitingBucket = typeof framesToSeconds === 'function' ? framesToSeconds(15) : 15;
  score += Math.min(20, Math.floor((car?.waiting || 0) / waitingBucket));
  return score;
}

export function carHasConflictPriority({ car, other, getResponderPhase, isCarInIntersection, framesToSeconds }) {
  if (!other) return true;
  if (other.stopReason === 'scene' || other.mode === 'delivery-stopped') return false;

  const carInIntersection = typeof isCarInIntersection === 'function' && isCarInIntersection(car);
  const otherInIntersection = typeof isCarInIntersection === 'function' && isCarInIntersection(other);
  if (!carInIntersection && !otherInIntersection) {
    const rightOfWay = compareIntersectionRightOfWay({ car, other });
    if (rightOfWay !== 0) return rightOfWay > 0;
  }

  const carScore = getTrafficPriorityScore({ car, getResponderPhase, isCarInIntersection, framesToSeconds });
  const otherScore = getTrafficPriorityScore({ car: other, getResponderPhase, isCarInIntersection, framesToSeconds });
  if (carScore !== otherScore) return carScore > otherScore;

  const carWaiting = car?.waiting || 0;
  const otherWaiting = other?.waiting || 0;
  const waitingTieWindow = typeof framesToSeconds === 'function' ? framesToSeconds(12) : 12;
  if (Math.abs(carWaiting - otherWaiting) > waitingTieWindow) {
    return carWaiting > otherWaiting;
  }

  return (car?.id || 0) < (other?.id || 0);
}

export function compareCarMovementOrder({ first, second, getResponderPhase, isCarInIntersection, framesToSeconds }) {
  if (first === second) return 0;

  const firstInIntersection = typeof isCarInIntersection === 'function' && isCarInIntersection(first);
  const secondInIntersection = typeof isCarInIntersection === 'function' && isCarInIntersection(second);
  if (!firstInIntersection && !secondInIntersection) {
    const rightOfWay = compareIntersectionRightOfWay({ car: first, other: second });
    if (rightOfWay !== 0) return rightOfWay > 0 ? -1 : 1;
  }

  const firstScore = getTrafficPriorityScore({ car: first, getResponderPhase, isCarInIntersection, framesToSeconds });
  const secondScore = getTrafficPriorityScore({ car: second, getResponderPhase, isCarInIntersection, framesToSeconds });
  if (firstScore !== secondScore) return secondScore - firstScore;

  const firstWaiting = first?.waiting || 0;
  const secondWaiting = second?.waiting || 0;
  const waitingTieWindow = typeof framesToSeconds === 'function' ? framesToSeconds(4) : 4;
  if (Math.abs(firstWaiting - secondWaiting) > waitingTieWindow) {
    return secondWaiting - firstWaiting;
  }

  return (first?.id || 0) - (second?.id || 0);
}

export function isCommittedIntersectionTurn({
  car,
  currentTile,
  roadX,
}) {
  if (!car || currentTile !== roadX) return false;
  if (!car.driverIntent?.intersectionEntryTile) return false;
  return Number.isInteger(car.pendingDir) && car.pendingDir !== car.dir;
}

export function canUseAdjacentOvertakeLane({
  car,
  cars,
  altLaneCenter,
  getCarHalfExtents,
  previewDistance = 48,
  lateralPadding = 0.7,
  backClearancePadding = 2.5,
  frontClearancePadding = 8,
}) {
  if (!car || !altLaneCenter || typeof getCarHalfExtents !== 'function') return false;

  const carExtents = getCarHalfExtents(car);
  for (const other of cars || []) {
    if (other === car) continue;
    const otherExtents = getCarHalfExtents(other);
    if (car.dir === 0 || car.dir === 2) {
      const lateralLimit = carExtents.y + otherExtents.y + lateralPadding;
      if (Math.abs(other.y - altLaneCenter.y) > lateralLimit) continue;
      const delta = car.dir === 0 ? other.x - car.x : car.x - other.x;
      const backClearance = carExtents.x + otherExtents.x + backClearancePadding;
      const frontClearance = carExtents.x + otherExtents.x + previewDistance + frontClearancePadding;
      if (delta > -backClearance && delta < frontClearance) return false;
      continue;
    }

    const lateralLimit = carExtents.x + otherExtents.x + lateralPadding;
    if (Math.abs(other.x - altLaneCenter.x) > lateralLimit) continue;
    const delta = car.dir === 1 ? other.y - car.y : car.y - other.y;
    const backClearance = carExtents.y + otherExtents.y + backClearancePadding;
    const frontClearance = carExtents.y + otherExtents.y + previewDistance + frontClearancePadding;
    if (delta > -backClearance && delta < frontClearance) return false;
  }

  return true;
}

export function getQueuedCarDistance({
  car,
  cars,
  getCarLaneIndex,
  getCarHalfExtents,
  lateralPadding = 0.6,
}) {
  let best = Infinity;
  const laneIndex = getCarLaneIndex(car);
  for (const other of cars || []) {
    if (other === car || other.dir !== car.dir || getCarLaneIndex(other) !== laneIndex) continue;
    if (car.dir === 0 || car.dir === 2) {
      const lateralLimit = getCarHalfExtents(car).y + getCarHalfExtents(other).y + lateralPadding;
      if (Math.abs(other.y - car.y) > lateralLimit) continue;
      const delta = car.dir === 0 ? other.x - car.x : car.x - other.x;
      const edgeGap = delta - getCarHalfExtents(car).x - getCarHalfExtents(other).x;
      if (edgeGap > 0 && edgeGap < best) best = edgeGap;
      continue;
    }

    const lateralLimit = getCarHalfExtents(car).x + getCarHalfExtents(other).x + lateralPadding;
    if (Math.abs(other.x - car.x) > lateralLimit) continue;
    const delta = car.dir === 1 ? other.y - car.y : car.y - other.y;
    const edgeGap = delta - getCarHalfExtents(car).y - getCarHalfExtents(other).y;
    if (edgeGap > 0 && edgeGap < best) best = edgeGap;
  }
  return best;
}

export function getProjectedCarPoint({
  car,
  distance,
  ensureWaypoints,
}) {
  if (distance <= 0) return { x: car.x, y: car.y };
  if ((!car.waypoints || !car.waypoints.length) && (!ensureWaypoints || !ensureWaypoints(car))) {
    return { x: car.x, y: car.y };
  }

  let px = car.x;
  let py = car.y;
  let remaining = distance;
  for (const target of car.waypoints || []) {
    if (remaining <= 0.0001) break;
    const dx = target.x - px;
    const dy = target.y - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= remaining + 0.0001) {
      px = target.x;
      py = target.y;
      remaining -= dist;
      continue;
    }
    px += dx / dist * remaining;
    py += dy / dist * remaining;
    remaining = 0;
  }
  return { x: px, y: py };
}

export function getProjectedCarConflict({
  car,
  travel,
  cars,
  getProjectedPoint = getProjectedCarPoint,
  carsOverlapAtPoints,
  carHasConflictPriority,
}) {
  if (!(travel > 0.0001)) return null;
  const sampleCount = Math.max(2, Math.min(6, Math.ceil(travel / 3.5)));
  let bestDistance = Infinity;
  let bestOther = null;

  for (let sample = 1; sample <= sampleCount; sample++) {
    const sampleDistance = travel * (sample / sampleCount);
    const projectedPoint = getProjectedPoint({ car, distance: sampleDistance });
    for (const other of cars || []) {
      if (other === car) continue;
      if (carsOverlapAtPoints(car, projectedPoint, other, other)) {
        if (carHasConflictPriority(car, other)) continue;
        if (sampleDistance < bestDistance) {
          bestDistance = sampleDistance;
          bestOther = other;
        }
      }
    }
  }

  if (!Number.isFinite(bestDistance)) return null;
  return {
    other: bestOther,
    safeDistance: Math.max(0, bestDistance - Math.max(0.8, travel / sampleCount)),
  };
}

export function applyVehicleMotionReset(car, {
  mode = car?.mode,
  targetPoint = null,
  targetCar = null,
  clearIncident = false,
  clearDeliveryPlan = false,
  baseSpeed = null,
  preferredLaneIndex = null,
  assignAmbientTarget = false,
  ambientMinRoadDistance = null,
  anchor = null,
} = {}, {
  getDeliveryDriver = () => null,
  removeTemporaryPerson = () => {},
  getDefaultBaseSpeed = currentCar => currentCar?.baseSpeed,
  clampLaneIndex = index => index === 1 ? 1 : 0,
  pickPreferredLaneIndex = () => 1,
  clearCarWaypoints = () => {},
  clearCarRoute = () => {},
  getCarRoadTile = () => null,
  usesAmbientRouteTarget = () => false,
  assignAmbientRouteTarget = () => false,
  getAmbientRouteMinRoadDistance = () => ambientMinRoadDistance ?? 0,
} = {}) {
  if (!car) return false;

  if (clearDeliveryPlan && car.deliveryPlan) {
    const driver = getDeliveryDriver(car);
    if (driver && driver.tempActor) removeTemporaryPerson(driver);
    car.deliveryPlan = null;
  }

  car.mode = mode;
  if (clearIncident) car.incidentId = null;
  car.targetCar = targetCar;
  car.targetPoint = targetPoint;
  if (Number.isFinite(baseSpeed)) car.baseSpeed = baseSpeed;
  if (!Number.isFinite(car.baseSpeed)) {
    car.baseSpeed = getDefaultBaseSpeed(car);
  }
  car.speed = car.baseSpeed;
  car.preferredLaneIndex = Number.isInteger(preferredLaneIndex)
    ? clampLaneIndex(preferredLaneIndex)
    : pickPreferredLaneIndex(car.vehicleType);
  car.stopped = false;
  car.stopReason = null;
  car.waiting = 0;
  car.honking = false;
  car.honkTimer = 0;
  car.overtakeTimer = 0;
  car.boostTimer = 0;
  car.trafficLightCommitKey = null;
  car.ambientRouteTimer = 0;
  clearCarWaypoints(car);
  clearCarRoute(car);

  const resolvedAnchor = anchor || getCarRoadTile(car);
  if (assignAmbientTarget && !targetPoint && usesAmbientRouteTarget(car)) {
    assignAmbientRouteTarget(car, resolvedAnchor, ambientMinRoadDistance ?? getAmbientRouteMinRoadDistance(car, mode));
  }

  return true;
}

export function resetDeliveryCruiseFlow(car, {
  resetVehicleMotionState,
  getAmbientRouteMinRoadDistance,
  randomDuration,
}) {
  if (!car || typeof resetVehicleMotionState !== 'function') return false;

  const reset = resetVehicleMotionState(car, {
    mode: 'delivery-cruising',
    clearDeliveryPlan: true,
    assignAmbientTarget: true,
    ambientMinRoadDistance: typeof getAmbientRouteMinRoadDistance === 'function'
      ? getAmbientRouteMinRoadDistance(car, 'delivery-cruising')
      : 12,
  });

  if (typeof randomDuration === 'function') {
    car.deliveryTimer = randomDuration(720, 1440);
  }

  return reset;
}

export function resumePoliceCarsFlow(incident, {
  resetVehicleMotionState,
  getVehicleColor,
  setCarSiren = () => {},
  getSuspectBaseSpeed = () => null,
}) {
  if (!incident || typeof resetVehicleMotionState !== 'function') return false;

  const { suspectCar, policeCar } = incident;
  if (suspectCar) {
    suspectCar.vehicleType = 'civilian';
    if (typeof getVehicleColor === 'function') {
      suspectCar.color = getVehicleColor('civilian');
    }
    resetVehicleMotionState(suspectCar, {
      mode: 'cruising',
      clearIncident: true,
      baseSpeed: getSuspectBaseSpeed(),
      assignAmbientTarget: true,
      ambientMinRoadDistance: 18,
    });
  }

  if (policeCar) {
    resetVehicleMotionState(policeCar, {
      mode: 'patrol',
      clearIncident: true,
      assignAmbientTarget: true,
      ambientMinRoadDistance: 18,
    });
    setCarSiren(policeCar, null);
  }

  return true;
}

export function releaseMedicalAmbulanceFlow(ambulance, {
  resetVehicleMotionState,
  setCarSiren = () => {},
}) {
  if (!ambulance || typeof resetVehicleMotionState !== 'function') return false;

  resetVehicleMotionState(ambulance, {
    mode: 'patrol',
    clearIncident: true,
    assignAmbientTarget: true,
    ambientMinRoadDistance: 18,
  });
  setCarSiren(ambulance, null);
  return true;
}

export function recoverFireTruckFlow(fireTruck, {
  sendVehicleToServiceBase = () => false,
  resetVehicleMotionState,
  setCarSiren = () => {},
}) {
  if (!fireTruck) return false;

  fireTruck.incidentId = null;
  setCarSiren(fireTruck, null);
  const sentToBase = sendVehicleToServiceBase(fireTruck);
  if (!sentToBase && typeof resetVehicleMotionState === 'function') {
    resetVehicleMotionState(fireTruck, {
      mode: 'patrol',
      clearIncident: true,
      assignAmbientTarget: true,
      ambientMinRoadDistance: 22,
    });
    return 'patrol';
  }

  return sentToBase ? 'service-return' : false;
}