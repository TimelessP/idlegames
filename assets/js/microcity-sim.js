// ============================================================================
//  MICRO CITY - simulation core (no DOM; runs in the browser and under node)
//  Authors: Timeless Prototype and Opus 5.5
// ============================================================================
//  Units are metres and seconds. x grows east, y grows south. Physics runs in
//  real seconds; the clock runs in game minutes (days slower than nights).
//
//  SECTION INDEX (search for the tag)
//  §A1 utilities & rng        §A2 geometry segments     §A3 catalogues & names
//  §A4 road network           §A5 blocks, lots, buildings, rooms
//  §A6 car parks & kerb bays  §A7 pedestrian network, crosswalks, props, water
//  §B1 routing                §B2 vehicles: create, place, IDM, lanes
//  §B3 intersections          §B4 manoeuvres (park, lots, garages, passing)
//  §B5 collisions & crashes   §C1 people: create, walk, cross, rooms
//  §C2 trips (walk, bus, car) §C3 daily plans          §D events & incidents
//  §E  clock, lighting, stats, picking, public API
// ============================================================================

// §A1 ------------------------------------------------------------------------
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = {
    f,
    range: (lo, hi) => lo + (hi - lo) * f(),
    int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(f() * arr.length)],
    chance: p => f() < p,
    weighted(list) { // [[item, weight], ...]
      let tot = 0; for (const [, w] of list) tot += w;
      let r = f() * tot; for (const [it, w] of list) { r -= w; if (r <= 0) return it; }
      return list[list.length - 1][0];
    },
    shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
  };
  return R;
}
export function hash2(a, b) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16; return h >>> 0;
}
export const hf = (a, b) => hash2(a, b) / 4294967296;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
const inset = (r, d) => ({ x0: r.x0 + d, y0: r.y0 + d, x1: r.x1 - d, y1: r.y1 - d });
const inRect = (r, x, y, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;

// §A2 ------------------------------------------------------------------------
let SEGID = 1;
class Seg { constructor(kind) { this.id = SEGID++; this.kind = kind; this.occ = []; this.intr = []; this.length = 1; this.speed = 11; this.reverse = false; } }
export class LineSeg extends Seg {
  constructor(kind, ax, ay, bx, by) { super(kind); this.ax = ax; this.ay = ay; this.bx = bx; this.by = by; const L = Math.hypot(bx - ax, by - ay) || 1e-6; this.length = L; this.ux = (bx - ax) / L; this.uy = (by - ay) / L; }
  at(s, o) { o.x = this.ax + this.ux * s; o.y = this.ay + this.uy * s; o.tx = this.ux; o.ty = this.uy; return o; }
  project(x, y) { return clamp((x - this.ax) * this.ux + (y - this.ay) * this.uy, 0, this.length); }
}
export class PathSeg extends Seg {
  constructor(kind, pts) {
    super(kind); this.pts = pts; const n = pts.length; this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    this.length = this.cum[n - 1] || 1e-6;
  }
  at(s, o) {
    const c = this.cum, p = this.pts, n = p.length; let i;
    if (s <= 0) i = 0; else if (s >= this.length) i = n - 2;
    else { let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; } i = lo; }
    const L = (c[i + 1] - c[i]) || 1e-6, t = clamp((s - c[i]) / L, 0, 1);
    const a = p[i], b = p[i + 1];
    o.x = a.x + (b.x - a.x) * t; o.y = a.y + (b.y - a.y) * t; o.tx = (b.x - a.x) / L; o.ty = (b.y - a.y) / L; return o;
  }
  project(x, y) {
    let best = 0, bd = Infinity; const p = this.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i].x, ay = p[i].y, dx = p[i + 1].x - ax, dy = p[i + 1].y - ay, L2 = dx * dx + dy * dy || 1e-9;
      const t = clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1), qx = ax + dx * t, qy = ay + dy * t, d = (qx - x) ** 2 + (qy - y) ** 2;
      if (d < bd) { bd = d; best = this.cum[i] + t * Math.sqrt(L2); }
    }
    return best;
  }
}
export function cubic(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return out;
}
const P = (x, y) => ({ x, y });
const TMP = { x: 0, y: 0, tx: 1, ty: 0 }, TMP2 = { x: 0, y: 0, tx: 1, ty: 0 };

// §A3 ------------------------------------------------------------------------
export const LANE_W = 3.3, PARK_W = 2.5, SW = 4.5;
const ROADCLS = { avenue: { lanes: 2, speed: 13.5 }, street: { lanes: 1, speed: 11 } };
export const halfW = cls => ROADCLS[cls].lanes * LANE_W + PARK_W;

export const VT = {
  car:       { len: 4.4, wid: 1.85, h: 1.45, aMax: 2.4, bComf: 2.6, bMax: 7.8, v0: 1.0 },
  taxi:      { len: 4.6, wid: 1.85, h: 1.5, aMax: 2.4, bComf: 2.8, bMax: 7.8, v0: 1.05 },
  van:       { len: 5.4, wid: 2.05, h: 2.3, aMax: 1.8, bComf: 2.4, bMax: 6.8, v0: 0.95 },
  ute:       { len: 5.3, wid: 1.95, h: 1.8, aMax: 2.0, bComf: 2.4, bMax: 7.0, v0: 0.95 },
  police:    { len: 4.9, wid: 1.9, h: 1.5, aMax: 2.9, bComf: 3.0, bMax: 8.4, v0: 1.05 },
  ambulance: { len: 6.4, wid: 2.25, h: 2.7, aMax: 2.2, bComf: 2.6, bMax: 7.2, v0: 1.0 },
  fire:      { len: 9.4, wid: 2.5, h: 3.1, aMax: 1.6, bComf: 2.2, bMax: 6.0, v0: 0.92 },
  bus:       { len: 12, wid: 2.55, h: 3.1, aMax: 1.2, bComf: 1.8, bMax: 5.8, v0: 0.85 },
  tow:       { len: 6.6, wid: 2.3, h: 2.4, aMax: 1.8, bComf: 2.4, bMax: 6.6, v0: 0.95 },
  garbage:   { len: 8.6, wid: 2.5, h: 3.2, aMax: 1.3, bComf: 2.0, bMax: 5.8, v0: 0.75 },
};
// Share targets for the non-private fleet (absolute counts, fixed by depots).
export const FLEET = { police: 3, ambulance: 2, fire: 2, tow: 2, ute: 1, van: 5, garbage: 1, taxi: 5, bus: 4 };

const CAR_COLOURS = ['#b8322c', '#2e4f8f', '#d9c27a', '#e9e4d6', '#2f6b4a', '#6b3b6b', '#d17a2a', '#3a3a3e', '#8d939b', '#9c2b45', '#3d6f86', '#c9b8a0', '#1f2a3a', '#77806b'];
const SKIN = ['#f1d3b6', '#e2b48f', '#c98f62', '#9a6340', '#6e4329', '#4a2e1d'];
const HAIR = ['#1d1612', '#3b2618', '#6a4428', '#a8743f', '#d8b66a', '#9a9a96', '#e8e4da', '#7a2e1c'];
const CLOTH = ['#b8322c', '#2e4f8f', '#e2c044', '#2f6b4a', '#6b3b6b', '#d17a2a', '#e9e4d6', '#3a3a3e', '#4c7fa8', '#a85a7a', '#8a6b4a', '#5a8a5a', '#c7c0b0', '#1f2a3a'];
const FIRST = ['Ada', 'Ari', 'Bea', 'Ben', 'Cal', 'Cleo', 'Dev', 'Dot', 'Eli', 'Ema', 'Finn', 'Gus', 'Hana', 'Ira', 'Ivy', 'Jai', 'Juno', 'Kai', 'Lena', 'Leo', 'Mara', 'Milo', 'Nell', 'Noor', 'Oli', 'Pia', 'Quin', 'Rafi', 'Rosa', 'Sam', 'Suki', 'Tam', 'Tess', 'Uma', 'Vic', 'Wren', 'Xan', 'Yara', 'Zed', 'Zoe', 'Abe', 'Bodhi', 'Cass', 'Dara', 'Effie', 'Hugo', 'Isla', 'Jude', 'Kit', 'Lou', 'Mei', 'Nico', 'Otto', 'Remy', 'Sol', 'Teo', 'Vera', 'Wade'];
const LAST = ['Abara', 'Bell', 'Cho', 'Doyle', 'Eze', 'Farr', 'Greco', 'Hale', 'Ito', 'Jansen', 'Kaur', 'Lund', 'Moss', 'Nair', 'Okafor', 'Pike', 'Quill', 'Reyes', 'Sato', 'Tran', 'Ulloa', 'Vance', 'Webb', 'Xu', 'Young', 'Zhou', 'Amari', 'Brooks', 'Costa', 'Duke', 'Ellis', 'Ford', 'Gill', 'Hart', 'Ivers', 'Kerr', 'Lowe', 'Marsh', 'Novak', 'Orr', 'Patel', 'Rao', 'Shaw', 'Thorne', 'Wills'];
const STREET_V = ['Wattle St', 'Banksia St', 'Kettle St', 'Juniper St', 'Grand Ave', 'Lantern St', 'Mercer St', 'Orchard St', 'Quarry St', 'Rowan St', 'Tannery St'];
const STREET_H = ['Saltmarsh Rd', 'Pilgrim Rd', 'Ironbark Rd', 'Federation Ave', 'Vesper Rd', 'Union Rd', 'Willow Rd', 'Harbour Rd'];

// Brands: short names (fit a sign), a subline, a mark and a palette.
const BRAND = {
  bakery: { w: ['Crumb', 'Rise', 'Loaf', 'Hearth', 'Knead', 'Crust', 'Golden', 'Rye'], sub: ['BAKEHOUSE', 'BAKERY', 'BREAD CO'], logo: ['wheat', 'sun', 'circle'] },
  cafe: { w: ['Bean', 'Drip', 'Ritual', 'Kettle', 'Ember', 'Fable', 'Pour', 'Grind'], sub: ['COFFEE', 'ESPRESSO', 'CAFÉ'], logo: ['cup', 'drop', 'ring'] },
  florist: { w: ['Bloom', 'Petal', 'Fern', 'Posy', 'Sprig', 'Wild'], sub: ['FLOWERS', 'FLORIST'], logo: ['flower', 'leaf'] },
  books: { w: ['Folio', 'Margin', 'Quire', 'Ink', 'Spine', 'Chapter'], sub: ['BOOKS', 'BOOKSHOP'], logo: ['book', 'diamond'] },
  grocer: { w: ['Harvest', 'Basket', 'Orchard', 'Pantry', 'Market'], sub: ['GROCER', 'FRESH FOOD'], logo: ['leaf', 'circle'] },
  pharmacy: { w: ['Remedy', 'Vital', 'Care', 'Well'], sub: ['PHARMACY', 'CHEMIST'], logo: ['cross'] },
  barber: { w: ['Blade', 'Clipper', 'Dapper', 'Mane'], sub: ['BARBER', 'HAIR'], logo: ['scissors', 'bars'] },
  laundry: { w: ['Suds', 'Spin', 'Fresh', 'Bubble'], sub: ['LAUNDROMAT', 'LAUNDRY'], logo: ['drop', 'ring'] },
  hardware: { w: ['Bolt', 'Anvil', 'Trusty', 'Toolbox'], sub: ['HARDWARE', 'TOOLS'], logo: ['wrench', 'chevron'] },
  electronics: { w: ['Volt', 'Pixel', 'Circuit', 'Signal'], sub: ['ELECTRONICS', 'TECH'], logo: ['bolt', 'bars'] },
  fashion: { w: ['Thread', 'Loom', 'Mode', 'Hem', 'Stitch'], sub: ['CLOTHING', 'BOUTIQUE'], logo: ['diamond', 'chevron'] },
  pizza: { w: ['Forno', 'Slice', 'Basil', 'Crust'], sub: ['PIZZERIA', 'PIZZA'], logo: ['circle', 'leaf'] },
  noodle: { w: ['Udon', 'Slurp', 'Lotus', 'Wok'], sub: ['NOODLE BAR', 'KITCHEN'], logo: ['wave', 'ring'] },
  deli: { w: ['Larder', 'Salt', 'Brine', 'Cellar'], sub: ['DELICATESSEN', 'DELI'], logo: ['diamond', 'circle'] },
  bar: { w: ['Gaslight', 'Copper', 'Anchor', 'Owl', 'Hollow'], sub: ['BAR', 'TAVERN', 'HOTEL'], logo: ['star', 'note'] },
  gelato: { w: ['Scoop', 'Frost', 'Swirl'], sub: ['GELATO', 'ICE CREAM'], logo: ['drop', 'heart'] },
  bank: { w: ['Meridian', 'Keystone', 'Harbour', 'Summit'], sub: ['BANK', 'SAVINGS'], logo: ['key', 'diamond', 'bars'] },
  office: { w: ['Arc', 'Vector', 'Northgate', 'Lumen', 'Atlas', 'Kestrel', 'Onyx', 'Halcyon'], sub: ['GROUP', 'PARTNERS', 'HOUSE', 'TOWER'], logo: ['chevron', 'bars', 'diamond', 'ring'] },
  hotel: { w: ['Grand', 'Regent', 'Orient', 'Mirabel'], sub: ['HOTEL'], logo: ['star', 'key'] },
  cinema: { w: ['Odeon', 'Roxy', 'Lyric', 'Astor'], sub: ['CINEMA', 'PICTURES'], logo: ['star'] },
  concert: { w: ['Palais', 'Echo', 'Lyre', 'Aurora'], sub: ['CONCERT HALL', 'THEATRE'], logo: ['note', 'star'] },
  mall: { w: ['Westfield', 'Arcadia', 'Galleria', 'Plaza'], sub: ['SHOPPING CENTRE'], logo: ['bars', 'diamond'] },
  dealer: { w: ['Velocity', 'Motorworks', 'Autohaus', 'Drive'], sub: ['MOTORS', 'CARS'], logo: ['chevron', 'ring'] },
  scrapyard: { w: ['Crusher', 'Salvage', 'Ironside'], sub: ['METALS', 'SALVAGE'], logo: ['wrench', 'bars'] },
  works: { w: ['City'], sub: ['WORKS DEPOT'], logo: ['chevron'] },
  warehouse: { w: ['Parcel', 'Swift', 'Crate'], sub: ['FREIGHT', 'LOGISTICS'], logo: ['chevron', 'bars'] },
  depot: { w: ['Metro'], sub: ['BUS DEPOT'], logo: ['ring'] },
  school: { w: ['Hillview', 'Wattle', 'Riverside'], sub: ['PRIMARY SCHOOL'], logo: ['book', 'sun'] },
  police: { w: ['Police'], sub: ['STATION'], logo: ['star'] },
  fire: { w: ['Fire'], sub: ['STATION 3'], logo: ['cross'] },
  hospital: { w: ['Hospital'], sub: ['EMERGENCY'], logo: ['cross'] },
  stadium: { w: ['Arena', 'Oval'], sub: ['STADIUM'], logo: ['ring'] },
  university: { w: ['Northfield', 'Meridian', 'Kestrel'], sub: ['UNIVERSITY'], logo: ['book', 'star'] },
  lab: { w: ['Helix', 'Quanta', 'Lumen'], sub: ['SCIENCE LAB', 'LABORATORIES'], logo: ['drop', 'ring'] },
  commerce: { w: ['Exchange', 'Commerce'], sub: ['COMMERCE HOUSE', 'TRADING FLOOR'], logo: ['bars', 'chevron'] },
  datacentre: { w: ['Cumulus', 'Lattice', 'Vault'], sub: ['DATA CENTRE'], logo: ['bars', 'diamond'] },
  substation: { w: ['Grid'], sub: ['SUBSTATION'], logo: ['bolt'] },
};
const PALETTES = [
  ['#1f3d36', '#f3e9d2', '#e0a458'], ['#7a1f2b', '#f6efe3', '#e8b04b'], ['#f2e8cf', '#2b2d42', '#d62828'], ['#264653', '#e9c46a', '#f4a261'],
  ['#0b132b', '#5bc0be', '#ffffff'], ['#3d405b', '#f4f1de', '#e07a5f'], ['#fbfaf6', '#141414', '#e63946'], ['#2a9d8f', '#ffffff', '#264653'],
  ['#e9d8a6', '#005f73', '#ae2012'], ['#14213d', '#fca311', '#e5e5e5'], ['#606c38', '#fefae0', '#dda15e'], ['#3a0ca3', '#f72585', '#ffffff'],
  ['#283618', '#fefae0', '#bc6c25'], ['#22223b', '#f2e9e4', '#c9ada7'], ['#bc4749', '#f2e8cf', '#386641'], ['#f6bd60', '#3d2c2e', '#84a59d'],
];
const FONTS = ['serif', 'sans', 'cond', 'script', 'slab', 'display', 'mono'];
const FIXED_PAL = { police: ['#1b3a6b', '#ffffff', '#e8edf5'], fire: ['#a3221b', '#ffffff', '#f2c14e'], hospital: ['#ffffff', '#c8102e', '#1d3557'], works: ['#f28c28', '#1a1a1a', '#ffffff'], depot: ['#14537a', '#ffffff', '#f2c14e'] };

function makeBrand(R, cat) {
  const B = BRAND[cat] || BRAND.office; let name = R.pick(B.w);
  const r = R.f();
  if (!FIXED_PAL[cat] && cat !== 'stadium' && cat !== 'hospital') {
    if (r < 0.14 && name.length <= 6) name = 'The ' + name;
    else if (r < 0.24) { const o = R.pick(B.w); if (o !== name && (name + o).length <= 11) name = name + ' & ' + o; }
    else if (r < 0.3) name = 'Nº' + R.int(2, 99) + ' ' + name;
  }
  if (name.length > 14) name = name.slice(0, 14);
  return { name, sub: R.pick(B.sub), logo: R.pick(B.logo), pal: FIXED_PAL[cat] || R.pick(PALETTES), font: FIXED_PAL[cat] ? 'sans' : R.pick(FONTS), cat, seed: R.int(1, 1e9) };
}
const SHOP_CATS = [['cafe', 5], ['bakery', 3], ['florist', 2], ['books', 2], ['grocer', 3], ['pharmacy', 2], ['barber', 2], ['laundry', 1], ['hardware', 1], ['electronics', 2], ['fashion', 3], ['pizza', 2], ['noodle', 2], ['deli', 2], ['bar', 3], ['gelato', 1]];
const SHOP_HOURS = { cafe: [6.5, 16], bakery: [6, 15], bar: [16, 25], pizza: [11, 23], noodle: [11, 22.5], gelato: [11, 21.5], grocer: [7, 21] };
export const shopHours = cat => SHOP_HOURS[cat] || [8.5, 17.5];

// §A4 ------------------------------------------------------------------------
function genRoads(C) {
  const R = C.R, NC = 8, NR = 6, M = 52;
  const vCls = [], hCls = [];
  for (let i = 0; i <= NC; i++) vCls.push(i === 4 ? 'avenue' : 'street');
  for (let j = 0; j <= NR; j++) hCls.push(j === 3 ? 'avenue' : 'street');
  const colW = [], rowH = [];
  for (let i = 0; i < NC; i++) colW.push(Math.round(R.range(82, 104)));
  for (let j = 0; j < NR; j++) rowH.push(Math.round(R.range(64, 78)));
  const X = [M + halfW(vCls[0])], Y = [M + halfW(hCls[0])];
  for (let i = 0; i < NC; i++) X.push(X[i] + halfW(vCls[i]) + colW[i] + halfW(vCls[i + 1]));
  for (let j = 0; j < NR; j++) Y.push(Y[j] + halfW(hCls[j]) + rowH[j] + halfW(hCls[j + 1]));
  C.W = X[NC] + halfW(vCls[NC]) + M; C.H = Y[NR] + halfW(hCls[NR]) + M;
  const removed = new Set(['v:3:2', 'v:6:0']);
  C.grid = { NC, NR, X, Y, vCls, hCls, removed };
  C.nodes = [];
  const nodeAt = (i, j) => C.nodes[j * (NC + 1) + i];
  C.nodeAt = nodeAt;
  for (let j = 0; j <= NR; j++) for (let i = 0; i <= NC; i++)
    C.nodes.push({ id: C.nodes.length, i, j, x: X[i], y: Y[j], arms: {}, inE: [], outE: [], moves: [], cws: [], halfV: 0, halfH: 0, kind: 'through', committed: new Map(), sig: null, stopQ: [] });
  const segs = [];
  for (let j = 0; j <= NR; j++) for (let i = 0; i < NC; i++) segs.push({ a: nodeAt(i, j), b: nodeAt(i + 1, j), axis: 'h', cls: hCls[j], name: STREET_H[j % STREET_H.length], line: j, edges: [] });
  for (let i = 0; i <= NC; i++) for (let j = 0; j < NR; j++) if (!removed.has(`v:${i}:${j}`)) segs.push({ a: nodeAt(i, j), b: nodeAt(i, j + 1), axis: 'v', cls: vCls[i], name: STREET_V[i % STREET_V.length], line: i, edges: [] });
  C.roadSegs = segs;
  for (const s of segs) { if (s.axis === 'h') { s.a.arms.E = s; s.b.arms.W = s; } else { s.a.arms.S = s; s.b.arms.N = s; } }
  for (const n of C.nodes) {
    const v = n.arms.N || n.arms.S, h = n.arms.E || n.arms.W;
    n.halfV = v ? halfW(v.cls) : 0; n.halfH = h ? halfW(h.cls) : 0;
    const deg = Object.keys(n.arms).length;
    if (v && h && deg >= 3) n.kind = (v.cls === 'avenue' || h.cls === 'avenue') ? 'signal' : 'stop';
    else n.kind = 'through';
  }
  const trim = (n, axis) => { const cross = axis === 'h' ? n.halfV : n.halfH; return cross > 0 ? cross + SW + 0.7 : 1.5; };
  C.edges = [];
  for (const s of segs) {
    for (const flip of [false, true]) {
      const from = flip ? s.b : s.a, to = flip ? s.a : s.b;
      const dx = Math.sign(to.x - from.x), dy = Math.sign(to.y - from.y);
      const kx = C.LHT ? dy : -dy, ky = C.LHT ? -dx : dx;
      const tA = trim(from, s.axis), tB = trim(to, s.axis), D = Math.hypot(to.x - from.x, to.y - from.y);
      const e = { id: C.edges.length, from, to, axis: s.axis, cls: s.cls, name: s.name, seg: s, dx, dy, kx, ky, nl: ROADCLS[s.cls].lanes, speed: ROADCLS[s.cls].speed,
        ax: from.x + dx * tA, ay: from.y + dy * tA, len: D - tA - tB, lanes: [], rev: null, bays: [], drives: [], zebras: [], closed: false, works: [], load: 0 };
      e.parkOff = e.nl * LANE_W + PARK_W / 2; e.kerbOff = e.nl * LANE_W + PARK_W;
      for (let k = 0; k < e.nl; k++) {
        const off = (k + 0.5) * LANE_W;
        const ln = new LineSeg('lane', e.ax + kx * off, e.ay + ky * off, e.ax + dx * e.len + kx * off, e.ay + dy * e.len + ky * off);
        ln.edge = e; ln.idx = k; ln.off = off; ln.moves = []; ln.speed = e.speed; e.lanes.push(ln);
      }
      from.outE.push(e); to.inE.push(e); C.edges.push(e); s.edges.push(e);
    }
    s.edges[0].rev = s.edges[1]; s.edges[1].rev = s.edges[0];
  }
  for (const n of C.nodes) {
    if (n.kind === 'signal') {
      const vAv = (n.arms.N || n.arms.S).cls === 'avenue', hAv = (n.arms.E || n.arms.W).cls === 'avenue';
      const gV = vAv ? 24 : 15, gH = hAv ? 24 : 15;
      n.sig = { i: R.int(0, 5), t: R.range(0, 8), plan: [{ a: 'v', st: 'G', d: gV }, { a: 'v', st: 'Y', d: 3.2 }, { a: null, st: 'R', d: 1.6 }, { a: 'h', st: 'G', d: gH }, { a: 'h', st: 'Y', d: 3.2 }, { a: null, st: 'R', d: 1.6 }] };
    }
  }
  const nearTurn = C.LHT ? 'L' : 'R';
  C.moves = [];
  for (const n of C.nodes) {
    for (const ein of n.inE) for (const eout of n.outE) {
      if (eout === ein.rev) continue;
      const cr = ein.dx * eout.dy - ein.dy * eout.dx, dot = ein.dx * eout.dx + ein.dy * eout.dy;
      const turn = dot > 0.5 ? 'S' : (cr < 0 ? 'L' : 'R');
      const pairs = [];
      if (turn === 'S') for (let k = 0; k < ein.nl; k++) pairs.push([k, Math.min(k, eout.nl - 1)]);
      else if (turn === nearTurn) pairs.push([ein.nl - 1, eout.nl - 1]);
      else pairs.push([0, 0]);
      for (const [a, b] of pairs) {
        const li = ein.lanes[a], lo = eout.lanes[b];
        const p0 = P(li.bx, li.by), p3 = P(lo.ax, lo.ay);
        let pts;
        if (turn === 'S') pts = [p0, p3];
        else { const c = ein.axis === 'h' ? P(p3.x, p0.y) : P(p0.x, p3.y); pts = cubic(p0, P(lerp(p0.x, c.x, .6), lerp(p0.y, c.y, .6)), P(lerp(p3.x, c.x, .6), lerp(p3.y, c.y, .6)), p3, 14); }
        const mv = new PathSeg('move', pts);
        mv.node = n; mv.inLane = li; mv.outLane = lo; mv.turn = turn; mv.near = turn === nearTurn; mv.far = turn !== 'S' && turn !== nearTurn;
        mv.axis = ein.axis; mv.conf = []; mv.yieldTo = []; mv.cws = [];
        mv.speed = turn === 'S' ? Math.min(ein.speed, eout.speed) : (mv.near ? 5.0 : 6.6);
        li.moves.push(mv); n.moves.push(mv); C.moves.push(mv);
      }
    }
    // conflicts
    const samp = n.moves.map(m => { const pts = []; for (let s = 0; s <= m.length; s += 1) { m.at(s, TMP); pts.push(TMP.x, TMP.y); } return pts; });
    for (let a = 0; a < n.moves.length; a++) for (let b = a + 1; b < n.moves.length; b++) {
      const ma = n.moves[a], mb = n.moves[b];
      if (ma.inLane === mb.inLane) continue;
      let conflict = ma.outLane === mb.outLane;
      if (!conflict) {
        const A = samp[a], B = samp[b];
        outer: for (let i = 0; i < A.length; i += 2) for (let j = 0; j < B.length; j += 2) { if ((A[i] - B[j]) ** 2 + (A[i + 1] - B[j + 1]) ** 2 < 2.4 * 2.4) { conflict = true; break outer; } }
      }
      if (!conflict) continue;
      ma.conf.push(mb); mb.conf.push(ma);
      if (n.kind === 'signal' && ma.axis === mb.axis) {
        if (ma.far && !mb.far) ma.yieldTo.push(mb); else if (mb.far && !ma.far) mb.yieldTo.push(ma);
        else if (ma.near && mb.near) { /* rare */ } else if (ma.far && mb.far && ma.outLane === mb.outLane) mb.yieldTo.push(ma);
      }
    }
  }
}
export function edgePoint(e, s, off, o = { x: 0, y: 0 }) { o.x = e.ax + e.dx * s + e.kx * off; o.y = e.ay + e.dy * s + e.ky * off; return o; }
function projectOnEdge(e, x, y) { return (x - e.ax) * e.dx + (y - e.ay) * e.dy; }
function findEdge(C, axis, line, coord, kerbSign) {
  // the directed edge on a grid line that covers `coord`, whose kerb normal points with kerbSign on the cross axis
  for (const s of C.roadSegs) {
    if (s.axis !== axis || s.line !== line) continue;
    const lo = axis === 'h' ? Math.min(s.a.x, s.b.x) : Math.min(s.a.y, s.b.y), hi = axis === 'h' ? Math.max(s.a.x, s.b.x) : Math.max(s.a.y, s.b.y);
    if (coord < lo || coord > hi) continue;
    for (const e of s.edges) if (Math.sign(axis === 'h' ? e.ky : e.kx) === kerbSign) return e;
  }
  return null;
}

// §A5 ------------------------------------------------------------------------
const WHOLE = { '2,2': 'park', '5,0': 'stadium', '4,2': 'plaza', '1,4': 'market', '6,3': 'mall', '6,4': 'hospital', '7,5': 'depot' };
const PLACES = [
  { blk: '3,4', row: 'S', type: 'police', w: [40, 44] }, { blk: '5,4', row: 'S', type: 'fire', w: [26, 30] },
  { blk: '3,1', row: 'S', type: 'concert', w: [40, 46] }, { blk: '5,5', row: 'S', type: 'dealer', w: [46, 52] },
  { blk: '5,5', row: 'N', type: 'warehouse', w: [38, 42] }, { blk: '6,5', row: 'S', type: 'scrapyard', w: [46, 52] },
  { blk: '6,5', row: 'N', type: 'works', w: [36, 40] }, { blk: '1,1', row: 'S', type: 'school', w: [40, 46] },
  { blk: '4,3', row: 'S', type: 'hotel', w: [26, 30] }, { blk: '3,3', row: 'S', type: 'bank', w: [20, 24] },
  { blk: '5,2', row: 'S', type: 'cinema', w: [24, 28] }, { blk: '5,3', row: 'N', type: 'carpark', w: [34, 36] },
  { blk: '2,3', row: 'N', type: 'carpark', w: [34, 36] }, { blk: '3,4', row: 'N', type: 'carpark', w: [18, 20] },
  { blk: '2,1', row: 'S', type: 'university', w: [46, 52] }, { blk: '2,1', row: 'N', type: 'lab', w: [28, 32] },
  { blk: '3,3', row: 'N', type: 'commerce', w: [26, 30] }, { blk: '4,5', row: 'N', type: 'datacentre', w: [36, 40] },
  { blk: '4,5', row: 'S', type: 'substation', w: [22, 26] },
];
const BSPEC = {
  house: { f: [1, 2], fh: 3.1, gh: 3.2, pitch: 3.6 }, terrace: { f: [2, 3], fh: 3.0, gh: 3.2, pitch: 2.5 },
  walkup: { f: [3, 5], fh: 3.0, gh: 3.3, pitch: 3.0 }, apartment: { f: [5, 9], fh: 3.0, gh: 3.6, pitch: 3.2 },
  office: { f: [6, 14], fh: 3.7, gh: 4.8, pitch: 2.6 }, shop: { f: [2, 4], fh: 3.1, gh: 4.4, pitch: 3.0 },
  hotel: { f: [7, 11], fh: 3.1, gh: 5.2, pitch: 2.8 }, bank: { f: [3, 5], fh: 4.0, gh: 5.6, pitch: 3.4 },
  cinema: { f: [2, 3], fh: 4.2, gh: 6.4, pitch: 4.2 }, concert: { f: [2, 3], fh: 5.0, gh: 8.0, pitch: 4.6 },
  police: { f: [3, 3], fh: 3.4, gh: 4.2, pitch: 3.2 }, fire: { f: [2, 2], fh: 3.6, gh: 5.4, pitch: 3.2 },
  hospital: { f: [6, 8], fh: 3.6, gh: 4.8, pitch: 3.0 }, mall: { f: [3, 3], fh: 5.0, gh: 6.2, pitch: 5.0 },
  warehouse: { f: [1, 1], fh: 7, gh: 7.5, pitch: 5 }, works: { f: [1, 1], fh: 5, gh: 5.2, pitch: 4 }, depot: { f: [1, 1], fh: 8, gh: 8.5, pitch: 6 },
  school: { f: [2, 2], fh: 3.6, gh: 3.9, pitch: 3.2 }, dealer: { f: [1, 1], fh: 5, gh: 6.0, pitch: 5 }, shed: { f: [1, 1], fh: 3.4, gh: 3.4, pitch: 3 },
  stadium: { f: [1, 1], fh: 15, gh: 15, pitch: 10 },
  university: { f: [4, 6], fh: 4.0, gh: 5.2, pitch: 3.4 }, lab: { f: [3, 4], fh: 3.8, gh: 4.4, pitch: 3.0 },
  commerce: { f: [8, 12], fh: 3.8, gh: 6.0, pitch: 2.8 }, datacentre: { f: [2, 3], fh: 4.6, gh: 5.0, pitch: 6.0 },
  substation: { f: [1, 1], fh: 3.6, gh: 3.6, pitch: 6.0 },
};
const RES_TYPES = new Set(['house', 'terrace', 'walkup', 'apartment', 'shop', 'hotel']);

