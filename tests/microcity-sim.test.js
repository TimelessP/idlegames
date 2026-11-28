// Micro City simulation core: generation, routing, lighting and a short live run.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createCity, routeEdges, pedRoute, roomLitWanted, _startFire, _crash, _requestTow, FLEET } from '../assets/js/microcity-sim.js';

const run = (C, seconds, dt = 1 / 30) => { for (let t = 0; t < seconds; t += dt) { C.step(dt); C.cues.length = 0; } };

test('generation is deterministic for a seed', () => {
  const a = createCity({ seed: 42 }), b = createCity({ seed: 42 });
  assert.equal(a.buildings.length, b.buildings.length);
  assert.equal(a.people.length, b.people.length);
  assert.deepEqual(a.buildings.slice(0, 20).map(x => x.label), b.buildings.slice(0, 20).map(x => x.label));
});

test('the city has every civic and special place, and one of each special character', () => {
  const C = createCity({ seed: 7 });
  for (const k of ['police', 'fireStation', 'hospital', 'stadium', 'mall', 'concert', 'school', 'dealer', 'scrap', 'works', 'warehouse', 'depot', 'university', 'lab', 'commerce', 'datacentre', 'substation']) assert.ok(C[k], `missing ${k}`);
  assert.equal(C.people.filter(p => p.special === 'wanderer').length, 1);
  assert.equal(C.people.filter(p => p.special === 'claude').length, 1);
  assert.ok(C.pool && C.fish.length > 0, 'fountain pool with fish');
  assert.ok(C.fireStation.garages.length >= 2);
});

test('every service fleet is complete, with a yard to park in, on many different cities', () => {
  for (const seed of [20261128, 7, 9, 11, 42, 123, 999, 31337, 2024, 555]) {
    const C = createCity({ seed });
    for (const [type, n] of Object.entries(FLEET)) assert.equal(C.vehicles.filter(v => v.type === type).length, n, `seed ${seed}: ${type}`);
    for (const k of ['police', 'warehouse', 'dealer', 'scrap', 'works']) assert.ok(C[k] && C[k].yard, `seed ${seed}: ${k} has no yard`);
    for (const v of C.vehicles) if (v.type !== 'car' && v.type !== 'taxi') assert.ok(v.homeBay, `seed ${seed}: ${v.type} has no home bay`);
  }
});

test('brand names fit on a sign', () => {
  const C = createCity({ seed: 7 });
  for (const b of C.buildings) if (b.brand) assert.ok(b.brand.name.length <= 14, b.brand.name);
});

test('movement conflicts are symmetric and never pair a lane with itself', () => {
  const C = createCity({ seed: 7 });
  for (const m of C.moves) for (const c of m.conf) { assert.ok(c.conf.includes(m)); assert.notEqual(c.inLane, m.inLane); }
});

test('every directed road can be reached from any other without U-turns', () => {
  const C = createCity({ seed: 9 });
  const from = C.edges[0];
  for (const e of C.edges) if (e !== from) assert.ok(routeEdges(C, from, e), `no route to edge ${e.id}`);
});

test('pedestrian routes start and end where asked', () => {
  const C = createCity({ seed: 9 });
  const a = C.buildings[3].door, b = C.buildings[C.buildings.length - 4].door;
  const p = pedRoute(C, a, b);
  assert.ok(p.length >= 2);
  assert.deepEqual([p[0].x, p[0].y], [a.x, a.y]);
  assert.deepEqual([p[p.length - 1].x, p[p.length - 1].y], [b.x, b.y]);
});

test('a room light is only on when an awake person is in it', () => {
  const C = createCity({ seed: 7, startHour: 21 });
  for (const b of C.buildings) for (const r of b.rooms) {
    if (r.kind === 'server' || (b.fire && b.fire.rooms.has(r.id))) continue;
    if (roomLitWanted(C, b, r)) assert.ok(r.occ.some(p => !p.asleep), `${b.label} room ${r.id} lit while empty`);
  }
});

