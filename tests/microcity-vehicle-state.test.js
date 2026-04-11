import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyVehicleMotionReset,
  recoverFireTruckFlow,
  releaseMedicalAmbulanceFlow,
  resetDeliveryCruiseFlow,
  resumePoliceCarsFlow,
} from '../assets/js/microcity-traffic.js';

function createResetDeps(overrides = {}) {
  const events = {
    removedDrivers: [],
    ambientCalls: [],
    clearedWaypoints: 0,
    clearedRoutes: 0,
  };

  const deps = {
    getDeliveryDriver: car => car.deliveryPlan ? { id: car.deliveryPlan.driverId, tempActor: true } : null,
    removeTemporaryPerson: driver => events.removedDrivers.push(driver),
    getDefaultBaseSpeed: car => ({
      civilian: 0.42,
      delivery: 0.5,
      police: 0.62,
      ambulance: 0.58,
      fire: 0.56,
    }[car.vehicleType] ?? 0.42),
    clampLaneIndex: index => index === 1 ? 1 : 0,
    pickPreferredLaneIndex: () => 1,
    clearCarWaypoints: car => {
      car.waypoints = [];
      car.driverIntent = null;
      events.clearedWaypoints += 1;
    },
    clearCarRoute: car => {
      car.routeTiles = null;
      car.routeGoalKey = null;
      car.routeRefreshTimer = 0;
      events.clearedRoutes += 1;
    },
    getCarRoadTile: car => car.anchor || null,
    usesAmbientRouteTarget: car => !car.incidentId && (car.mode === 'cruising' || car.mode === 'delivery-cruising' || car.mode === 'patrol'),
    assignAmbientRouteTarget: (car, anchor, minRoadDistance) => {
      events.ambientCalls.push({ car, anchor, minRoadDistance });
      car.targetPoint = { x: 100 + minRoadDistance, y: 200 + minRoadDistance };
      return true;
    },
    getAmbientRouteMinRoadDistance: (_car, mode) => mode === 'patrol' ? 18 : 12,
    ...overrides,
  };

  return { deps, events };
}

function applyResetWithDeps(car, options, deps) {
  return applyVehicleMotionReset(car, options, deps);
}

test('applyVehicleMotionReset restores baseline motion state without forcing ambient routing when a target exists', () => {
  const car = {
    vehicleType: 'civilian',
    mode: 'pursuit',
    incidentId: 'police',
    baseSpeed: Number.NaN,
    speed: 0,
    waiting: 5,
    honking: true,
    honkTimer: 2,
    overtakeTimer: 3,
    boostTimer: 4,
    trafficLightCommitKey: '10,20,11,21',
    ambientRouteTimer: 8,
    waypoints: [{ roadTx: 2, roadTy: 3 }],
    driverIntent: { approachDir: 0 },
    anchor: { x: 3, y: 3 },
  };
  const targetPoint = { x: 44, y: 88 };
  const { deps, events } = createResetDeps();

  const reset = applyResetWithDeps(car, {
    mode: 'service-return',
    targetPoint,
    clearIncident: true,
    preferredLaneIndex: 0,
    assignAmbientTarget: true,
  }, deps);

  assert.equal(reset, true);
  assert.equal(car.mode, 'service-return');
  assert.equal(car.incidentId, null);
  assert.equal(car.baseSpeed, 0.42);
  assert.equal(car.speed, 0.42);
  assert.equal(car.preferredLaneIndex, 0);
  assert.equal(car.targetPoint, targetPoint);
  assert.equal(car.waiting, 0);
  assert.equal(car.honking, false);
  assert.equal(car.trafficLightCommitKey, null);
  assert.equal(events.clearedWaypoints, 1);
  assert.equal(events.clearedRoutes, 1);
  assert.equal(events.ambientCalls.length, 0);
});

test('resetDeliveryCruiseFlow clears the delivery plan and re-enters ambient routing', () => {
  const car = {
    vehicleType: 'delivery',
    mode: 'delivery-arriving',
    deliveryPlan: { driverId: 7 },
    baseSpeed: 0.5,
    speed: 0.1,
    waiting: 4,
    honking: true,
    honkTimer: 2,
    overtakeTimer: 3,
    boostTimer: 4,
    trafficLightCommitKey: '2,3,3,4',
    ambientRouteTimer: 9,
    waypoints: [{ roadTx: 2, roadTy: 3 }],
    driverIntent: { approachDir: 0 },
    anchor: { x: 4, y: 4 },
    incidentId: null,
  };
  const { deps, events } = createResetDeps();

  const reset = resetDeliveryCruiseFlow(car, {
    resetVehicleMotionState: (targetCar, options) => applyResetWithDeps(targetCar, options, deps),
    getAmbientRouteMinRoadDistance: (_car, mode) => mode === 'delivery-cruising' ? 12 : 18,
    randomDuration: () => 900,
  });

  assert.equal(reset, true);
  assert.equal(car.mode, 'delivery-cruising');
  assert.equal(car.deliveryPlan, null);
  assert.equal(car.deliveryTimer, 900);
  assert.equal(car.waiting, 0);
  assert.equal(car.honking, false);
  assert.equal(events.removedDrivers.length, 1);
  assert.equal(events.ambientCalls.length, 1);
  assert.equal(events.ambientCalls[0].minRoadDistance, 12);
});