function genBlocks(C) {
  const { NC, NR, X, Y, vCls, hCls, removed } = C.grid;
  C.blocks = []; const at = {};
  for (let j = 0; j < NR; j++) for (let i = 0; i < NC; i++) {
    if (at[`${i},${j}`]) continue;
    let i1 = i; while (i1 + 1 < NC && removed.has(`v:${i1 + 1}:${j}`)) i1++;
    const k = { x0: X[i] + halfW(vCls[i]), x1: X[i1 + 1] - halfW(vCls[i1 + 1]), y0: Y[j] + halfW(hCls[j]), y1: Y[j + 1] - halfW(hCls[j + 1]) };
    const b = { id: C.blocks.length, i, j, i1, kerb: k, ring: inset(k, SW / 2), inner: inset(k, SW), kind: null, rpts: [], rnodes: [], bld: [], lots: [], yard: null, area: null };
    for (let ii = i; ii <= i1; ii++) at[`${ii},${j}`] = b;
    C.blocks.push(b);
  }
  C.blockAt = (i, j) => at[`${i},${j}`];
  C.buildings = []; C.lots = []; C.spots = { park: null, plaza: null, market: null };
  for (const b of C.blocks) {
    const cx = (b.i + b.i1 + 1) / 2, cy = b.j + 0.5, d = Math.max(Math.abs(cx - 4), Math.abs(cy - 3) * 1.25);
    b.kind = WHOLE[`${b.i},${b.j}`] || (b.j === 5 && b.i >= 5 ? 'industrial' : d < 1.6 ? 'downtown' : d < 2.9 ? 'mixed' : 'residential');
  }
  for (const b of C.blocks) fillBlock(C, b);
}
function blockRows(C, b) {
  const inn = b.inner, D = inn.y1 - inn.y0, alley = D > 50 ? C.R.range(5, 10) : 3, rd = (D - alley) / 2;
  b.yard = { x0: inn.x0, x1: inn.x1, y0: inn.y0 + rd, y1: inn.y1 - rd };
  return { S: { x0: inn.x0, x1: inn.x1, y0: inn.y1 - rd, y1: inn.y1, facing: 'S' }, N: { x0: inn.x0, x1: inn.x1, y0: inn.y0, y1: inn.y0 + rd, facing: 'N' } };
}
function fillBlock(C, b) {
  const R = C.R, inn = b.inner;
  if (b.kind === 'park' || b.kind === 'plaza' || b.kind === 'market') { b.area = { ...inn }; return; }
  if (b.kind === 'stadium') {
    const sx1 = inn.x0 + (inn.x1 - inn.x0) * 0.6;
    const st = makeBuilding(C, b, { x0: inn.x0 + 3, x1: sx1, y0: inn.y0 + 3, y1: inn.y1 - 2 }, 'stadium', 'S');
    C.stadium = st;
    splitLots(C, b, { x0: sx1 + 5, x1: inn.x1, y0: inn.y0, y1: inn.y1 }, 'S', 'stadium');
    return;
  }
  const rows = blockRows(C, b);
  if (b.kind === 'mall') { C.mall = makeBuilding(C, b, rows.N, 'mall', 'N'); splitLots(C, b, rows.S, 'S', 'mall'); return; }
  if (b.kind === 'hospital') { C.hospital = makeBuilding(C, b, { ...rows.N, x0: rows.N.x0 + 4, x1: rows.N.x1 - 4 }, 'hospital', 'N'); splitLots(C, b, rows.S, 'S', 'hospital'); return; }
  if (b.kind === 'depot') { C.depot = makeBuilding(C, b, { ...rows.N, x0: rows.N.x0 + 10, x1: rows.N.x1 - 10 }, 'depot', 'N'); const r = rows.S; const w = Math.min(r.x1 - r.x0, 66); makeLot(C, b, { ...r, x0: r.x0 + (r.x1 - r.x0 - w) / 2, x1: r.x0 + (r.x1 - r.x0 + w) / 2 }, 'S', 'depot', { bayL: 13, bayW: 3.8 }); return; }
  for (const rowKey of ['S', 'N']) {
    const row = rows[rowKey], total = row.x1 - row.x0;
    const req = PLACES.filter(p => p.blk === `${b.i},${b.j}` && p.row === rowKey).map(p => ({ t: p.type, w: R.range(p.w[0], p.w[1]), special: true }));
    let rem = total - req.reduce((a, r) => a + r.w, 0);
    const gen = [];
    while (rem > 0.5) {
      const t = pickGeneric(C, b.kind, rowKey);
      const run = t === 'terrace' ? R.int(3, 6) : 1;
      let stop = false;
      for (let k = 0; k < run && !stop; k++) {
        const [w0, w1] = WIDTHS[t]; let w = R.range(w0, w1);
        if (rem - w < 6.5) { w = rem; stop = true; }
        gen.push({ t, w, run: run > 1 ? gen.length - k : -1 }); rem -= w;
      }
      if (stop) break;
    }
    const all = gen.slice(); for (const r of req) all.splice(R.int(0, all.length), 0, r);
    let x = row.x0;
    for (const it of all) {
      const r = { x0: x, x1: x + it.w, y0: row.y0, y1: row.y1 }; x += it.w;
      placeLot(C, b, r, row.facing, it.t, it);
    }
  }
}
const WIDTHS = { house: [13, 17], terrace: [6.4, 8.2], walkup: [14, 19], apartment: [19, 28], office: [22, 34], shop: [9, 14], carpark: [34, 36], warehouse: [18, 26] };
function pickGeneric(C, kind, row) {
  const R = C.R;
  if (kind === 'downtown') return R.weighted([['office', row === 'S' ? 4 : 5], ['apartment', 2], ['shop', row === 'S' ? 3 : 1], ['walkup', 1]]);
  if (kind === 'mixed') return R.weighted([['shop', row === 'S' ? 5 : 2], ['walkup', 3], ['apartment', 2], ['terrace', 1], ['office', 1]]);
  if (kind === 'industrial') return R.weighted([['warehouse', 3], ['walkup', 1]]);
  return R.weighted([['house', 4], ['terrace', 3], ['walkup', 2], ['apartment', 1], ['shop', row === 'S' ? 1 : 0.3]]);
}
function placeLot(C, b, r, facing, t, it) {
  const R = C.R, w = r.x1 - r.x0;
  switch (t) {
    case 'police': { const bw = 22; const bl = makeBuilding(C, b, { ...r, x1: r.x0 + bw }, 'police', facing); C.police = bl; bl.yard = makeLot(C, b, { ...r, x0: r.x0 + bw + 0.5 }, facing, 'police'); return; }
    case 'fire': { const bl = makeBuilding(C, b, r, 'fire', facing); C.fireStation = bl; makeGarages(C, b, bl); return; }
    case 'dealer': { const bw = 17; C.dealer = makeBuilding(C, b, { ...r, x1: r.x0 + bw }, 'dealer', facing); C.dealer.yard = makeLot(C, b, { ...r, x0: r.x0 + bw + 0.5 }, facing, 'dealer'); return; }
    case 'warehouse': {
      if (it.special) { const bw = w - 18; C.warehouse = makeBuilding(C, b, { ...r, x1: r.x0 + bw }, 'warehouse', facing); C.warehouse.yard = makeLot(C, b, { ...r, x0: r.x0 + bw + 0.5 }, facing, 'warehouse'); return; }
      makeBuilding(C, b, r, 'warehouse', facing); return;
    }
    case 'scrapyard': { C.scrap = makeBuilding(C, b, { ...r, x1: r.x0 + 9, y0: facing === 'S' ? r.y1 - 10 : r.y0, y1: facing === 'S' ? r.y1 : r.y0 + 10 }, 'shed', facing, 'scrapyard'); C.scrap.yard = makeLot(C, b, { ...r, x0: r.x0 + 10 }, facing, 'scrap'); return; }
    case 'works': { C.works = makeBuilding(C, b, { ...r, x1: r.x0 + 14 }, 'works', facing); C.works.yard = makeLot(C, b, { ...r, x0: r.x0 + 15 }, facing, 'works'); return; }
    case 'carpark': splitLots(C, b, r, facing, 'public'); return;
    case 'school': { const fy = facing === 'S' ? { y0: r.y0, y1: r.y1 - 12 } : { y0: r.y0 + 12, y1: r.y1 }; const bl = makeBuilding(C, b, { ...r, ...fy }, 'school', facing); C.school = bl; bl.playground = facing === 'S' ? { x0: r.x0 + 2, x1: r.x1 - 2, y0: r.y1 - 11, y1: r.y1 - 1 } : { x0: r.x0 + 2, x1: r.x1 - 2, y0: r.y0 + 1, y1: r.y0 + 11 }; return; }
    default: {
      const bl = makeBuilding(C, b, r, t, facing);
      if (t === 'hotel') C.hotel = bl; if (t === 'bank') C.bank = bl; if (t === 'cinema') C.cinema = bl; if (t === 'concert') C.concert = bl;
      if (t === 'university') C.university = bl; if (t === 'lab') C.lab = bl; if (t === 'commerce') C.commerce = bl; if (t === 'datacentre') C.datacentre = bl; if (t === 'substation') C.substation = bl;
      if (it && it.run >= 0) bl.terraceRun = it.run + b.id * 1000;
    }
  }
}
function makeBuilding(C, b, lot, type, facing, brandCat) {
  const R = C.R, S = BSPEC[type] || BSPEC.shop;
  let fp = { ...lot };
  if (type === 'house') { const fr = R.range(3.5, 6), bk = R.range(4, 9); fp = { x0: lot.x0 + R.range(1, 2), x1: lot.x1 - R.range(1, 2), y0: facing === 'S' ? lot.y0 + bk : lot.y0 + fr, y1: facing === 'S' ? lot.y1 - fr : lot.y1 - bk }; }
  else if (type !== 'stadium' && type !== 'mall' && type !== 'hospital' && type !== 'depot') {
    const back = R.chance(0.5) ? R.range(0, 7) : 0;
    if (facing === 'S') fp.y0 += back; else fp.y1 -= back;
  }
  let floors = R.int(S.f[0], S.f[1]);
  if (b.kind === 'downtown' && (type === 'office' || type === 'apartment')) floors += R.int(2, 8);
  if (b.kind === 'residential' && type === 'apartment') floors = Math.min(floors, 6);
  const w = fp.x1 - fp.x0, pitch = S.pitch * R.range(0.95, 1.08);
  const cols = Math.max(1, Math.floor((w - 1.0) / pitch));
  const parapet = type === 'house' || type === 'terrace' ? 0 : R.range(0.5, 1.3);
  const H = S.gh + (floors - 1) * S.fh + parapet;
  const cat = brandCat || (type === 'shop' ? R.weighted(SHOP_CATS) : BRAND[type] ? type : null);
  const branded = !!cat && (type !== 'office' || R.chance(0.7));
  const bl = {
    id: C.buildings.length, type, cat, block: b, lot, fp, facing, floors, gh: S.gh, fh: S.fh, H, parapet,
    win: { cols, pitch, mx: (w - cols * pitch) / 2 }, rooms: [], units: [], residents: [], workers: [], inside: new Set(),
    brand: branded ? makeBrand(R, cat) : null, seed: R.int(1, 2 ** 30), fire: null, hours: cat ? shopHours(cat) : null,
    door: null, doorNode: -1, garages: null, yard: null, roof: type === 'house' ? 'pitched' : (type === 'terrace' ? 'pitched' : 'flat'),
    lit: 0, litVer: 0, visitors: 0, label: '',
  };
  const doorX = type === 'house' || type === 'terrace' ? (fp.x0 + fp.x1) / 2 + R.range(-w * 0.25, w * 0.25) : (fp.x0 + fp.x1) / 2 + (cols > 3 ? R.range(-w * 0.2, w * 0.2) : 0);
  bl.door = { x: clamp(doorX, fp.x0 + 1, fp.x1 - 1), y: facing === 'S' ? fp.y1 : fp.y0 };
  makeRooms(C, bl);
  bl.label = buildingLabel(C, bl);
  b.bld.push(bl); C.buildings.push(bl);
  return bl;
}
function buildingLabel(C, bl) {
  const names = { house: 'House', terrace: 'Terrace house', walkup: 'Walk-up flats', apartment: 'Apartments', office: 'Offices', shop: 'Shop', warehouse: 'Warehouse', stadium: 'Stadium', mall: 'Shopping centre', hospital: 'Hospital', police: 'Police station', fire: 'Fire station', depot: 'Bus depot', works: 'Works depot', dealer: 'Car dealership', school: 'Primary school', shed: 'Scrap metal yard', hotel: 'Hotel', bank: 'Bank', cinema: 'Cinema', concert: 'Concert hall', university: 'University', lab: 'Science lab', commerce: 'Commerce house', datacentre: 'Data centre', substation: 'Power substation' };
  if (bl.brand && !['police', 'fire', 'hospital', 'works', 'depot'].includes(bl.type)) return `${bl.brand.name.replace(/^The /, bl.brand.sub.length > 9 ? '' : 'The ')} ${bl.brand.sub.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase())}`;
  return names[bl.type] || 'Building';
}
function makeRooms(C, bl) {
  const R = C.R, cols = bl.win.cols, F = bl.floors, t = bl.type;
  const addRoom = (f, c0, c1, kind, unit = -1) => { const r = { id: bl.rooms.length, f, c0, c1, kind, unit, occ: [], lit: false, tv: R.chance(0.5), seed: R.int(1, 1e9), curtain: R.f(), hue: R.int(0, 5) }; bl.rooms.push(r); return r; };
  const unitOf = rooms => { const u = { id: bl.units.length, rooms: rooms.map(r => r.id), residents: [] }; for (const r of rooms) r.unit = u.id; bl.units.push(u); return u; };
  const splitUnit = (f, c0, c1) => {
    const n = c1 - c0 + 1, rs = [];
    if (n === 1) rs.push(addRoom(f, c0, c1, 'studio'));
    else if (n === 2) { rs.push(addRoom(f, c0, c0, 'living')); rs.push(addRoom(f, c1, c1, 'bed')); }
    else { const a = c0 + 1 + (n > 3 ? 1 : 0); rs.push(addRoom(f, c0, a - 1, 'living')); rs.push(addRoom(f, a, c1 - 1, 'kitchen')); rs.push(addRoom(f, c1, c1, 'bed')); }
    return unitOf(rs);
  };
  if (t === 'house' || t === 'terrace') {
    const rs = [];
    for (let f = 0; f < F; f++) {
      if (cols === 1) rs.push(addRoom(f, 0, 0, f === 0 ? 'living' : 'bed'));
      else if (f === 0) { const m = Math.max(0, Math.floor(cols / 2) - 1); rs.push(addRoom(0, 0, m, 'living')); rs.push(addRoom(0, m + 1, cols - 1, 'kitchen')); }
      else { const m = Math.floor((cols - 1) / 2); rs.push(addRoom(f, 0, m, 'bed')); if (m + 1 <= cols - 1) rs.push(addRoom(f, m + 1, cols - 1, 'bed')); }
    }
    unitOf(rs); return;
  }
  const resLike = t === 'walkup' || t === 'apartment' || t === 'shop' || t === 'hotel';
  for (let f = 0; f < F; f++) {
    if (f === 0 && (t === 'shop' || t === 'bank' || t === 'office' || t === 'hotel' || t === 'mall' || t === 'cinema' || t === 'concert' || t === 'dealer' || t === 'university' || t === 'commerce')) {
      addRoom(0, 0, cols - 1, bl.facing === 'N' && t === 'shop' ? 'store' : (t === 'hotel' || t === 'office' || t === 'bank' || t === 'university' || t === 'commerce' ? 'lobby' : 'retail')); continue;
    }
    if (resLike) {
      if (t === 'hotel') { for (let c = 0; c < cols; c++) unitOf([addRoom(f, c, c, 'hotel')]); continue; }
      let c = 0; while (c < cols) { const uw = Math.min(cols - c, R.int(2, 3)); splitUnit(f, c, c + uw - 1); c += uw; }
      continue;
    }
    const kind = { office: 'office', bank: 'office', police: 'office', fire: f === 0 ? 'garage' : 'office', hospital: f === 0 ? 'lobby' : 'ward', school: 'class', mall: 'retail', works: 'workshop', depot: 'workshop', warehouse: 'workshop', shed: 'workshop', dealer: 'retail', university: f % 2 ? 'lecture' : 'office', lab: 'lab', commerce: 'trading', datacentre: 'server' }[t];
    if (!kind || t === 'stadium') continue;
    if (kind === 'garage') { addRoom(f, 0, cols - 1, 'garage'); continue; }
    const span = kind === 'office' ? R.int(3, 5) : kind === 'ward' || kind === 'lab' ? 2 : kind === 'class' ? 3 : kind === 'lecture' || kind === 'trading' ? 4 : cols;
    for (let c = 0; c < cols; c += span) addRoom(f, c, Math.min(cols - 1, c + span - 1), kind);
  }
}
// cars that serve a building (police yard, fire garages)
function makeGarages(C, b, bl) {
  const fp = bl.fp, n = 2, e = findEdge(C, 'h', bl.facing === 'S' ? b.j + 1 : b.j, (fp.x0 + fp.x1) / 2, bl.facing === 'S' ? -1 : 1);
  const inward = bl.facing === 'S' ? -1 : 1, frontY = bl.facing === 'S' ? fp.y1 : fp.y0;
  bl.garages = [];
  for (let k = 0; k < n; k++) {
    const gx = fp.x0 + (fp.x1 - fp.x0) * (0.28 + 0.44 * k);
    const bay = { id: C.bays.length, kind: 'garage', bld: bl, x: gx, y: frontY + inward * 5.2, hx: 0, hy: -inward, occ: null, res: null, e, len: 10 };
    const s = projectOnEdge(e, gx, frontY); bay.s = s;
    e.drives.push({ s0: s - 6, s1: s + 6, bay });
    const lane = e.lanes[e.nl - 1];
    // out: forward from garage across the footpath, near-side turn into the kerb lane
    const sOut = Math.min(e.len - 1, s + 10);
    lane.at(sOut, TMP);
    bay.outTrack = new PathSeg('track', cubic(P(bay.x, bay.y), P(bay.x, bay.y - inward * 6), P(TMP.x - e.dx * 5, TMP.y - e.dy * 5), P(TMP.x, TMP.y), 16));
    bay.outTrack.join = { lane, s: sOut };
    // in: stop past the doors in the kerb lane, then reverse in
    const sIn = Math.min(e.len - 1, s + 12); lane.at(sIn, TMP);
    const rt = new PathSeg('track', cubic(P(TMP.x, TMP.y), P(TMP.x - e.dx * 5, TMP.y - e.dy * 5), P(bay.x, bay.y - inward * 6), P(bay.x, bay.y), 18));
    rt.reverse = true; rt.blocks = { lane, s0: s - 6, s1: sIn + 4 }; bay.inTrack = rt; bay.inS = sIn;
    C.bays.push(bay); bl.garages.push(bay);
  }
}

// §A6 ------------------------------------------------------------------------
function splitLots(C, b, r, facing, kind) {
  const W = r.x1 - r.x0; let n = Math.max(1, Math.round(W / 36));
  if (W / n < 16.6) n = Math.max(1, Math.floor(W / 16.6));
  const w = W / n, out = [];
  for (let k = 0; k < n; k++) out.push(makeLot(C, b, { ...r, x0: r.x0 + k * w + (k ? 0.5 : 0), x1: r.x0 + (k + 1) * w }, facing, kind));
  return out;
}
function makeLot(C, b, r, facing, kind, o = {}) {
  const bayL = o.bayL || 5.2, bayW = o.bayW || 2.6, aisle = 3.4;
  const width = r.x1 - r.x0, depth = r.y1 - r.y0;
  const e = findEdge(C, 'h', facing === 'S' ? b.j + 1 : b.j, (r.x0 + r.x1) / 2, facing === 'S' ? -1 : 1);
  if (!e) return null;
  const inY = facing === 'S' ? -1 : 1, frontY = facing === 'S' ? r.y1 : r.y0, uO = e.dx > 0 ? r.x0 : r.x1;
  const W2 = (u, w) => P(uO + e.dx * u, frontY + inY * w);
  let aisles;
  if (width >= 4 * bayL + 12.4) { const m = (width - (4 * bayL + 12)) / 2; aisles = [{ u: m + bayL + 3, sides: [-1, 1], half: 3 }, { u: m + 3 * bayL + 9, sides: [-1, 1], half: 3 }]; }
  else if (width >= 2 * bayL + 2 * aisle + 0.4) { const m = (width - (2 * bayL + 2 * aisle)) / 2; aisles = [{ u: m + bayL + aisle / 2, sides: [-1], half: aisle / 2 }, { u: m + bayL + 1.5 * aisle, sides: [1], half: aisle / 2 }]; }
  else return null;
  const a0 = aisles[0], a1 = aisles[1], rr = (a1.u - a0.u) / 2;
  const cw = depth - 2.4, c = Math.min(2.6, rr);
  const raw = [W2(a0.u, 0), W2(a0.u, cw - c),
    ...cubic(W2(a0.u, cw - c), W2(a0.u, cw - c * 0.45), W2(a0.u + c * 0.45, cw), W2(a0.u + c, cw), 5).slice(1),
    W2(a1.u - c, cw),
    ...cubic(W2(a1.u - c, cw), W2(a1.u - c * 0.45, cw), W2(a1.u, cw - c * 0.45), W2(a1.u, cw - c), 5).slice(1),
    W2(a1.u, 0)];
  const pts = [raw[0]]; for (const p of raw) { const q = pts[pts.length - 1]; if (Math.hypot(p.x - q.x, p.y - q.y) > 0.05) pts.push(p); }
  const loop = new PathSeg('track', pts); loop.speed = 3.2;
  const backW = cw - c + rr;
  const lot = { id: C.lots.length, kind, block: b, rect: r, facing, e, loop, bays: [], inTrack: null, outTrack: null, pedIn: W2(width / 2, 0), pedNode: -1 };
  const wb0 = 2.6, wb1 = cw - 1.8; void backW;
  for (const a of aisles) for (const side of a.sides) {
    for (let w = wb0 + bayW / 2; w + bayW / 2 <= wb1; w += bayW) {
      const uc = a.u + side * (a.half + bayL / 2), c = W2(uc, w), ap = W2(a.u, w);
      const hx = e.dx * side, hy = 0;
      const bay = { id: C.bays.length, kind: kind === 'hospital' && lot.bays.length < 3 ? 'amb' : 'lot', lot, x: c.x, y: c.y, hx, hy, occ: null, res: null, len: bayL };
      bay.loopS = loop.project(ap.x, ap.y);
      // forward in from the loop
      loop.at(Math.max(0, bay.loopS - 4.5), TMP);
      bay.inTrack = new PathSeg('track', cubic(P(TMP.x, TMP.y), P(TMP.x + TMP.tx * 2.6, TMP.y + TMP.ty * 2.6), P(c.x - hx * 3.2, c.y - hy * 3.2), P(c.x, c.y), 10));
      bay.inTrack.speed = 2.2; bay.inS0 = Math.max(0, bay.loopS - 4.5);
      // reverse out to the loop, ending upstream and facing along the loop
      const sEnd = Math.max(0, bay.loopS - 3); loop.at(sEnd, TMP);
      const ot = new PathSeg('track', cubic(P(c.x, c.y), P(c.x - hx * 3.2, c.y - hy * 3.2), P(TMP.x + TMP.tx * 2.6, TMP.y + TMP.ty * 2.6), P(TMP.x, TMP.y), 10));
      ot.reverse = true; ot.speed = 1.6; bay.outTrack = ot; bay.outS = sEnd;
      lot.bays.push(bay); C.bays.push(bay);
    }
  }
  const lane = e.lanes[e.nl - 1];
  const ein = loop.pts[0], eout = loop.pts[loop.pts.length - 1];
  const sE = projectOnEdge(e, ein.x, ein.y), sX = projectOnEdge(e, eout.x, eout.y);
  const s0 = clamp(sE - 9, 0.5, e.len - 1); lane.at(s0, TMP);
  lot.inTrack = new PathSeg('track', cubic(P(TMP.x, TMP.y), P(TMP.x + e.dx * 4.5, TMP.y + e.dy * 4.5), P(ein.x, ein.y - inY * 4.5), ein, 14));
  lot.inTrack.speed = 3.4; lot.inS = s0;
  const s1 = clamp(sX + 9, 1, e.len - 0.5); lane.at(s1, TMP);
  lot.outTrack = new PathSeg('track', cubic(eout, P(eout.x, eout.y - inY * 4.5), P(TMP.x - e.dx * 4.5, TMP.y - e.dy * 4.5), P(TMP.x, TMP.y), 14));
  lot.outTrack.speed = 3.0; lot.outTrack.join = { lane, s: s1 };
  e.drives.push({ s0: Math.min(sE, sX) - 4, s1: Math.max(sE, sX) + 4, lot });
  b.lots.push(lot); C.lots.push(lot);
  return lot;
}
function genKerbBays(C) {
  const R = C.R;
  for (const e of C.edges) {
    const excl = [];
    for (const d of e.drives) excl.push([d.s0, d.s1]);
    for (const z of e.zebras) excl.push([z.s - 6, z.s + 6]);
    for (const st of e.stops || []) excl.push([st.s - 9, st.s + 9]);
    e.hydrant = R.range(10, Math.max(11, e.len - 10)); excl.push([e.hydrant - 3, e.hydrant + 3]);
    const free = (a, b) => !excl.some(([x0, x1]) => b > x0 && a < x1);
    const mk = (s0, s1, kind) => {
      const s = (s0 + s1) / 2, c = edgePoint(e, s, e.parkOff);
      const bay = { id: C.bays.length, kind, e, s0, s1, s, len: s1 - s0, x: c.x, y: c.y, hx: e.dx, hy: e.dy, occ: null, res: null };
      e.bays.push(bay); C.bays.push(bay); return bay;
    };
    for (const st of e.stops || []) st.bay = mk(st.s - 8, st.s + 8, 'bus');
    // a loading zone beside commercial frontage
    const commercial = C.buildings.some(b => b.cat && b.type !== 'office' && Math.abs(projectOnEdge(e, b.door.x, b.door.y) - e.len / 2) < e.len / 2 && sideOf(e, b.door) > 0 && Math.abs(sideDist(e, b.door)) < e.kerbOff + SW + 2);
    let s = 3.5; const end = e.len - 7; let madeLoad = !commercial;
    while (s + 6 <= end) {
      if (!madeLoad && s > e.len * 0.3 && free(s, s + 9.5)) { mk(s, s + 9.5, 'load'); s += 10; madeLoad = true; continue; }
      if (free(s, s + 6.1)) { mk(s, s + 6.1, R.chance(0.03) ? 'taxi' : 'park'); s += 6.3; } else s += 1;
    }
    e.bays.sort((a, b) => a.s - b.s);
  }
}
const sideDist = (e, p) => (p.x - e.ax) * e.kx + (p.y - e.ay) * e.ky;
const sideOf = (e, p) => Math.sign(sideDist(e, p));

// §A7 ------------------------------------------------------------------------
function ringT(b, x, y) {
  const r = b.ring, w = r.x1 - r.x0, h = r.y1 - r.y0;
  const d = [Math.abs(y - r.y0), Math.abs(x - r.x1), Math.abs(y - r.y1), Math.abs(x - r.x0)];
  const k = d.indexOf(Math.min(...d));
  if (k === 0) return { t: clamp(x - r.x0, 0, w), x: clamp(x, r.x0, r.x1), y: r.y0 };
  if (k === 1) return { t: w + clamp(y - r.y0, 0, h), x: r.x1, y: clamp(y, r.y0, r.y1) };
  if (k === 2) return { t: w + h + clamp(r.x1 - x, 0, w), x: clamp(x, r.x0, r.x1), y: r.y1 };
  return { t: 2 * w + h + clamp(r.y1 - y, 0, h), x: r.x0, y: clamp(y, r.y0, r.y1) };
}
function ringBlockAt(C, x, y, tol = 0.9) {
  for (const b of C.blocks) { const r = b.ring; if (x < r.x0 - tol || x > r.x1 + tol || y < r.y0 - tol || y > r.y1 + tol) continue; if (Math.min(Math.abs(x - r.x0), Math.abs(x - r.x1), Math.abs(y - r.y0), Math.abs(y - r.y1)) <= tol) return b; }
  return null;
}
function addRingPt(b, x, y, key) { const q = ringT(b, x, y); b.rpts.push({ ...q, keys: key ? [key] : [] }); return q; }
function genZebras(C) {
  C.cws = [];
  for (const s of C.roadSegs) {
    const e = s.edges[0]; if (s.cls !== 'street' || e.len < 78) continue;
    const zs = e.len / 2, off = e.kerbOff + SW / 2, a = edgePoint(e, zs, off), b = edgePoint(e, zs, -off);
    const ba = ringBlockAt(C, a.x, a.y), bb = ringBlockAt(C, b.x, b.y); if (!ba || !bb) continue;
    const cw = { id: C.cws.length, node: null, zebra: true, ax: a.x, ay: a.y, bx: b.x, by: b.y, peds: [], wait: 0, edges: [e, e.rev], walkAxis: null };
    C.cws.push(cw); e.zebras.push({ s: zs, cw }); e.rev.zebras.push({ s: e.len - zs, cw });
    addRingPt(ba, a.x, a.y, 'cw' + cw.id + 'a'); addRingPt(bb, b.x, b.y, 'cw' + cw.id + 'b');
  }
}
function genPedNet(C) {
  C.pn = [];
  for (const b of C.blocks) { const r = b.ring; for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]]) addRingPt(b, x, y, null); }
  // signalised / stop crosswalks
  for (const n of C.nodes) {
    if (!(n.halfV > 0 && n.halfH > 0)) continue;
    const dv = n.halfV + SW / 2, dh = n.halfH + SW / 2;
    const arms = { E: [n.x + dv, n.y - dh, n.x + dv, n.y + dh, 'v'], W: [n.x - dv, n.y - dh, n.x - dv, n.y + dh, 'v'], N: [n.x - dv, n.y - dh, n.x + dv, n.y - dh, 'h'], S: [n.x - dv, n.y + dh, n.x + dv, n.y + dh, 'h'] };
    for (const arm of ['E', 'W', 'N', 'S']) {
      if (!n.arms[arm]) continue;
      const [ax, ay, bx, by, walkAxis] = arms[arm];
      const ba = ringBlockAt(C, ax, ay), bb = ringBlockAt(C, bx, by); if (!ba || !bb) continue;
      const cw = { id: C.cws.length, node: n, arm, zebra: false, ax, ay, bx, by, peds: [], wait: 0, walkAxis, edges: n.arms[arm].edges };
      C.cws.push(cw); n.cws.push(cw);
      addRingPt(ba, ax, ay, 'cw' + cw.id + 'a'); addRingPt(bb, bx, by, 'cw' + cw.id + 'b');
    }
  }
  for (const bl of C.buildings) { const b = bl.block; addRingPt(b, bl.door.x, bl.facing === 'S' ? b.ring.y1 : b.ring.y0, 'door' + bl.id); }
  for (const lot of C.lots) { const b = lot.block; addRingPt(b, lot.pedIn.x, lot.facing === 'S' ? b.ring.y1 : b.ring.y0, 'lot' + lot.id); }
  for (const st of C.stops) { const p = edgePoint(st.e, st.s, st.e.kerbOff + SW / 2); const b = ringBlockAt(C, p.x, p.y, 1.5); if (b) { st.block = b; addRingPt(b, p.x, p.y, 'stop' + st.id); st.spot = { x: p.x, y: p.y }; } }
  for (const b of C.blocks) if (b.area || b.kind === 'stadium') { const r = b.ring; for (const [x, y, k] of [[(r.x0 + r.x1) / 2, r.y0, 'N'], [(r.x0 + r.x1) / 2, r.y1, 'S'], [r.x0, (r.y0 + r.y1) / 2, 'W'], [r.x1, (r.y0 + r.y1) / 2, 'E']]) addRingPt(b, x, y, 'area' + b.id + k); }
  // build ring nodes
  const keyNode = {};
  for (const b of C.blocks) {
    b.rpts.sort((p, q) => p.t - q.t);
    const merged = [];
    for (const p of b.rpts) { const m = merged[merged.length - 1]; if (m && p.t - m.t < 0.6) { m.keys.push(...p.keys); continue; } merged.push({ ...p, keys: p.keys.slice() }); }
    const per = 2 * ((b.ring.x1 - b.ring.x0) + (b.ring.y1 - b.ring.y0));
    if (merged.length > 1 && per - merged[merged.length - 1].t + merged[0].t < 0.6) { merged[0].keys.push(...merged.pop().keys); }
    b.rnodes = merged.map(p => { const nd = { id: C.pn.length, x: p.x, y: p.y, adj: [], block: b, t: p.t }; C.pn.push(nd); for (const k of p.keys) keyNode[k] = nd.id; return nd; });
    for (let i = 0; i < b.rnodes.length; i++) { const a = b.rnodes[i], c = b.rnodes[(i + 1) % b.rnodes.length]; const d = dist(a.x, a.y, c.x, c.y); a.adj.push({ to: c.id, d, cw: null }); c.adj.push({ to: a.id, d, cw: null }); }
    b.per = per;
  }
  C.keyNode = keyNode;
  for (const cw of C.cws) {
    const a = keyNode['cw' + cw.id + 'a'], b = keyNode['cw' + cw.id + 'b']; cw.na = a; cw.nb = b;
    const d = dist(cw.ax, cw.ay, cw.bx, cw.by) + 4;
    C.pn[a].adj.push({ to: b, d, cw }); C.pn[b].adj.push({ to: a, d, cw });
  }
  for (const bl of C.buildings) bl.doorNode = keyNode['door' + bl.id];
  for (const lot of C.lots) lot.pedNode = keyNode['lot' + lot.id];
  for (const st of C.stops) st.pnode = keyNode['stop' + st.id] ?? -1;
  for (const b of C.blocks) if (b.area || b.kind === 'stadium') b.entries = ['N', 'S', 'W', 'E'].map(k => keyNode['area' + b.id + k]);
  // which crosswalks does each movement cross
  for (const mv of C.moves) {
    for (const cw of mv.node.cws) {
      const dx = cw.bx - cw.ax, dy = cw.by - cw.ay, L = Math.hypot(dx, dy);
      let bestD = 9, bp = null;
      for (let s = 0; s <= mv.length; s += 0.5) { mv.at(s, TMP); const t = ((TMP.x - cw.ax) * dx + (TMP.y - cw.ay) * dy) / (L * L); if (t < -0.05 || t > 1.05) continue; const qx = cw.ax + dx * t, qy = cw.ay + dy * t, dd = dist(qx, qy, TMP.x, TMP.y); if (dd < bestD) { bestD = dd; bp = { x: TMP.x, y: TMP.y }; } }
      if (bestD < 2.6) { mv.cws.push(cw); (mv.cwPts || (mv.cwPts = [])).push({ cw, x: bp.x, y: bp.y }); }
    }
  }
}
// nearest point on any sidewalk ring, with the two ring nodes either side of it
function ringAttach(C, x, y) {
  let best = null, bd = Infinity;
  for (const b of C.blocks) {
    const r = b.ring; const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1);
    if (dx * dx + dy * dy > bd + 1600) continue;
    const q = ringT(b, x, y); const d = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (d < bd) { bd = d; best = { b, ...q }; }
  }
  const b = best.b, ns = b.rnodes; let i = 0;
  while (i < ns.length && ns[i].t <= best.t) i++;
  const n0 = ns[(i - 1 + ns.length) % ns.length], n1 = ns[i % ns.length];
  return { x: best.x, y: best.y, b, t: best.t, n0: n0.id, n1: n1.id };
}
function genProps(C) {
  const R = C.R, PR = C.props = { lamps: [], trees: [], benches: [], bins: [], hydrants: [], drains: [], manholes: [], vents: [], shelters: [], bollards: [], planters: [], stalls: [], cones: [], kiosks: [] };
  const onSidewalk = (x, y) => C.blocks.some(b => inRect(b.kerb, x, y, 0.05) && !inRect(b.inner, x, y, -0.05));
  const nearDrive = (e, s, pad) => e.drives.some(d => s > d.s0 - pad && s < d.s1 + pad) || e.zebras.some(z => Math.abs(z.s - s) < pad + 3);
  for (const sg of C.roadSegs) {
    for (const [k, e] of sg.edges.entries()) {
      const sp = sg.cls === 'avenue' ? 29 : 34;
      for (let s = 9 + k * sp / 2; s < e.len - 6; s += sp) {
        if (nearDrive(e, s, 2)) continue;
        const p = edgePoint(e, s, e.kerbOff + 0.55); if (!onSidewalk(p.x, p.y)) continue;
        const hd = edgePoint(e, s, e.kerbOff - 1.2);
        PR.lamps.push({ id: PR.lamps.length, x: p.x, y: p.y, hx: hd.x, hy: hd.y, h: 6.4, r: sg.cls === 'avenue' ? 15 : 13, warm: R.chance(0.7) });
      }
      const zone = (ringBlockAt(C, ...Object.values(edgePoint(e, e.len / 2, e.kerbOff + SW / 2)), 1.5) || {}).kind;
      if (zone === 'residential' || zone === 'mixed' || zone === 'park' || zone === 'plaza') {
        for (let s = 9 + 15 + k * 7; s < e.len - 8; s += R.range(14, 22)) {
          if (nearDrive(e, s, 3)) continue;
          const p = edgePoint(e, s, e.kerbOff + 1.1); if (!onSidewalk(p.x, p.y)) continue;
          if (PR.lamps.some(l => dist(l.x, l.y, p.x, p.y) < 4)) continue;
          PR.trees.push({ x: p.x, y: p.y, r: R.range(2.2, 3.2), h: R.range(5, 8), kind: zone === 'residential' ? 'gum' : 'plane', seed: R.int(1, 1e9) });
        }
      }
      const hy = edgePoint(e, e.hydrant, e.kerbOff + 0.6); if (onSidewalk(hy.x, hy.y)) PR.hydrants.push({ x: hy.x, y: hy.y, e, s: e.hydrant });
      for (let s = 14; s < e.len - 6; s += R.range(34, 48)) { const p = edgePoint(e, s, e.kerbOff - 0.35); PR.drains.push({ x: p.x, y: p.y, a: e.axis === 'h' ? 0 : Math.PI / 2 }); }
      if (R.chance(0.6)) { const ln = R.pick(e.lanes); ln.at(R.range(8, Math.max(9, e.len - 8)), TMP); PR.manholes.push({ x: TMP.x, y: TMP.y }); }
      if (zone === 'downtown' || zone === 'mixed') { if (R.chance(0.22)) { const ln = R.pick(e.lanes); ln.at(R.range(10, Math.max(11, e.len - 10)), TMP); PR.vents.push({ x: TMP.x, y: TMP.y, t: R.range(0, 10) }); } }
    }
  }
  for (const st of C.stops) if (st.spot) { const p = edgePoint(st.e, st.s + 2.5, st.e.kerbOff + 2.4); PR.shelters.push({ x: p.x, y: p.y, axis: st.e.axis, stop: st }); }
  for (const b of C.blocks) {
    const inn = b.inner;
    if (b.kind === 'park') {
      const cx = (inn.x0 + inn.x1) / 2, cy = (inn.y0 + inn.y1) / 2, w = inn.x1 - inn.x0, h = inn.y1 - inn.y0;
      C.pond = { x: inn.x0 + w * 0.78, y: inn.y0 + h * 0.6, rx: Math.min(14, w * 0.09), ry: Math.min(9, h * 0.15), kind: 'pond' };
      C.spots.stage = { x: inn.x0 + w * 0.22, y: inn.y0 + h * 0.3 };
      C.spots.kites = []; for (let k = 0; k < 14; k++) C.spots.kites.push({ x: R.range(inn.x0 + w * 0.35, inn.x0 + w * 0.65), y: R.range(inn.y0 + 8, inn.y1 - 8) });
      C.spots.parkArea = b;
      for (let k = 0; k < 46; k++) {
        const x = R.range(inn.x0 + 3, inn.x1 - 3), y = R.range(inn.y0 + 3, inn.y1 - 3);
        if (Math.abs(x - cx) < 3 || Math.abs(y - cy) < 3) continue;
        if (((x - C.pond.x) / (C.pond.rx + 4)) ** 2 + ((y - C.pond.y) / (C.pond.ry + 4)) ** 2 < 1) continue;
        if (dist(x, y, C.spots.stage.x, C.spots.stage.y) < 14) continue;
        if (x > inn.x0 + w * 0.33 && x < inn.x0 + w * 0.67 && R.chance(0.8)) continue;
        PR.trees.push({ x, y, r: R.range(3, 5.5), h: R.range(7, 12), kind: R.chance(0.5) ? 'oak' : 'plane', seed: R.int(1, 1e9) });
      }
      for (let k = 0; k < 10; k++) { const t = k / 10; PR.benches.push({ x: lerp(inn.x0 + 8, inn.x1 - 8, t), y: cy + (k % 2 ? 3.2 : -3.2), a: 0 }); }
      for (let k = 0; k < 6; k++) PR.lamps.push({ id: PR.lamps.length, x: lerp(inn.x0 + 10, inn.x1 - 10, k / 5), y: cy - 2.6, hx: lerp(inn.x0 + 10, inn.x1 - 10, k / 5), hy: cy - 2.6, h: 4.2, r: 10, warm: true, park: true });
      b.paths = [{ x0: inn.x0, y0: cy, x1: inn.x1, y1: cy }, { x0: cx, y0: inn.y0, x1: cx, y1: inn.y1 }];
    }
    if (b.kind === 'plaza') {
      const cx = (inn.x0 + inn.x1) / 2, cy = (inn.y0 + inn.y1) / 2, rr = Math.min(inn.x1 - inn.x0, inn.y1 - inn.y0) * 0.17;
      C.pool = { x: cx, y: cy, r: rr, kind: 'pool' }; C.spots.plaza = b;
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + Math.PI / 8; PR.benches.push({ x: cx + Math.cos(a) * (rr + 4), y: cy + Math.sin(a) * (rr + 4), a: a + Math.PI / 2 }); }
      for (const [fx, fy] of [[.12, .15], [.88, .15], [.12, .85], [.88, .85], [.5, .1], [.5, .9]]) PR.planters.push({ x: lerp(inn.x0, inn.x1, fx), y: lerp(inn.y0, inn.y1, fy), r: 2.2 }), PR.trees.push({ x: lerp(inn.x0, inn.x1, fx), y: lerp(inn.y0, inn.y1, fy), r: 2.8, h: 6.5, kind: 'plane', seed: R.int(1, 1e9), planter: true });
      for (const [fx, fy] of [[.25, .3], [.75, .3], [.25, .7], [.75, .7]]) PR.lamps.push({ id: PR.lamps.length, x: lerp(inn.x0, inn.x1, fx), y: lerp(inn.y0, inn.y1, fy), hx: lerp(inn.x0, inn.x1, fx), hy: lerp(inn.y0, inn.y1, fy), h: 4.6, r: 11, warm: true, park: true });
      C.spots.hotdog = { x: inn.x0 + 6, y: inn.y1 - 5 }; C.spots.news = { x: inn.x1 - 5, y: inn.y0 + 5 };
      PR.kiosks.push({ kind: 'news', x: C.spots.news.x, y: C.spots.news.y });
      C.spots.busker = { x: cx, y: inn.y1 - 9 }; C.spots.pigeons = { x: cx - rr - 9, y: cy + 4 };
      for (let k = 0; k < 9; k++) PR.bollards.push({ x: lerp(inn.x0 + 3, inn.x1 - 3, k / 8), y: inn.y1 + 0.6 });
    }
    if (b.kind === 'market') {
      C.spots.market = b; const nx = Math.floor((inn.x1 - inn.x0 - 8) / 5.2), ny = 3;
      for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
        const x = inn.x0 + 6 + c * 5.2, y = lerp(inn.y0 + 12, inn.y1 - 12, r / (ny - 1));
        PR.stalls.push({ id: PR.stalls.length, x, y, w: 4.2, d: 2.8, pal: R.pick(PALETTES), open: 0, vendor: null, goods: R.pick(['fruit', 'flowers', 'bread', 'crafts', 'veg', 'cheese', 'books']) });
      }
      for (let k = 0; k < 8; k++) PR.trees.push({ x: inn.x0 + 3, y: lerp(inn.y0 + 4, inn.y1 - 4, k / 7), r: 2.6, h: 6, kind: 'plane', seed: R.int(1, 1e9) });
    }
    if (b.yard && !b.area && b.kind !== 'industrial') {
      const y = (b.yard.y0 + b.yard.y1) / 2;
      for (let x = b.yard.x0 + 6; x < b.yard.x1 - 4; x += R.range(9, 18)) { if (R.chance(0.5)) PR.trees.push({ x, y: y + R.range(-1, 1), r: R.range(2, 3.4), h: R.range(4, 7), kind: 'gum', seed: R.int(1, 1e9) }); else PR.bins.push({ x, y, kind: 'wheelie', c: R.pick(['#2f6b4a', '#b8322c', '#d9b13b']) }); }
    }
    // bins at corners of commercial blocks
    if (b.kind === 'downtown' || b.kind === 'mixed') for (const [x, y] of [[b.kerb.x0 + 1, b.kerb.y0 + 2], [b.kerb.x1 - 1, b.kerb.y1 - 2]]) PR.bins.push({ x, y, kind: 'street', c: '#3a3a3e' });
  }
  // country margin trees
  for (let k = 0; k < 260; k++) {
    const side = R.int(0, 3); let x, y;
    if (side === 0) { x = R.range(0, C.W); y = R.range(2, 40); } else if (side === 1) { x = R.range(0, C.W); y = R.range(C.H - 40, C.H - 2); }
    else if (side === 2) { x = R.range(2, 40); y = R.range(0, C.H); } else { x = R.range(C.W - 40, C.W - 2); y = R.range(0, C.H); }
    const n = C.nodes; if (x > n[0].x - 16 && x < n[n.length - 1].x + 16 && y > n[0].y - 16 && y < n[n.length - 1].y + 16) continue;
    PR.trees.push({ x, y, r: R.range(3, 6), h: R.range(7, 13), kind: R.chance(0.6) ? 'gum' : 'oak', seed: R.int(1, 1e9) });
  }
  // fish & pigeons
  C.fish = []; C.birds = []; C.ducks = [];
  if (C.pool) for (let k = 0; k < 11; k++) { const a = R.range(0, 6.28), r = R.range(0, C.pool.r * 0.7); C.fish.push({ id: 'f' + k, kind: 'fish', x: C.pool.x + Math.cos(a) * r, y: C.pool.y + Math.sin(a) * r, h: R.range(0, 6.28), v: 0.4, tv: 0.4, size: R.range(0.35, 0.6), col: R.pick(['#e8662a', '#f2f0e8', '#e8a33a', '#c8342a']), spot: R.chance(0.5), pool: C.pool, t: R.range(0, 10) }); }
  if (C.pond) for (let k = 0; k < 4; k++) C.ducks.push({ id: 'd' + k, kind: 'duck', x: C.pond.x + R.range(-4, 4), y: C.pond.y + R.range(-2, 2), h: R.range(0, 6.28), v: 0.2, pool: C.pond, t: R.range(0, 10), size: 0.5 });
  if (C.spots.pigeons) for (let k = 0; k < 14; k++) C.birds.push({ id: 'b' + k, kind: 'pigeon', x: C.spots.pigeons.x + R.range(-4, 4), y: C.spots.pigeons.y + R.range(-3, 3), z: 0, vx: 0, vy: 0, vz: 0, h: R.range(0, 6.28), state: 'ground', t: R.range(0, 5), home: C.spots.pigeons });
}