test('a few minutes of city life: traffic moves, people come and go, cars stay in balance', () => {
  const C = createCity({ seed: 7 });
  const cars0 = C.vehicles.filter(v => v.type === 'car' && !v.forSale && !v.visitor).length;
  run(C, 8 * 60);
  const moving = C.vehicles.filter(v => v.mode === 'drive' && v.v > 0.5).length;
  const outside = C.people.filter(p => ['walk', 'act', 'wait'].includes(p.state)).length;
  assert.ok(moving > 5, `only ${moving} vehicles moving`);
  assert.ok(outside > 50, `only ${outside} people outside`);
  assert.ok(C.stats.rescues < 30, `${C.stats.rescues} stuck vehicles had to be rescued`);
  const cars1 = C.vehicles.filter(v => v.type === 'car' && !v.forSale && !v.visitor).length;
  assert.ok(Math.abs(cars1 - cars0) <= 6, `private cars drifted from ${cars0} to ${cars1}`);
  for (const p of C.people) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${p.name} has no position`);
  for (const v of C.vehicles) assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y), `vehicle ${v.id} has no position`);
});

test('a building fire is fought and put out', () => {
  const C = createCity({ seed: 7, startHour: 10 });
  run(C, 20);
  const b = C.buildings.find(x => x.type === 'walkup' && x.rooms.length > 4);
  _startFire(C, b);
  assert.equal(b.inside.size, [...b.inside].filter(p => p.busy).length, 'everyone not otherwise busy left');
  let out = false;
  for (let t = 0; t < 900 && !out; t += 5) { run(C, 5); out = !b.fire || b.fire.stage === 'out'; }
  assert.ok(out, 'fire still burning after 15 minutes');
});

test('after a crash everyone goes back to normal: police stand down, the wreck is towed and crushed, the tow truck parks at home', () => {
  const rescued = [];
  const C = createCity({ seed: 7, startHour: 10, onRescue: v => rescued.push(v.type) });
  run(C, 60);
  run(C, 60);
  const cars = C.vehicles.filter(v => v.type === 'car' && v.mode === 'drive' && v.seg.kind === 'lane' && v.s > 10 && v.s < v.seg.length - 18);
  assert.ok(cars.length >= 2, 'need two cars on the road');
  const [a, b] = cars;
  _crash(C, a, b, 9);
  const inc = C.incidents.find(i => i.kind === 'crash');
  assert.ok(inc, 'crash incident opened');
  let towed = false;
  for (let t = 0; t < 900 && !towed; t += 5) { run(C, 5); towed = a.mode === 'gone' && b.mode === 'gone'; }
  assert.ok(!inc.active, 'crash scene was cleared');
  assert.ok(towed, `wrecks still ${a.mode}/${b.mode}`);
  run(C, 120);
  for (const v of C.vehicles) if (v.job && v.job.active === false) assert.notEqual(v.mode, 'stopped', `${v.type} ${v.id} left waiting on a finished incident (${v.task})`);
  for (const p of C.people) if (p.busy && p.busy.active === false && p.state === 'act') assert.fail(`${p.name} stuck at a finished incident (${p.task})`);
  const tows = C.vehicles.filter(v => v.type === 'tow');
  for (const t of tows) assert.ok(t.mode === 'parked' && t.bay === t.homeBay || t.job, `tow ${t.id} is ${t.mode}: ${t.task}`);
  assert.ok(!rescued.includes('tow'), 'tow truck had to be rescued');
});

test('a tow for a car left standing in the lane: it is moved to the kerb and the tow truck drives all the way there', () => {
  const rescued = [];
  const C = createCity({ seed: 20261128, startHour: 10, onRescue: v => rescued.push(v.type) });
  run(C, 90);
  const car = C.vehicles.find(v => v.type === 'car' && v.mode === 'drive' && v.seg.kind === 'lane' && v.s > 12 && v.s < v.seg.length - 20);
  assert.ok(car, 'need a car on the road');
  car.mode = 'stopped'; car.lights.haz = true;
  _requestTow(C, car, 'scrap');
  assert.ok(car.kerbE, 'car was pushed to the kerb');
  for (let t = 0; t < 900 && car.mode !== 'gone'; t += 5) run(C, 5);
  assert.equal(car.mode, 'gone', 'car was towed away and crushed');
  assert.ok(!rescued.includes('tow'), 'tow truck had to be rescued');
});