test('resumePoliceCarsFlow restores both suspect and police vehicles to shared traffic rules', () => {
  const suspectCar = {
    id: 1,
    vehicleType: 'hijacked',
    color: '#f00',
    mode: 'escape',
    incidentId: 'police',
    baseSpeed: 0.4,
    speed: 0,
    waiting: 5,
    waypoints: [{ roadTx: 2, roadTy: 3 }],
    driverIntent: { approachDir: 0 },
    anchor: { x: 2, y: 3 },
  };
  const policeCar = {
    id: 2,
    vehicleType: 'police',
    mode: 'pursuit',
    incidentId: 'police',
    targetCar: suspectCar,
    baseSpeed: 0.62,
    speed: 0,
    anchor: { x: 3, y: 3 },
  };
  const { deps, events } = createResetDeps({
    getAmbientRouteMinRoadDistance: (_car, mode) => mode === 'patrol' ? 18 : 12,
  });
  const sirenCalls = [];

  const resumed = resumePoliceCarsFlow({ suspectCar, policeCar }, {
    resetVehicleMotionState: (car, options) => applyResetWithDeps(car, options, deps),
    getVehicleColor: type => type === 'civilian' ? '#ccc' : '#00f',
    setCarSiren: (...args) => sirenCalls.push(args),
    getSuspectBaseSpeed: () => 0.73,
  });

  assert.equal(resumed, true);
  assert.equal(suspectCar.vehicleType, 'civilian');
  assert.equal(suspectCar.color, '#ccc');
  assert.equal(suspectCar.mode, 'cruising');
  assert.equal(suspectCar.incidentId, null);
  assert.equal(suspectCar.baseSpeed, 0.73);
  assert.equal(policeCar.mode, 'patrol');
  assert.equal(policeCar.incidentId, null);
  assert.equal(events.ambientCalls.length, 2);
  assert.deepEqual(sirenCalls, [[policeCar, null]]);
});

test('releaseMedicalAmbulanceFlow returns the ambulance to patrol and clears sirens', () => {
  const ambulance = {
    vehicleType: 'ambulance',
    mode: 'medical-on-scene',
    incidentId: 'medical',
    baseSpeed: 0.58,
    speed: 0,
    anchor: { x: 5, y: 5 },
  };
  const { deps, events } = createResetDeps();
  const sirenCalls = [];

  const released = releaseMedicalAmbulanceFlow(ambulance, {
    resetVehicleMotionState: (car, options) => applyResetWithDeps(car, options, deps),
    setCarSiren: (...args) => sirenCalls.push(args),
  });

  assert.equal(released, true);
  assert.equal(ambulance.mode, 'patrol');
  assert.equal(ambulance.incidentId, null);
  assert.equal(events.ambientCalls.length, 1);
  assert.equal(events.ambientCalls[0].minRoadDistance, 18);
  assert.deepEqual(sirenCalls, [[ambulance, null]]);
});

test('recoverFireTruckFlow prefers sending the truck back to base when available', () => {
  const fireTruck = {
    vehicleType: 'fire',
    mode: 'fire-on-scene',
    incidentId: 'fire',
  };
  const sirenCalls = [];

  const result = recoverFireTruckFlow(fireTruck, {
    sendVehicleToServiceBase: car => {
      car.mode = 'service-return';
      car.targetPoint = { x: 80, y: 96 };
      return true;
    },
    setCarSiren: (...args) => sirenCalls.push(args),
  });

  assert.equal(result, 'service-return');
  assert.equal(fireTruck.incidentId, null);
  assert.equal(fireTruck.mode, 'service-return');
  assert.deepEqual(sirenCalls, [[fireTruck, null]]);
});

test('recoverFireTruckFlow falls back to patrol reset when no service return is possible', () => {
  const fireTruck = {
    vehicleType: 'fire',
    mode: 'fire-on-scene',
    incidentId: 'fire',
    baseSpeed: 0.56,
    speed: 0,
    anchor: { x: 6, y: 6 },
  };
  const { deps, events } = createResetDeps({
    getAmbientRouteMinRoadDistance: (_car, mode) => mode === 'patrol' ? 22 : 12,
  });
  const sirenCalls = [];

  const result = recoverFireTruckFlow(fireTruck, {
    sendVehicleToServiceBase: () => false,
    resetVehicleMotionState: (car, options) => applyResetWithDeps(car, options, deps),
    setCarSiren: (...args) => sirenCalls.push(args),
  });

  assert.equal(result, 'patrol');
  assert.equal(fireTruck.mode, 'patrol');
  assert.equal(fireTruck.incidentId, null);
  assert.equal(events.ambientCalls.length, 1);
  assert.equal(events.ambientCalls[0].minRoadDistance, 22);
  assert.deepEqual(sirenCalls, [[fireTruck, null]]);
});