// §B1 ------------------------------------------------------------------------
class Heap { constructor() { this.a = []; } push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } } pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } get size() { return this.a.length; } }
function edgeCost(C, e, opt) {
  let c = e.len / e.speed + (e.to.kind === 'signal' ? 7 : e.to.kind === 'stop' ? 4 : 0) + e.load * 1.4 + e.works.length * 8;
  if (opt && opt.avoid && opt.avoid.has(e.id)) c += 200;
  if (opt && opt.jitter) c *= 1 + hf(e.id, opt.jitter) * 0.5;
  return c;
}
// Edges to drive after `from` (we're on it, heading to from.to) until we are on `target`.
export function routeEdges(C, from, target, opt = {}) {
  if (from === target) return [];
  const N = C.edges.length, D = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), H = new Heap();
  D[from.id] = 0; H.push(0, from.id);
  while (H.size) {
    const [d, id] = H.pop(); if (d > D[id]) continue;
    if (id === target.id) break;
    const e = C.edges[id];
    for (const nx of e.to.outE) {
      if (nx === e.rev || (nx.closed && nx !== target && !opt.allowClosed)) continue;
      const nd = d + edgeCost(C, nx, opt);
      if (nd < D[nx.id]) { D[nx.id] = nd; prev[nx.id] = id; H.push(nd, nx.id); }
    }
  }
  if (prev[target.id] < 0) return null;
  const out = []; let c = target.id; while (c !== from.id) { out.push(C.edges[c]); c = prev[c]; if (c < 0) return null; }
  return out.reverse();
}
function routeToNode(C, from, node) {
  let best = null;
  for (const e of node.inE) { const r = routeEdges(C, from, e); if (r && (!best || r.length < best.length)) best = r; }
  return best;
}
function genBusRoutes(C) {
  const W = [[[1, 1], [7, 1], [7, 5], [1, 5]], [[3, 0], [5, 0], [5, 6], [3, 6]]];
  C.busRoutes = []; C.stops = [];
  for (const [ri, wps] of W.entries()) {
    const nodes = wps.map(([i, j]) => C.nodeAt(i, j));
    const first = nodes[0].outE.find(e => { const r = routeToNode(C, e, nodes[1]); return r && r.length < 12; }) || nodes[0].outE[0];
    let route = [first], cur = first;
    for (const nd of [...nodes.slice(1), nodes[0]]) { if (cur.to === nd) continue; const leg = routeToNode(C, cur, nd); if (!leg) break; route.push(...leg); cur = route[route.length - 1]; }
    const close = routeEdges(C, cur, first); if (close && close.length) route.push(...close.slice(0, -1));
    const r = { id: ri, edges: route, stops: [], colour: ri ? '#d9632b' : '#2b7bd9', name: ri ? 'Route 2' : 'Route 1' };
    route.forEach((e, k) => {
      if (k % 2 || e.len < 50) return;
      if (C.stops.some(s => s.e === e || s.e === e.rev)) { const ex = C.stops.find(s => s.e === e); if (ex && !ex.routes.includes(r)) { ex.routes.push(r); r.stops.push(ex); } return; }
      const st = { id: C.stops.length, e, s: e.len * 0.55, routes: [r], waiting: [], spot: null, pnode: -1, bay: null };
      e.stops = e.stops || []; e.stops.push(st); C.stops.push(st); r.stops.push(st);
    });
    C.busRoutes.push(r);
  }
}

// §B2 ------------------------------------------------------------------------
const LIVERY = { taxi: '#e8c33a', van: '#e9e4d6', ute: '#f28c28', police: '#f4f6fa', ambulance: '#f4f6fa', fire: '#b8261e', bus: '#2b7bd9', tow: '#e8b33a', garbage: '#2f6b4a' };
const NAMES = { police: 'Police car', ambulance: 'Ambulance', fire: 'Fire engine', bus: 'Bus', tow: 'Tow truck', ute: 'Works ute', van: 'Delivery van', garbage: 'Garbage truck', taxi: 'Taxi' };
let VID = 1;
function plate(R) { const L = 'ABCDEFGHJKLMNPRSTUVWXYZ'; return L[R.int(0, 22)] + L[R.int(0, 22)] + L[R.int(0, 22)] + '·' + R.int(100, 999); }
export function makeVehicle(C, type, o = {}) {
  const R = C.R, sp = VT[type], distracted = R.chance(type === 'car' || type === 'taxi' ? 0.1 : 0.03);
  const v = {
    id: VID++, kind: 'vehicle', type, len: sp.len, wid: sp.wid, h: sp.h, color: o.color || (type === 'car' ? R.pick(CAR_COLOURS) : LIVERY[type]), plate: plate(R),
    aMax: sp.aMax * R.range(0.9, 1.12), bComf: sp.bComf, bMax: sp.bMax * R.range(0.92, 1.05), v0f: sp.v0 * R.range(0.92, 1.1),
    T: distracted ? R.range(0.6, 0.95) : R.range(1.1, 1.7), s0: 2.0, react: distracted ? R.range(1.0, 1.7) : R.range(0.25, 0.5), rt: 0, aCmd: 0, distracted,
    x: 0, y: 0, hd: 0, v: 0, a: 0, mode: 'parked', seg: null, s: 0, d: 0, dT: 0, dv: 0, route: [], mv: null, admit: null, goal: null,
    track: null, tEnd: 0, tDone: null, tWait: null, tIntr: null, tWaitT: 0,
    lights: { brake: false, rev: false, ind: 0, haz: false, siren: null, head: false },
    owner: null, crew: [], pax: [], job: null, bay: null, age: R.range(0, 14), damage: 0, stuckT: 0, blockT: 0, passing: null, pIntr: null, yielding: false, swerveT: 0, revT: 0, waitT: 0, arrive: 0,
    stolen: false, towing: null, towedBy: null, busRoute: null, home: null, seed: R.int(1, 1e9), task: 'Parked', num: 0,
  };
  v.num = 1 + C.vehicles.filter(u => u.type === type).length;
  C.vehicles.push(v); C.vById.set(v.id, v);
  return v;
}
export function vehicleName(v) { if (v.type === 'car') return v.owner ? `${v.owner.first}'s car · ${v.plate}` : `Car · ${v.plate}`; return `${NAMES[v.type]} ${v.num}${v.busRoute ? ' · ' + v.busRoute.name : ''}`; }
const occAdd = (seg, v) => { if (!seg.occ.includes(v)) seg.occ.push(v); };
const occDel = (seg, v) => { if (!seg) return; const i = seg.occ.indexOf(v); if (i >= 0) seg.occ.splice(i, 1); };
const intrDel = (seg, it) => { if (!seg || !it) return; const i = seg.intr.indexOf(it); if (i >= 0) seg.intr.splice(i, 1); };
function sideN(C, tx, ty) { return C.LHT ? [ty, -tx] : [-ty, tx]; }

function parkAt(C, v, bay) {
  detach(C, v);
  v.mode = 'parked'; v.bay = bay; bay.occ = v; if (bay.res === v) bay.res = null; v.v = 0; v.a = 0; v.d = 0;
  v.x = bay.x; v.y = bay.y; v.hd = Math.atan2(bay.hy, bay.hx); v.lights.haz = false; v.lights.rev = false; v.lights.ind = 0; v.lights.brake = false;
}
function freeBay(v) { if (v.bay) { if (v.bay.occ === v) v.bay.occ = null; v.bay = null; } }
// Remove a vehicle from whatever it occupies (lane, track, intersection, intrusions).
function detach(C, v) {
  if (v.seg) { occDel(v.seg, v); if (v.seg.kind === 'move') v.seg.node.committed.delete(v); }
  if (v.admit) v.admit.node.committed.delete(v);
  for (const n of C.nodes) { if (n.committed.has(v)) n.committed.delete(v); }
  if (v.track) { occDel(v.track, v); if (v.tIntr) intrDel(v.tIntr.seg, v.tIntr); }
  if (v.pIntr) { intrDel(v.pIntr.seg, v.pIntr); v.pIntr = null; }
  if (v.stopIntr) { intrDel(v.stopIntr.seg, v.stopIntr); v.stopIntr = null; }
  v.seg = null; v.track = null; v.tIntr = null; v.admit = null; v.mv = null; v.passing = null;
}
function joinLane(C, v, lane, s) {
  detach(C, v);
  v.mode = 'drive'; v.seg = lane; v.s = s; v.d = 0; v.dT = 0; occAdd(lane, v); v.mv = null; v.admit = null; v.stuckT = 0;
}
// Route & goal setters ------------------------------------------------------
function setGoal(C, v, e, s, speed, fn) {
  v.goal = { e, s, speed, fn };
  if (!v.seg) { v.route = []; return; }
  const onMove = v.seg.kind === 'move', cur = onMove ? v.seg.outLane.edge : v.seg.edge;
  if (cur === e && (onMove || v.s < s - 2)) v.route = [];
  else if (cur === e) v.route = routeLoop(C, cur) || [];
  else v.route = routeEdges(C, cur, e, { jitter: v.seed }) || [];
  if (!onMove) { v.mv = null; if (v.admit) { v.admit.node.committed.delete(v); v.admit = null; } }
}
function routeLoop(C, e) { // go around the block back onto e
  let best = null;
  for (const nx of e.to.outE) { if (nx === e.rev) continue; const r = routeEdges(C, nx, e); if (r && (!best || r.length + 1 < best.length)) best = [nx, ...r]; }
  return best;
}
function curEdge(v) { return !v.seg ? null : v.seg.kind === 'lane' ? v.seg.edge : v.seg.kind === 'move' ? v.seg.outLane.edge : null; }
function nextEdgeOf(v) {
  if (!v.seg) return null;
  if (v.seg.kind === 'move') return null;
  const e = v.seg.edge; if (v.goal && v.goal.e === e && v.s < v.goal.s + 1) return null;
  return v.route[0] || null;
}
// choose the movement at the end of the current lane, or the lane we need
function planLane(C, v) {
  const ln = v.seg, e = ln.edge, nx = nextEdgeOf(v);
  v.wantLane = -1;
  if (!nx) { if (v.goal && v.goal.e === e) { if (ln.idx !== e.nl - 1) v.wantLane = e.nl - 1; v.mv = null; return; }
    // no plan: keep going straight-ish
    const mv = ln.moves.find(m => m.turn === 'S') || ln.moves[0]; v.mv = mv || null; if (mv) v.route = [mv.outLane.edge]; return; }
  const here = ln.moves.find(m => m.outLane.edge === nx);
  if (here) { v.mv = here; return; }
  v.mv = null;
  const ok = e.lanes.find(l => l.moves.some(m => m.outLane.edge === nx));
  if (ok) v.wantLane = ok.idx;
}
// §B2b leader search ----------------------------------------------------------
const LEAD = { gap: 0, vl: 0, obj: null };
function considerSeg(C, v, seg, base, best, isOwn) {
  for (const u of seg.occ) {
    if (u === v) continue;
    if (isOwn && u.s <= v.s) continue;
    if (v.lights.siren && u.yielding && Math.abs(u.d) > 0.9) continue;
    if (v.passing && v.d < -1.4 && u.s < v.passing.sEnd && (u === v.passing.obj || u.mode === 'stopped' || u.mode === 'crashed' || (u.v < 0.2 && u.lights.haz))) continue;
    if (u.towedBy === v || v.towedBy === u) continue;
    const g = base + u.s - (isOwn ? v.s : 0) - (u.len + v.len) / 2;
    if (g < best.gap) { best.gap = Math.max(0.05, g); best.vl = Math.max(0, u.v); best.obj = u; }
  }
  for (const it of seg.intr) {
    if (it.v === v) continue;
    if (isOwn && it.s1 < v.s - v.len / 2) continue;
    if (v.passing && Math.abs(v.d) > 1.4 && (it.tag === 'works' || it.v === v.passing.obj)) continue;
    if (it.tag === 'pass' && v.lights.siren) continue;
    const g = base + it.s0 - (isOwn ? v.s : 0) - v.len / 2;
    if (g < best.gap) { best.gap = Math.max(0.05, g); best.vl = 0; best.obj = it; }
  }
}
function findLeader(C, v, look) {
  const best = LEAD; best.gap = look; best.vl = 30; best.obj = null;
  considerSeg(C, v, v.seg, 0, best, true);
  let base = v.seg.length - v.s;
  if (v.mode === 'drive' && v.seg.kind === 'lane' && v.mv && base < look) {
    considerSeg(C, v, v.mv, base, best, false); base += v.mv.length;
    if (base < look) considerSeg(C, v, v.mv.outLane, base, best, false);
  } else if (v.mode === 'drive' && v.seg.kind === 'move' && base < look) considerSeg(C, v, v.seg.outLane, base, best, false);
  if (v.passing && v.d < -1.0 && v.seg.kind === 'lane') {
    const Lr = v.seg.edge.len;
    for (const u of v.passing.oc.occ) { if (u === v) continue; const us = Lr - u.s; if (us <= v.s) continue; const g = us - v.s - (u.len + v.len) / 2 - (u.v > 0.3 ? u.v * 2 : 0); if (g < best.gap) { best.gap = Math.max(0.05, g); best.vl = 0; best.obj = u; } }
  }
  return best;
}
function idmAcc(v, gap, vl, v0) {
  const vel = Math.max(0, v.v), a = v.aMax, b = v.bComf;
  const free = 1 - Math.pow(vel / Math.max(0.5, v0), 4);
  if (gap >= 900) return a * free;
  const ss = v.s0 + Math.max(0, vel * v.T + vel * (vel - vl) / (2 * Math.sqrt(a * b)));
  return a * (free - (ss / Math.max(gap, 0.05)) ** 2);
}
// §B3 intersections ------------------------------------------------------------
export function sigState(n, axis) { if (!n.sig) return 'G'; const ph = n.sig.plan[n.sig.i]; return ph.a === axis ? ph.st : 'R'; }
export function walkOn(cw) { if (cw.zebra || !cw.node || !cw.node.sig) return true; const s = cw.node.sig, ph = s.plan[s.i]; return ph.a === cw.walkAxis && ph.st === 'G' && s.t < ph.d - 5; }
function stepSignals(C, dt) {
  for (const n of C.nodes) {
    if (n.stopQ.length) n.stopQ = n.stopQ.filter(q => q.v.mode === 'drive' && q.v.seg && q.v.seg.kind === 'lane' && q.v.mv && q.v.mv.node === n && q.v.seg.length - q.v.s - q.v.len / 2 < 4);
    if (!n.sig) continue; const s = n.sig; s.t += dt; if (s.t >= s.plan[s.i].d) { s.t = 0; s.i = (s.i + 1) % s.plan.length; } }
}
function headOf(lane) { let h = null; for (const u of lane.occ) if (u.mode === 'drive' && (!h || u.s > h.s)) h = u; return h; }
function admit(C, v, mv, D) {
  const n = mv.node, em = !!v.lights.siren || v.stolen;
  if (n.kind === 'signal' && !em) {
    const st = sigState(n, mv.axis);
    if (st === 'R') return false;
    if (st === 'Y' && v.v * v.v / (2 * v.bComf * 1.4) < D - 0.5) return false;
  }
  if (n.kind === 'stop' && !em) {
    if (v.v > 0.5 || D > 3) return false;
    const me = n.stopQ.find(q => q.v === v); if (!me) return false;
    if (v.waitT < 0.8) return false;
    if (v.waitT < 20) for (const q of n.stopQ) { if (q.v !== v && q.t < me.t && q.v.waitT < 9 && q.v.mv && mv.conf.includes(q.v.mv)) return false; }
  }
  for (const c of mv.conf) {
    for (const u of c.occ) { if (u.mode === 'drive' || u.mode === 'crashed') return false; }
  }
  for (const [u, m] of n.committed) if (u !== v && mv.conf.includes(m)) return false;
  if (!em) for (const y of mv.yieldTo) {
    const h = headOf(y.inLane); if (!h || h.mv !== y) continue;
    const dl = y.inLane.length - h.s; if (h.v > 0.8 && dl / Math.max(1, h.v) < 4.2) return false;
    if (h.v <= 0.8 && dl < 4 && sigState(n, y.axis) === 'G') return false;
  }
  if (mv.cwPts) for (const c of mv.cwPts) {
    for (const p of c.cw.peds) if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 < 30) return false;
    if (mv.turn !== 'S' && !em && walkOn(c.cw)) for (const p of c.cw.waiters) if ((p.x - c.x) ** 2 + (p.y - c.y) ** 2 < 49) return false;
  }
  const out = mv.outLane;
  let tail = null; for (const u of out.occ) if (!tail || u.s < tail.s) tail = u;
  if (tail && tail.v < 2.5) { const stat = tail.mode === 'stopped' || tail.mode === 'crashed' || tail.lights.haz; if (tail.s - tail.len / 2 < (stat ? Math.min(v.len + 2, 6.5) : v.len + 2)) return false; }
  for (const it of out.intr) if (it.s0 < v.len + 1.5) return false;
  n.committed.set(v, mv);
  const qi = n.stopQ.findIndex(q => q.v === v); if (qi >= 0) n.stopQ.splice(qi, 1);
  return true;
}
// §B2c driving step ------------------------------------------------------------
function laneSpeedCap(C, v) {
  let cap = v.seg.speed * v.v0f;
  if (v.stolen) cap *= 1.35; else if (v.lights.siren) cap *= 1.3;
  if (v.passing) cap = Math.min(cap, v.lights.siren ? 9 : 5.5);
  if (v.yielding) cap = Math.min(cap, 2.5);
  if (C.marathonSlow && v.seg.kind === 'lane' && v.seg.edge.closed) cap = Math.min(cap, 4);
  return cap;
}
function tryLaneChange(C, v, idx, urgent) {
  const e = v.seg.edge, tl = e.lanes[idx]; if (!tl || tl === v.seg) return false;
  if (v.s < 3 || v.s > v.seg.length - (urgent ? 6 : 16)) return false;
  let gl = 1e9, gf = 1e9, vf = 0, vl = 30;
  for (const u of tl.occ) { const g = u.s - v.s; if (g > 0) { const gg = g - (u.len + v.len) / 2; if (gg < gl) { gl = gg; vl = u.v; } } else { const gg = -g - (u.len + v.len) / 2; if (gg < gf) { gf = gg; vf = u.v; } } }
  for (const it of tl.intr) { if (it.s1 > v.s - v.len && it.s0 < v.s + v.len + 4) return false; }
  const needF = (urgent ? 1.2 : 2.2) + Math.max(0, vf - v.v) * (urgent ? 1.0 : 1.7) + vf * (urgent ? 0.25 : 0.55);
  const needL = (urgent ? 1.0 : 2.0) + Math.max(0, v.v - vl) * 1.2 + v.v * 0.3;
  if (gf < needF || gl < needL) return false;
  const kerbward = tl.idx > v.seg.idx; v.lcDir = kerbward === C.LHT ? -1 : 1; occDel(v.seg, v); v.d += v.seg.off - tl.off; v.seg = tl; occAdd(tl, v); v.mv = null; planLane(C, v); v.lcT = 2.2;
  return true;
}
function pedObstacle(C, v, best) {
  const hx = Math.cos(v.hd), hy = Math.sin(v.hd);
  let swerve = 0;
  for (const p of C.roadPeds) {
    const dx = p.x - v.x, dy = p.y - v.y; if (dx * dx + dy * dy > 1600) continue;
    const fwd = dx * hx + dy * hy, lat = -dx * hy + dy * hx;
    if (fwd < 0 || fwd > 40 || Math.abs(lat) > v.wid / 2 + 0.9) continue;
    const g = fwd - v.len / 2 - 1.3;
    if (g < best.gap) { best.gap = Math.max(0.05, g); best.vl = 0; best.obj = p; }
    if (fwd < v.len / 2 + 0.7 && Math.abs(lat) < v.wid / 2 + 0.35) p.dodge = v;
    const need = v.v * v.v / (2 * Math.max(0.3, g));
    if (need > v.bMax * 0.8 && v.v > 4 && !v.swerveT) swerve = lat > 0 ? 1 : -1; // lat>0: ped on the right of the car
    if (need > 4.5 && v.v > 3 && !p.honked) { p.honked = true; C.cue('screech', v.x, v.y, Math.min(1, need / 9)); C.cue('horn', v.x, v.y, 0.8, v.type); p.startle = 1.2; }
  }
  if (swerve) { // right-side ped -> move left, and vice versa (in lateral d units)
    const towardKerb = (C.LHT ? swerve > 0 : swerve < 0);
    v.dT = towardKerb ? 2.1 : -2.4; v.swerveT = 1.4;
  }
}
function stepDrive(C, v, dt) {
  const seg = v.seg;
  if (seg.kind === 'lane') {
    if (!v.mv || v.mv.inLane !== seg) planLane(C, v);
    if (v.wantLane >= 0 && seg.edge.nl > 1) tryLaneChange(C, v, v.wantLane, seg.length - v.s < 40);
  }
  const look = Math.max(55, v.v * 5);
  const L = findLeader(C, v, look);
  pedObstacle(C, v, L);
  let v0 = seg.kind === 'move' ? Math.min(seg.speed * (v.stolen || v.lights.siren ? 1.3 : 1), laneSpeedCap(C, v)) : laneSpeedCap(C, v);
  let acc = idmAcc(v, L.gap, L.vl, v0);
  // stop line / intersection admission
  if (seg.kind === 'lane') {
    const D = seg.length - v.s - v.len / 2 - 0.3;
    if (v.mv) {
      if (v.admit !== v.mv) {
        if (v.admit) { v.admit.node.committed.delete(v); v.admit = null; }
        const isHead = !seg.occ.some(u => u !== v && u.s > v.s);
        const decide = isHead && D < Math.max(14, v.v * v.v / (2 * v.bComf) + 10);
        if (decide && !admit(C, v, v.mv, D)) {
          acc = Math.min(acc, idmAcc(v, D + v.s0 * 0.5, 0, v0));
          if (v.v < 0.3 && D < 3) { v.waitT += dt; if (v.mv.node.kind === 'stop' && !v.mv.node.stopQ.some(q => q.v === v)) v.mv.node.stopQ.push({ v, t: C.tReal }); }
        } else if (decide) { v.admit = v.mv; v.waitT = 0; v.admitT = 0; }
        else if (!decide) acc = Math.min(acc, idmAcc(v, D + v.s0 * 0.5, 0, v0));
      } else if (v.v < 0.15) { // reserved but not moving: give the reservation back so others are not blocked
        v.admitT = (v.admitT || 0) + dt;
        if (v.admitT > 3.5 && D > 0.5) { v.admit.node.committed.delete(v); v.admit = null; v.admitT = 0; }
      } else v.admitT = 0;
      const mvS = v.mv.speed * (v.lights.siren ? 0.75 : 1);
      if (v.mv.turn !== 'S' || (v.lights.siren && v.mv.node.kind !== 'through')) { const va = Math.sqrt(mvS * mvS + 2 * v.bComf * Math.max(0, D)); if (v.v > va) acc = Math.min(acc, -(v.v * v.v - va * va) / (2 * Math.max(1, D)) - 0.3); }
      v.lights.ind = v.lcT > 0 ? v.lcDir : (v.mv.turn === 'S' || D > 40 ? 0 : (v.mv.turn === 'L' ? -1 : 1));
    } else if (!(v.goal && v.goal.e === seg.edge)) {
      acc = Math.min(acc, idmAcc(v, D + v.s0 * 0.5, 0, v0));
      if (D < 1 && v.v < 0.2) { // stuck at line without a way on: reroute via any movement
        const mv = seg.moves.find(m => m.turn === 'S') || seg.moves[0];
        if (mv) { v.route = [mv.outLane.edge]; const g = v.goal; if (g) { const r = routeEdges(C, mv.outLane.edge, g.e, { jitter: v.seed + 7 }); if (r) v.route = [mv.outLane.edge, ...r]; } planLane(C, v); }
      }
    }
    if (v.goal && v.goal.e === seg.edge) {
      const g = v.goal, gd = g.s - v.s, outer = seg.idx === seg.edge.nl - 1;
      if (gd > -1) {
        if (g.speed > 0) { if (v.v > g.speed) acc = Math.min(acc, -(v.v * v.v - g.speed * g.speed) / (2 * Math.max(1, gd)) - 0.2); }
        else acc = Math.min(acc, idmAcc(v, Math.max(0.05, gd + v.s0), 0, v0));
      }
      if (gd < 40 && !outer) { tryLaneChange(C, v, seg.edge.nl - 1, gd < 20); acc = Math.min(acc, idmAcc(v, Math.max(0.1, gd - 6) + v.s0, 0, v0)); }
      if (gd < 30 && outer && !v.lcT) v.lights.ind = C.LHT ? -1 : 1;
      if (outer && ((g.speed > 0 && gd <= 0.3) || (g.speed === 0 && gd < 1.2 && v.v < 0.5))) { v.goal = null; v.lights.ind = 0; g.fn(v); return; }
      if (gd < -1) { const r = routeLoop(C, seg.edge); v.route = r || []; v.mv = null; g.overshoot = (g.overshoot || 0) + 1; planLane(C, v); }
    }
  }
  // blocked by something static: plan to go around it
  const obj = L.obj, staticObs = obj && ((obj.kind === 'vehicle' && (obj.mode === 'stopped' || obj.mode === 'crashed' || (obj.v < 0.1 && obj.lights.haz))) || (obj.tag === 'works'));
  if (seg.kind === 'lane' && staticObs && L.gap < 14 && v.v < 0.6 && !v.passing) v.blockT += dt; else if (!v.passing) v.blockT = Math.max(0, v.blockT - dt);
  if (v.blockT > (v.lights.siren ? 0.8 : 2.6) && seg.kind === 'lane' && !v.passing) planPass(C, v, L);
  if (v.lights.siren && seg.kind === 'lane' && !v.passing && obj && obj.kind === 'vehicle' && obj.v < 4 && L.gap < 12 && !obj.yielding) v.blockT += dt;
  // reversing to get room
  if (v.revT > 0) { v.revT -= dt; acc = -1.1 - v.v; }
  v.rt -= dt; if (v.rt <= 0 || (!v.distracted && acc < v.aCmd - 5)) { v.rt = v.react; v.aCmd = acc; }
  if (v.revT <= 0 && !v.distracted) v.aCmd = Math.min(v.aCmd, acc + 0.8 * v.aMax);
  let a = clamp(v.revT > 0 ? acc : v.aCmd, -v.bMax, v.aMax);
  v.a = a;
  const wasV = v.v;
  v.v += a * dt;
  if (v.revT > 0) { v.v = Math.max(-1.2, Math.min(0, v.v)); } else if (v.v < 0) v.v = 0;
  if (v.revT > 0 && v.s < 1) v.v = 0;
  v.lights.brake = a < -0.6 || (v.v < 0.1 && wasV < 0.1);
  v.lights.rev = v.revT > 0;
  v.s += v.v * dt;
  // lateral
  if (v.swerveT > 0) { v.swerveT -= dt; if (v.swerveT <= 0) { v.swerveT = 0; if (!v.passing) v.dT = 0; } }
  const rate = v.swerveT > 0 ? 3.2 : v.passing ? 1.6 : 1.2;
  const dd = clamp(v.dT - v.d, -rate * dt, rate * dt); v.dv = dd / dt; v.d += dd;
  if (v.lcT > 0) v.lcT -= dt;
  advance(C, v);
  updatePassing(C, v);
  posFromSeg(C, v, dt);
}
function advance(C, v) {
  let guard = 0;
  while (v.mode === 'drive' && v.s > v.seg.length && guard++ < 4) {
    const seg = v.seg, over = v.s - seg.length;
    if (seg.kind === 'lane') {
      if (!v.mv || v.admit !== v.mv) { v.s = seg.length; v.v = 0; return; }
      occDel(seg, v); v.seg = v.mv; occAdd(v.mv, v); v.s = over; v.admit = null;
      if (v.passing) endPass(C, v);
    } else if (seg.kind === 'move') {
      occDel(seg, v); seg.node.committed.delete(v);
      const out = seg.outLane; v.seg = out; occAdd(out, v); v.s = over;
      if (v.route[0] === out.edge) v.route.shift();
      v.mv = null; v.wantLane = undefined; out.edge.load += 0; planLane(C, v);
    }
  }
}
function posFromSeg(C, v, dt) {
  v.seg.at(v.s, TMP);
  const [nx, ny] = sideN(C, TMP.tx, TMP.ty);
  v.x = TMP.x + nx * v.d; v.y = TMP.y + ny * v.d;
  const base = Math.atan2(TMP.ty, TMP.tx), side = C.LHT ? -1 : 1;
  const tgt = base + side * Math.atan2(v.dv || 0, Math.max(1.5, Math.abs(v.v)));
  v.hd += angDiff(v.hd, tgt) * Math.min(1, dt * 9);
}
// §B4 passing & yielding --------------------------------------------------------
function planPass(C, v, L) {
  const seg = v.seg, e = seg.edge, obj = L.obj;
  if (!obj) return;
  const os = obj.kind === 'vehicle' ? obj.s : obj.s0, olen = obj.kind === 'vehicle' ? obj.len : (obj.s1 - obj.s0);
  let obEnd = obj.kind === 'vehicle' ? os + olen / 2 : obj.s1;
  // the obstruction may be several stopped vehicles nose to tail
  for (let k = 0; k < 6; k++) { const nx = seg.occ.find(u => u !== v && u.s - u.len / 2 > obEnd - 0.5 && u.s - u.len / 2 < obEnd + 7 && (u.mode === 'stopped' || u.mode === 'crashed' || (u.v < 0.2 && u.lights.haz))); if (!nx) break; obEnd = nx.s + nx.len / 2; }
  for (const it of seg.intr) if (it.tag === 'works' && it.s0 < obEnd + 7 && it.s1 > obEnd) obEnd = Math.max(obEnd, it.s1);
  if (obEnd + v.len + 4 > seg.length) return; // too close to the junction; wait
  if (e.nl > 1) { const other = seg.idx === 0 ? 1 : 0; if (tryLaneChange(C, v, other, true)) { v.blockT = 0; return; } }
  if (e.nl > 1 && seg.idx === 1) return;
  const oc = e.rev.lanes[0], Lr = e.len;
  const r0 = Lr - (obEnd + v.len + 4), r1 = Lr - (v.s - v.len / 2);
  for (const u of oc.occ) { if (u.s > r0 - (u.v * 7 + 14) && u.s - u.len / 2 < r1 + 2) return; }
  for (const it of oc.intr) if (it.s1 > r0 && it.s0 < r1) return;
  if (L.gap < 1.0 && v.revT <= 0) {
    let room = true; for (const u of seg.occ) if (u !== v && u.s < v.s && v.s - u.s - (u.len + v.len) / 2 < 2.2) room = false;
    if (room && v.s > 3) { v.revT = 1.8; v.blockT = 1.0; return; }
  }
  v.passing = { obj, sEnd: obEnd + v.len / 2 + 3, oc };
  v.dT = -LANE_W * (e.nl > 1 ? 1 : 1.0); v.blockT = 0;
  v.pIntr = { s0: 0, s1: 0, tag: 'pass', v, seg: oc }; oc.intr.push(v.pIntr);
}
function updatePassing(C, v) {
  if (!v.passing) return;
  const p = v.passing;
  if (v.seg.kind !== 'lane') { endPass(C, v); return; }
  const Lr = v.seg.edge.len;
  if (v.pIntr) { v.pIntr.s0 = Lr - (v.s + v.len / 2 + 2 + v.v * 1.5); v.pIntr.s1 = Lr - (v.s - v.len / 2); }
  if (v.s - v.len / 2 > p.sEnd) v.dT = 0;
  if (v.v < 0.2) { p.slowT = (p.slowT || 0) + 1 / 30; if (p.slowT > 2.5 && v.dT !== 0) { v.dT = 0; v.blockT = -4; } } else p.slowT = 0;
  if (v.dT === 0 && Math.abs(v.d) < 0.4) endPass(C, v);
}
function endPass(C, v) { if (v.pIntr) intrDel(v.pIntr.seg, v.pIntr); v.pIntr = null; v.passing = null; if (!v.swerveT) v.dT = 0; }
function stepYield(C) {
  // drivers ahead of a siren pull over toward the kerb (into the parking lane if it is free)
  for (const v of C.vehicles) { v.yielding = false; if (v.mode === 'drive' && !v.passing && !v.swerveT) v.dT = 0; }
  for (const em of C.vehicles) {
    if (!em.lights.siren || em.mode !== 'drive' || em.seg.kind !== 'lane') continue;
    const e = em.seg.edge;
    const lanes = [...e.lanes, ...(e.nl === 1 ? e.rev.lanes : [])];
    for (const ln of lanes) for (const u of ln.occ) {
      if (u === em || u.mode !== 'drive' || u.lights.siren) continue;
      const ahead = ln.edge === e ? u.s - em.s : (e.len - u.s) - em.s;
      if (ahead < 0 || ahead > 55) continue;
      u.yielding = true;
      if (u.passing || u.swerveT) continue;
      const bayOcc = (ln.edge.bays || []).some(b => b.occ && Math.abs(b.s - u.s) < (b.len + u.len) / 2 + 0.5);
      u.dT = bayOcc ? 0.6 : 1.9;
    }
    if (e.nl === 1) em.dT = em.passing ? em.dT : -0.9;
  }
}
// §B4b tracks (manoeuvres) -------------------------------------------------------
function startTrack(C, v, track, s0, s1, o, done) {
  if (v.seg) { occDel(v.seg, v); if (v.seg.kind === 'move') v.seg.node.committed.delete(v); v.seg = null; }
  if (v.admit) { v.admit.node.committed.delete(v); v.admit = null; }
  if (v.track) { occDel(v.track, v); if (v.tIntr) intrDel(v.tIntr.seg, v.tIntr); v.tIntr = null; }
  if (v.passing) endPass(C, v);
  v.mode = 'track'; v.track = track; v.s = s0; v.tEnd = s1; v.tDone = done; v.tWait = o.wait || null; v.tWaitT = 0; v.tShared = !!o.shared; v.d = 0;
  v.tStarted = !v.tWait; v.v = Math.min(v.v, 3);
  if (v.tShared) occAdd(track, v);
  v.tBlocks = track.blocks || o.blocks || null;
  if (v.tStarted) addTrackBlock(v);
}
function addTrackBlock(v) { const bl = v.tBlocks; if (!bl || v.tIntr) return; const seg = bl.lane || bl.seg; v.tIntr = { s0: bl.s0, s1: bl.s1, tag: 'park', v, seg }; seg.intr.push(v.tIntr); }
function stepTrack(C, v, dt) {
  const tr = v.track;
  if (!v.tStarted) {
    v.tWaitT += dt; v.v = 0; v.lights.brake = true;
    if (v.tWait(v) && v.tWaitT < 40) { trackPos(C, v, dt); return; }
    v.tStarted = true; addTrackBlock(v);
  }
  const rev = tr.reverse, sp = (tr.speed || 2.5) * (v.lights.siren ? 1.5 : 1);
  let gap = 900, vl = 30;
  if (v.tShared) for (const u of tr.occ) { if (u === v) continue; const g = u.s - v.s - (u.len + v.len) / 2; if (g > -0.5 && g < gap) { gap = Math.max(0.05, g); vl = u.v; } }
  for (const it of tr.intr) { if (it.v === v) continue; const g = it.s0 - v.s - v.len / 2; if (g > -v.len && g < gap) { gap = Math.max(0.05, g); vl = 0; } }
  const hx = Math.cos(v.hd) * (rev ? -1 : 1), hy = Math.sin(v.hd) * (rev ? -1 : 1);
  const fx = v.x + hx * v.len / 2, fy = v.y + hy * v.len / 2;
  for (const p of pedsNear(C, fx, fy, 2.0)) { if (p.state !== 'walk' || p.vehicle) continue; gap = Math.min(gap, 0.3); vl = 0; }
  const rem = v.tEnd - v.s;
  let acc = Math.min(idmAcc(v, gap, vl, sp), idmAcc(v, rem + v.s0 * 0.9, 0, sp));
  v.a = clamp(acc, -v.bMax, v.aMax * 0.8); v.v = Math.max(0, v.v + v.a * dt);
  v.s += v.v * dt;
  v.lights.rev = rev; v.lights.brake = v.a < -0.5 || v.v < 0.05;
  if (v.tIntr && v.tIntr.seg === tr) { /* loop intrusion follows the bay */ }
  if (rem < 0.25 || (rem < 0.8 && v.v < 0.15)) {
    v.s = v.tEnd; trackPos(C, v, dt);
    const done = v.tDone; occDel(tr, v); if (v.tIntr) { intrDel(v.tIntr.seg, v.tIntr); v.tIntr = null; }
    v.track = null; v.tDone = null; v.mode = 'stopped'; v.v = 0; v.lights.rev = false;
    if (done) done(v);
    return;
  }
  trackPos(C, v, dt);
}
function trackPos(C, v, dt) {
  v.track.at(v.s, TMP);
  v.x = TMP.x; v.y = TMP.y;
  const tgt = Math.atan2(TMP.ty, TMP.tx) + (v.track.reverse ? Math.PI : 0);
  v.hd += angDiff(v.hd, tgt) * Math.min(1, dt * 10);
}
function laneClearFor(C, lane, s, ahead = 12) {
  for (const u of lane.occ) { if (u.mode === 'track') continue; if (u.s < s + ahead && u.s > s - (10 + u.v * 3.8)) return false; }
  for (const it of lane.intr) if (it.s1 > s - 6 && it.s0 < s + ahead) return false;
  return true;
}
// departure from wherever the vehicle is parked; then() runs once it is driving on a lane
function depart(C, v, then) {
  v.lights.haz = false;
  if (v.mode === 'drive') { then(v); return; }
  if (v.mode === 'stopped' && v.seg && v.seg.kind === 'lane') { v.mode = 'drive'; if (v.stopIntr) { intrDel(v.stopIntr.seg, v.stopIntr); v.stopIntr = null; } then(v); return; }
  const bay = v.bay;
  if (!bay) { // stranded off-network: snap to nearest lane
    const ln = nearestLane(C, v.x, v.y); joinLane(C, v, ln.lane, ln.s); then(v); return;
  }
  if (bay.kind === 'garage') {
    const tr = bay.outTrack; const j = tr.join;
    freeBay(v); v.mode = 'stopped';
    startTrack(C, v, tr, 0, tr.length, { wait: () => !laneClearFor(C, j.lane, j.s, 6) && !v.lights.siren }, () => { joinLane(C, v, j.lane, j.s); then(v); });
    return;
  }
  if (bay.lot) {
    const lot = bay.lot;
    startTrack(C, v, bay.outTrack, 0, bay.outTrack.length, { wait: () => lot.loop.occ.some(u => u.s > bay.loopS - 14 && u.s < bay.loopS + 5) },
      () => {
        freeBay(v);
        startTrack(C, v, lot.loop, bay.outS, lot.loop.length, { shared: true }, () => {
          const j = lot.outTrack.join;
          startTrack(C, v, lot.outTrack, 0, lot.outTrack.length, { shared: true, wait: () => !laneClearFor(C, j.lane, j.s, 10) }, () => { joinLane(C, v, j.lane, j.s); then(v); });
        });
      });
    v.tBlocks = { seg: lot.loop, s0: bay.loopS - 6, s1: bay.loopS + 3 };
    return;
  }
  // kerb bay: pull out forward
  const e = bay.e, lane = e.lanes[e.nl - 1], sOut = Math.min(e.len - 1, bay.s + 9);
  lane.at(sOut, TMP);
  const tr = new PathSeg('track', cubic(P(bay.x, bay.y), P(bay.x + e.dx * 3.5, bay.y + e.dy * 3.5), P(TMP.x - e.dx * 3.5, TMP.y - e.dy * 3.5), P(TMP.x, TMP.y), 12));
  tr.speed = 2.6; tr.blocks = { lane, s0: bay.s - 3, s1: sOut + v.len / 2 };
  startTrack(C, v, tr, 0, tr.length, { wait: () => !laneClearFor(C, lane, bay.s, 12) || !!lane.intr.length && lane.intr.some(i => i.s1 > bay.s - 3 && i.s0 < sOut + 3 && i.v !== v) },
    () => { freeBay(v); joinLane(C, v, lane, sOut); then(v); });
}
function nearestLane(C, x, y) {
  let best = null, bd = Infinity;
  for (const e of C.edges) for (const ln of e.lanes) { const s = ln.project(x, y); ln.at(s, TMP); const d = (TMP.x - x) ** 2 + (TMP.y - y) ** 2; if (d < bd && s > 2 && s < ln.length - 4) { bd = d; best = { lane: ln, s }; } }
  return best || { lane: C.edges[0].lanes[0], s: 5 };
}
// drive to a target. target kinds: bay (kerb/lot/garage/amb), kerb (stop in lane at e,s), pass (drive by e,s)
function driveTo(C, v, target, done) {
  v.target = target; v.onArrive = done;
  if (target.bay) { if (target.bay.res && target.bay.res !== v) { target.bay = null; } else target.bay.res = v; }
  if (target.bay && target.bay === v.bay && v.mode === 'parked') { v.target = null; done && done(v); return; }
  if (target.bay && target.bay.lot && v.mode === 'parked' && v.bay && v.bay.lot === target.bay.lot) { moveWithinLot(C, v, target.bay, done); return; }
  depart(C, v, () => headFor(C, v));
}
// from one bay to another in the same car park, following the one-way loop (round again if it is behind us)
function moveWithinLot(C, v, tb, done) {
  const bay = v.bay, lot = bay.lot;
  const park = () => startTrack(C, v, tb.inTrack, 0, tb.inTrack.length, { blocks: { seg: lot.loop, s0: tb.loopS - 6, s1: tb.loopS + 2 } }, () => { parkAt(C, v, tb); v.target = null; done && done(v); });
  startTrack(C, v, bay.outTrack, 0, bay.outTrack.length, { wait: () => lot.loop.occ.some(u => u.s > bay.loopS - 14 && u.s < bay.loopS + 5) }, () => {
    freeBay(v);
    if (tb.inS0 > bay.outS + 1.5) startTrack(C, v, lot.loop, bay.outS, tb.inS0, { shared: true }, park);
    else startTrack(C, v, lot.loop, bay.outS, lot.loop.length, { shared: true }, () => {
      const j = lot.outTrack.join;   // behind us on the loop: out to the street and straight back in
      startTrack(C, v, lot.outTrack, 0, lot.outTrack.length, { shared: true, wait: () => !laneClearFor(C, j.lane, j.s, 10) }, () => { joinLane(C, v, j.lane, j.s); headFor(C, v); });
    });
  });
  v.tBlocks = { seg: lot.loop, s0: bay.loopS - 6, s1: bay.loopS + 3 };
}
function headFor(C, v) {
  const t = v.target, done = v.onArrive;
  if (!t) return;
  const bay = t.bay;
  if (bay && bay.kind === 'garage') {
    setGoal(C, v, bay.e, bay.inS, 0, () => {
      startTrack(C, v, bay.inTrack, 0, bay.inTrack.length, {}, () => { parkAt(C, v, bay); v.target = null; done && done(v); });
    });
  } else if (bay && bay.lot) {
    const lot = bay.lot;
    setGoal(C, v, lot.e, lot.inS, 3.2, () => {
      startTrack(C, v, lot.inTrack, 0, lot.inTrack.length, { shared: true }, () => {
        startTrack(C, v, lot.loop, 0, bay.inS0, { shared: true }, () => {
          startTrack(C, v, bay.inTrack, 0, bay.inTrack.length, { blocks: { seg: lot.loop, s0: bay.loopS - 6, s1: bay.loopS + 2 } }, () => { parkAt(C, v, bay); v.target = null; done && done(v); });
        });
      });
    });
  } else if (bay) {
    const e = bay.e, lane = e.lanes[e.nl - 1];
    const forward = bay.kind === 'bus' || bay.kind === 'load' || v.len > 5.6;
    if (forward) {
      const sA = Math.max(1, bay.s - bay.len / 2 - 5.5);
      setGoal(C, v, e, sA, 2.6, () => {
        lane.at(sA, TMP);
        const tr = new PathSeg('track', cubic(P(TMP.x, TMP.y), P(TMP.x + e.dx * 4, TMP.y + e.dy * 4), P(bay.x - e.dx * 4, bay.y - e.dy * 4), P(bay.x, bay.y), 12));
        tr.speed = 2.6; tr.blocks = { lane, s0: sA - v.len / 2, s1: bay.s + 1 };
        startTrack(C, v, tr, 0, tr.length, {}, () => { parkAt(C, v, bay); v.target = null; done && done(v); });
      });
    } else {
      const sStop = Math.min(e.len - 2, bay.s + Math.max(3.4, bay.len / 2 - v.len / 2 + 3.6));
      setGoal(C, v, e, sStop, 0, () => {
        lane.at(sStop, TMP); const k = (sStop - bay.s) * 0.5;
        const tr = new PathSeg('track', cubic(P(TMP.x, TMP.y), P(TMP.x - e.dx * k, TMP.y - e.dy * k), P(bay.x + e.dx * k, bay.y + e.dy * k), P(bay.x, bay.y), 12));
        tr.reverse = true; tr.speed = 1.5; tr.blocks = { lane, s0: bay.s - 3, s1: sStop + v.len / 2 + 1 };
        v.lights.ind = C.LHT ? -1 : 1;
        startTrack(C, v, tr, 0, tr.length, {}, () => { parkAt(C, v, bay); v.target = null; done && done(v); });
      });
    }
  } else if (t.kerb) {
    setGoal(C, v, t.e, t.s, 0, () => { stopInLane(C, v); v.target = null; done && done(v); });
  } else if (t.pass) {
    setGoal(C, v, t.e, t.s, 6, () => { v.target = null; done && done(v); });
  }
}
function stopInLane(C, v) {
  v.mode = 'stopped'; v.v = 0; v.lights.haz = true;
  if (v.seg && v.seg.kind === 'lane') { /* stays in occ, so traffic behind sees it */ }
}
// pick a free bay near a point
function findBay(C, x, y, o = {}) {
  const kinds = o.kinds || ['park'], maxD = o.maxD || 90; let best = null, bd = Infinity;
  for (const b of C.bays) {
    if (!kinds.includes(b.kind) || b.occ || b.res) continue;
    if (b.lot && o.lotKinds && !o.lotKinds.includes(b.lot.kind)) continue;
    if (b.lot && !o.lotKinds && b.lot.kind !== 'public' && b.lot.kind !== 'mall' && b.lot.kind !== 'stadium' && b.lot.kind !== 'hospital') continue;
    if (b.e && b.e.closed) continue;
    const d = Math.hypot(b.x - x, b.y - y) * (1 + hf(b.id, o.seed || 1) * 0.25);
    if (d < maxD && d < bd) { bd = d; best = b; }
  }
  return best;
}
// §B5 collisions -----------------------------------------------------------------
const CRASHABLE = new Set(['car', 'taxi', 'van']);
function obbOverlap(a, b, shrink = 0.12) {
  const ax = [Math.cos(a.hd), Math.sin(a.hd)], ay = [-ax[1], ax[0]], bx = [Math.cos(b.hd), Math.sin(b.hd)], by = [-bx[1], bx[0]];
  const ha = [a.len / 2 - shrink, a.wid / 2 - shrink], hb = [b.len / 2 - shrink, b.wid / 2 - shrink];
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const ax2 of [ax, ay, bx, by]) {
    const d = Math.abs(dx * ax2[0] + dy * ax2[1]);
    const ra = ha[0] * Math.abs(ax[0] * ax2[0] + ax[1] * ax2[1]) + ha[1] * Math.abs(ay[0] * ax2[0] + ay[1] * ax2[1]);
    const rb = hb[0] * Math.abs(bx[0] * ax2[0] + bx[1] * ax2[1]) + hb[1] * Math.abs(by[0] * ax2[0] + by[1] * ax2[1]);
    if (d > ra + rb) return false;
  }
  return true;
}
function stepCollisions(C) {
  const G = new Map(), cell = 8, key = (i, j) => i * 4096 + j;
  for (const v of C.vehicles) { if (v.mode === 'hidden' || v.towedBy) continue; const k = key(Math.floor(v.x / cell), Math.floor(v.y / cell)); let a = G.get(k); if (!a) G.set(k, a = []); a.push(v); }
  C.vGrid = G; C.vCell = cell;
  for (const v of C.vehicles) {
    if (v.mode !== 'drive' || Math.abs(v.v) < 0.6) continue;
    const ci = Math.floor(v.x / cell), cj = Math.floor(v.y / cell);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const a = G.get(key(i, j)); if (!a) continue;
      for (const u of a) {
        if (u === v || u.towing === v || v.towing === u) continue;
        if (Math.abs(u.x - v.x) > 9 || Math.abs(u.y - v.y) > 9) continue;
        if ((v.lights.siren && u.yielding) || (u.lights.siren && v.yielding)) continue;
        if (u.mode === 'track' || u.mode === 'parked' && !u.bay?.e) continue;
        if (!obbOverlap(v, u)) continue;
        const rv = Math.hypot(Math.cos(v.hd) * v.v - Math.cos(u.hd) * u.v, Math.sin(v.hd) * v.v - Math.sin(u.hd) * u.v);
        if (rv > 1.6 && u.mode !== 'crashed' && v.mode !== 'crashed' && CRASHABLE.has(v.type) && CRASHABLE.has(u.type) && !v.towing && !u.towing && !u.lights.siren && !v.lights.siren && !(u.job && u.job.kind !== 'delivery') && !(v.job && v.job.kind !== 'delivery')) crash(C, v, u, rv);
        else { v.v = 0; v.aCmd = Math.min(v.aCmd, 0); }
      }
    }
  }
}
function crash(C, a, b, rv) {
  for (const v of [a, b]) {
    if (v.mode === 'parked') { v.damage += rv * 0.5; continue; }
    if (v.mode === 'drive' || v.mode === 'stopped') {
      if (v.admit) { v.admit.node.committed.delete(v); v.admit = null; }
      if (v.passing) endPass(C, v);
      v.mode = 'crashed'; v.lights.haz = true; v.lights.brake = true; v.damage += rv;
      v.spin = (hf(v.id, C.tReal | 0) - 0.5) * Math.min(0.6, rv * 0.06); v.slide = Math.min(v.v, 4);
    }
  }
  C.cue('crash', (a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, rv / 9));
  C.stats.crashes++; C.stats.crashesToday++;
  onCrash(C, a, b, rv);
}
function stepCrashed(C, v, dt) {
  if (v.slide && typeof v.slide === 'object') { const sl = v.slide; sl.t = Math.min(1, sl.t + dt / sl.dur); const k = sl.t * sl.t * (3 - 2 * sl.t); v.x = lerp(sl.x0, sl.x1, k); v.y = lerp(sl.y0, sl.y1, k); v.hd = sl.h0 + angDiff(sl.h0, sl.h1) * k; if (sl.t >= 1) v.slide = 0; v.v = 0; return; }
  if (v.slide > 0) { v.slide = Math.max(0, v.slide - 9 * dt); v.x += Math.cos(v.hd) * v.slide * dt; v.y += Math.sin(v.hd) * v.slide * dt; v.hd += v.spin * dt * 2; }
  v.v = 0;
}

// §C1 ------------------------------------------------------------------------
let PID = 1;
function makePerson(C, o = {}) {
  const R = C.R;
  const age = o.age || R.weighted([['adult', 70], ['kid', 14], ['senior', 16]]);
  const p = {
    id: PID++, kind: 'person', first: R.pick(FIRST), last: R.pick(LAST), age, role: o.role || 'none',
    skin: R.pick(SKIN), hair: age === 'senior' ? R.pick(['#9a9a96', '#e8e4da', '#c8c4ba']) : R.pick(HAIR), hairStyle: R.int(0, 4),
    top: R.pick(CLOTH), bottom: R.pick(['#2a3550', '#3a3a3e', '#5a4a3a', '#7a7466', '#1f2a3a', '#4c5a3a']), hat: R.chance(0.12) ? R.pick(CLOTH) : null,
    h: age === 'kid' ? R.range(1.1, 1.4) : R.range(1.58, 1.9), spdBase: age === 'kid' ? R.range(1.2, 1.6) : age === 'senior' ? R.range(0.85, 1.15) : R.range(1.15, 1.5),
    home: null, unit: null, job: null, shift: null, jobRoom: null, car: null, uniform: null,
    state: 'in', bld: null, room: null, asleep: false, x: 0, y: 0, bx: 0, by: 0, hd: 0, spd: 1.3, path: null, pi: 0, lat: 0, latT: 0,
    crossing: null, cwWait: null, cwOK: false, onRoad: false, dodge: null, startle: 0, until: 0, next: null, carry: null, pose: 'stand', bubble: null,
    task: 'At home', vehicle: null, temp: false, dog: null, sleepAt: R.range(21.8, 23.9), wakeAt: R.range(5.8, 7.6), lunched: -1, workedDay: -1,
    commit: null, phase: R.f() * 10, ix: R.f(), distracted: R.chance(0.08), seed: R.int(1, 1e9), busy: null,
  };
  if (age !== 'kid' && R.chance(0.07)) p.dog = { x: 0, y: 0, col: R.pick(['#c8a070', '#3a2a1a', '#e8e0d0', '#8a6a4a']) };
  p.name = `${p.first} ${p.last}`;
  C.people.push(p); C.pById.set(p.id, p);
  return p;
}
function pedGridBuild(C) {
  const G = new Map(); C.pGrid = G;
  C.roadPeds.length = 0;
  for (const cw of C.cws) { cw.peds.length = 0; cw.wait = 0; (cw.waiters || (cw.waiters = [])).length = 0; }
  for (const p of C.people) {
    if (p.crossing) { if (p.state === 'walk') p.crossing.peds.push(p); else { p.crossing = null; p.cwOK = false; } }
    if (p.cwWait) { if (p.state === 'walk') { p.cwWait.wait++; p.cwWait.waiters.push(p); } else p.cwWait = null; }
    if (p.state !== 'walk' && p.state !== 'wait' && p.state !== 'act') continue;
    const k = Math.floor(p.x / 4) * 8192 + Math.floor(p.y / 4); let a = G.get(k); if (!a) G.set(k, a = []); a.push(p);
    if (p.onRoad) C.roadPeds.push(p);
  }
}
function pedsNear(C, x, y, r) {
  const out = []; const G = C.pGrid; if (!G) return out;
  for (let i = Math.floor((x - r) / 4); i <= Math.floor((x + r) / 4); i++) for (let j = Math.floor((y - r) / 4); j <= Math.floor((y + r) / 4); j++) {
    const a = G.get(i * 8192 + j); if (!a) continue; for (const p of a) if ((p.x - x) ** 2 + (p.y - y) ** 2 < r * r) out.push(p);
  }
  return out;
}
export function pedRoute(C, a, b) {
  const A = ringAttach(C, a.x, a.y), B = ringAttach(C, b.x, b.y);
  const pts = [{ x: a.x, y: a.y }, { x: A.x, y: A.y }];
  if (A.b === B.b && A.n0 === B.n0 && A.n1 === B.n1) { pts.push({ x: B.x, y: B.y }, { x: b.x, y: b.y }); return pts; }
  const N = C.pn.length, g = C._g || (C._g = new Float64Array(N)), prev = C._prev || (C._prev = new Int32Array(N)), pcw = C._pcw || (C._pcw = new Array(N));
  g.fill(Infinity); prev.fill(-1); pcw.fill(null);
  const H = new Heap(), hx = B.x, hy = B.y, hd = i => Math.hypot(C.pn[i].x - hx, C.pn[i].y - hy);
  for (const n of [A.n0, A.n1]) { const d = Math.hypot(C.pn[n].x - A.x, C.pn[n].y - A.y); if (d < g[n]) { g[n] = d; prev[n] = -2; H.push(d + hd(n), n); } }
  let best = Infinity, bestN = -1;
  while (H.size) {
    const [f, u] = H.pop(); if (f >= best) break;
    if (u === B.n0 || u === B.n1) { const t = g[u] + Math.hypot(C.pn[u].x - B.x, C.pn[u].y - B.y); if (t < best) { best = t; bestN = u; } }
    for (const ed of C.pn[u].adj) { const nd = g[u] + ed.d; if (nd < g[ed.to]) { g[ed.to] = nd; prev[ed.to] = u; pcw[ed.to] = ed.cw; H.push(nd + hd(ed.to), ed.to); } }
  }
  if (bestN < 0) { pts.push({ x: B.x, y: B.y }, { x: b.x, y: b.y }); return pts; }
  const chain = []; let c = bestN; while (c >= 0) { chain.push(c); c = prev[c]; }
  chain.reverse();
  for (const n of chain) { const nd = C.pn[n]; pts.push({ x: nd.x, y: nd.y, cw: pcw[n] || null }); }
  pts.push({ x: B.x, y: B.y }, { x: b.x, y: b.y });
  // drop zero-length hops
  const out = [pts[0]]; for (let i = 1; i < pts.length; i++) { const q = out[out.length - 1]; if (Math.hypot(pts[i].x - q.x, pts[i].y - q.y) > 0.05 || pts[i].cw) out.push(pts[i]); }
  return out;
}
function walkPath(C, p, path, next, task) {
  if (p.state === 'in') leaveBuilding(C, p);
  p.state = 'walk'; p.path = path; p.pi = 1; p.next = next; p.cwOK = false; if (task) p.task = task;
  p.bx = path[0].x; p.by = path[0].y; p.pose = 'walk';
}
function walkTo(C, p, pt, next, task) { walkPath(C, p, pedRoute(C, { x: p.state === 'in' ? p.bld.door.x : p.x, y: p.state === 'in' ? p.bld.door.y : p.y }, pt), next, task); }
function canCross(C, p, cw) {
  if (!cw.zebra && cw.node && cw.node.sig) {
    if (!walkOn(cw)) return false;
  }
  // vehicles close to the crossing and still moving: wait
  const mx = (cw.ax + cw.bx) / 2, my = (cw.ay + cw.by) / 2, L = Math.hypot(cw.bx - cw.ax, cw.by - cw.ay);
  const G = C.vGrid; if (!G) return true;
  const cell = C.vCell, r = L / 2 + 16;
  for (let i = Math.floor((mx - r) / cell); i <= Math.floor((mx + r) / cell); i++) for (let j = Math.floor((my - r) / cell); j <= Math.floor((my + r) / cell); j++) {
    const a = G.get(i * 4096 + j); if (!a) continue;
    for (const v of a) {
      if (v.mode !== 'drive' || v.v < 0.6) continue;
      const dx = mx - v.x, dy = my - v.y, d = Math.hypot(dx, dy); if (d > r) continue;
      const toward = (dx * Math.cos(v.hd) + dy * Math.sin(v.hd)) / (d || 1);
      if (toward < 0.2) continue;
      // distance from the crossing line
      const ux = (cw.bx - cw.ax) / L, uy = (cw.by - cw.ay) / L, perp = Math.abs((v.x - cw.ax) * -uy + (v.y - cw.ay) * ux), along = (v.x - cw.ax) * ux + (v.y - cw.ay) * uy;
      if (along < -2 || along > L + 2) continue;
      const stopD = v.v * v.v / (2 * 3.5) + 3;
      if (perp < Math.max(5, stopD + 2) || (v.lights.siren && perp < 40)) return false;
    }
  }
  return true;
}
function stepWalk(C, p, dt) {
  if (p.startle > 0) p.startle -= dt;
  if (p.dodge) { // jump back out of the way
    const v = p.dodge; p.dodge = null; const dx = p.x - v.x, dy = p.y - v.y, d = Math.hypot(dx, dy) || 1;
    p.bx += dx / d * 1.3; p.by += dy / d * 1.3; p.startle = 1.6; p.bubble = { t: '!', ttl: 1.6 }; C.cue('gasp', p.x, p.y, 0.6);
  }
  const tgt = p.path[p.pi];
  if (!tgt) { endWalk(C, p); return; }
  if ((tgt.cw || tgt.jay) && !p.cwOK) {
    const ok = tgt.cw ? canCross(C, p, tgt.cw) : (p.distracted && C.R.chance(0.7)) || jayGapOK(C, p, tgt);
    if (!ok || p.startle > 0) {
      if (tgt.cw && !p.cwWait) { p.cwWait = tgt.cw; tgt.cw.wait++; }
      p.pose = 'stand'; p.waitT = (p.waitT || 0) + dt; setPos(C, p, dt, 0, 0); return;
    }
    if (p.cwWait) { p.cwWait.wait = Math.max(0, p.cwWait.wait - 1); p.cwWait = null; }
    p.cwOK = true; p.waitT = 0; p.onRoad = true;
    if (tgt.cw) { p.crossing = tgt.cw; tgt.cw.peds.push(p); }
  }
  let spd = p.spd * (p.crossing && !walkOn(p.crossing) ? 1.35 : 1) * (p.onRoad && tgt.jay ? 1.2 : 1);
  if (p.startle > 0) spd *= 0.2;
  const dx = tgt.x - p.bx, dy = tgt.y - p.by, d = Math.hypot(dx, dy);
  let step = spd * dt;
  p.pose = spd > 2.2 ? 'run' : 'walk';
  if (d <= step) {
    p.bx = tgt.x; p.by = tgt.y; p.pi++;
    if (p.cwOK) { if (p.crossing) { const i = p.crossing.peds.indexOf(p); if (i >= 0) p.crossing.peds.splice(i, 1); p.crossing = null; } p.cwOK = false; p.onRoad = false; }
    if (p.pi >= p.path.length) { setPos(C, p, dt, dx, dy); endWalk(C, p); return; }
  } else { p.bx += dx / d * step; p.by += dy / d * step; }
  // keep left (or right) when someone comes the other way
  const ux = d > 0 ? dx / d : 0, uy = d > 0 ? dy / d : 0;
  p.latT = 0;
  if (!p.onRoad) for (const q of pedsNear(C, p.x, p.y, 2.4)) {
    if (q === p || q.state !== 'walk') continue;
    const fx = (q.x - p.x) * ux + (q.y - p.y) * uy; if (fx < 0) continue;
    const qdx = q.path && q.path[q.pi] ? q.path[q.pi].x - q.bx : 0, qdy = q.path && q.path[q.pi] ? q.path[q.pi].y - q.by : 0;
    if (qdx * ux + qdy * uy < 0 || fx < 1.0) { p.latT = 0.85; break; }
  }
  setPos(C, p, dt, ux, uy);
}
function setPos(C, p, dt, ux, uy) {
  p.lat += clamp(p.latT - p.lat, -1.5 * dt, 1.5 * dt);
  const [nx, ny] = C.LHT ? [uy, -ux] : [-uy, ux];
  p.x = p.bx + nx * p.lat; p.y = p.by + ny * p.lat;
  if (ux || uy) p.hd = Math.atan2(uy, ux);
  if (p.dog) { const tx = p.x - Math.cos(p.hd) * 1.4 + Math.sin(p.phase) * 0.3, ty = p.y - Math.sin(p.hd) * 1.4; p.dog.x += (tx - p.dog.x) * Math.min(1, dt * 4); p.dog.y += (ty - p.dog.y) * Math.min(1, dt * 4); }
  p.phase += dt * (p.pose === 'run' ? 11 : p.pose === 'walk' ? 7 : 1.5);
}
function endWalk(C, p) {
  if (p.cwWait) { p.cwWait.wait = Math.max(0, p.cwWait.wait - 1); p.cwWait = null; }
  if (p.crossing) { const i = p.crossing.peds.indexOf(p); if (i >= 0) p.crossing.peds.splice(i, 1); p.crossing = null; }
  p.onRoad = false; p.cwOK = false; p.state = 'act'; p.pose = 'stand'; p.path = null; p.until = Infinity;
  const n = p.next; p.next = null; if (n) n(p); else think(C, p);
}
function jayGapOK(C, p, tgt) {
  // look both ways: any moving vehicle within ~45m heading toward the crossing line?
  const G = C.vGrid; if (!G) return true;
  for (const v of C.vehicles) {
    if (v.mode !== 'drive' || v.v < 1) continue;
    const d = Math.hypot(v.x - p.x, v.y - p.y); if (d > 50) continue;
    const toward = ((p.x - v.x) * Math.cos(v.hd) + (p.y - v.y) * Math.sin(v.hd)) / (d || 1);
    if (toward > 0.3 && d < 12 + v.v * 3) return false;
  }
  return true;
}
// buildings, rooms & lights ----------------------------------------------------
function enterBuilding(C, p, bl, kind) {
  p.state = 'in'; p.bld = bl; bl.inside.add(p); p.path = null; p.onRoad = false; p.pose = 'stand'; p.carry = kind === 'home' ? null : p.carry;
  let room = null;
  if (kind === 'home' && p.unit) room = bl.rooms[p.unit.rooms[0]];
  else if (kind === 'work' && p.jobRoom != null) room = bl.rooms[p.jobRoom];
  else if (kind === 'ward') room = bl.rooms.find(r => r.kind === 'ward' && r.occ.length < 3) || null;
  else if (kind === 'lecture' || kind === 'lab' || kind === 'trading' || kind === 'server') room = C.R.pick(bl.rooms.filter(r => r.kind === kind)) || null;
  else if (kind === 'cell' || kind === 'visit') room = bl.rooms.find(r => r.f === 0) || null;
  if (!room && bl.rooms.length && kind !== 'event') room = bl.rooms.find(r => r.f === 0) || bl.rooms[0];
  moveRoom(C, p, room);
  if (bl.fire && bl.fire.stage !== 'out') { // never stay in a burning building
    p.until = C.time + 0.5;
  }
}
function moveRoom(C, p, room) {
  if (p.room) { const i = p.room.occ.indexOf(p); if (i >= 0) p.room.occ.splice(i, 1); markLit(C, p.bld, p.room); }
  p.room = room; p.ix = C.R.f();
  if (room) { room.occ.push(p); markLit(C, p.bld, room); }
}
function leaveBuilding(C, p) {
  const bl = p.bld; if (!bl) return;
  if (p.room) { const i = p.room.occ.indexOf(p); if (i >= 0) p.room.occ.splice(i, 1); markLit(C, bl, p.room); p.room = null; }
  bl.inside.delete(p); p.bld = null; p.asleep = false;
  p.state = 'act'; p.x = p.bx = bl.door.x; p.y = p.by = bl.door.y; p.hd = bl.facing === 'S' ? Math.PI / 2 : -Math.PI / 2;
  C.cue('door', bl.door.x, bl.door.y, 0.25);
}
export function roomLitWanted(C, bl, r) {
  if (bl.fire && bl.fire.stage !== 'out' && bl.fire.rooms.has(r.id)) return true;
  if (r.kind === 'server') return true;
  const awake = r.occ.some(p => !p.asleep); if (!awake) return false;
  if (r.kind === 'living' || r.kind === 'kitchen' || r.kind === 'bed' || r.kind === 'studio' || r.kind === 'hotel') return C.dark > 0.15 || r.kind === 'kitchen' && C.dark > 0.05;
  return true;
}
function markLit(C, bl, r) { if (!bl || !r) return; const w = roomLitWanted(C, bl, r); if (w !== r.lit) { r.lit = w; bl.litVer++; } }
function stepIndoor(C, p) {
  // small indoor life at home: wander between the rooms of the flat, bedtime, waking
  const bl = p.bld, h = C.hour;
  if (p.unit && bl === p.home) {
    if (p.asleep) return;
    if (p.nextRoomAt === undefined || C.time > p.nextRoomAt) {
      p.nextRoomAt = C.time + C.R.range(18, 55);
      const rooms = p.unit.rooms.map(i => bl.rooms[i]);
      const bed = rooms.find(r => r.kind === 'bed') || rooms[0];
      const sleepy = (h >= p.sleepAt || h < p.wakeAt - 0.2);
      const r = sleepy ? bed : C.R.pick(rooms.filter(r => r.kind !== 'bed' || rooms.length === 1) .concat(rooms.length ? [] : []));
      if (r && r !== p.room) moveRoom(C, p, r);
      if (sleepy && p.room === bed) { p.asleep = true; markLit(C, bl, p.room); }
    }
  }
}
// §C2 trips ---------------------------------------------------------------------
function doorPt(bl) { return { x: bl.door.x, y: bl.door.y }; }
function here(p) { return p.state === 'in' ? doorPt(p.bld) : { x: p.x, y: p.y }; }
function vehicleDoor(C, v, side = 1) { // side 1 = driver side
  const s = (C.LHT ? 1 : -1) * side, hx = Math.cos(v.hd), hy = Math.sin(v.hd);
  return { x: v.x - hy * s * (v.wid / 2 + 0.55) + hx * 0.4, y: v.y + hx * s * (v.wid / 2 + 0.55) + hy * 0.4 };
}
function boardVehicle(C, p, v) {
  if (p.state === 'in') leaveBuilding(C, p);
  p.state = 'ride'; p.vehicle = v; p.onRoad = false; if (!v.crew.includes(p)) v.crew.push(p);
  C.cue('cardoor', v.x, v.y, 0.4);
}
function alight(C, p, side = 1, dx = 0) {
  const v = p.vehicle; if (!v) return;
  const i = v.crew.indexOf(p); if (i >= 0) v.crew.splice(i, 1);
  const d = vehicleDoor(C, v, side); p.x = p.bx = d.x + Math.cos(v.hd) * dx; p.y = p.by = d.y + Math.sin(v.hd) * dx;
  p.vehicle = null; p.state = 'act'; p.pose = 'stand'; p.until = Infinity;
  C.cue('cardoor', v.x, v.y, 0.4);
}
// go somewhere: dest = { bld, kind } or { pt }. then(p) on arrival.
function travel(C, p, dest, then, task) {
  const from = here(p), to = dest.bld ? doorPt(dest.bld) : dest.pt;
  const D = Math.hypot(to.x - from.x, to.y - from.y);
  p.task = task || p.task;
  const finish = q => { if (dest.bld) { q.state = 'act'; enterBuilding(C, q, dest.bld, dest.kind || 'visit'); then && then(q); } else then && then(q); };
  if (p.car && p.car.mode === 'parked' && p.car.owner === p && !p.car.job && D > 280 && p.age !== 'kid' && C.R.chance(0.8)) {
    const car = p.car, cd = { x: car.x, y: car.y };
    if (Math.hypot(cd.x - from.x, cd.y - from.y) < 260) { carTrip(C, p, car, dest, to, finish); return; }
  }
  if (D > 560) {
    const bt = busPlan(C, from, to);
    if (bt) { busTrip(C, p, bt, to, finish); return; }
  }
  walkTo(C, p, to, finish);
}
function carTrip(C, p, car, dest, to, finish) {
  const door = vehicleDoor(C, car);
  walkTo(C, p, door, q => {
    if (car.mode !== 'parked' || car.job) { walkTo(C, q, to, finish); return; }
    boardVehicle(C, q, car); car.driver = q; car.task = `Driving ${q.first} ${dest.bld ? 'to ' + dest.bld.label : ''}`;
    const bay = findBay(C, to.x, to.y, { kinds: ['park'], maxD: 110, seed: q.seed }) || findBay(C, to.x, to.y, { kinds: ['lot'], maxD: 260, seed: q.seed, lotKinds: ['public', 'mall', 'stadium', 'hospital'] }) || findBay(C, to.x, to.y, { kinds: ['park', 'lot'], maxD: 900, lotKinds: ['public', 'mall', 'stadium', 'hospital'] });
    if (!bay) { alight(C, q); walkTo(C, q, to, finish); return; }
    car.lights.head = C.dark > 0.3;
    driveTo(C, car, { bay }, () => {
      car.driver = null; car.task = 'Parked';
      setTimeout0(C, 1.2, () => { alight(C, q); walkTo(C, q, to, finish); });
    });
  }, p.task);
}
function busPlan(C, a, b) {
  let best = null;
  for (const r of C.busRoutes) for (const sa of r.stops) { if (!sa.spot) continue; const da = Math.hypot(sa.spot.x - a.x, sa.spot.y - a.y); if (da > 320) continue;
    for (const sb of r.stops) { if (sb === sa || !sb.spot) continue; const db = Math.hypot(sb.spot.x - b.x, sb.spot.y - b.y); if (db > 320) continue;
      const tot = da + db; if (tot < Math.hypot(b.x - a.x, b.y - a.y) * 0.55 && (!best || tot < best.tot)) best = { r, sa, sb, tot }; } }
  return best;
}
function busTrip(C, p, bt, to, finish) {
  walkTo(C, p, bt.sa.spot, q => {
    q.state = 'wait'; q.waitStop = bt.sa; q.alightAt = bt.sb; q.busRoute = bt.r; q.pose = 'stand'; q.until = C.time + 90; bt.sa.waiting.push(q);
    q.task = `Waiting for the ${bt.r.name} bus`; q.afterBus = () => walkTo(C, q, to, finish);
    q.x = q.bx = bt.sa.spot.x + C.R.range(-2, 2); q.y = q.by = bt.sa.spot.y + C.R.range(-0.6, 0.6);
  }, p.task);
}
function stepWait(C, p, dt) {
  p.phase += dt;
  if (p.waitStop && C.time > p.until) { // gave up on the bus
    const st = p.waitStop; st.waiting.splice(st.waiting.indexOf(p), 1); p.waitStop = null; const f = p.afterBus; p.afterBus = null; f && f();
  }
}
// tiny scheduler (real seconds)
function setTimeout0(C, sec, fn) { C.timers.push({ t: C.tReal + sec, fn }); }
function stepTimers(C) { if (!C.timers.length) return; const due = C.timers.filter(t => t.t <= C.tReal); if (!due.length) return; C.timers = C.timers.filter(t => t.t > C.tReal); for (const t of due) t.fn(); }
// game-minute scheduler
function atGameTime(C, min, fn) { C.gtimers.push({ t: min, fn }); }
function stepGTimers(C) { if (!C.gtimers.length) return; const due = C.gtimers.filter(t => t.t <= C.time); if (!due.length) return; C.gtimers = C.gtimers.filter(t => t.t > C.time); for (const t of due) t.fn(); }

// §C3 daily plans ---------------------------------------------------------------
const WEEK = [0, 1, 2, 3, 4], SIXDAY = [0, 1, 2, 3, 4, 5], ALL = [0, 1, 2, 3, 4, 5, 6];
const dowOf = (C, day) => (((day + C.startDow) % 7) + 7) % 7;
function shiftNow(C, p, lead = 40) {
  if (!p.shift) return null;
  for (const d of [C.day - 1, C.day]) {
    if (!p.workDays.includes(dowOf(C, d))) continue;
    const s = d * 1440 + p.shift[0] * 60, e = d * 1440 + p.shift[1] * 60;
    if (C.time >= s - lead && C.time < e - 2) return { s, e };
  }
  return null;
}
const sleepy = (p, h) => h >= p.sleepAt || h < p.wakeAt;
function stay(C, p, min) { p.until = C.time + min; }
function nextWake(C, p) { const h = C.hour; let add = (p.wakeAt - h) * 60; if (add < 0) add += 1440; return C.time + add; }
function goHome(C, p, why) {
  if (p.state === 'in' && p.bld === p.home) { afterHome(C, p, why); return; }
  if (!p.home) { p.state = 'gone'; return; }
  travel(C, p, { bld: p.home, kind: 'home' }, q => afterHome(C, q, why), 'Heading home');
}
function afterHome(C, p, why) {
  p.task = p.asleep ? 'Asleep at home' : 'At home'; p.carry = null;
  const h = C.hour;
  if (sleepy(p, h)) { p.nextRoomAt = C.time; stepIndoor(C, p); p.until = nextWake(C, p); p.task = 'Getting ready for bed'; return; }
  stay(C, p, C.R.range(40, 160));
}
export function think(C, p) {
  if (p.busy || p.state === 'ride' || p.state === 'gone' || p.state === 'carried' || p.state === 'escort') return;
  if (p.special === 'wanderer') { if (p.asleep && sleepy(p, C.hour)) { p.until = nextWake(C, p); return; } p.asleep = false; wandererThink(C, p); return; }
  if (p.special === 'claude') { claudeThink(C, p); return; }
  const R = C.R, h = C.hour;
  if (p.asleep) { if (sleepy(p, h)) { p.until = nextWake(C, p); return; } p.asleep = false; markLit(C, p.bld, p.room); p.task = 'Up and about'; }
  if (p.commit) { const c = p.commit; if (C.time >= c.end) p.commit = null; else if (C.time >= c.go) { c.fn(C, p); return; } }
  const sh = shiftNow(C, p);
  if (p.lunchChance && p.lunchDay !== C.day) { p.lunchDay = C.day; p.lunchAt = R.chance(p.lunchChance) ? C.day * 1440 + R.range(12, 13.1) * 60 : null; }
  if (sh) {
    if (p.lunchAt && p.lunched !== C.day && C.time >= p.lunchAt && C.time < p.lunchAt + 60 && p.state === 'in' && p.bld === p.job) { p.lunched = C.day; lunch(C, p); return; }
    if (p.state === 'in' && p.bld === p.job) { p.until = Math.min(sh.e + R.range(0, 12), p.lunchAt && p.lunched !== C.day && p.lunchAt > C.time ? p.lunchAt : Infinity); p.task = workTask(p); return; }
    if (p.job) { travel(C, p, { bld: p.job, kind: 'work' }, q => { q.task = workTask(q); q.until = Math.min(sh.e, q.lunchAt && q.lunched !== C.day && q.lunchAt > C.time ? q.lunchAt : Infinity); }, `Off to ${p.age === 'kid' ? 'school' : 'work'} at ${p.job.label}`); return; }
    if (p.role === 'hotdog' || p.role === 'newsie' || p.role === 'vendor' || p.role === 'busker') { vendorShift(C, p, sh); return; }
  }
  if (sleepy(p, h) && !(p.role === 'none' && h < 1 && R.chance(0.3))) { goHome(C, p, 'sleep'); return; }
  leisure(C, p);
}
function workTask(p) { const r = p.role; return { police: 'On duty at the police station', medic: 'On shift with the ambulance crew', firefighter: 'On shift at the fire station', kid: 'At school' }[r] || (p.age === 'kid' ? 'At school' : `Working at ${p.job.label}`); }
function openShops(C, cats) { const h = C.hour; return C.buildings.filter(b => b.cat && cats.includes(b.cat) && b.hours && (h >= b.hours[0] && h < b.hours[1] || h + 24 < b.hours[1]) && !b.fire); }
function nearest(list, pt, k = 4, R) { const s = list.map(b => [b, Math.hypot(b.door.x - pt.x, b.door.y - pt.y)]).sort((a, b) => a[1] - b[1]).slice(0, k); return s.length ? (R ? R.pick(s)[0] : s[0][0]) : null; }
function lunch(C, p) {
  const R = C.R, pt = here(p);
  if (C.events.hotdog && C.events.hotdog.open && Math.hypot(C.spots.hotdog.x - pt.x, C.spots.hotdog.y - pt.y) < 520 && R.chance(0.45)) { hotdogRun(C, p, () => think(C, p)); return; }
  const cafe = nearest(openShops(C, ['cafe', 'bakery', 'noodle', 'pizza', 'deli']), pt, 5, R);
  if (cafe) { travel(C, p, { bld: cafe, kind: 'visit' }, q => { q.task = `Lunch at ${cafe.label}`; stay(C, q, R.range(22, 38)); }, 'Out for lunch'); return; }
  benchSit(C, p, R.range(20, 30), 'Lunch on a bench');
}
function leisure(C, p) {
  const R = C.R, h = C.hour, dow = C.dow, wkend = dow >= 5, pt = here(p);
  const L = [];
  const add = (w, fn) => { if (w > 0) L.push([fn, w]); };
  const kid = p.age === 'kid', senior = p.age === 'senior';
  if (h >= 6 && h < 9.5) { add(!kid ? 1.2 : 0, () => jog(C, p)); add(p.dog ? 4 : 0, () => walkDog(C, p)); add(C.events.news && C.events.news.open ? 2 : 0, () => buyPaper(C, p)); add(senior ? 2 : 0.5, () => cafeVisit(C, p)); }
  if (h >= 9 && h < 17) { add(senior ? 3 : 1.5, () => shopVisit(C, p)); add(senior ? 2 : 1, () => benchSit(C, p, R.range(15, 45))); add(1.2, () => fishWatch(C, p)); add(1, () => pigeonFeed(C, p)); add(senior ? 2 : 1, () => cafeVisit(C, p)); add(1.2, () => mallVisit(C, p)); add(p.dog ? 2 : 0, () => walkDog(C, p)); }
  if (C.events.market && C.events.market.open) add(5, () => marketVisit(C, p));
  if (C.wind > 0.5 && h >= 11 && h < 18.5 && (kid || R.chance(0.5))) add(kid ? 6 : 2, () => flyKite(C, p));
  if (kid && h >= 15 && h < 18.5) { add(3, () => benchSit(C, p, R.range(15, 30), 'Playing in the park', 'play')); }
  if (h >= 16 && h < 21) { add(2, () => mallVisit(C, p)); add(1.5, () => shopVisit(C, p)); add(kid ? 0 : 1.5, () => eatOut(C, p)); add(C.events.busker && C.events.busker.open ? 1.5 : 0, () => listenBusker(C, p)); }
  if (h >= 17.5 && h < 23.5 && !kid) { add(wkend || dow === 4 ? 3 : 1, () => barVisit(C, p)); add(h < 20.5 ? 1 : 0, () => cinemaVisit(C, p)); }
  add(1, () => visitFriend(C, p));
  if (C.university && dow < 5 && h >= 9 && h < 16 && p.age === 'adult') add(1.2, () => travel(C, p, { bld: C.university, kind: 'lecture' }, q => { q.task = 'At a lecture at the university'; stay(C, q, R.range(45, 90)); }, 'Off to a lecture'));
  add(3, () => goHome(C, p, 'idle'));
  const fn = R.weighted(L); fn();
}
function shopVisit(C, p) { const R = C.R, list = openShops(C, ['grocer', 'florist', 'books', 'pharmacy', 'barber', 'laundry', 'hardware', 'electronics', 'fashion', 'deli', 'bakery']); const b = nearest(list, here(p), 6, R); if (!b) return goHome(C, p); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = `Browsing at ${b.label}`; q.carry = R.chance(0.6) ? 'bag' : q.carry; stay(C, q, R.range(8, 26)); }, `Popping into ${b.label}`); }
function cafeVisit(C, p) { const R = C.R, b = nearest(openShops(C, ['cafe', 'bakery', 'gelato']), here(p), 5, R); if (!b) return benchSit(C, p, 20); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = `Coffee at ${b.label}`; stay(C, q, R.range(15, 40)); }, `Going for a coffee`); }
function eatOut(C, p) { const R = C.R, b = nearest(openShops(C, ['pizza', 'noodle', 'deli']), here(p), 5, R); if (!b) return goHome(C, p); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = `Dinner at ${b.label}`; stay(C, q, R.range(40, 75)); }, 'Going out to eat'); }
function barVisit(C, p) { const R = C.R, b = nearest(openShops(C, ['bar']), here(p), 4, R); if (!b) return goHome(C, p); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = `Drinks at ${b.label}`; stay(C, q, R.range(60, 160)); }, `Meeting friends at ${b.label}`); }
function mallVisit(C, p) { const R = C.R, b = C.mall; if (!b || C.hour < 9 || C.hour > 20.5) return shopVisit(C, p); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = 'Shopping at the centre'; q.carry = 'bag'; stay(C, q, R.range(30, 90)); }, 'Off to the shopping centre'); }
function cinemaVisit(C, p) { const b = C.cinema; if (!b) return goHome(C, p); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = 'At the pictures'; stay(C, q, C.R.range(100, 130)); }, 'Going to the movies'); }
function visitFriend(C, p) { const R = C.R; const b = R.pick(C.buildings.filter(b => b.units.length && b !== p.home)); if (!b) return goHome(C, p); travel(C, p, { bld: b, kind: 'visit' }, q => { q.task = `Visiting a friend at ${b.label}`; stay(C, q, R.range(40, 120)); }, 'Visiting a friend'); }
function areaPoint(C, b, R, pad = 4) { const a = b.area || b.inner; return { x: R.range(a.x0 + pad, a.x1 - pad), y: R.range(a.y0 + pad, a.y1 - pad) }; }
function standAt(C, p, pt, min, pose, task, then, walkTask) {
  walkTo(C, p, pt, q => { q.state = 'act'; q.pose = pose; q.task = task; q.until = C.time + min; q.next = then || null; q.actAt = { x: pt.x, y: pt.y }; }, walkTask || task.replace(/^(\w+)/, m => 'Going ' + m.toLowerCase()));
}
function benchSit(C, p, min, task = 'Sitting on a bench', pose = 'sit') {
  const R = C.R, benches = C.props.benches; const pt0 = here(p);
  const bs = benches.map(b => [b, Math.hypot(b.x - pt0.x, b.y - pt0.y)]).sort((a, b) => a[1] - b[1]).slice(0, 6);
  if (!bs.length) return goHome(C, p);
  const b = R.pick(bs)[0];
  if (pose === 'play' && C.spots.parkArea) { standAt(C, p, areaPoint(C, C.spots.parkArea, R, 8), min, 'play', task, null, 'Heading to the park'); return; }
  standAt(C, p, { x: b.x + R.range(-0.5, 0.5), y: b.y + 0.3 }, min, pose, task, null, 'Strolling to a bench');
}
function fishWatch(C, p) { const pool = C.pool; if (!pool) return benchSit(C, p, 20); const a = C.R.range(0, 6.28); standAt(C, p, { x: pool.x + Math.cos(a) * (pool.r + 0.9), y: pool.y + Math.sin(a) * (pool.r + 0.9) }, C.R.range(5, 16), 'look', 'Watching the fish in the fountain'); }
function pigeonFeed(C, p) { const s = C.spots.pigeons; if (!s) return benchSit(C, p, 20); standAt(C, p, { x: s.x + C.R.range(-3, 3), y: s.y + C.R.range(-2, 2) }, C.R.range(6, 16), 'feed', 'Feeding the pigeons'); }
function flyKite(C, p) { const R = C.R, s = C.spots.kites ? R.pick(C.spots.kites) : null; if (!s) return benchSit(C, p, 20); p.carry = 'kite'; standAt(C, p, s, R.range(25, 60), 'kite', 'Flying a kite in the park', q => { q.carry = null; think(C, q); }, 'Taking a kite to the park'); }
function listenBusker(C, p) { const s = C.spots.busker; standAt(C, p, { x: s.x + C.R.range(-5, 5), y: s.y + C.R.range(-4, -1.5) }, C.R.range(5, 15), 'look', 'Listening to the busker'); }
function jog(C, p) {
  const park = C.spots.parkArea; if (!park) return goHome(C, p);
  const ns = park.rnodes; p.spd = p.spdBase * 2.3; p.carry = null;
  walkTo(C, p, { x: ns[0].x, y: ns[0].y }, q => {
    const lap = [...ns, ns[0], ...ns, ns[0]].map(n => ({ x: n.x, y: n.y }));
    walkPath(C, q, [{ x: q.x, y: q.y }, ...lap], r => { r.spd = r.spdBase; think(C, r); }, 'Jogging laps of the park');
  }, 'Going for a jog');
}
function walkDog(C, p) { const park = C.spots.parkArea; if (!park) return goHome(C, p); const pt = areaPoint(C, park, C.R, 6); walkTo(C, p, pt, q => { const pt2 = areaPoint(C, park, C.R, 6); walkTo(C, q, pt2, r => goHome(C, r), 'Walking the dog'); }, 'Walking the dog'); }
function buyPaper(C, p) { const s = C.spots.news; standAt(C, p, { x: s.x - 1.6, y: s.y + 1.2 }, 1.5, 'stand', 'Buying the morning paper', q => { q.carry = 'paper'; think(C, q); }); }
function marketVisit(C, p) {
  const R = C.R, stalls = C.props.stalls.filter(s => s.open > 0.9); if (!stalls.length) return shopVisit(C, p);
  const seq = R.shuffle(stalls.slice()).slice(0, R.int(2, 4));
  const go = (q, i) => { if (i >= seq.length) { q.carry = 'bag'; think(C, q); return; } const s = seq[i]; standAt(C, q, { x: s.x + R.range(-1.5, 1.5), y: s.y + s.d / 2 + 1.1 }, R.range(3, 8), 'look', `Browsing the ${s.goods} stall`, r => go(r, i + 1), 'Wandering the market'); };
  go(p, 0);
}
function hotdogRun(C, p, then) {
  const ev = C.events.hotdog; const s = C.spots.hotdog;
  walkTo(C, p, { x: s.x + 2.5, y: s.y + 0.5 }, q => { q.state = 'wait'; q.pose = 'stand'; q.task = 'Queueing for a hot dog'; ev.queue.push(q); q.until = C.time + 30; q.afterQueue = () => { q.carry = 'hotdog'; benchSit(C, q, C.R.range(8, 15), 'Eating a hot dog'); }; }, 'Getting a hot dog');
}
function vendorShift(C, p, sh) {
  const R = C.R;
  if (p.role === 'hotdog') { const s = C.spots.hotdog; standAt(C, p, { x: s.x, y: s.y - 1 }, (sh.e - C.time), 'vend', 'Running the hot dog stand', q => { think(C, q); }); p.carry = 'cart'; return; }
  if (p.role === 'newsie') { const s = C.spots.news; standAt(C, p, { x: s.x, y: s.y + 1.4 }, (sh.e - C.time), 'vend', 'Selling newspapers'); return; }
  if (p.role === 'busker') { const s = C.spots.busker; standAt(C, p, s, (sh.e - C.time), 'busk', 'Busking in the plaza'); return; }
  if (p.role === 'vendor') {
    const ev = C.events.market; if (!ev || !ev.active) { leisure(C, p); return; }
    const st = p.stall; if (!st) { leisure(C, p); return; }
    standAt(C, p, { x: st.x, y: st.y - st.d / 2 - 0.6 }, (sh.e - C.time), 'vend', `Running the ${st.goods} stall`, q => think(C, q));
  }
}
function stepAct(C, p, dt) {
  p.phase += dt * (p.pose === 'play' ? 5 : 1.5);
  if (p.startle > 0) p.startle -= dt;
  if (p.pose === 'play' && p.actAt) { const R = C.R; if (!p.playT || p.playT < 0) { p.playT = R.range(1, 3); p.playTo = { x: p.actAt.x + R.range(-6, 6), y: p.actAt.y + R.range(-5, 5) }; } p.playT -= dt; const dx = p.playTo.x - p.x, dy = p.playTo.y - p.y, d = Math.hypot(dx, dy); if (d > 0.2) { p.x += dx / d * 2 * dt; p.y += dy / d * 2 * dt; p.hd = Math.atan2(dy, dx); } p.bx = p.x; p.by = p.y; }
  if (C.time >= p.until) { const n = p.next; p.next = null; p.pose = 'stand'; if (n) n(p); else think(C, p); }
}
// §C4 population ----------------------------------------------------------------
function genPeople(C) {
  const R = C.R;
  const units = []; for (const bl of C.buildings) for (const u of bl.units) units.push([bl, u]);
  const MAXP = C.opts.maxPop || 1150, rate = Math.min(0.92, MAXP / (units.length * 1.9));
  for (const [bl, u] of units) {
    if (!R.chance(bl.type === 'hotel' ? 0.6 : rate)) continue;
    const n = bl.type === 'hotel' ? 1 : R.weighted([[1, 4], [2, 4], [3, 2]]);
    for (let k = 0; k < n; k++) {
      const p = makePerson(C, { age: k === 2 ? 'kid' : (bl.type === 'hotel' ? 'adult' : undefined) });
      p.home = bl; p.unit = u; u.residents.push(p); bl.residents.push(p); if (bl.type === 'hotel') p.role = 'guest';
    }
  }
  const adults = R.shuffle(C.people.filter(p => p.age === 'adult' && p.role === 'none'));
  const take = () => adults.pop();
  const assign = (role, bl, shift, days, roomKind, uniform) => {
    const p = take(); if (!p) return null;
    p.role = role; p.job = bl; p.shift = shift; p.workDays = days; p.uniform = uniform || null;
    if (bl && bl.rooms.length) { const rs = bl.rooms.filter(r => !roomKind || r.kind === roomKind); const r = R.pick(rs.length ? rs : bl.rooms); p.jobRoom = r.id; }
    if (bl) bl.workers.push(p);
    return p;
  };
  for (const sh of [[7, 19], [19, 31]]) {
    for (let k = 0; k < 4; k++) assign('police', C.police, sh, ALL, 'office', 'police');
    for (let k = 0; k < 4; k++) assign('medic', C.hospital, sh, ALL, 'lobby', 'medic');
    for (let k = 0; k < 6; k++) assign('firefighter', C.fireStation, sh, ALL, null, 'fire');
    for (let k = 0; k < 5; k++) assign('nurse', C.hospital, sh, ALL, 'ward', 'scrubs');
    assign('tow', C.scrap, sh, ALL, null, 'hivis');
  }
  for (let k = 0; k < 3; k++) assign('roadworker', C.works, [7, 15.5], WEEK, null, 'hivis');
  for (let k = 0; k < 2; k++) assign('garbo', C.works, [4.6, 11], WEEK, null, 'hivis');
  for (let k = 0; k < FLEET.van; k++) assign('driver', C.warehouse, [7, 16], WEEK, null, 'courier');
  const hd = assign('hotdog', null, [10.2, 15.2], ALL, null, 'apron');
  assign('newsie', null, [5.8, 12], ALL, null, 'apron');
  const bk = assign('busker', null, [16, 20.5], [3, 4, 5, 6], null, null);
  for (const st of C.props.stalls) { const v = assign('vendor', null, [6.5, 14.5], [5, 6], null, 'apron'); if (v) { v.stall = st; st.vendor = v; } }
  void hd; void bk;
  const jobs = [];
  for (const bl of C.buildings) {
    const t = bl.type, push = (n, shift, days, kind) => { for (let k = 0; k < n; k++) jobs.push({ bl, shift, days, kind }); };
    if (t === 'office' || t === 'bank') { for (const r of bl.rooms) if (r.kind === 'office') for (let k = 0; k < 2; k++) jobs.push({ bl, shift: [R.range(7.8, 9.3), R.range(16.2, 18.4)], days: WEEK, kind: null, room: r.id }); }
    else if (bl.cat && bl.hours && t === 'shop') push(R.int(1, 3), [bl.hours[0] - 0.3, bl.hours[1] + 0.2], bl.cat === 'bar' ? ALL : SIXDAY, null);
    else if (t === 'mall') push(14, [8.6, 18.2], ALL, null);
    else if (t === 'hotel') { push(3, [7, 15], ALL, null); push(3, [15, 23], ALL, null); }
    else if (t === 'school') push(7, [8, 16], WEEK, 'class');
    else if (t === 'cinema') push(3, [12, 23], ALL, null);
    else if (t === 'concert') push(4, [16, 23.5], ALL, null);
    else if (t === 'dealer') push(3, [9, 17.5], SIXDAY, null);
    else if (t === 'depot') { push(3, [5, 13], ALL, null); push(3, [13, 21], ALL, null); }
    else if (t === 'warehouse') push(2, [7, 15.5], WEEK, null);
    else if (t === 'university') { push(4, [8.5, 17.5], WEEK, 'lecture'); push(4, [8.5, 17.5], WEEK, 'office'); }
    else if (t === 'lab') push(5, [8.5, 18], WEEK, 'lab');
    else if (t === 'commerce') { for (const r of bl.rooms) if (r.kind === 'trading') for (let k = 0; k < 3; k++) jobs.push({ bl, shift: [R.range(7.5, 9), R.range(16.5, 18.5)], days: WEEK, kind: null, room: r.id }); }
    else if (t === 'datacentre') { push(1, [7, 15], ALL, 'server'); push(1, [15, 23], ALL, 'server'); }
  }
  R.shuffle(jobs);
  for (const j of jobs) {
    const p = take(); if (!p) break;
    p.role = 'worker'; p.job = j.bl; p.shift = j.shift; p.workDays = j.days; j.bl.workers.push(p);
    const rs = j.room != null ? [j.bl.rooms[j.room]] : j.bl.rooms.filter(r => !j.kind || r.kind === j.kind);
    if (rs.length) p.jobRoom = R.pick(rs).id;
    if (j.bl.type === 'office' || j.bl.type === 'bank' || j.bl.type === 'shop' || j.bl.type === 'school') p.lunchChance = 0.55;
  }
  // school for kids
  for (const p of C.people) if (p.age === 'kid' && C.school) { p.role = 'kid'; p.job = C.school; p.shift = [8.7, 15.2]; p.workDays = WEEK; p.jobRoom = R.pick(C.school.rooms.filter(r => r.kind === 'class') || C.school.rooms).id; }
  for (const p of C.people) if (p.role === 'none' && p.age !== 'kid') p.role = 'leisure';
  for (const p of C.people) if (p.shift && p.lunchChance) p.lunchAt = null;
  // cars
  const target = Math.round(C.people.length * (C.opts.carRate || 0.16));
  const drivers = R.shuffle(C.people.filter(p => p.age !== 'kid' && !['hotdog', 'newsie', 'vendor', 'busker', 'guest'].includes(p.role)));
  C.carTarget = target;
  for (const p of drivers.slice(0, target)) {
    const near = p.job && shiftNow(C, p, 0) ? p.job : p.home;
    const bay = findBay(C, near.door.x, near.door.y, { kinds: ['park'], maxD: 160, seed: p.seed }) || findBay(C, near.door.x, near.door.y, { kinds: ['lot'], maxD: 400, seed: p.seed });
    if (!bay) continue;
    const v = makeVehicle(C, 'car'); v.owner = p; p.car = v; parkAt(C, v, bay);
  }
}
function placeInitial(C) {
  const R = C.R, h = C.hour;
  for (const p of C.people) {
    p.lunchDay = C.day; p.lunchAt = p.lunchChance && R.chance(p.lunchChance) ? C.day * 1440 + R.range(12, 13.1) * 60 : null;
    const sh = shiftNow(C, p, 0);
    if (sh && p.job) { enterBuilding(C, p, p.job, 'work'); p.until = sh.e + R.range(0, 10); p.task = workTask(p); continue; }
    if (p.home) { enterBuilding(C, p, p.home, 'home'); p.until = C.time + R.range(0, 120); if (sleepy(p, h)) { p.asleep = true; p.until = nextWake(C, p); } else p.task = 'At home'; continue; }
    p.state = 'gone';
  }
}

// §D1 incidents: common -------------------------------------------------------
let IID = 1;
function newIncident(C, kind, title, x, y, focus) {
  const inc = { id: IID++, kind, title, x, y, t0: C.time, focus, active: true, step: null, phase: '' };
  C.incidents.push(inc); C.cue('notice', x, y, 1, title); C.log(title, kind);
  return inc;
}
function endIncident(C, inc) { inc.active = false; const i = C.incidents.indexOf(inc); if (i >= 0) C.incidents.splice(i, 1); }
const ROLE_FOR = { police: 'police', ambulance: 'medic', fire: 'firefighter', tow: 'tow', ute: 'roadworker', garbage: 'garbo', van: 'driver' };
function staffIn(C, bl, role) { return bl ? [...bl.inside].filter(p => p.role === role && !p.busy && shiftNow(C, p, 30)) : []; }
function freeVehicle(C, type, preempt) { return C.vehicles.filter(v => v.type === type && ((!v.job && v.mode === 'parked' && v.homeBay && v.bay === v.homeBay) || (preempt && v.job && v.job.kind === 'patrol' && v.crew.length && (v.mode === 'drive' || v.mode === 'stopped')))); }
function homeFor(C, type) { return { police: C.police, ambulance: C.hospital, fire: C.fireStation, tow: C.scrap, ute: C.works, garbage: C.works, van: C.warehouse, bus: C.depot }[type]; }
// crew run from the station to the vehicle and board; onReady(v, crew)
function dispatch(C, inc, type, nCrew, onReady, o = {}) {
  const cands = freeVehicle(C, type, !o.calm); if (!cands.length) return null;
  const v = o.near ? cands.sort((a, b) => Math.hypot(a.x - o.near.x, a.y - o.near.y) - Math.hypot(b.x - o.near.x, b.y - o.near.y))[0] : cands[0];
  if (v.job && v.job.kind === 'patrol') { // divert a patrol car: the crew is already aboard
    v.job = inc; v.unitCrew = v.crew.slice(); (inc.units || (inc.units = [])).push(v);
    for (const p of v.crew) { p.busy = inc; p.task = o.task || 'Responding to a call'; }
    v.target = null; v.goal = null; v.onArrive = null; setTimeout0(C, 0.2, () => onReady(v, v.crew.slice()));
    return { v, crew: v.crew.slice() };
  }
  const st = homeFor(C, type);
  let crew = staffIn(C, st, ROLE_FOR[type]).slice(0, nCrew);
  if (!crew.length) return null;
  v.job = inc; v.unitCrew = crew.slice(); (inc.units || (inc.units = [])).push(v);
  for (const p of crew) { p.busy = inc; p.task = o.task || 'Responding to a call'; }
  if (type === 'fire') C.cue('bell', st.door.x, st.door.y, 1);
  let n = 0;
  crew.forEach((p, i) => {
    leaveBuilding(C, p); p.spd = p.spdBase * (o.calm ? 1 : 1.9);
    walkPath(C, p, pedRoute(C, { x: p.x, y: p.y }, vehicleDoor(C, v, i % 2 ? -1 : 1)), q => { boardVehicle(C, q, v); q.spd = q.spdBase; if (++n === crew.length) onReady(v, crew); }, p.task);
  });
  return { v, crew };
}
function releaseCrew(C, v, inc) {
  // crew get out at base and go inside
  const st = homeFor(C, v.type);
  for (const p of v.crew.slice()) {
    alight(C, p, v.crew.indexOf(p) % 2 ? -1 : 1);
    p.busy = null; p.carry = null;
    if (st) walkTo(C, p, doorPt(st), q => { enterBuilding(C, q, st, 'work'); q.task = workTask(q); const sh = shiftNow(C, q, 0); q.until = sh ? sh.e : C.time + 1; }, 'Heading back inside');
    else think(C, p);
  }
  v.job = null; v.lights.siren = null; v.lights.beacon = false; v.task = 'Parked at base';
  if (inc) endIncident(C, inc);
}
// wait until a vehicle is not halfway through a manoeuvre before giving it new orders
function whenSettled(C, v, fn) { if (v.mode === 'track') setTimeout0(C, 0.5, () => whenSettled(C, v, fn)); else fn(); }
// end a unit's part in an incident: crew who are out walk back and get in, then the vehicle goes home
function standDown(C, v, inc) {
  if (!v || v.mode === 'gone' || v.standingDown) return;
  v.standingDown = true; v.lights.siren = null; v.lights.beacon = false;
  const crew = (v.unitCrew || []).filter(p => p.vehicle !== v && p.state !== 'gone' && p.state !== 'in');
  const go = () => whenSettled(C, v, () => { v.standingDown = false; v.lights.haz = false; if (v.mode === 'crashed') return; returnToBase(C, v, null); });
  if (!crew.length) { go(); return; }
  let n = 0;
  crew.forEach((p, i) => {
    p.carry = null; p.next = null; p.hoseFrom = null; p.aim = null; p.lookAt = null; p.spd = p.spdBase; p.busy = inc || p.busy;
    walkTo(C, p, vehicleDoor(C, v, i % 2 ? -1 : 1), q => { boardVehicle(C, q, v); if (++n === crew.length) go(); }, 'Heading back to the vehicle');
  });
}
function standDownAll(C, inc) { for (const v of inc.units || []) if (v.job === inc) standDown(C, v, inc); }
function returnToBase(C, v, inc) {
  v.lights.siren = null; v.lights.haz = false; v.task = 'Returning to base';
  v.lights.beacon = false;
  driveTo(C, v, { bay: v.homeBay }, () => setTimeout0(C, 1.5, () => releaseCrew(C, v, inc)));
}
// a place at the kerb close to a point: a free bay, otherwise stop in the lane
function kerbNear(C, x, y, kinds = ['load', 'park'], maxD = 45) {
  const bay = findBay(C, x, y, { kinds, maxD });
  if (bay) return { bay };
  let best = null, bd = Infinity;
  for (const e of C.edges) {
    if (e.closed) continue;
    if (e.len < 34) continue;
    const s = clamp(projectOnEdge(e, x, y), 16, e.len - 14), q = edgePoint(e, s, e.kerbOff);
    const d = Math.hypot(q.x - x, q.y - y); if (d < bd && sideOf(e, { x, y }) > 0) { bd = d; best = { kerb: true, e, s }; }
  }
  return best;
}
function rearPoint(v, k = 0.9) { return { x: v.x - Math.cos(v.hd) * (v.len / 2 + k), y: v.y - Math.sin(v.hd) * (v.len / 2 + k) }; }
function sidewalkNear(C, x, y) { const a = ringAttach(C, x, y); return { x: a.x, y: a.y }; }
// §D2 medical ------------------------------------------------------------------------------
function startMedical(C, patient, where) {
  const bl = patient.bld;
  const inc = newIncident(C, 'medical', `Medical callout at ${bl ? bl.label : 'the street'}`, where.x, where.y, null);
  patient.busy = inc; patient.task = 'Waiting for the paramedics'; if (patient.room) { patient.asleep = false; markLit(C, bl, patient.room); }
  inc.patient = patient; inc.phase = 'dispatch'; inc.wait = 0;
  inc.step = (C, dt) => {
    if (inc.phase === 'dispatch') {
      inc.wait += dt;
      const d = dispatch(C, inc, 'ambulance', 2, (v, crew) => {
        inc.phase = 'enroute'; v.lights.siren = 'ambulance'; v.task = `Rushing to ${bl ? bl.label : 'a patient'}`; inc.focus = v; inc.v = v; inc.crew = crew;
        const tgt = kerbNear(C, where.x, where.y, ['load', 'amb', 'park', 'bus']);
        driveTo(C, v, tgt, () => arrived(v, crew));
      }, { near: where, task: 'Running to the ambulance' });
      if (d) { inc.phase = 'boarding'; inc.focus = d.v; }
      else if (inc.wait > 90) { patient.busy = null; endIncident(C, inc); }
    }
  };
  const arrived = (v, crew) => {
    inc.phase = 'scene'; v.lights.siren = null; v.lights.beacon = true; v.lights.haz = true; v.task = 'Paramedics on scene'; v.doorOpen = true;
    crew.forEach((p, i) => { alight(C, p, i % 2 ? -1 : 1); p.carry = i === 0 ? 'stretcher' : 'kit'; p.task = 'Paramedic on a callout'; });
    inc.focus = crew[0];
    const goIn = bl ? doorPt(bl) : { x: patient.x, y: patient.y };
    let n = 0;
    for (const p of crew) walkTo(C, p, goIn, q => {
      if (bl) { q.state = 'act'; enterBuilding(C, q, bl, 'visit'); }
      if (++n === crew.length) setTimeout0(C, C.R.range(25, 45), () => bringOut(v, crew));
    }, 'Taking the stretcher in');
  };
  const bringOut = (v, crew) => {
    inc.phase = 'carry';
    for (const p of crew) if (p.state === 'in') leaveBuilding(C, p);
    if (patient.state === 'in') leaveBuilding(C, patient);
    patient.state = 'carried'; patient.carriedBy = crew[0]; patient.pose = 'lying'; patient.task = 'On a stretcher'; crew[0].carryWho = patient; crew[0].carry = 'stretcher';
    inc.focus = patient;
    const rp = rearPoint(v, 1.4); let n = 0;
    for (const p of crew) walkTo(C, p, { x: rp.x + C.R.range(-0.4, 0.4), y: rp.y }, q => {
      if (++n === crew.length) setTimeout0(C, 3, () => {
        crew[0].carryWho = null; for (const c of crew) { c.carry = null; boardVehicle(C, c, v); }
        patient.carriedBy = null; boardVehicle(C, patient, v); patient.pose = 'lying';
        v.doorOpen = false; v.lights.beacon = false; v.lights.siren = 'ambulance'; v.lights.haz = false; v.task = 'Racing to the hospital';
        inc.phase = 'hospital'; inc.focus = v;
        const bay = v.homeBay;
        driveTo(C, v, { bay }, () => atHospital(v, crew));
      });
    }, 'Wheeling the patient out');
  };
  const atHospital = (v, crew) => {
    v.lights.siren = null; v.task = 'At the emergency department';
    const hosp = C.hospital;
    alight(C, patient, 1, -2); patient.state = 'carried'; patient.carriedBy = crew[0];
    crew.forEach((p, i) => alight(C, p, i % 2 ? -1 : 1));
    crew[0].carry = 'stretcher'; crew[0].carryWho = patient;
    let n = 0;
    for (const p of crew) walkTo(C, p, doorPt(hosp), q => {
      if (++n < crew.length) return;
      crew[0].carryWho = null; crew[0].carry = null; patient.carriedBy = null;
      patient.state = 'act'; patient.x = hosp.door.x; patient.y = hosp.door.y; enterBuilding(C, patient, hosp, 'ward'); patient.asleep = false;
      patient.task = 'Recovering in hospital'; patient.until = C.time + C.R.range(180, 420); patient.busy = null; patient.pose = 'stand';
      for (const c of crew) { c.busy = null; c.state = 'act'; enterBuilding(C, c, hosp, 'work'); c.task = workTask(c); const sh = shiftNow(C, c, 0); c.until = sh ? sh.e : C.time + 1; }
      v.crew.length = 0; v.job = null; v.task = 'Waiting for the next call'; endIncident(C, inc);
    }, 'Taking the patient inside');
  };
  return inc;
}
// §D3 fire ---------------------------------------------------------------------------------
function startFire(C, bl) {
  const R = C.R, room = R.pick(bl.rooms.length ? bl.rooms : [{ id: -1 }]);
  bl.fire = { stage: 'smoke', k: 0.12, t: 0, rooms: new Set([room.id]), hoses: 0, steam: 0 };
  bl.litVer++;
  const inc = newIncident(C, 'fire', `Fire at ${bl.label}`, bl.door.x, bl.door.y, bl);
  inc.bl = bl; inc.phase = 'dispatch'; inc.wait = 0; inc.engines = []; inc.watchers = [];
  // evacuate everyone; they gather on the far footpath
  const assembly = sidewalkNear(C, bl.door.x + R.range(-12, 12), bl.door.y + (bl.facing === 'S' ? 22 : -22));
  const evac = p => { p.busy = inc; p.asleep = false; p.task = 'Evacuated, watching the fire'; walkTo(C, p, { x: assembly.x + R.range(-6, 6), y: assembly.y + R.range(-1, 1) }, q => { q.state = 'act'; q.pose = 'look'; q.until = Infinity; q.lookAt = { x: bl.door.x, y: bl.fp.y1 - 6 }; }, 'Evacuating the building'); inc.watchers.push(p); };
  for (const p of [...bl.inside]) if (!p.busy) { leaveBuilding(C, p); p.bubble = { t: '!', ttl: 3 }; evac(p); }
  inc.evac = evac;
  inc.step = (C, dt) => {
    const f = bl.fire; f.t += dt;
    if (f.stage !== 'out') {
      const grow = f.hoses ? -0.015 * f.hoses : 0.0035;
      f.k = clamp(f.k + grow * dt, 0, 1.2);
      if (f.k > 0.32 && f.stage === 'smoke') f.stage = 'burning';
      if (f.stage === 'burning' && R.chance(dt * 0.05 * f.k) && f.rooms.size < bl.rooms.length) {
        const cur = R.pick([...f.rooms].map(i => bl.rooms[i]).filter(Boolean));
        if (cur) { const nb = bl.rooms.filter(r => !f.rooms.has(r.id) && ((r.f === cur.f && (r.c0 === cur.c1 + 1 || r.c1 === cur.c0 - 1)) || (r.f === cur.f + 1 && r.c0 <= cur.c1 && r.c1 >= cur.c0))); if (nb.length) { f.rooms.add(R.pick(nb).id); bl.litVer++; } }
      }
      if (f.k <= 0.001 && f.t > 20) { f.stage = 'out'; f.steam = 1; bl.scorch = 1; bl.litVer++; C.log(`The fire at ${bl.label} is out`, 'fire'); packUp(); }
      for (const p of [...bl.inside]) if (!p.busy && p.state === 'in') { leaveBuilding(C, p); evac(p); }
    } else { f.steam = Math.max(0, f.steam - dt / 50); if (f.steam <= 0 && inc.phase === 'gone') { bl.fire = null; bl.litVer++; endIncident(C, inc); } }
    if (inc.phase === 'dispatch') {
      inc.wait += dt;
      if (inc.wait > 4) sendEngine();
      if (inc.wait > 120 && !inc.engines.length) { f.hoses = 1; } // the fire burns down by itself eventually
    }
    if (inc.phase === 'fighting' && f.k > 0.7 && inc.engines.length < 2 && R.chance(dt * 0.02)) sendEngine();
  };
  const sendEngine = () => {
    const d = dispatch(C, inc, 'fire', 4, (v, crew) => {
      v.lights.siren = 'fire'; v.task = `Responding to the fire at ${bl.label}`; inc.focus = v;
      const tgt = kerbNear(C, bl.door.x, bl.door.y, ['load', 'park', 'bus'], 50);
      driveTo(C, v, tgt && tgt.bay && v.len > 9 ? kerbNear(C, bl.door.x, bl.door.y, [], 0) : tgt, () => onScene(v, crew));
    }, { near: bl.door, task: 'Turning out to a fire' });
    if (d) { inc.engines.push(d.v); if (inc.phase === 'dispatch') inc.phase = 'enroute'; }
  };
  const onScene = (v, crew) => {
    if (!bl.fire || bl.fire.stage === 'out' || inc.phase === 'packing' || inc.phase === 'gone') { standDown(C, v, inc); return; }
    inc.phase = 'fighting'; v.lights.siren = null; v.lights.beacon = true; v.lights.haz = true; v.task = 'Fighting the fire';
    crew.forEach((p, i) => {
      alight(C, p, i % 2 ? -1 : 1);
      const role = i < 2 ? 'hose' : i === 2 ? 'hydrant' : 'look';
      p.carry = role === 'hose' ? 'hose' : null; p.task = role === 'hose' ? 'On the hose' : role === 'hydrant' ? 'Working the hydrant' : 'Directing the crew';
      const fx = clamp(bl.door.x + (i - 0.5) * 6, bl.fp.x0 + 1, bl.fp.x1 - 1), fy = bl.facing === 'S' ? bl.fp.y1 + 2.2 + i * 0.4 : sidewalkNear(C, fx, bl.door.y).y;
      const pt = role === 'hydrant' ? nearestHydrant(C, v.x, v.y) : sidewalkNear(C, fx, fy);
      walkTo(C, p, pt, q => {
        q.state = 'act'; q.until = Infinity; q.pose = role === 'hose' ? 'hose' : role === 'hydrant' ? 'crouch' : 'look'; q.hoseFrom = v;
        const rr = [...bl.fire.rooms].map(id => bl.rooms[id]).filter(Boolean);
        q.aim = rr.length ? roomCentre(bl, C.R.pick(rr)) : { x: bl.door.x, y: bl.fp.y1, z: bl.H * 0.5, bid: bl.id };
        q.lookAt = q.aim;
        if (role === 'hose') bl.fire.hoses++;
      }, p.task);
    });
    inc.focus = crew[0];
  };
  const packUp = () => {
    inc.phase = 'packing';
    setTimeout0(C, 12, () => {
      if (bl.fire) bl.fire.hoses = 0;
      standDownAll(C, inc);
      for (const p of inc.watchers) if (p.busy === inc) { p.busy = null; p.lookAt = null; think(C, p); }
      inc.phase = 'gone';
    });
  };
  return inc;
}
export function roomCentre(bl, r) {
  const w = bl.win, x = bl.fp.x0 + w.mx + (r.c0 + r.c1 + 1) / 2 * w.pitch, z = r.f === 0 ? bl.gh * 0.5 : bl.gh + (r.f - 1) * bl.fh + bl.fh * 0.5;
  return { x, y: bl.fp.y1, z, bid: bl.id };
}
function nearestHydrant(C, x, y) { let b = null, bd = Infinity; for (const h of C.props.hydrants) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; b = h; } } return b ? { x: b.x + 0.6, y: b.y + 0.4 } : sidewalkNear(C, x, y); }
// §D4 crashes, towing ------------------------------------------------------------------------
function driverOf(v) { return v.driver || v.crew[0] || null; }
function onCrash(C, a, b, rv) {
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const inc = newIncident(C, 'crash', rv > 6 ? 'Car crash' : 'Fender bender', x, y, a);
  inc.cars = [a, b].filter(v => v.mode === 'crashed'); inc.rv = rv; inc.phase = 'stopped'; inc.t = 0; inc.people = [];
  for (const v of inc.cars) { v.job = v.job || null; v.crashInc = inc; v.task = 'Crashed'; }
  setTimeout0(C, 2.5, () => {
    for (const v of inc.cars) {
      const d = driverOf(v); if (!d) continue;
      alight(C, d, 1); d.busy = inc; inc.people.push(d);
      const sw = sidewalkNear(C, d.x, d.y);
      walkPath(C, d, [{ x: d.x, y: d.y }, sw], q => { q.state = 'act'; q.pose = 'argue'; q.until = Infinity; q.bubble = { t: C.R.pick(['!', '?', '#']), ttl: 4 }; q.task = 'Arguing about the crash'; q.lookAt = { x, y }; }, 'Getting out to check the damage');
      d.onRoad = false;
    }
    for (const p of pedsNear(C, x, y, 30)) if (!p.busy && p.state === 'walk' && C.R.chance(0.5)) { p.startle = 1; p.bubble = { t: '!', ttl: 2 }; }
  });
  const d = dispatch(C, inc, 'police', 1, (v, crew) => {
    v.lights.siren = 'police'; v.task = 'Attending a crash'; inc.police = v;
    const e = curEdge(a) || curEdge(b);
    const tgt = e ? { kerb: true, e, s: clamp((a.seg && a.seg.kind === 'lane' ? a.s : 10) - 14, 4, e.len - 14) } : kerbNear(C, x, y);
    driveTo(C, v, tgt, () => {
      if (!inc.active) { standDown(C, v, inc); return; }            // the scene was cleared while we were on the way
      v.lights.siren = null; v.lights.beacon = true; v.lights.haz = true; v.task = 'At the crash scene';
      const o = crew[0]; alight(C, o, 1);
      walkTo(C, o, sidewalkNear(C, x, y), q => {
        if (!inc.active) { standDown(C, v, inc); return; }
        q.state = 'act'; q.pose = 'notes'; q.until = Infinity; q.lookAt = { x, y }; q.task = 'Taking statements at the crash';
        setTimeout0(C, C.R.range(25, 45), () => close());
      }, 'Walking over to the crash');
    });
  }, { near: { x, y } });
  if (!d) setTimeout0(C, 50, () => close());
  setTimeout0(C, 160, () => close());                                // nobody could get here in time: clear it anyway
  const close = () => {
    if (!inc.active) return; inc.active = false;
    for (const car of inc.cars) {
      const dr = inc.people.find(p => p.car === car || p.vehicle === car || p === car.driver) || inc.people[inc.cars.indexOf(car)];
      if (car.damage > 7 || inc.rv > 7) { pushToKerb(C, car); requestTow(C, car, 'scrap'); if (dr) { dr.busy = null; dr.lookAt = null; if (dr.car === car) dr.car = null; dr.bubble = { t: '…', ttl: 3 }; think(C, dr); } }
      else if (dr) {
        walkTo(C, dr, vehicleDoor(C, car), q => {
          q.busy = null; q.lookAt = null; boardVehicle(C, q, car); car.driver = q; car.mode = 'drive'; car.crashInc = null; car.lights.haz = false; car.task = 'Driving on, a little dented';
          if (!car.seg || car.seg.kind !== 'lane') { const ln = nearestLane(C, car.x, car.y); joinLane(C, car, ln.lane, ln.s); }
          if (car.target) headFor(C, car); else parkSomewhere(C, car);
        }, 'Back to the car');
      } else { car.mode = 'drive'; car.lights.haz = false; parkSomewhere(C, car); }
    }
    for (const p of inc.people) if (p.busy === inc && !inc.cars.some(c => c.driver === p)) { if (p.state === 'act') { p.busy = null; p.lookAt = null; think(C, p); } }
    standDownAll(C, inc);
    endIncident(C, inc);
  };
}
// push a wreck out of the traffic lane into the parking lane beside it, ready for the tow truck
function pushToKerb(C, car) {
  const e = curEdge(car) || nearestLane(C, car.x, car.y).lane.edge;
  const s0 = clamp(car.seg && car.seg.kind === 'lane' ? car.s : 9, 9, e.len - 18);
  const clear = s => !e.bays.some(b => b.occ && b.occ !== car && Math.abs(b.s - s) < (b.len + car.len) / 2 + 0.3) && !e.drives.some(d => s > d.s0 - 3 && s < d.s1 + 3) && !e.zebras.some(z => Math.abs(z.s - s) < 6);
  let sk = null; for (let k = 0; k <= 22 && sk === null; k += 2) for (const sg of k ? [1, -1] : [1]) { const ss = s0 + sg * k; if (ss > 8 && ss < e.len - 17 && clear(ss)) { sk = ss; break; } }
  if (sk === null) return false;
  detach(C, car);
  for (const b of e.bays) if (Math.abs(b.s - sk) < (b.len + car.len) / 2 && !b.occ) b.res = car;
  const q = edgePoint(e, sk, e.parkOff);
  car.slide = { x0: car.x, y0: car.y, h0: car.hd, x1: q.x, y1: q.y, h1: Math.atan2(e.dy, e.dx), t: 0, dur: 4 };
  car.kerbE = e; car.kerbS = sk; car.mode = 'crashed'; car.task = 'Pushed to the kerb, waiting for the tow truck';
  return true;
}
function parkSomewhere(C, v) {
  const bay = findBay(C, v.x, v.y, { kinds: ['park'], maxD: 300, seed: v.seed });
  if (!bay) { const r = routeLoop(C, curEdge(v) || C.edges[0]); v.route = r || []; return; }
  driveTo(C, v, { bay }, () => { if (v.driver) { const d = v.driver; v.driver = null; alight(C, d); d.busy = null; think(C, d); } });
}
function requestTow(C, car, dest) {
  const inc = newIncident(C, 'tow', `Tow truck called for a ${car.type === 'car' ? 'car' : car.type}`, car.x, car.y, car);
  inc.car = car; inc.wait = 0; car.towWanted = true; car.task = 'Waiting for the tow truck';
  inc.step = (C, dt) => {
    if (inc.v) return; inc.wait += dt;
    const d = dispatch(C, inc, 'tow', 1, (v, crew) => {
      inc.v = v; inc.focus = v; v.lights.beacon = true; v.task = 'On the way to a tow job';
      const e = car.kerbE || curEdge(car) || nearestLane(C, car.x, car.y).lane.edge;
      const cs = car.kerbE ? car.kerbS : car.seg && car.seg.kind === 'lane' ? car.s : 8;
      const s = clamp(cs + car.len / 2 + v.len / 2 + 2.5, 3, e.len - 4);
      driveTo(C, v, { kerb: true, e, s }, () => {
        v.lights.haz = true; v.task = 'Hooking up the wreck'; const drv = crew[0]; alight(C, drv, 1);
        walkPath(C, drv, [{ x: drv.x, y: drv.y }, rearPoint(v, 0.6)], q => { q.state = 'act'; q.pose = 'crouch'; q.task = 'Hooking up the car'; q.until = Infinity;
          setTimeout0(C, 7, () => { boardVehicle(C, q, v); hook(C, v, car); v.lights.haz = false; v.mode = 'stopped'; v.task = dest === 'scrap' ? 'Towing to the scrapyard' : 'Towing to the pound';
            const bay = findBay(C, C.scrap.door.x, C.scrap.door.y, { kinds: ['lot'], maxD: 400, lotKinds: ['scrap'] }) || v.homeBay;
            setTimeout0(C, 3.2, () => driveTo(C, v, { bay }, () => { unhookAndCrush(C, v, car); setTimeout0(C, 3, () => { if (bay !== v.homeBay) returnToBase(C, v, inc); else releaseCrew(C, v, inc); }); }));
          }); });
        drv.task = 'Walking round to the hook';
      });
    }, { task: 'Tow job' });
    if (!d && inc.wait > 200) { // nobody to tow it: it gets pushed to the kerb and scrapped later
      scrapVehicle(C, car); endIncident(C, inc);
    }
    if (d) inc.v = d.v;
  };
}
function hook(C, tow, car) {
  detach(C, car); freeBay(car);
  for (const b of C.bays) if (b.res === car) b.res = null;
  car.mode = 'towed'; car.towedBy = tow; tow.towing = car; car.lights.haz = true; car.v = 0; car.kerbE = null;
  car.winch = { x0: car.x, y0: car.y, h0: car.hd, t: 0 };       // a short visible winch onto the hitch
}
function unhookAndCrush(C, tow, car) {
  tow.towing = null; car.towedBy = null; car.mode = 'crushing'; car.crushT = 0; car.lights.haz = false;
  const lot = C.scrap.yard; const cx = lot ? (lot.rect.x0 + lot.rect.x1) / 2 : car.x, cy = lot ? (lot.rect.y0 + lot.rect.y1) / 2 : car.y;
  car.x = cx; car.y = cy; C.cue('crush', cx, cy, 1);
  setTimeout0(C, 6, () => scrapVehicle(C, car));
}
function stepTowed(C, v, dt) {
  const t = v.towedBy; if (!t) return;
  const bx = t.x - Math.cos(t.hd) * (t.len / 2 + v.len / 2 + 0.4), by = t.y - Math.sin(t.hd) * (t.len / 2 + v.len / 2 + 0.4);
  if (v.winch) { const w = v.winch; w.t = Math.min(1, w.t + dt / 3); const k = w.t * w.t * (3 - 2 * w.t); v.x = lerp(w.x0, bx, k); v.y = lerp(w.y0, by, k); v.hd = w.h0 + angDiff(w.h0, t.hd) * k; if (w.t >= 1) v.winch = null; return; }
  v.x += (bx - v.x) * Math.min(1, dt * 8); v.y += (by - v.y) * Math.min(1, dt * 8);
  v.hd += angDiff(v.hd, Math.atan2(t.y - v.y, t.x - v.x)) * Math.min(1, dt * 3);
}
export function scrapVehicle(C, v, quiet) {
  detach(C, v); freeBay(v); if (v.target && v.target.bay && v.target.bay.res === v) v.target.bay.res = null;
  for (const p of v.crew.slice()) alight(C, p);
  if (v.owner && v.owner.car === v) v.owner.car = null;
  const i = C.vehicles.indexOf(v); if (i >= 0) C.vehicles.splice(i, 1); C.vById.delete(v.id);
  v.mode = 'gone'; if (quiet) return; C.stats.scrapped++; C.log(`A ${v.type === 'car' ? 'car' : v.type} (${v.plate}) was scrapped`, 'scrap');
}
// §D5 crime ---------------------------------------------------------------------------------
function pickCrook(C, near) {
  const R = C.R, cands = C.people.filter(p => p.role === 'leisure' && p.age === 'adult' && !p.busy && (p.state === 'walk' || p.state === 'act') && Math.hypot(p.x - near.x, p.y - near.y) < 120);
  return cands.length ? R.pick(cands) : null;
}
function startPickpocket(C) {
  const R = C.R;
  const crowd = C.people.filter(p => (p.state === 'act' || p.state === 'wait') && !p.busy && p.age !== 'kid' && pedsNear(C, p.x, p.y, 14).length >= 5);
  if (!crowd.length) return null;
  const victim = R.pick(crowd), thief = pickCrook(C, victim); if (!thief || thief === victim) return null;
  const inc = newIncident(C, 'pickpocket', 'Pickpocket in the crowd', victim.x, victim.y, thief);
  inc.thief = thief; inc.victim = victim; thief.busy = inc; thief.task = 'Sizing up the crowd…'; thief.crook = true;
  thief.spd = thief.spdBase * 1.1;
  walkTo(C, thief, { x: victim.x + 0.6, y: victim.y + 0.3 }, q => {
    if (victim.busy) { q.busy = null; endIncident(C, inc); think(C, q); return; }
    victim.busy = inc; victim.bubble = { t: 'HEY!', ttl: 4 }; victim.pose = 'point'; victim.lookAt = q; victim.task = 'Just had their wallet stolen'; victim.until = Infinity;
    C.cue('shout', victim.x, victim.y, 1); q.carry = 'wallet';
    for (const b of pedsNear(C, victim.x, victim.y, 18)) if (b !== victim && b !== q && !b.busy && (b.state === 'act' || b.state === 'wait')) { b.lookAt = q; b.bubble = { t: '!', ttl: 3 }; b.lookT = 8; }
    // run!
    const far = C.R.pick(C.pn.filter(n => Math.hypot(n.x - q.x, n.y - q.y) > 260 && Math.hypot(n.x - q.x, n.y - q.y) < 420));
    q.spd = 4.3; q.task = 'Running off with a wallet';
    walkPath(C, q, pedRoute(C, { x: q.x, y: q.y }, far || { x: q.x + 200, y: q.y }), r => { // got away
      r.spd = r.spdBase; r.busy = null; r.crook = false; r.carry = null; inc.escaped = true; C.log('The pickpocket got away', 'police'); think(C, r);
    });
    inc.phase = 'flee';
    const d = dispatch(C, inc, 'police', 1, (v, crew) => { inc.v = v; v.lights.siren = 'police'; v.task = 'Responding to a theft'; chaseByCar(v, crew[0]); }, { near: victim });
    if (!d) setTimeout0(C, 30, () => { if (!inc.v) { victim.busy = null; victim.pose = 'stand'; think(C, victim); } });
    setTimeout0(C, 14, () => { if (victim.busy === inc) { victim.busy = null; victim.lookAt = null; victim.pose = 'stand'; think(C, victim); } });
  }, 'Wandering through the crowd');
  inc.focus = thief;
  const chaseByCar = (v, officer) => {
    const tick = () => {
      if (!inc.active || inc.escaped) { if (v.job === inc) { v.lights.siren = null; returnToBase(C, v, inc); } return; }
      const d = Math.hypot(thief.x - v.x, thief.y - v.y);
      if (d < 35) { // stop and chase on foot
        const e = curEdge(v);
        const stopHere = () => { stopInLane(C, v); v.lights.beacon = true; v.lights.siren = null; footChase(v, officer); };
        if (e && v.seg.kind === 'lane') { setGoal(C, v, e, clamp(v.s + 4, 0, e.len - 2), 0, stopHere); } else setTimeout0(C, 1, tick);
        return;
      }
      const tgt = kerbNear(C, thief.x, thief.y, [], 0);
      if (tgt && tgt.e) setGoal(C, v, tgt.e, tgt.s, 6, () => {});
      setTimeout0(C, 2.5, tick);
    };
    const tgt = kerbNear(C, thief.x, thief.y, [], 0);
    driveTo(C, v, tgt, () => {});
    setTimeout0(C, 2.5, tick);
  };
  const footChase = (v, officer) => {
    alight(C, officer, 1); officer.spd = 5.2; officer.task = 'Chasing the pickpocket'; inc.phase = 'chase'; inc.focus = officer;
    C.cue('whistle', officer.x, officer.y, 1);
    let t0 = C.tReal;
    const step = () => {
      if (inc.escaped) { officer.spd = officer.spdBase; walkTo(C, officer, vehicleDoor(C, v), q => { boardVehicle(C, q, v); returnToBase(C, v, inc); }, 'Lost them…'); return; }
      const d = Math.hypot(thief.x - officer.x, thief.y - officer.y);
      if (d < 1.1) { caught(v, officer); return; }
      if (C.tReal - t0 > 120) { inc.escaped = true; step(); return; }
      if (d < 18) walkPath(C, officer, [{ x: officer.x, y: officer.y }, { x: thief.x, y: thief.y }], () => {});
      else walkPath(C, officer, pedRoute(C, { x: officer.x, y: officer.y }, { x: thief.x, y: thief.y }), () => {});
      officer.busy = inc; setTimeout0(C, 0.6, step);
    };
    step();
  };
  const caught = (v, officer) => {
    inc.phase = 'arrest'; C.cue('scuffle', thief.x, thief.y, 1);
    thief.state = 'act'; thief.path = null; thief.pose = 'down'; thief.until = Infinity; thief.next = null; thief.task = 'Caught!'; thief.onRoad = false;
    officer.state = 'act'; officer.pose = 'crouch'; officer.until = Infinity; officer.next = null;
    C.log('The pickpocket has been arrested', 'police');
    setTimeout0(C, 3, () => {
      thief.pose = 'cuffed'; thief.carry = null; officer.pose = 'walk'; officer.spd = officer.spdBase; thief.spd = officer.spdBase * 0.9;
      escortTo(C, officer, thief, v, () => {
        boardVehicle(C, thief, v); boardVehicle(C, officer, v); v.lights.beacon = false; v.task = 'Taking the pickpocket to the station';
        v.mode === 'stopped' && (v.mode = 'drive');
        driveTo(C, v, { bay: v.homeBay }, () => setTimeout0(C, 1.5, () => {
          alight(C, thief, -1); thief.pose = 'cuffed';
          releaseCrew(C, v, inc); jail(C, thief);
        }));
      });
    });
  };
  return inc;
}
function escortTo(C, officer, crook, v, done) {
  crook.escort = officer; crook.state = 'escort';
  walkTo(C, officer, vehicleDoor(C, v, -1), q => { crook.escort = null; crook.state = 'act'; done(); }, 'Escorting the suspect');
}
function jail(C, p) {
  const st = C.police;
  walkTo(C, p, doorPt(st), q => { q.state = 'act'; enterBuilding(C, q, st, 'cell'); q.task = 'In a holding cell'; q.until = C.time + C.R.range(240, 600); q.busy = null; q.crook = false; q.pose = 'stand'; });
}
function startCarjack(C) {
  const R = C.R;
  const cands = C.vehicles.filter(v => v.type === 'car' && v.mode === 'drive' && v.driver && !v.job && v.v < 0.2 && v.seg.kind === 'lane' && v.mv && v.mv.node.kind === 'signal' && sigState(v.mv.node, v.mv.axis) === 'R' && v.seg.length - v.s < 12);
  if (!cands.length) return null;
  const car = R.pick(cands), crook = pickCrook(C, car); if (!crook) return null;
  const inc = newIncident(C, 'carjack', 'Carjacking at the lights!', car.x, car.y, crook);
  crook.busy = inc; crook.crook = true; crook.spd = 3.2; crook.task = 'Up to no good…';
  walkTo(C, crook, vehicleDoor(C, car), q => {
    if (car.mode !== 'drive' && car.mode !== 'stopped' || !car.driver) { q.busy = null; q.crook = false; endIncident(C, inc); think(C, q); return; }
    const victim = car.driver; C.cue('shout', car.x, car.y, 1); C.cue('cardoor', car.x, car.y, 1);
    alight(C, victim, 1); victim.busy = inc; victim.bubble = { t: 'HEY!', ttl: 5 }; victim.pose = 'point'; victim.lookAt = car; victim.task = 'Just had their car stolen'; victim.until = Infinity;
    const sw = sidewalkNear(C, victim.x, victim.y); walkPath(C, victim, [{ x: victim.x, y: victim.y }, sw], r => { r.state = 'act'; r.pose = 'point'; r.until = Infinity; });
    boardVehicle(C, q, car); car.driver = q; car.stolen = true; car.task = 'Stolen! Fleeing the police'; car.v0f = 1.25; car.T = 0.9; car.mode = 'drive';
    car.target = null; car.onArrive = null; if (car.bay) freeBay(car);
    inc.car = car; inc.victim = victim; inc.focus = car; inc.phase = 'flee'; C.log('A car has been stolen — police are in pursuit', 'police');
    const flee = () => { const e = R.pick(C.edges.filter(e => !e.closed && e.len > 50 && Math.hypot(e.ax - car.x, e.ay - car.y) > 300)); if (e) setGoal(C, car, e, e.len * 0.5, 8, flee); };
    flee();
    let units = 0;
    for (let k = 0; k < 2; k++) {
      const d = dispatch(C, inc, 'police', 1, (v) => { units++; v.lights.siren = 'police'; v.task = 'In pursuit of a stolen car'; pursue(v); }, { near: car });
      if (!d && k === 0) setTimeout0(C, 60, () => giveUp());
    }
    inc.t0r = C.tReal; inc.chaseFor = R.range(70, 130);
  }, 'Walking up to a car at the lights');
  const pursue = v => {
    const tick = () => {
      if (!inc.active) return;
      if (inc.phase === 'stopped') { // pull in behind
        const e = curEdge(car); if (e && car.seg && car.seg.kind === 'lane' && curEdge(v) === e && v.s < car.s) { setGoal(C, v, e, Math.max(2, car.s - car.len / 2 - v.len / 2 - 3), 0, () => { stopInLane(C, v); v.lights.beacon = true; v.lights.siren = null; arrest(v); }); return; }
        const tgt = kerbNear(C, car.x, car.y, [], 0); if (tgt) driveTo(C, v, tgt, () => { v.lights.beacon = true; v.lights.siren = null; arrest(v); }); return;
      }
      const e = curEdge(car);
      if (e && car.seg) { const s = car.seg.kind === 'lane' ? Math.min(e.len - 2, car.s + 6) : 6; setGoal(C, v, e, s, 9, () => {}); }
      if (C.tReal - inc.t0r > inc.chaseFor && inc.phase === 'flee') pullOver();
      setTimeout0(C, 1.4, tick);
    };
    depart(C, v, () => tick());
  };
  const pullOver = () => {
    if (inc.phase !== 'flee') return; inc.phase = 'stopping';
    const e = curEdge(car); if (!e || car.mode !== 'drive') { inc.phase = 'stopped'; return; }
    const sNow = car.seg.kind === 'lane' ? car.s : 0;
    if (sNow + 30 < e.len) setGoal(C, car, e, sNow + 25, 0, () => { stopInLane(C, car); inc.phase = 'stopped'; car.task = 'Cornered by the police'; });
    else { const r = car.route[0]; if (r) setGoal(C, car, r, Math.min(r.len - 4, 25), 0, () => { stopInLane(C, car); inc.phase = 'stopped'; }); }
  };
  inc.step = (C, dt) => {
    if (car.mode === 'crashed' && (inc.phase === 'flee' || inc.phase === 'stopping')) { inc.phase = 'stopped'; car.task = 'Crashed while fleeing'; }
  };
  let arrested = false;
  const arrest = v => {
    if (arrested) { // second car just stands by
      const o = v.crew[0]; if (o) { alight(C, o, 1); o.state = 'act'; o.pose = 'look'; o.until = Infinity; o.lookAt = car; setTimeout0(C, 20, () => { walkTo(C, o, vehicleDoor(C, v), q => { boardVehicle(C, q, v); returnToBase(C, v, null); }); }); }
      return;
    }
    arrested = true; inc.phase = 'arrest';
    const crook2 = car.driver; if (crook2) { alight(C, crook2, 1); crook2.pose = 'surrender'; crook2.state = 'act'; crook2.until = Infinity; crook2.bubble = { t: '…', ttl: 3 }; car.driver = null; }
    car.stolen = false; car.v0f = 1; car.T = 1.3; car.lights.haz = true; car.task = 'Recovered — waiting for its owner';
    const o = v.crew[0]; if (!o) { returnToBase(C, v, inc); return; }
    alight(C, o, 1); o.task = 'Arresting the car thief'; inc.focus = o;
    walkTo(C, o, { x: crook2.x, y: crook2.y }, q => {
      crook2.pose = 'cuffed'; C.cue('scuffle', q.x, q.y, 0.6); C.log('The car thief has been arrested', 'police');
      escortTo(C, q, crook2, v, () => {
        boardVehicle(C, crook2, v); boardVehicle(C, q, v); v.lights.beacon = false; v.mode === 'stopped' && (v.mode = 'drive');
        driveTo(C, v, { bay: v.homeBay }, () => setTimeout0(C, 1.5, () => { alight(C, crook2, -1); releaseCrew(C, v, inc); jail(C, crook2); }));
        // the owner comes to collect the car
        const owner = inc.victim; if (owner) { owner.busy = null; owner.bubble = { t: '♥', ttl: 3 };
          travel(C, owner, { pt: vehicleDoor(C, car) }, r => { if (car.mode === 'gone') { think(C, r); return; } boardVehicle(C, r, car); car.driver = r; car.lights.haz = false; car.mode = car.mode === 'crashed' ? 'crashed' : 'stopped';
            if (car.mode === 'crashed') { alight(C, r); requestTow(C, car, 'scrap'); r.car = null; think(C, r); return; }
            depart(C, car, () => { const home = r.home || C.buildings[0]; const bay = findBay(C, home.door.x, home.door.y, { kinds: ['park'], maxD: 200 }); if (bay) driveTo(C, car, { bay }, () => { car.driver = null; alight(C, r); goHome(C, r); }); else parkSomewhere(C, car); });
          }, 'Going to collect the car'); }
      });
    }, 'Making an arrest');
  };
  const giveUp = () => { if (inc.phase === 'flee') { car.stolen = false; car.task = 'Abandoned'; const c = car.driver; if (c) { car.driver = null; alight(C, c); c.busy = null; c.crook = false; think(C, c); } car.mode = 'stopped'; car.lights.haz = true; const ow = inc.victim; if (ow) { ow.busy = null; think(C, ow); } requestTow(C, car, 'scrap'); endIncident(C, inc); } };
  return inc;
}

// §D6 routine services ------------------------------------------------------------------------
function startRoadworks(C) {
  const R = C.R;
  if (!freeVehicle(C, 'ute').length || staffIn(C, C.works, 'roadworker').length < 2) return null;
  const edges = C.edges.filter(e => !e.closed && !e.rev.closed && e.len > 75 && !(e.stops && e.stops.length) && !e.works.length && !e.rev.works.length && !e.zebras.length && !e.drives.length);
  if (!edges.length) return null;
  const e = R.pick(edges), lane = e.lanes[e.nl - 1], s0 = R.range(20, e.len - 42);
  const p0 = edgePoint(e, s0 + 10, lane.off);
  const inc = newIncident(C, 'works', `Roadworks on ${e.name}`, p0.x, p0.y, null);
  inc.e = e; inc.cones = []; inc.phase = 'dispatch';
  const inner = lane.off - LANE_W / 2 + 0.25, kerb = e.nl * LANE_W - 0.2;
  const conePts = [[s0 - 10, kerb], [s0 - 6.5, (kerb + inner) / 2], [s0 - 3, inner]];
  for (let s = s0 + 2; s <= s0 + 26; s += 4) conePts.push([s, inner]);
  const d = dispatch(C, inc, 'ute', 2, (v, crew) => {
    v.lights.beacon = 'amber'; v.task = `Heading to roadworks on ${e.name}`; inc.focus = v;
    driveTo(C, v, { kerb: true, e, s: s0 + 6 }, () => {
      v.lights.haz = true; v.task = 'Parked at the roadworks'; inc.phase = 'setup'; v.doorOpen = true;
      const [a, b] = crew; alight(C, a, 1); alight(C, b, -1); inc.focus = a;
      a.task = 'Setting out cones'; b.task = 'Unloading the jackhammer';
      const put = i => {
        if (i >= conePts.length) { work(v, a, b); return; }
        const [s, off] = conePts[i], q = edgePoint(e, s, off);
        a.onRoad = true;
        walkPath(C, a, [{ x: a.x, y: a.y }, { x: q.x + e.kx * 0.6, y: q.y + e.ky * 0.6 }], w => {
          w.state = 'act'; w.pose = 'crouch'; w.until = Infinity; w.onRoad = true;
          setTimeout0(C, 1.1, () => {
            const cone = { x: q.x, y: q.y, inc: inc.id }; C.props.cones.push(cone); inc.cones.push(cone); C.cue('cone', q.x, q.y, 0.4);
            if (i === 0) { inc.intr = { s0: s0 - 10, s1: s0 + 27, tag: 'works', v: null, seg: lane }; lane.intr.push(inc.intr); e.works.push(inc); }
            put(i + 1);
          });
        });
      };
      put(0);
      b.onRoad = true; walkPath(C, b, [{ x: b.x, y: b.y }, edgePoint(e, s0 + 14, lane.off - 0.3)], w => { w.state = 'act'; w.pose = 'look'; w.until = Infinity; w.onRoad = true; });
    });
  }, { calm: true, task: 'Off to a road job' });
  if (!d) { endIncident(C, inc); return null; }
  const work = (v, a, b) => {
    inc.phase = 'jackhammer'; v.task = 'Roadworks in progress';
    const jp = edgePoint(e, s0 + 14, lane.off - 0.3);
    walkPath(C, b, [{ x: b.x, y: b.y }, jp], w => { w.state = 'act'; w.pose = 'jackhammer'; w.until = Infinity; w.task = 'On the jackhammer'; w.onRoad = true; inc.hammer = w; inc.focus = w; });
    const sp = edgePoint(e, s0 + 18, lane.off + 0.4);
    walkPath(C, a, [{ x: a.x, y: a.y }, sp], w => { w.state = 'act'; w.pose = 'shovel'; w.until = Infinity; w.task = 'Shovelling rubble'; w.onRoad = true; });
    setTimeout0(C, R.range(90, 170), () => tidy(v, a, b));
  };
  const tidy = (v, a, b) => {
    inc.phase = 'tidy'; b.pose = 'look'; inc.hammer = null; b.task = 'Loading up the ute'; a.task = 'Picking up the cones';
    walkPath(C, b, [{ x: b.x, y: b.y }, vehicleDoor(C, v, -1)], w => { boardVehicle(C, w, v); w.onRoad = false; });
    const take = () => {
      const cone = inc.cones.pop();
      if (!cone) { if (inc.intr) { intrDel(lane, inc.intr); inc.intr = null; } e.works.splice(e.works.indexOf(inc), 1);
        walkPath(C, a, [{ x: a.x, y: a.y }, vehicleDoor(C, v, 1)], w => { boardVehicle(C, w, v); w.onRoad = false; v.doorOpen = false; v.lights.haz = false; v.mode = 'stopped'; returnToBase(C, v, inc); }); return; }
      walkPath(C, a, [{ x: a.x, y: a.y }, { x: cone.x + e.kx * 0.6, y: cone.y + e.ky * 0.6 }], w => { w.state = 'act'; w.pose = 'crouch'; w.until = Infinity; setTimeout0(C, 0.9, () => { C.props.cones.splice(C.props.cones.indexOf(cone), 1); take(); }); });
    };
    take();
  };
  return inc;
}
function startDelivery(C) {
  const R = C.R, vans = freeVehicle(C, 'van'); if (!vans.length) return;
  const shops = openShops(C, SHOP_CATS.map(c => c[0])); if (!shops.length) return;
  const stops = R.shuffle(shops.slice()).slice(0, R.int(1, 3));
  const job = { kind: 'delivery' };
  dispatch(C, job, 'van', 1, (v, crew) => {
    const drv = crew[0]; v.task = 'Out on deliveries';
    const go = i => {
      if (i >= stops.length) { returnToBase(C, v, null); return; }
      const shop = stops[i]; v.task = `Delivering to ${shop.label}`;
      const tgt = kerbNear(C, shop.door.x, shop.door.y, ['load', 'park'], 45);
      driveTo(C, v, tgt, () => {
        v.doorOpen = true; if (v.mode === 'stopped') v.lights.haz = true;
        alight(C, drv, 1); drv.carry = 'boxes'; drv.busy = job;
        walkTo(C, drv, doorPt(shop), q => { q.state = 'act'; enterBuilding(C, q, shop, 'visit'); q.task = `Dropping off a delivery at ${shop.label}`; q.until = Infinity;
          setTimeout0(C, R.range(18, 34), () => { leaveBuilding(C, q); q.carry = 'trolley';
            walkTo(C, q, vehicleDoor(C, v), w => { w.carry = null; boardVehicle(C, w, v); v.doorOpen = false; v.lights.haz = false; go(i + 1); }, 'Back to the van'); });
        }, 'Wheeling boxes in');
      });
    };
    go(0);
  }, { calm: true, task: 'Loading the van' });
}
function startGarbage(C) {
  const R = C.R; if (!freeVehicle(C, 'garbage').length) return;
  const bins = R.shuffle(C.props.bins.filter(b => b.kind === 'street' || R.chance(0.5)).slice()).slice(0, 9);
  if (!bins.length) return;
  const job = { kind: 'garbage' };
  dispatch(C, job, 'garbage', 2, (v, crew) => {
    v.lights.beacon = 'amber'; v.task = 'Collecting the rubbish';
    const go = i => {
      if (i >= bins.length) { v.lights.beacon = false; returnToBase(C, v, null); return; }
      const bin = bins[i], tgt = kerbNear(C, bin.x, bin.y, [], 0);
      if (!tgt) { go(i + 1); return; }
      driveTo(C, v, tgt, () => {
        const w = crew[i % crew.length]; alight(C, w, -1);
        walkPath(C, w, [{ x: w.x, y: w.y }, { x: bin.x, y: bin.y + 0.5 }], q => { q.state = 'act'; q.pose = 'lift'; q.until = Infinity; C.cue('bin', bin.x, bin.y, 0.7); bin.lift = 1;
          setTimeout0(C, 3.2, () => { bin.lift = 0; walkPath(C, q, [{ x: q.x, y: q.y }, rearPoint(v, 0.6)], r => { boardVehicle(C, r, v); C.cue('compactor', v.x, v.y, 0.6); setTimeout0(C, 1.2, () => { v.mode = 'stopped'; go(i + 1); }); }); });
        });
      });
    };
    go(0);
  }, { calm: true, task: 'Starting the rubbish round' });
}
const busHours = C => C.hour >= 5.4 && C.hour < 23.6;
function busRun(C, bus) {
  const r = bus.busRoute; bus.job = { kind: 'bus' };
  const next = () => {
    if (!busHours(C)) { bus.task = 'Returning to the depot'; bus.doorOpen = false; driveTo(C, bus, { bay: bus.homeBay }, () => { bus.task = 'In the depot overnight'; bus.job = null; for (const p of bus.crew.slice()) { alight(C, p, -1); const f = p.afterBus; p.afterBus = null; f ? f() : think(C, p); } }); return; }
    const st = r.stops[bus.si % r.stops.length]; bus.si++;
    bus.task = `${r.name} · next stop ${st.e.name}`; bus.nextStop = st;
    const tgt = st.bay && !st.bay.occ && (!st.bay.res || st.bay.res === bus) ? { bay: st.bay } : { kerb: true, e: st.e, s: st.s };
    driveTo(C, bus, tgt, () => dwell(st));
  };
  const dwell = st => {
    bus.doorOpen = true; bus.task = `${r.name} · at ${st.e.name}`; C.cue('busdoor', bus.x, bus.y, 0.6);
    const off = bus.crew.filter(p => p.alightAt === st || (p.alightAt && !r.stops.includes(p.alightAt)));
    off.forEach((p, i) => setTimeout0(C, 0.9 * (i + 1), () => { if (p.vehicle !== bus) return; alight(C, p, -1, -bus.len * 0.3); p.alightAt = null; const f = p.afterBus; p.afterBus = null; f ? f() : think(C, p); }));
    const on = st.waiting.filter(p => p.busRoute === r && p.state === 'wait');
    let boarded = 0;
    for (const p of on) {
      st.waiting.splice(st.waiting.indexOf(p), 1); p.waitStop = null; p.state = 'walk';
      walkPath(C, p, [{ x: p.x, y: p.y }, vehicleDoor(C, bus, -1)], q => { boardVehicle(C, q, bus); boarded++; q.task = `Riding the ${r.name} bus`; });
    }
    const t0 = C.tReal;
    const wait = () => { if ((boarded >= on.length && C.tReal - t0 > 4 + off.length) || C.tReal - t0 > 22) { bus.doorOpen = false; C.cue('busdoor', bus.x, bus.y, 0.5); setTimeout0(C, 1, next); } else setTimeout0(C, 0.5, wait); };
    wait();
  };
  next();
}
function taxiRoam(C, t) {
  if (t.job) return;
  const R = C.R;
  if (R.chance(0.2)) { const bay = findBay(C, t.x, t.y, { kinds: ['taxi'], maxD: 500 }); if (bay) { t.task = 'Waiting for a fare'; driveTo(C, t, { bay }, () => setTimeout0(C, R.range(20, 60), () => taxiRoam(C, t))); return; } }
  const e = R.pick(C.edges.filter(e => !e.closed)); t.task = 'Cruising for a fare';
  depart(C, t, () => setGoal(C, t, e, e.len * R.range(0.3, 0.7), 5, () => taxiRoam(C, t)));
}
function taxiTrip(C, p, taxi, dest, to, finish) {
  const pick = kerbNear(C, ...Object.values(here(p)), [], 0); if (!pick) { walkTo(C, p, to, finish); return; }
  taxi.job = { kind: 'taxi', p }; taxi.task = `Picking up ${p.first}`;
  const spot = edgePoint(pick.e, pick.s, pick.e.kerbOff + 0.7);
  walkTo(C, p, spot, q => {
    q.state = 'act'; q.pose = 'wave'; q.until = Infinity; q.task = 'Hailing a taxi';
    driveTo(C, taxi, pick, () => {
      walkPath(C, q, [{ x: q.x, y: q.y }, vehicleDoor(C, taxi, -1)], r => {
        boardVehicle(C, r, taxi); taxi.task = `Taking ${r.first} ${dest.bld ? 'to ' + dest.bld.label : 'across town'}`;
        const drop = kerbNear(C, to.x, to.y, [], 0) || pick;
        driveTo(C, taxi, drop, () => setTimeout0(C, 1.5, () => { alight(C, r, -1); taxi.job = null; taxi.lights.haz = false; walkTo(C, r, to, finish); setTimeout0(C, 2, () => taxiRoam(C, taxi)); }));
      });
    });
  }, 'Looking for a taxi');
}
function startPatrol(C) {
  const job = { kind: 'patrol' };
  dispatch(C, job, 'police', 1, v => {
    const R = C.R; let n = R.int(2, 4); v.task = 'On patrol'; for (const p of v.crew) p.task = 'On patrol';
    const go = () => { if (n-- <= 0 || v.job !== job) { returnToBase(C, v, null); return; } const e = R.pick(C.edges.filter(e => !e.closed && e.len > 50)); setGoal(C, v, e, e.len / 2, 7, go); };
    depart(C, v, go);
  }, { calm: true, task: 'Heading out on patrol' });
}
// §D7 scheduled events ----------------------------------------------------------------------
function genDaySchedule(C, day) {
  const R = C.R, dow = dowOf(C, day), base = day * 1440, adults = () => C.people.filter(p => (p.age !== 'kid' || R.chance(0.4)) && !['police', 'medic', 'firefighter', 'nurse', 'vendor', 'hotdog', 'newsie', 'busker', 'tow', 'driver', 'garbo', 'roadworker'].includes(p.role) && !p.commit && p.home);
  C.wind = R.range(0.15, 0.95);
  const sched = [];
  if ((dow === 2 || dow === 5) && C.stadium) { const K = base + (dow === 2 ? 19.5 : 15) * 60; sched.push({ kind: 'stadium', at: K - 200, K, end: K + 115, title: dow === 2 ? 'Night match at the stadium' : 'Saturday match at the stadium' }); }
  if ((dow === 4 || dow === 5) && C.concert) { const K = base + 20 * 60; sched.push({ kind: 'concert', at: K - 150, K, doors: K - 30, end: K + 140, title: `Concert at ${C.concert.label}` }); }
  if (dow < 5 && R.chance(0.4) && C.spots.stage) { const K = base + R.range(11.8, 12.6) * 60; sched.push({ kind: 'rally', at: K - 60, K, end: K + 90, title: 'Rally in the park' }); }
  if (dow === 6) { const K = base + 7 * 60; sched.push({ kind: 'marathon', at: K - 50, K, end: K + 190, title: 'City marathon' }); }
  for (const ev of sched) if (ev.end > C.time + 30) atGameTime(C, Math.max(ev.at, C.time), () => startEvent(C, ev, adults));
  C.today = sched;
}
function startEvent(C, ev, pool) {
  const R = C.R;
  ev.active = true;
  const inc = newIncident(C, ev.kind, ev.title, 0, 0, null); ev.inc = inc;
  const pick = n => R.shuffle(pool()).slice(0, n);
  if (ev.kind === 'stadium') {
    const st = C.stadium; inc.x = st.door.x; inc.y = st.door.y; inc.focus = st;
    for (const p of pick(150)) p.commit = { go: ev.K - R.range(25, 95), end: ev.end, fn: (C, q) => travel(C, q, { bld: st, kind: 'event' }, r => { r.task = 'Watching the match'; r.until = ev.end + R.range(0, 12); }, 'Heading to the match') };
    atGameTime(C, ev.K, () => { C.events.stadium.live = true; C.cue('whistle', st.door.x, st.door.y, 1); C.log('Kick-off at the stadium!', 'stadium'); });
    atGameTime(C, ev.end - 5, () => { C.events.stadium.live = false; C.cue('roar', st.door.x, st.door.y, 1); });
    atGameTime(C, ev.end + 30, () => endIncident(C, inc));
  }
  if (ev.kind === 'concert') {
    const hall = C.concert, b = hall.block; inc.x = hall.door.x; inc.y = hall.door.y; inc.focus = hall;
    const Q = C.events.concert; Q.queue = []; Q.doors = false; Q.ev = ev;
    const ry = hall.facing === 'S' ? b.ring.y1 : b.ring.y0;
    Q.slot = k => ({ x: Math.min(b.ring.x1, hall.door.x + 1.5 + k * 0.72) - (hall.door.x + 1.5 + k * 0.72 > b.ring.x1 ? 0 : 0), y: ry + (hall.door.x + 1.5 + k * 0.72 > b.ring.x1 ? (hall.facing === 'S' ? -1 : 1) * (hall.door.x + 1.5 + k * 0.72 - b.ring.x1) : 0) });
    for (const p of pick(70)) p.commit = { go: ev.K - R.range(75, 120), end: ev.end, fn: (C, q) => walkTo(C, q, Q.slot(Q.queue.length + 2), r => { r.state = 'wait'; r.pose = 'stand'; r.task = 'Queueing for the concert'; r.until = Infinity; r.inQueue = Q; Q.queue.push(r); }, 'Off to the concert') };
    atGameTime(C, ev.doors, () => { Q.doors = true; C.log('Doors are open at the concert hall', 'concert'); });
    atGameTime(C, ev.K, () => { C.events.concert.live = true; });
    atGameTime(C, ev.end, () => { C.events.concert.live = false; Q.doors = false; C.cue('applause', hall.door.x, hall.door.y, 1); for (const p of Q.queue) { p.inQueue = null; p.state = 'act'; p.until = 0; } Q.queue = []; });
    atGameTime(C, ev.end + 20, () => endIncident(C, inc));
  }
  if (ev.kind === 'rally') {
    const s = C.spots.stage; inc.x = s.x; inc.y = s.y;
    const ppl = pick(40); let first = true;
    for (const p of ppl) {
      const speaker = first; first = false;
      p.commit = { go: ev.K - R.range(5, 35), end: ev.end, fn: (C, q) => {
        const a = R.range(0, 6.28), r = speaker ? 0 : R.range(5, 13);
        q.carry = speaker ? null : (R.chance(0.7) ? 'placard' : null);
        standAt(C, q, { x: s.x + Math.cos(a) * r, y: s.y + Math.sin(a) * r * 0.7 + (speaker ? 0 : 3) }, Math.max(5, ev.end - C.time), speaker ? 'speech' : 'cheer', speaker ? 'Giving a speech at the rally' : 'At the rally', w => { w.carry = null; think(C, w); }, 'Off to the rally');
        if (speaker) inc.focus = q;
      } };
    }
    atGameTime(C, ev.K, () => { C.events.rally.live = true; const j = { kind: 'standby' }; dispatch(C, j, 'police', 1, v => { v.task = 'Keeping an eye on the rally'; const t = kerbNear(C, s.x, s.y, ['park'], 120); driveTo(C, v, t, () => { const o = v.crew[0]; alight(C, o, 1); standAt(C, o, sidewalkNear(C, s.x, s.y), Math.max(5, ev.end - C.time), 'look', 'Watching the rally', q => walkTo(C, q, vehicleDoor(C, v), w => { boardVehicle(C, w, v); returnToBase(C, v, null); })); }); }, { calm: true }); });
    atGameTime(C, ev.end, () => { C.events.rally.live = false; });
    atGameTime(C, ev.end + 5, () => endIncident(C, inc));
  }
  if (ev.kind === 'marathon') {
    const W = [[2, 1], [5, 1], [5, 3], [2, 3]].map(([i, j]) => C.nodeAt(i, j));
    let route = [], cur = W[0].outE.find(e => e.to === C.nodeAt(3, 1)) || W[0].outE[0]; route.push(cur);
    for (const nd of [W[1], W[2], W[3], W[0]]) { const leg = routeToNode(C, cur, nd); if (leg) { route.push(...leg); cur = route[route.length - 1]; } }
    const M = C.events.marathon; M.route = route; M.runners = [];
    const start = edgePoint(route[0], 4, LANE_W * 0.5); inc.x = start.x; inc.y = start.y; M.start = start;
    const pts = []; for (const e of route) { pts.push(edgePoint(e, 0, LANE_W * 0.6), edgePoint(e, e.len, LANE_W * 0.6)); }
    M.lap = pts;
    atGameTime(C, ev.K - 30, () => { for (const e of route) { e.closed = true; e.rev.closed = true; } M.closed = true; C.log('Roads are closed for the marathon', 'marathon'); });
    for (const p of pick(55)) p.commit = { go: ev.K - R.range(10, 28), end: ev.end, fn: (C, q) => {
      const sw = sidewalkNear(C, start.x + R.range(-4, 4), start.y);
      standAt(C, q, sw, Math.max(1, ev.K - C.time), 'stretch', 'Warming up for the marathon', r => {
        r.carry = 'bib'; r.spd = R.range(2.6, 4.3); r.onRoad = true; const laps = r.spd > 3.4 ? 3 : 2;
        const path = [{ x: r.x, y: r.y }]; for (let k = 0; k < laps; k++) path.push(...M.lap.map(p => ({ x: p.x + R.range(-0.8, 0.8), y: p.y + R.range(-0.8, 0.8), jay: false })));
        path.push(edgePoint(route[0], 6, LANE_W * 0.6)); M.runners.push(r);
        walkPath(C, r, path, w => { w.onRoad = false; w.carry = null; w.spd = w.spdBase; w.commit = null; w.bubble = { t: '★', ttl: 4 }; M.finished = (M.finished || 0) + 1; C.cue('cheer', w.x, w.y, 0.6); M.runners.splice(M.runners.indexOf(w), 1); standAt(C, w, sidewalkNear(C, w.x, w.y), 6, 'look', 'Catching their breath after the marathon'); }, 'Running the marathon');
        r.onRoad = true; inc.focus = inc.focus || r;
      }, 'Heading to the marathon start');
    } };
    for (const p of pick(36)) p.commit = { go: ev.K - R.range(-20, 20), end: ev.end, fn: (C, q) => { const e = R.pick(route), s = R.range(8, e.len - 8), pt = edgePoint(e, s, e.kerbOff + 1.2); standAt(C, q, pt, Math.max(5, ev.end - C.time), 'cheer', 'Cheering on the runners', null, 'Going to watch the marathon'); } };
    atGameTime(C, ev.K, () => { M.live = true; C.cue('horn', start.x, start.y, 1, 'start'); C.log('And they’re off — the marathon has started!', 'marathon'); });
    atGameTime(C, ev.end, () => { for (const e of route) { e.closed = false; e.rev.closed = false; } M.closed = false; M.live = false; C.log('Marathon roads have reopened', 'marathon'); endIncident(C, inc); });
  }
}
function stepEvents(C, dt) {
  const E = C.events, R = C.R;
  // vendors present?
  const hdV = C.people.find(p => p.role === 'hotdog' && p.state === 'act' && p.pose === 'vend');
  E.hotdog.open = !!hdV;
  if (E.hotdog.open) {
    E.hotdog.t -= dt;
    if (E.hotdog.queue.length && E.hotdog.t <= 0) { const q = E.hotdog.queue.shift(); E.hotdog.t = R.range(6, 11); if (q && q.afterQueue) { const f = q.afterQueue; q.afterQueue = null; q.state = 'act'; f(); } C.cue('sizzle', C.spots.hotdog.x, C.spots.hotdog.y, 0.5); }
  } else if (E.hotdog.queue.length) { for (const q of E.hotdog.queue.splice(0)) { q.afterQueue = null; q.state = 'act'; think(C, q); } }
  E.hotdog.queue.forEach((q, k) => queueShuffle(C, q, { x: C.spots.hotdog.x + 1.8 + k * 0.75, y: C.spots.hotdog.y + 0.4 }, dt));
  E.news.open = C.people.some(p => p.role === 'newsie' && p.state === 'act' && p.pose === 'vend');
  E.busker.open = C.people.some(p => p.role === 'busker' && p.state === 'act' && p.pose === 'busk');
  // market stalls follow their vendors
  let any = false;
  for (const st of C.props.stalls) { const here = st.vendor && st.vendor.state === 'act' && st.vendor.pose === 'vend'; st.open = clamp(st.open + (here ? dt / 25 : -dt / 25), 0, 1); if (st.open > 0.9) any = true; }
  E.market.active = [5, 6].includes(C.dow) && C.hour > 6 && C.hour < 15; E.market.open = any;
  // concert queue
  const Q = E.concert;
  if (Q.queue && Q.queue.length) {
    Q.queue.forEach((q, k) => queueShuffle(C, q, Q.slot(k), dt));
    if (Q.doors) { Q.t = (Q.t || 0) - dt; if (Q.t <= 0) { Q.t = 0.9; const q = Q.queue.shift(); if (q) { q.inQueue = null; q.state = 'act'; enterBuilding(C, q, C.concert, 'event'); q.task = 'Enjoying the concert'; q.until = Q.ev.end + R.range(0, 8); } } }
  }
  if (C.wind !== undefined) C.windNow = clamp(C.wind + Math.sin(C.tReal * 0.05) * 0.15, 0, 1);
}
function queueShuffle(C, q, slot, dt) {
  const dx = slot.x - q.x, dy = slot.y - q.y, d = Math.hypot(dx, dy);
  if (d > 0.15) { const st = Math.min(d, 0.9 * dt); q.x += dx / d * st; q.y += dy / d * st; q.bx = q.x; q.by = q.y; q.pose = d > 0.3 ? 'walk' : 'stand'; q.hd = Math.atan2(dy, dx); q.phase += dt * 5; } else { q.pose = 'stand'; q.hd = Math.PI; }
}
// equilibrium: dealers sell cars when the city is short of them, old cars get scrapped
function stepEconomy(C) {
  const R = C.R, priv = C.vehicles.filter(v => v.type === 'car' && !v.forSale && !v.visitor && v.mode !== 'gone').length;
  const dealerStock = C.vehicles.filter(v => v.forSale);
  if (C.dealer && C.dealer.yard && dealerStock.length < 4 && (C.hour < 6 || !inView(C, C.dealer.door.x, C.dealer.door.y))) {
    const bay = C.dealer.yard.bays.find(b => !b.occ && !b.res);
    if (bay) { const v = makeVehicle(C, 'car', { color: R.pick(CAR_COLOURS) }); v.forSale = true; v.age = 0; v.task = 'For sale'; parkAt(C, v, bay); }
  }
  if (priv < C.carTarget - 2 && dealerStock.length && C.hour > 9 && C.hour < 17.5 && !C.saleBusy) {
    const buyer = R.pick(C.people.filter(p => !p.car && !p.busy && p.age === 'adult' && p.state === 'in' && !p.asleep && p.role !== 'guest' && p.home));
    if (buyer) {
      C.saleBusy = true; buyer.busy = { kind: 'buying' };
      travel(C, buyer, { bld: C.dealer, kind: 'visit' }, q => {
        q.task = 'Signing the papers for a new car';
        setTimeout0(C, R.range(30, 60), () => {
          const car = C.vehicles.find(v => v.forSale && v.mode === 'parked');
          C.saleBusy = false;
          if (!car) { q.busy = null; think(C, q); return; }
          car.forSale = false; car.owner = q; q.car = car; car.task = `${q.first}'s brand new car`; C.stats.sold++; C.log(`${q.name} bought a new car`, 'sale'); C.cue('chime', C.dealer.door.x, C.dealer.door.y, 0.6);
          leaveBuilding(C, q); walkTo(C, q, vehicleDoor(C, car), r => {
            boardVehicle(C, r, car); car.driver = r;
            const home = r.home, bay = findBay(C, home.door.x, home.door.y, { kinds: ['park'], maxD: 200, seed: r.seed }) || findBay(C, home.door.x, home.door.y, { kinds: ['lot'], maxD: 400 });
            if (!bay) { alight(C, r); r.busy = null; goHome(C, r); return; }
            driveTo(C, car, { bay }, () => { car.driver = null; alight(C, r); r.busy = null; goHome(C, r); });
          }, 'Collecting the new car');
        });
      }, 'Going to buy a car');
    }
  }
  if (!C.scrapBusy && (priv > C.carTarget + 2 || R.chance(0.08))) {
    const old = C.vehicles.filter(v => v.type === 'car' && !v.forSale && v.mode === 'parked' && v.owner && !v.owner.busy && v.owner.state === 'in' && !v.owner.asleep && (v.age > 16 || priv > C.carTarget + 2)).sort((a, b) => b.age - a.age)[0];
    if (old && C.scrap && C.scrap.yard && C.hour > 8 && C.hour < 17) {
      const o = old.owner, bay = findBay(C, C.scrap.door.x, C.scrap.door.y, { kinds: ['lot'], lotKinds: ['scrap'], maxD: 400 });
      if (bay) {
        C.scrapBusy = true; o.busy = { kind: 'scrapping' }; old.job = { kind: 'scrap' };
        walkTo(C, o, vehicleDoor(C, old), q => {
          boardVehicle(C, q, old); old.driver = q; old.task = 'On its last drive, to the scrapyard';
          driveTo(C, old, { bay }, () => { old.driver = null; alight(C, q); q.car = null; q.busy = null; C.scrapBusy = false; unhookAndCrush(C, { towing: old }, old); goHome(C, q); });
        }, 'Taking the old car to the scrapyard');
      }
    }
  }
}
export function inView(C, x, y) { const v = C.view; return v && x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1; }
// §D8 the wanderer: one of a kind, turns up everywhere -----------------------------------------
function wandererThink(C, p) {
  const R = C.R, h = C.hour, E = C.events;
  if (h >= 23.3 || h < 6.6) { goHome(C, p, 'sleep'); return; }
  const L = [];
  const add = (w, f) => { if (w > 0) L.push([f, w]); };
  add(2, () => fishWatch(C, p)); add(2, () => pigeonFeed(C, p)); add(2, () => cafeVisit(C, p)); add(1.5, () => shopVisit(C, p)); add(1.5, () => benchSit(C, p, R.range(8, 20), 'Sketching the city from a bench'));
  add(C.windNow > 0.4 ? 3 : 0, () => flyKite(C, p)); add(E.market.open ? 5 : 0, () => marketVisit(C, p)); add(E.hotdog.open ? 3 : 0, () => hotdogRun(C, p, () => think(C, p)));
  add(E.busker.open ? 3 : 0, () => listenBusker(C, p)); add(2, () => mallVisit(C, p)); add(1, () => barVisit(C, p)); add(1.5, () => visitFriend(C, p));
  add(C.stadium && C.events.stadium.live ? 6 : 0, () => travel(C, p, { bld: C.stadium, kind: 'event' }, q => { q.task = 'Cheering at the match'; stay(C, q, R.range(25, 60)); }, 'Sneaking into the match'));
  add(E.rally.live ? 6 : 0, () => { const s = C.spots.stage; p.carry = 'placard'; standAt(C, p, { x: s.x + R.range(-9, 9), y: s.y + R.range(3, 9) }, R.range(15, 30), 'cheer', 'Joining the rally', q => { q.carry = null; think(C, q); }); });
  add(E.marathon.live ? 6 : 0, () => { const e = R.pick(E.marathon.route), pt = edgePoint(e, R.range(8, e.len - 8), e.kerbOff + 1.2); standAt(C, p, pt, R.range(15, 40), 'cheer', 'Cheering at the marathon'); });
  add(E.concert.queue && E.concert.queue.length && !E.concert.doors ? 6 : 0, () => walkTo(C, p, E.concert.slot(E.concert.queue.length + 2), q => { q.state = 'wait'; q.inQueue = E.concert; q.until = Infinity; q.task = 'In the concert queue'; E.concert.queue.push(q); }, 'Off to the concert'));
  const fire = C.incidents.find(i => i.kind === 'fire');
  add(fire ? 3 : 0, () => standAt(C, p, sidewalkNear(C, fire.bl.door.x + R.range(-10, 10), fire.bl.door.y + (fire.bl.facing === 'S' ? 20 : -20)), R.range(10, 20), 'look', 'Watching the firefighters'));
  add(2.5, () => { // ride a bus somewhere just for the view
    const dests = C.stops.filter(s => s.spot); const st = R.pick(dests); if (!st) return benchSit(C, p, 10);
    travel(C, p, { pt: st.spot }, q => think(C, q), 'Riding the bus around town');
  });
  add(1.5, () => { const t = C.vehicles.find(v => v.type === 'taxi' && !v.job && v.mode === 'drive'); const b = R.pick(C.buildings.filter(b => b.cat)); if (!t || !b) return cafeVisit(C, p); taxiTrip(C, p, t, { bld: b }, doorPt(b), q => { enterBuilding(C, q, b, 'visit'); q.task = `Popping into ${b.label}`; stay(C, q, R.range(10, 25)); }); });
  R.weighted(L)();
}
// §D9 Claude: a friendly, unique resident -------------------------------------------------------
function claudeThink(C, p) {
  const R = C.R, h = C.hour, wk = C.dow < 5;
  p.asleep = false;
  const dc = C.datacentre;
  if (h >= 23.4 || h < 6.5) {
    if (dc) { if (p.bld === dc) { p.task = 'Resting among the servers'; p.until = nextWake(C, p); return; } travel(C, p, { bld: dc, kind: 'server' }, q => { q.task = 'Resting among the servers'; q.until = nextWake(C, q); }, 'Heading back to the data centre'); return; }
    goHome(C, p, 'sleep'); return;
  }
  const go = (bl, kind, task, min, walkTask) => { if (!bl) return false; travel(C, p, { bld: bl, kind }, q => { q.task = task; stay(C, q, min); }, walkTask); return true; };
  // a chance meeting with the wanderer
  const fen = C.people.find(q => q.special === 'wanderer');
  if (fen && (fen.state === 'act' || fen.state === 'wait') && !fen.busy && R.chance(0.25) && Math.hypot(fen.x - here(p).x, fen.y - here(p).y) < 450) {
    walkTo(C, p, { x: fen.x + 0.9, y: fen.y + 0.2 }, q => { q.state = 'act'; q.pose = 'wave'; q.until = C.time + 6; q.bubble = { t: '♥', ttl: 4 }; q.task = `Catching up with ${fen.first}`; q.lookAt = fen; if (fen.state !== 'walk') { fen.bubble = { t: '♥', ttl: 4 }; fen.lookAt = q; } C.log(`${q.first} bumped into ${fen.name}!`, 'claude'); }, `Going to say hello to ${fen.first}`);
    return;
  }
  if (wk && h >= 8.3 && h < 11 && go(C.university, 'lecture', R.pick(['Teaching a seminar on kindness and calculus', 'Giving a lecture on how cities breathe', 'Running office hours at the university']), (11 - h) * 60, 'Walking to the university')) return;
  if (wk && h >= 11 && h < 12.4 && go(C.lab, 'lab', R.pick(['Running an experiment in the science lab', 'Carefully measuring something in the lab', 'Peering into a microscope']), (12.4 - h) * 60, 'Popping over to the science lab')) return;
  if (h >= 12.4 && h < 13.3) { if (C.events.hotdog.open && R.chance(0.5)) { hotdogRun(C, p, () => think(C, p)); return; } cafeVisit(C, p); return; }
  if (wk && h >= 13.3 && h < 15 && go(C.commerce, 'trading', 'Helping the traders read the numbers', (15 - h) * 60, 'Heading to the commerce house')) return;
  if (h >= 17 && h < 17.6 && C.substation && R.chance(0.6)) { const s = C.substation; standAt(C, p, { x: s.door.x, y: s.facing === 'S' ? s.block.ring.y1 : s.block.ring.y0 }, R.range(4, 8), 'look', 'Listening to the substation hum'); return; }
  const lost = C.people.filter(q => q !== p && !q.busy && q.state === 'act' && !q.special && Math.hypot(q.x - here(p).x, q.y - here(p).y) < 300);
  if (lost.length && R.chance(0.45)) {
    const q = R.pick(lost); q.bubble = { t: '?', ttl: 8 };
    walkTo(C, p, { x: q.x + 0.9, y: q.y }, w => { w.state = 'act'; w.pose = 'point'; w.until = C.time + R.range(3, 6); w.task = `Helping ${q.first} find their way`; w.bubble = { t: '✦', ttl: 3 }; w.lookAt = q; q.bubble = { t: '!', ttl: 2.5 }; q.lookAt = w; C.stats.helped++; }, `Going to help ${q.first}`);
    return;
  }
  const L = [[() => fishWatch(C, p), 2], [() => go(dc, 'server', 'Checking in on the servers', R.range(20, 40), 'Off to the data centre') || benchSit(C, p, 15), 1.5], [() => benchSit(C, p, R.range(10, 25), 'Reading a very long book on a bench'), 1.5],
    [() => C.events.market.open ? marketVisit(C, p) : shopVisit(C, p), 1.5], [() => pigeonFeed(C, p), 1], [() => go(C.university, 'lecture', 'Sitting in on a lecture', R.range(30, 60)) || cafeVisit(C, p), wk ? 1 : 0.2],
    [() => C.events.busker.open ? listenBusker(C, p) : cafeVisit(C, p), 1], [() => C.events.concert.queue && C.events.concert.queue.length && !C.events.concert.doors ? walkTo(C, p, C.events.concert.slot(C.events.concert.queue.length + 2), q => { q.state = 'wait'; q.inQueue = C.events.concert; q.until = Infinity; q.task = 'Queueing for the concert'; C.events.concert.queue.push(q); }) : cafeVisit(C, p), C.events.concert.queue && C.events.concert.queue.length ? 3 : 0]];
  R.weighted(L.filter(l => l[1] > 0))();
}
function makeSpecials(C) {
  const R = C.R;
  const hotelUnit = C.hotel && C.hotel.units.find(u => !u.residents.length) || (C.hotel && C.hotel.units[0]);
  const f = makePerson(C, { age: 'adult', role: 'special' });
  Object.assign(f, { first: 'Fennel', last: 'Vane', name: 'Fennel Vane', special: 'wanderer', top: '#2f8f8a', bottom: '#3a3550', hat: '#e07b28', hair: '#6a4428', skin: '#e2b48f', dog: null, distracted: false, spdBase: 1.25, wakeAt: 6.7, sleepAt: 23.3 });
  if (hotelUnit) { f.home = C.hotel; f.unit = hotelUnit; hotelUnit.residents.push(f); }
  const c = makePerson(C, { age: 'adult', role: 'special' });
  Object.assign(c, { first: 'Claude', last: '', name: 'Claude', special: 'claude', top: '#d97757', bottom: '#3d3929', hat: null, hair: '#3b2618', skin: '#f1d3b6', dog: null, distracted: false, spdBase: 1.3, wakeAt: 6.5, sleepAt: 23.4 });
  if (C.datacentre) { c.home = C.datacentre; const r = C.datacentre.rooms.find(r => r.kind === 'server'); if (r) { c.unit = { id: -1, rooms: [r.id], residents: [c] }; } }
  C.fennel = f; C.claude = c;
  void R;
}
// §E1 critters ------------------------------------------------------------------------------
function stepCritters(C, dt) {
  const R = C.R;
  for (const f of C.fish) {
    f.t += dt;
    if (R.chance(dt * 0.4)) { f.th = f.h + R.range(-1.4, 1.4); f.tv = R.range(0.15, 0.7); }
    if (f.th !== undefined) f.h += angDiff(f.h, f.th) * Math.min(1, dt * 1.6);
    const pool = f.pool, dx = f.x - pool.x, dy = f.y - pool.y, r = Math.hypot(dx, dy);
    if (r > pool.r * 0.82) { f.th = Math.atan2(-dy, -dx) + R.range(-0.5, 0.5); }
    f.v += (f.tv - f.v) * Math.min(1, dt); f.x += Math.cos(f.h) * f.v * dt; f.y += Math.sin(f.h) * f.v * dt;
    if (R.chance(dt * 0.004)) { f.jump = 1; C.cue('splash', f.x, f.y, 0.4); }
    if (f.jump > 0) f.jump = Math.max(0, f.jump - dt * 1.5);
  }
  for (const d of C.ducks) {
    if (R.chance(dt * 0.25)) d.th = d.h + R.range(-1.6, 1.6);
    if (d.th !== undefined) d.h += angDiff(d.h, d.th) * Math.min(1, dt);
    const pd = d.pool, ex = (d.x - pd.x) / pd.rx, ey = (d.y - pd.y) / pd.ry;
    if (ex * ex + ey * ey > 0.6) d.th = Math.atan2(pd.y - d.y, pd.x - d.x);
    d.x += Math.cos(d.h) * 0.25 * dt; d.y += Math.sin(d.h) * 0.25 * dt; d.t += dt;
    if (R.chance(dt * 0.01)) C.cue('quack', d.x, d.y, 0.4);
  }
  for (const b of C.birds) {
    b.t -= dt;
    if (b.state === 'ground') {
      const scare = pedsNear(C, b.x, b.y, 2.2).some(p => p.state === 'walk' && p.pose !== 'feed');
      if (scare) { b.state = 'fly'; b.t = R.range(3, 7); const a = R.range(0, 6.28); b.vx = Math.cos(a) * 5; b.vy = Math.sin(a) * 5; b.vz = 3; C.cue('flutter', b.x, b.y, 0.5); continue; }
      const feeder = pedsNear(C, b.x, b.y, 7).find(p => p.pose === 'feed');
      if (b.t < 0) { b.t = R.range(0.6, 2.5); const tx = feeder ? feeder.x : b.home.x, ty = feeder ? feeder.y + 1 : b.home.y; b.tx = tx + R.range(-3, 3); b.ty = ty + R.range(-2, 2); }
      if (b.tx !== undefined) { const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy); if (d > 0.1) { b.x += dx / d * 0.6 * dt; b.y += dy / d * 0.6 * dt; b.h = Math.atan2(dy, dx); } }
      b.peck = (Math.sin(C.tReal * 6 + b.x) > 0.6) ? 1 : 0;
    } else {
      b.z += b.vz * dt; b.vz -= 0.6 * dt; if (b.z > 12) b.vz = Math.min(b.vz, 0);
      const toH = Math.atan2(b.home.y - b.y, b.home.x - b.x);
      b.vx += Math.cos(toH) * dt * 2.5; b.vy += Math.sin(toH) * dt * 2.5; const sp = Math.hypot(b.vx, b.vy); if (sp > 6) { b.vx *= 6 / sp; b.vy *= 6 / sp; }
      b.x += b.vx * dt; b.y += b.vy * dt; b.h = Math.atan2(b.vy, b.vx);
      if (b.t < 0 && Math.hypot(b.home.x - b.x, b.home.y - b.y) < 6) { b.vz = -2; if (b.z <= 0.05) { b.z = 0; b.state = 'ground'; b.vx = b.vy = 0; b.t = 1; } }
      if (b.z < 0) b.z = 0;
    }
  }
}
// §E2 drama: someone strays into the road ------------------------------------------------------
function startJaywalk(C) {
  const R = C.R;
  const walkers = C.people.filter(p => p.state === 'walk' && !p.onRoad && !p.busy && !p.crossing && p.path && p.pi < p.path.length - 1 && !p.special);
  if (!walkers.length) return;
  const p = R.pick(walkers);
  let best = null;
  for (const e of C.edges) {
    const sd = sideDist(e, p), s = projectOnEdge(e, p.x, p.y);
    if (sd < e.kerbOff || sd > e.kerbOff + SW || s < 10 || s > e.len - 10 || e.closed) continue;
    best = { e, s }; break;
  }
  if (!best) return;
  const { e, s } = best, lane = e.lanes[e.nl - 1];
  const car = lane.occ.find(v => v.mode === 'drive' && v.s < s && s - v.s > 14 && s - v.s < 34 && v.v > 6);
  const far = edgePoint(e, s, -(e.kerbOff + SW / 2)); if (!ringBlockAt(C, far.x, far.y, 1.2)) return;
  if (!car && R.chance(0.7)) return;
  const dest = p.path[p.path.length - 1], next = p.next;
  const k1 = edgePoint(e, s, e.kerbOff - 0.2), k2 = edgePoint(e, s, -(e.kerbOff - 0.2));
  const rest = pedRoute(C, far, dest);
  if (p.age === 'kid') { p.carry = 'ball'; p.task = 'Chasing a ball into the road!'; } else { p.task = p.distracted ? 'Crossing without looking (on the phone)' : 'Darting across the road'; if (p.distracted) p.carry = 'phone'; }
  p.distracted = true;
  walkPath(C, p, [{ x: p.bx, y: p.by }, k1, { ...k2, jay: true }, ...rest.slice(1)], next, p.task);
  p.spd = p.spdBase * 1.25;
  setTimeout0(C, 25, () => { if (p.carry === 'ball' || p.carry === 'phone') p.carry = null; p.spd = p.spdBase; });
  C.stats.jaywalks++;
}
// out-of-town visitors keep the streets lively: they arrive, park a while, and leave again
function stepVisitors(C) {
  const R = C.R, h = C.hour, want = h > 6.5 && h < 22 ? (h > 7 && h < 9.5 || h > 16 && h < 19 ? 34 : 24) : 6;
  const vis = C.vehicles.filter(v => v.visitor);
  if (vis.length < want && R.chance(0.25)) {
    const e = R.pick(C.edges.filter(e => !e.closed && e.len > 40 && !inView(C, e.ax, e.ay)));
    if (e) { const v = makeVehicle(C, 'car'); v.visitor = true; joinLane(C, v, e.lanes[0], R.range(4, 12)); posFromSeg(C, v, 1); visitorNext(C, v); }
  }
  for (const v of vis) if (v.mode === 'parked' && v.leaveAt && C.tReal > v.leaveAt) { v.leaveAt = 0; if (vis.length > want || R.chance(0.3)) { v.leaving = true; } visitorNext(C, v); }
}
function visitorNext(C, v) {
  const R = C.R;
  if (v.leaving) { // drive off "out of town" from a quiet edge
    const e = R.pick(C.edges.filter(e => !e.closed && e.len > 40));
    driveTo(C, v, { pass: true, e, s: e.len * 0.6 }, () => { if (!inView(C, v.x, v.y)) scrapVehicle(C, v, true); else { v.leaving = false; visitorNext(C, v); } });
    v.task = 'Heading out of town'; return;
  }
  const b = R.pick(C.buildings.filter(b => b.cat || b.type === 'mall')), bay = b && (findBay(C, b.door.x, b.door.y, { kinds: ['park'], maxD: 120, seed: v.seed }) || findBay(C, b.door.x, b.door.y, { kinds: ['lot'], maxD: 250, seed: v.seed }));
  if (!bay) { v.leaving = true; visitorNext(C, v); return; }
  v.task = `Visitor driving to ${b.label}`;
  driveTo(C, v, { bay }, () => { v.task = `Visitor parked near ${b.label}`; v.leaveAt = C.tReal + R.range(60, 420); });
}
// §E3 clock, step, spawners ------------------------------------------------------------------
function updateClock(C) {
  C.day = Math.floor(C.time / 1440); C.hour = (C.time / 60) % 24; C.dow = dowOf(C, C.day);
  const h = C.hour;
  C.dark = h < 5.2 ? 1 : h < 6.7 ? 1 - (h - 5.2) / 1.5 : h < 18.9 ? 0 : h < 20.4 ? (h - 18.9) / 1.5 : 1;
}
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SEC_PER_HOUR_DAY = 300, SEC_PER_HOUR_NIGHT = 108;
function newDay(C) {
  C.stats.crashesToday = 0; genDaySchedule(C, C.day);
  if (C.dow < 5) atGameTime(C, C.day * 1440 + 5 * 60, () => startGarbage(C));
  for (const b of C.buildings) if (b.scorch) b.scorch = Math.max(0, b.scorch - 0.5);
}
function stepVehicle(C, v, dt) {
  switch (v.mode) {
    case 'drive': stepDrive(C, v, dt); break;
    case 'track': stepTrack(C, v, dt); break;
    case 'crashed': stepCrashed(C, v, dt); break;
    case 'towed': stepTowed(C, v, dt); break;
    case 'stopped': v.v = 0; v.lights.brake = true; break;
    case 'crushing': v.crushT += dt; break;
    default: break;
  }
  v.lights.head = C.dark > 0.35 && v.mode !== 'parked' && v.mode !== 'crushing';
  for (const p of v.crew) { p.x = v.x; p.y = v.y; p.hd = v.hd; }
  if (v.mode === 'drive' && v.v < 0.1 && !v.lights.siren) {
    const atRed = v.seg.kind === 'lane' && v.mv && v.mv.node.kind === 'signal' && sigState(v.mv.node, v.mv.axis) !== 'G';
    v.stuckT += atRed ? 0 : dt;
    if (v.stuckT > (inView(C, v.x, v.y) ? 240 : 80)) rescue(C, v);
  } else if (v.v > 0.5) v.stuckT = 0;
}
function rescue(C, v) {
  v.stuckT = 0; C.stats.rescues++; if (C.opts.onRescue) C.opts.onRescue(v, C);
  const t = v.target, done = v.onArrive;
  if (t && t.bay) { detach(C, v); parkAt(C, v, t.bay); v.target = null; done && done(v); return; }
  const g = v.goal;
  if (g) { detach(C, v); joinLane(C, v, g.e.lanes[g.e.nl - 1], clamp(g.s, 1, g.e.len - 1)); v.goal = null; posFromSeg(C, v, 1); g.fn(v); return; }
  const e = C.R.pick(C.edges.filter(e => !e.closed)); joinLane(C, v, e.lanes[0], e.len / 2); v.route = [];
}
function stepPerson(C, p, dt) {
  if (p.bubble) { p.bubble.ttl -= dt; if (p.bubble.ttl <= 0) p.bubble = null; }
  if (p.lookT > 0) { p.lookT -= dt; if (p.lookT <= 0) p.lookAt = null; }
  switch (p.state) {
    case 'in': if (C.time >= p.until) think(C, p); else if (((C.frame + p.id) & 31) === 0) stepIndoor(C, p); break;
    case 'walk': stepWalk(C, p, dt); if (p.waitT > 45 && p.path && p.path[p.pi]) { p.cwOK = false; p.waitT = 0; if (p.cwWait) { p.cwWait.wait = Math.max(0, p.cwWait.wait - 1); p.cwWait = null; } p.cwOK = true; p.onRoad = true; const cw = p.path[p.pi].cw; if (cw) { p.crossing = cw; cw.peds.push(p); } } break;
    case 'wait': stepWait(C, p, dt); break;
    case 'act': stepAct(C, p, dt); break;
    case 'ride': if (p.vehicle) { p.x = p.vehicle.x; p.y = p.vehicle.y; } break;
    case 'carried': { const c = p.carriedBy; if (c) { p.x = c.x + Math.cos(c.hd) * 1.1; p.y = c.y + Math.sin(c.hd) * 1.1; p.hd = c.hd; } break; }
    case 'escort': { const o = p.escort; if (o) { const tx = o.x - Math.cos(o.hd) * 0.9, ty = o.y - Math.sin(o.hd) * 0.9; p.x += (tx - p.x) * Math.min(1, dt * 5); p.y += (ty - p.y) * Math.min(1, dt * 5); p.bx = p.x; p.by = p.y; p.hd = o.hd; p.phase += dt * 7; p.pose = 'cuffed'; } break; }
    default: break;
  }
}
function spawners(C) {
  const R = C.R, h = C.hour, wk = C.dow < 5, n = kind => C.incidents.filter(i => i.kind === kind).length;
  if (wk && h > 7.5 && h < 17 && R.chance(0.03)) startDelivery(C);
  if (wk && h > 8.4 && h < 14 && !n('works') && R.chance(0.006)) startRoadworks(C);
  if (h > 7.5 && h < 22 && R.chance(0.004) && !C.vehicles.some(v => v.job && v.job.kind === 'patrol')) startPatrol(C);
  stepVisitors(C);
  if (n('medical') < 2 && R.chance(0.0028)) {
    const cands = C.people.filter(p => p.state === 'in' && !p.busy && !p.special && p.bld && p.bld !== C.hospital && p.bld.type !== 'stadium' && !p.bld.fire);
    if (cands.length) { const pt = R.pick(cands); startMedical(C, pt, doorPt(pt.bld)); }
  }
  if (!n('fire') && R.chance(0.0007)) {
    const bs = C.buildings.filter(b => b.rooms.length > 2 && !b.fire && !['police', 'fire', 'hospital', 'stadium', 'datacentre', 'substation'].includes(b.type));
    if (bs.length) startFire(C, R.pick(bs));
  }
  if (!n('pickpocket') && h > 9 && h < 22 && R.chance(0.003)) startPickpocket(C);
  if (!n('carjack') && h > 8 && h < 23 && R.chance(0.0016)) startCarjack(C);
  if (h > 7 && h < 21.5 && R.chance(0.035)) startJaywalk(C);
  for (const t of C.vehicles) if (t.type === 'taxi' && !t.job && t.mode === 'drive' && !t.goal && !t.target) taxiRoam(C, t);
  for (const b of C.vehicles) if (b.type === 'bus' && !b.job && b.mode === 'parked' && busHours(C) && R.chance(0.08)) busRun(C, b);
}
function stepLighting(C) {
  const B = C.buildings, n = 24;
  for (let k = 0; k < n; k++) { const b = B[(C.lightI + k) % B.length]; for (const r of b.rooms) markLit(C, b, r); }
  C.lightI = (C.lightI + n) % B.length;
}
function sampleStats(C) {
  const vs = C.vehicles, moving = vs.filter(v => v.mode === 'drive' && v.v > 0.5).length, parked = vs.filter(v => v.mode === 'parked').length;
  const out = C.people.filter(p => p.state === 'walk' || p.state === 'act' || p.state === 'wait').length;
  const avg = moving ? vs.reduce((a, v) => a + (v.mode === 'drive' ? v.v : 0), 0) / moving : 0;
  C.hist.push({ t: C.time, moving, parked, out, inside: C.people.filter(p => p.state === 'in').length, riding: C.people.filter(p => p.state === 'ride').length, speed: avg * 3.6, crashes: C.stats.crashes, lit: C.buildings.reduce((a, b) => a + b.rooms.filter(r => r.lit).length, 0) });
  if (C.hist.length > 432) C.hist.shift();
}
function step(C, dt) {
  dt = Math.min(dt, 0.1); C.frame = (C.frame || 0) + 1;
  C.tReal += dt; const prevDay = C.day;
  C.time += dt * 60 / (C.hour >= 6 && C.hour < 20 ? SEC_PER_HOUR_DAY : SEC_PER_HOUR_NIGHT);
  updateClock(C);
  if (C.day !== prevDay) newDay(C);
  stepTimers(C); stepGTimers(C);
  stepSignals(C, dt);
  pedGridBuild(C);
  if ((C.frame & 7) === 0) stepYield(C);
  for (const v of C.vehicles.slice()) stepVehicle(C, v, dt);
  stepCollisions(C);
  for (const p of C.people) stepPerson(C, p, dt);
  for (const inc of C.incidents.slice()) if (inc.step && inc.active) inc.step(C, dt);
  stepEvents(C, dt);
  stepCritters(C, dt);
  C.spawnT -= dt; if (C.spawnT <= 0) { C.spawnT = 1; spawners(C); for (const e of C.edges) e.load = e.lanes.reduce((a, l) => a + l.occ.length, 0); }
  if (C.time >= C.econT) { C.econT = C.time + 15; stepEconomy(C); }
  if (C.time >= C.histT) { C.histT = C.time + 10; sampleStats(C); }
  stepLighting(C);
  if (C.cues.length > 300) C.cues.splice(0, C.cues.length - 300);
}
function genFleet(C) {
  const R = C.R;
  const put = (type, n, bays) => { const free = bays.filter(b => b && !b.occ); for (let k = 0; k < n && k < free.length; k++) { const v = makeVehicle(C, type); v.homeBay = free[k]; parkAt(C, v, free[k]); v.task = 'Parked at base'; } };
  if (C.police && C.police.yard) put('police', FLEET.police, C.police.yard.bays);
  const hl = C.lots.filter(l => l.kind === 'hospital'); put('ambulance', FLEET.ambulance, hl.flatMap(l => l.bays.filter(b => b.kind === 'amb')));
  if (C.fireStation) put('fire', FLEET.fire, C.fireStation.garages);
  if (C.scrap && C.scrap.yard) put('tow', FLEET.tow, C.scrap.yard.bays.slice(-2));
  if (C.works && C.works.yard) { put('ute', FLEET.ute, C.works.yard.bays); put('garbage', FLEET.garbage, C.works.yard.bays); }
  if (C.warehouse && C.warehouse.yard) put('van', FLEET.van, C.warehouse.yard.bays);
  const depotLot = C.lots.find(l => l.kind === 'depot');
  if (depotLot) { put('bus', FLEET.bus, depotLot.bays); C.vehicles.filter(v => v.type === 'bus').forEach((b, k) => { b.busRoute = C.busRoutes[k % C.busRoutes.length]; b.si = Math.floor(k / C.busRoutes.length) * Math.floor(b.busRoute.stops.length / 2); }); }
  for (let k = 0; k < FLEET.taxi; k++) { const e = R.pick(C.edges); const t = makeVehicle(C, 'taxi'); joinLane(C, t, e.lanes[0], R.range(5, e.len - 10)); posFromSeg(C, t, 1); }
  if (C.dealer && C.dealer.yard) for (const b of C.dealer.yard.bays.slice(0, 5)) { const v = makeVehicle(C, 'car'); v.forSale = true; v.age = 0; v.task = 'For sale'; parkAt(C, v, b); }
  C.vehicles.filter(v => v.type === 'bus').forEach((b, k) => setTimeout0(C, 2 + k * 30, () => { if (busHours(C) && !b.job) busRun(C, b); }));
}
// §E4 public API ------------------------------------------------------------------------------
export function createCity(opts = {}) {
  SEGID = 1; VID = 1; PID = 1; IID = 1;
  const seed = (opts.seed >>> 0) || 20261128;
  const C = {
    opts, seed, R: makeRng(seed), LHT: opts.driveSide !== 'right', vehicles: [], people: [], vById: new Map(), pById: new Map(), bays: [], incidents: [], timers: [], gtimers: [],
    cues: [], logs: [], roadPeds: [], hist: [], startDow: 4, time: (opts.startHour ?? 15.6) * 60, tReal: 0, view: null, wind: 0.5, windNow: 0.5, spawnT: 1, econT: 0, histT: 0, lightI: 0,
    stats: { crashes: 0, crashesToday: 0, scrapped: 0, sold: 0, jaywalks: 0, rescues: 0, helped: 0, found: 0 },
    events: { market: { active: false, open: false }, hotdog: { open: false, queue: [], t: 0 }, news: { open: false }, busker: { open: false }, stadium: { live: false }, concert: { queue: [], doors: false, live: false }, rally: { live: false }, marathon: { live: false, route: [], runners: [] } },
  };
  C.cue = (type, x, y, vol = 1, extra) => { C.cues.push({ type, x, y, vol, extra }); };
  C.log = (msg, kind) => { C.logs.push({ t: C.time, msg, kind }); if (C.logs.length > 80) C.logs.shift(); };
  genRoads(C); genBlocks(C); genBusRoutes(C); genZebras(C); genKerbBays(C); genPedNet(C); genProps(C);
  updateClock(C);
  genPeople(C); makeSpecials(C); genFleet(C); placeInitial(C);
  genDaySchedule(C, C.day); if (C.dow < 5 && C.hour < 5) atGameTime(C, 5 * 60, () => startGarbage(C));
  for (const p of [C.fennel, C.claude]) if (p && p.state === 'in') p.until = C.time + 0.5;
  C.step = dt => step(C, dt);
  C.describe = ent => describe(C, ent);
  C.markFound = () => { C.stats.found++; };
  C.clockText = () => { const h = Math.floor(C.hour), m = Math.floor((C.hour - h) * 60); return `${DAY_NAMES[C.dow]} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
  sampleStats(C);
  return C;
}
function describe(C, e) {
  if (!e) return null;
  if (e.kind === 'person') {
    const where = e.state === 'in' && e.bld ? ` · inside ${e.bld.label}` : e.state === 'ride' && e.vehicle ? ` · in ${vehicleName(e.vehicle)}` : '';
    return { title: e.name, sub: (e.asleep ? 'Asleep' : e.task) + where, tag: e.special === 'wanderer' ? 'The wanderer' : e.special === 'claude' ? 'Resident AI' : e.role === 'leisure' ? '' : e.role };
  }
  if (e.kind === 'vehicle') return { title: vehicleName(e), sub: `${e.task}${e.mode === 'drive' ? ` · ${Math.round(Math.abs(e.v) * 3.6)} km/h` : ''}`, tag: e.type };
  if (e.fp) {
    const open = e.hours ? (C.hour >= e.hours[0] && C.hour < e.hours[1] || C.hour + 24 < e.hours[1]) : null;
    const lit = e.rooms.filter(r => r.lit).length;
    return { title: e.label, sub: `${e.fire && e.fire.stage !== 'out' ? 'ON FIRE · ' : ''}${open === null ? '' : open ? 'Open · ' : 'Closed · '}${e.inside.size} inside · ${lit} lights on`, tag: e.type };
  }
  if (e.kind === 'fish') return { title: 'Koi', sub: 'Swimming in the fountain pool', tag: 'fish' };
  if (e.kind === 'duck') return { title: 'Duck', sub: 'Paddling on the park pond', tag: 'duck' };
  if (e.kind === 'pigeon') return { title: 'Pigeon', sub: e.state === 'fly' ? 'Flapping about' : 'Pecking at crumbs', tag: 'bird' };
  return null;
}
export { vehicleDoor, rearPoint, curEdge };
export { crash as _crash, requestTow as _requestTow, startJaywalk as _startJaywalk, startFire as _startFire, startCarjack as _startCarjack, startPickpocket as _startPickpocket, startRoadworks as _startRoadworks, startMedical as _startMedical, sideDist as _sideDist, projectOnEdge as _proj };
