// The shipyard: three classes of sailing warship built plank by plank, not loaded from a file.
//   brigantine — two masts, one weather deck with guns in the waist, a hold below, captain's cabin aft
//   frigate    — three masts, an enclosed gun deck under the weather deck, orlop and hold below
//   man-o'-war — three great masts, three enclosed gun decks (about a hundred guns), far too deep for the river
// Hulls are lofted from station sections (fine bow, full quarters, a flat transom with stern windows,
// tumblehome above the waterline). Gun ports are cut out of the strakes with lids hinged open above them;
// decks have hatches with ladders between them; the quarterdeck and forecastle are raised with stairs up;
// the great cabin under the quarterdeck has a door, a table, a bunk and the stern windows.
// Ship space: +x is the bow, +y up from the bottom of the keel, z across the beam.
import * as THREE from 'three';
import { GeoBuilder } from '../build/geom';

export type ShipClass = 'brigantine' | 'frigate' | 'manowar' | 'leviathan';

export interface ClassSpec {
  name: string; L: number; B: number;
  /** deck floor heights above the keel, lowest (hold) first; the last is the weather deck */
  decks: number[];
  /** indices into decks that are enclosed gun decks (ports cut in the hull) */
  gunDecks: number[];
  /** guns per side on enclosed gun decks, and on the weather deck waist/quarterdeck */
  portsPerSide: number; weatherGuns: number;
  qdH: number; qdTo: number;   // quarterdeck: raised by qdH from the stern to x = qdTo * L/2
  fcH: number; fcFrom: number; // forecastle from x = fcFrom * L/2 to the bow
  masts: { at: number; h: number; yards: number }[];
  draft: number; mass: number;
  paint: { hull: string; band: string; wale: string; inner: string };
  bowsprit: number;
}

const OAK = 'wood:planks|stain:walnut|fin:raw', DARK = 'wood:dark|stain:ebony|fin:raw', TAR = 'wood:planks|stain:ebony|fin:raw|wx:0.6';
const DECKP = 'wood:weathered|stain:honey|fin:raw', DECKIN = 'wood:weathered|stain:honey|fin:raw|in:1';

export const CLASSES: Record<ShipClass, ClassSpec> = {
  brigantine: {
    name: 'Brigantine', L: 26, B: 7.2, decks: [1.5, 4.3], gunDecks: [], portsPerSide: 0, weatherGuns: 5,
    qdH: 1.9, qdTo: -0.48, fcH: 1.4, fcFrom: 0.62, masts: [{ at: 0.3, h: 21, yards: 3 }, { at: -0.12, h: 23, yards: 3 }],
    draft: 2.9, mass: 160000, paint: { hull: 'wood:planks|stain:walnut|fin:oiled', band: 'wood:planks|stain:amber|fin:oiled', wale: DARK, inner: 'wood:planks|stain:honey|fin:raw|in:1' }, bowsprit: 9,
  },
  frigate: {
    name: 'Frigate', L: 44, B: 11.6, decks: [2.0, 4.2, 6.3, 8.7], gunDecks: [2], portsPerSide: 13, weatherGuns: 6,
    qdH: 2.1, qdTo: -0.38, fcH: 1.6, fcFrom: 0.6, masts: [{ at: 0.33, h: 34, yards: 3 }, { at: 0.0, h: 38, yards: 3 }, { at: -0.32, h: 28, yards: 3 }],
    draft: 4.6, mass: 900000, paint: { hull: 'wood:planks|stain:ebony|fin:oiled', band: 'wood:planks|stain:honey|fin:oiled', wale: DARK, inner: 'wood:planks|stain:oxblood|fin:raw|in:1' }, bowsprit: 14,
  },
  manowar: {
    name: "Man-o'-war", L: 58, B: 16, decks: [2.4, 5.2, 8.4, 10.8, 13.2, 15.6], gunDecks: [2, 3, 4], portsPerSide: 15, weatherGuns: 7,
    qdH: 2.2, qdTo: -0.36, fcH: 1.8, fcFrom: 0.6, masts: [{ at: 0.33, h: 50, yards: 4 }, { at: 0.0, h: 56, yards: 4 }, { at: -0.31, h: 42, yards: 3 }],
    draft: 6.8, mass: 2600000, paint: { hull: 'wood:planks|stain:ebony|fin:oiled', band: 'wood:planks|stain:amber|fin:oiled', wale: DARK, inner: 'wood:planks|stain:oxblood|fin:raw|in:1' }, bowsprit: 18,
  },
  // debug only (spawn.leviathan()): a sea monster of a ship — four enclosed gun decks of thirty ports a side,
  // seven decks in all, four towering masts, a crew of hundreds, too deep for anything but open sea
  leviathan: {
    name: 'Leviathan', L: 112, B: 30, decks: [3.0, 6.4, 9.6, 12.6, 15.6, 18.6, 21.6], gunDecks: [2, 3, 4, 5], portsPerSide: 30, weatherGuns: 12,
    qdH: 2.6, qdTo: -0.4, fcH: 2.3, fcFrom: 0.62, masts: [{ at: 0.42, h: 88, yards: 5 }, { at: 0.14, h: 102, yards: 5 }, { at: -0.14, h: 96, yards: 5 }, { at: -0.4, h: 70, yards: 4 }],
    draft: 11.5, mass: 14000000, paint: { hull: 'wood:planks|stain:ebony|fin:oiled', band: 'wood:planks|stain:oxblood|fin:oiled', wale: 'brass', inner: 'wood:planks|stain:oxblood|fin:raw|in:1' }, bowsprit: 32,
  },
};

export interface ShipPlan {
  spec: ClassSpec; cls: ShipClass;
  hull: GeoBuilder;          // outside: hull, decks, masts, rigging, guns on the weather deck
  inside: GeoBuilder;        // inner shell, lower decks, furniture-like fittings (hidden from far away)
  colliders: { c: THREE.Vector3; h: THREE.Vector3; q?: THREE.Quaternion; m: number }[];
  sails: { x: number; top: number; bottom: number; z0: number; z1: number; jib?: boolean }[];
  guns: { pos: THREE.Vector3; side: 1 | -1; deck: number }[];
  doors: { pos: THREE.Vector3; yaw: number; w: number; h: number; hinge: 1 | -1 }[];
  lights: THREE.Vector3[];
  hammocks: THREE.Vector3[];
  cabin: { x0: number; x1: number; y: number; hw: number };
  helm: THREE.Vector3;
  buoy: THREE.Vector3[];
  waterline: number; deckY: number; topY: number;
  hb: (x: number, y: number) => number;
  /** top of the bulwark / hull side at x */
  top: (x: number) => number;
  /** walkable deck height at (x) on the weather decks (quarterdeck, waist, forecastle) */
  weatherY: (x: number) => number;
  /** the companion stairs from the waist up to the quarterdeck and forecastle (ship space) */
  stairs: { xLow: number; xHigh: number; z: number; y0: number; y1: number }[];
  /** hatch openings in the weather deck (x centres; half-sizes) and the quarterdeck/forecastle breaks */
  hatches: { x: number; hx: number; hz: number }[];
  qdX: number; fcX: number;
}

const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function planShip(cls: ShipClass): ShipPlan {
  const S = CLASSES[cls];
  const L = S.L, B = S.B, H = L / 2;
  const upper = S.decks[S.decks.length - 1];
  const wl = S.draft;
  const qdX = S.qdTo * H, fcX = S.fcFrom * H;
  const bul = 1.15;                                     // bulwark height above a deck
  const top = (x: number) => (x < qdX ? upper + S.qdH : x > fcX ? upper + S.fcH : upper) + bul;
  const weatherY = (x: number) => (x < qdX ? upper + S.qdH : x > fcX ? upper + S.fcH : upper);
  // keel rocker: the bottom sweeps up toward the stem and the sternpost
  const yBot = (x: number) => { const xn = x / H; return xn > 0 ? wl * 0.75 * Math.pow(xn, 3.2) : wl * 0.4 * Math.pow(-xn, 5); };
  /** half-breadth of the hull at (x, y) */
  const hb = (x: number, y: number) => {
    const xn = THREE.MathUtils.clamp(x / H, -1, 1);
    const yb = yBot(x);
    if (y < yb) return 0;
    // plan shape: a fine entry at the bow, full quarters aft closing on a transom (wide above the water)
    let pf: number;
    if (xn >= 0) pf = Math.sqrt(Math.max(0, 1 - Math.pow(xn, 2.3)));
    else { const tw = 0.62 * ss(wl - 1.2, wl + 1.5, y); pf = 1 - Math.pow(-xn, 3.4) * (1 - tw); }
    // section: deadrise from the keel, full bilges, and tumblehome above the wale
    const Dm = upper + 1;
    const r = THREE.MathUtils.clamp((y - yb) / Math.max(0.5, (wl * 0.95 - yb)), 0, 1);
    let sf = Math.pow(1 - Math.pow(1 - r, 2.4), 0.55);
    if (y > wl + 0.5) sf *= 1 - 0.13 * Math.pow(THREE.MathUtils.clamp((y - wl - 0.5) / (Dm - wl), 0, 1.4), 2);
    return Math.max(0, (B / 2) * pf * sf);
  };
  const hull = new GeoBuilder(), inside = new GeoBuilder();
  const colliders: ShipPlan['colliders'] = [];
  const C = (c: THREE.Vector3, h: THREE.Vector3, m = 1, q?: THREE.Quaternion) => colliders.push({ c, h, m, q });
  const guns: ShipPlan['guns'] = [], doors: ShipPlan['doors'] = [], lights: THREE.Vector3[] = [], hammocks: THREE.Vector3[] = [];
  const sails: ShipPlan['sails'] = [];
  const stairList: ShipPlan['stairs'] = [];

  // ---- gun ports: positions along the hull for every enclosed gun deck and the weather deck ----
  const ports: { x: number; y0: number; y1: number; deck: number; weather: boolean }[] = [];
  for (const di of S.gunDecks) {
    const yd = S.decks[di];
    const n = S.portsPerSide - (di === S.gunDecks[S.gunDecks.length - 1] && S.gunDecks.length > 1 ? 1 : 0);
    const x0 = -H * 0.78, x1 = H * 0.7;
    for (let i = 0; i < n; i++) ports.push({ x: x0 + (i + 0.5) * (x1 - x0) / n, y0: yd + 0.5, y1: yd + 1.15, deck: di, weather: false });
  }
  {
    // the weather deck: guns in the waist (between the masts and the breaks) and a few on the quarterdeck
    const n = S.weatherGuns, x0 = qdX + 1.6, x1 = fcX - 1.6;
    for (let i = 0; i < n; i++) ports.push({ x: x0 + (i + 0.5) * (x1 - x0) / n, y0: upper + 0.35, y1: upper + 0.95, deck: S.decks.length - 1, weather: true });
    if (cls !== 'brigantine') for (let i = 0; i < 2; i++) { const x = -H * 0.88 + i * 3.2 + (qdX + H) * 0.25; ports.push({ x, y0: upper + S.qdH + 0.35, y1: upper + S.qdH + 0.95, deck: S.decks.length - 1, weather: true }); }
  }
  const portHalf = 0.42;
  const inPort = (x0: number, x1: number, y0: number, y1: number) => ports.some((p) => x1 > p.x - portHalf && x0 < p.x + portHalf && y1 > p.y0 + 0.01 && y0 < p.y1 - 0.01);

  // ---- hull shell: stations x strakes, outer and inner skins ----
  const NX = Math.round(L * 1.4);
  const xs: number[] = [];
  for (let i = 0; i <= NX; i++) xs.push(-H + (i / NX) * L);
  // make sure port edges and deck breaks fall on station lines (clean openings)
  for (const p of ports) xs.push(p.x - portHalf, p.x + portHalf);
  xs.push(qdX, fcX);
  xs.sort((a, b) => a - b);
  const X = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.05);
  const ysSet = new Set<number>();
  const maxTop = upper + Math.max(S.qdH, S.fcH) + bul;
  for (let y = 0; y <= maxTop + 0.01; y += 0.45) ysSet.add(+y.toFixed(3));
  for (const p of ports) { ysSet.add(p.y0); ysSet.add(p.y1); }
  for (const d of S.decks) ysSet.add(d);
  for (const x of [upper + bul, upper + S.qdH + bul, upper + S.fcH + bul, wl, wl + 0.4, wl + 1.4]) ysSet.add(+x.toFixed(3));
  const Y = [...ysSet].sort((a, b) => a - b);
  const T = 0.16;  // planking + frames
  const keyAt = (y: number) => y < wl - 0.05 ? TAR : (y >= wl + 0.4 && y < wl + 1.4) ? S.paint.wale : S.gunDecks.some((d) => y >= S.decks[d] + 0.3 && y < S.decks[d] + 1.35) ? S.paint.band : S.paint.hull;
  const innerKey = (y: number) => y < (S.gunDecks.length ? S.decks[S.gunDecks[0]] : S.decks[1]) - 0.05 ? 'wood:planks|stain:walnut|fin:raw|in:1' : S.paint.inner;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  for (let i = 0; i < X.length - 1; i++) {
    const xa = X[i], xb = X[i + 1], xm = (xa + xb) / 2;
    const segTop = Math.min(top(xa + 0.001), top(xb - 0.001));
    for (let j = 0; j < Y.length - 1; j++) {
      const ya = Y[j], yb = Y[j + 1];
      if (ya >= segTop - 0.001) break;
      const yt = Math.min(yb, segTop);
      if (inPort(xa, xb, ya, yt)) continue;
      const wa0 = hb(xa, ya), wb0 = hb(xb, ya), wa1 = hb(xa, yt), wb1 = hb(xb, yt);
      if (wa0 + wb0 + wa1 + wb1 < 0.02) continue;
      const k = keyAt((ya + yt) / 2), ki = innerKey((ya + yt) / 2);
      const u0 = xa * 0.5, u1 = xb * 0.5, v0 = ya * 0.5, v1 = yt * 0.5;
      for (const s of [1, -1]) {
        // outside skin (CCW seen from outside)
        const a = v(xa, ya, s * wa0), b = v(xb, ya, s * wb0), c = v(xb, yt, s * wb1), d = v(xa, yt, s * wa1);
        if (s > 0) hull.quad(k, b, a, d, c, [[u1, v0], [u0, v0], [u0, v1], [u1, v1]]); else hull.quad(k, a, b, c, d, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
        // inside skin, a frame's thickness in (only where there is room)
        if (ya < S.decks[0] - 0.1) continue;
        const ia = v(xa, ya, s * Math.max(0, wa0 - T)), ib = v(xb, ya, s * Math.max(0, wb0 - T)), ic = v(xb, yt, s * Math.max(0, wb1 - T)), id = v(xa, yt, s * Math.max(0, wa1 - T));
        if (s > 0) inside.quad(ki, ia, ib, ic, id, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]); else inside.quad(ki, ib, ia, id, ic, [[u1, v0], [u0, v0], [u0, v1], [u1, v1]]);
      }
      void xm;
    }
    // cap rail along the top of the side
    for (const s of [1, -1]) { const w0 = hb(xa, segTop), w1 = hb(xb, segTop); const zc = s * (w0 + w1) / 2 - s * T / 2; hull.push().translate(xm, segTop + 0.04, zc).rotateY(-Math.atan2((w1 - w0) * s, xb - xa)); hull.box(DARK, 0, 0, 0, Math.hypot(xb - xa, w1 - w0) + 0.02, 0.09, T + 0.12, 2); hull.pop(); }
  }
  // the steps in the side at the quarterdeck and forecastle breaks
  for (const [x, yLo, yHi] of [[qdX, upper + bul, upper + S.qdH + bul], [fcX, upper + bul, upper + S.fcH + bul]] as [number, number, number][]) {
    for (const s of [1, -1]) { const w = hb(x, yHi); hull.box(S.paint.hull, x, (yLo + yHi) / 2, s * (w - T / 2), 0.12, yHi - yLo, T + 0.04, 0.5); }
  }
  // gun port reveals and lids hinged open above
  for (const p of ports) for (const s of [1, -1]) {
    const w0 = hb(p.x, p.y0), w1 = hb(p.x, p.y1), wm = (w0 + w1) / 2;
    const zc = s * (wm - T / 2);
    hull.box(DARK, p.x, p.y0 - 0.03, zc, portHalf * 2 + 0.08, 0.06, T + 0.06, 2);
    hull.box(DARK, p.x, p.y1 + 0.03, zc, portHalf * 2 + 0.08, 0.06, T + 0.06, 2);
    for (const e of [-1, 1]) hull.box(DARK, p.x + e * (portHalf + 0.02), (p.y0 + p.y1) / 2, zc, 0.06, p.y1 - p.y0, T + 0.06, 2);
    if (!p.weather) {
      hull.push().translate(p.x, p.y1 + 0.02, s * (w1 + 0.02)).rotateX(s * -1.15);
      hull.box(S.paint.band, 0, 0, s * (p.y1 - p.y0) * 0.5, portHalf * 2, 0.07, p.y1 - p.y0, 1);
      hull.box(S.paint.inner.replace('|in:1', ''), 0, -0.04 * s, s * (p.y1 - p.y0) * 0.5, portHalf * 2 - 0.06, 0.02, p.y1 - p.y0 - 0.06, 1);
      hull.pop();
    }
  }
  // stem and keel
  hull.box(TAR, 0, 0.15, 0, L * 0.92, 0.3, 0.34, 1.5);
  for (let i = 0; i < 12; i++) {
    const t0 = i / 12, t1 = (i + 1) / 12;
    const xa = H * (0.6 + 0.4 * t0), xb = H * (0.6 + 0.4 * t1);
    const ya = yBot(xa), yb2 = yBot(xb);
    hull.push().translate((xa + xb) / 2, (ya + yb2) / 2 + 0.15, 0).rotateZ(Math.atan2(yb2 - ya, xb - xa)); hull.box(TAR, 0, 0, 0, Math.hypot(xb - xa, yb2 - ya) + 0.05, 0.4, 0.3, 1.5); hull.pop();
  }
  hull.push().translate(H + 0.1, (yBot(H) + top(H)) / 2, 0).rotateZ(-0.12); hull.box(DARK, 0, 0, 0, 0.4, top(H) - yBot(H) + 0.6, 0.32, 1.5); hull.pop();
  // rudder on the sternpost
  hull.box(DARK, -H - 0.25, wl * 0.55, 0, 0.5, wl * 1.2, 0.18, 1.2);

  // ---- the transom, with the stern windows of the great cabin ----
  const sternX = -H;
  const sternTop = top(sternX + 0.01);
  const cabinY = upper;                       // the great cabin is under the quarterdeck on the weather deck level
  const winY0 = cabinY + 0.75, winY1 = cabinY + 1.6;
  for (let j = 0; j < Y.length - 1; j++) {
    const ya = Y[j], yt = Math.min(Y[j + 1], sternTop);
    if (ya >= sternTop) break;
    const w0 = hb(sternX, ya), w1 = hb(sternX, yt);
    if (w0 + w1 < 0.05) continue;
    // windows: leave gaps, filled with leaded glass below
    if (ya >= winY0 - 0.01 && yt <= winY1 + 0.01) {
      const nW = cls === 'brigantine' ? 3 : 5;
      const wmax = Math.min(w0, w1) - 0.3;
      const pane = (wmax * 2) / nW;
      for (let k = 0; k <= nW; k++) {
        const z0 = -wmax + k * pane - 0.09, z1 = z0 + 0.18;
        hull.quad(S.paint.band, v(sternX, ya, z1), v(sternX, ya, z0), v(sternX, yt, z0), v(sternX, yt, z1), [[0, 0], [0.1, 0], [0.1, 0.4], [0, 0.4]]);
      }
      for (const s of [1, -1]) hull.quad(S.paint.band, s > 0 ? v(sternX, ya, w0) : v(sternX, ya, -wmax), s > 0 ? v(sternX, ya, wmax) : v(sternX, ya, -w0), s > 0 ? v(sternX, yt, wmax) : v(sternX, yt, -w1), s > 0 ? v(sternX, yt, w1) : v(sternX, yt, -wmax), [[0, 0], [0.2, 0], [0.2, 0.4], [0, 0.4]]);
      continue;
    }
    hull.quad(ya < wl ? TAR : S.paint.hull, v(sternX, ya, w0), v(sternX, ya, -w0), v(sternX, yt, -w1), v(sternX, yt, w1), [[w0 * 0.5, ya * 0.5], [-w0 * 0.5, ya * 0.5], [-w1 * 0.5, yt * 0.5], [w1 * 0.5, yt * 0.5]]);
    inside.quad(S.paint.inner, v(sternX + T, ya, -Math.max(0, w0 - T)), v(sternX + T, ya, Math.max(0, w0 - T)), v(sternX + T, yt, Math.max(0, w1 - T)), v(sternX + T, yt, -Math.max(0, w1 - T)), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  {
    const wmax = Math.min(hb(sternX, winY0), hb(sternX, winY1)) - 0.3;
    hull.box('glass|c:b8c8c0', sternX + 0.02, (winY0 + winY1) / 2, 0, 0.02, winY1 - winY0, wmax * 2);
    // carved rail and lanterns on the taffrail
    hull.box(S.paint.band, sternX - 0.08, winY1 + 0.12, 0, 0.12, 0.2, wmax * 2 + 0.4, 1);
    hull.box(S.paint.band, sternX - 0.08, winY0 - 0.12, 0, 0.12, 0.2, wmax * 2 + 0.4, 1);
    if (cls === 'manowar' || cls === 'leviathan') {
      // an open stern gallery for the admiral's cabin
      hull.box(OAK, sternX - 0.9, winY0 - 0.15, 0, 1.6, 0.12, wmax * 2 + 0.6, 1);
      for (let k = 0; k <= 10; k++) hull.box(S.paint.band, sternX - 1.6, winY0 + 0.45, -wmax - 0.2 + k * (wmax * 2 + 0.4) / 10, 0.06, 0.9, 0.06, 1);
      hull.box(S.paint.band, sternX - 1.6, winY0 + 0.92, 0, 0.1, 0.08, wmax * 2 + 0.5, 1);
    }
    for (const z of [-wmax * 0.9, 0, wmax * 0.9]) { hull.cyl('brass', sternX - 0.3, sternTop + 0.1, z, 0.04, 0.04, 0.5, 6); hull.ellipsoid('color:ffc070|e:5', sternX - 0.3, sternTop + 0.75, z, 0.17, 0.25, 0.17, 8); lights.push(v(sternX - 0.3, sternTop + 0.75, z)); }
  }

  // ---- decks ----
  const hatchXs = [H * 0.18, -H * 0.12].map((x) => +x.toFixed(2));
  const hatchHalfX = 1.1, hatchHalfZ = 0.66;
  const deckStrip = (key: string, g: GeoBuilder, y: number, xa: number, xb: number, colls: boolean, holes: number[]) => {
    const n = Math.max(1, Math.round((xb - xa) / 1.2));
    for (let i = 0; i < n; i++) {
      const x0 = xa + (i / n) * (xb - xa), x1 = xa + ((i + 1) / n) * (xb - xa), xm = (x0 + x1) / 2;
      const hw = Math.max(0, Math.min(hb(x0, y), hb(x1, y)) - T);
      if (hw < 0.3) continue;
      const hole = holes.find((hx) => x1 > hx - hatchHalfX && x0 < hx + hatchHalfX);
      if (hole !== undefined) {
        for (const s of [1, -1]) {
          g.box(key, xm, y - 0.06, s * (hatchHalfZ + (hw - hatchHalfZ) / 2), x1 - x0 + 0.01, 0.12, hw - hatchHalfZ, 0.7);
          if (colls) C(v(xm, y - 0.06, s * (hatchHalfZ + (hw - hatchHalfZ) / 2)), v((x1 - x0) / 2 + 0.01, 0.06, (hw - hatchHalfZ) / 2), 1);
        }
        // the parts of the strip fore and aft of the opening
        const lo = Math.max(x0, hole - hatchHalfX), hi = Math.min(x1, hole + hatchHalfX);
        for (const [a, b] of [[x0, lo], [hi, x1]]) if (b - a > 0.05) { g.box(key, (a + b) / 2, y - 0.06, 0, b - a, 0.12, hatchHalfZ * 2, 0.7); if (colls) C(v((a + b) / 2, y - 0.06, 0), v((b - a) / 2, 0.06, hatchHalfZ), 1); }
      } else {
        g.box(key, xm, y - 0.06, 0, x1 - x0 + 0.01, 0.12, hw * 2, 0.7);
        if (colls) C(v(xm, y - 0.06, 0), v((x1 - x0) / 2 + 0.01, 0.06, hw), 1);
      }
      // deck beams underneath
      if (i % 2 === 0) g.box(DARK + '|in:1', xm, y - 0.2, 0, 0.18, 0.16, hw * 2, 2);
    }
  };
  const deckEnds = (y: number) => {
    // where the deck meets the hull fore and aft at this height
    let xa = -H, xb = H;
    for (let x = -H; x < H; x += 0.25) if (hb(x, y) > T + 0.3) { xa = x; break; }
    for (let x = H; x > -H; x -= 0.25) if (hb(x, y) > T + 0.3) { xb = x; break; }
    return [Math.max(xa, -H + 0.2), xb];
  };
  // lower decks (hold, orlop, gun decks): enclosed, inside
  for (let di = 0; di < S.decks.length - 1; di++) {
    const y = S.decks[di];
    const [xa, xb] = deckEnds(y);
    deckStrip(di === 0 ? 'wood:planks|stain:walnut|fin:raw|in:1' : DECKIN, inside, y, xa, xb, true, di === 0 ? [] : hatchXs);
    // lanterns hung from the beams of every deck above the hold
    const yUp = S.decks[di + 1];
    for (const lx of [H * 0.4, 0, -H * 0.45]) { inside.cyl('iron', lx, yUp - 0.55, 0, 0.12, 0.09, 0.3, 8); inside.ellipsoid('color:ffb060|e:4', lx, yUp - 0.42, 0, 0.07, 0.1, 0.07, 6); lights.push(v(lx, yUp - 0.45, 0)); }
    // hull walls between decks so nobody walks out through the side (ports have their own frames)
    for (let x = xa; x < xb; x += 2) {
      const x1 = Math.min(xb, x + 2), xm = (x + x1) / 2, w = Math.min(hb(xm, y + 0.4), hb(xm, yUp - 0.3)) - T / 2;
      if (w < 0.4) continue;
      for (const s of [1, -1]) C(v(xm, (y + yUp) / 2, s * (w + 0.05)), v((x1 - x) / 2, (yUp - y) / 2, 0.1), 1);
    }
  }
  // weather decks: quarterdeck, waist, forecastle (exposed, part of the outside)
  {
    const [xa, xb] = deckEnds(upper);
    deckStrip(DECKP, hull, upper, Math.max(xa, -H + 0.2), xb, true, hatchXs.filter((hx) => hx > qdX + hatchHalfX && hx < fcX - hatchHalfX));
    deckStrip(DECKP, hull, upper + S.qdH, -H + 0.2, qdX, true, []);
    deckStrip(DECKP, hull, upper + S.fcH, fcX, xb, true, []);
    // bulwark colliders along the weather decks
    for (let x = -H + 0.2; x < xb; x += 2) {
      const x1 = Math.min(xb, x + 2), xm = (x + x1) / 2, yd = weatherY(xm), w = hb(xm, yd + 0.6) - T / 2;
      if (w < 0.3) continue;
      for (const s of [1, -1]) C(v(xm, yd + 0.6, s * (w + 0.04)), v((x1 - x) / 2, 0.62, 0.08), 1);
    }
    // the front of the quarterdeck (with the cabin door) and the back of the forecastle
    const wq = hb(qdX, upper + 1) - T;
    const wf = hb(fcX, upper + 1) - T;
    hull.box(OAK, fcX - 0.06, upper + S.fcH / 2, 0, 0.12, S.fcH, wf * 2, 0.7);
    // the quarterdeck front is solid but for the doorway (z from -1 to 0)
    C(v(qdX + 0.12, upper + S.qdH / 2, wq / 2), v(0.08, S.qdH / 2, wq / 2), 1);
    C(v(qdX + 0.12, upper + S.qdH / 2, (-wq - 1) / 2), v(0.08, S.qdH / 2, (wq - 1) / 2), 1);
    C(v(fcX - 0.06, upper + S.fcH / 2, 0), v(0.08, S.fcH / 2, wf), 1);
    // the cabin door in the quarterdeck front
    doors.push({ pos: v(qdX + 0.14, upper, -0.5), yaw: Math.PI / 2, w: 1.0, h: Math.min(S.qdH - 0.2, 1.9), hinge: 1 });
    // stairs up to the quarterdeck and the forecastle, either side of the door
    const stairs = (xLow: number, xHigh: number, y0: number, y1: number, z: number) => {
      stairList.push({ xLow, xHigh, z, y0, y1 });
      const n = Math.max(4, Math.round((y1 - y0) / 0.24)), run = xHigh - xLow;
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; hull.box(DECKP, xLow + run * t, y0 + (y1 - y0) * (k + 1) / n - 0.04, z, Math.abs(run) / n + 0.04, 0.06, 0.85, 1.2); }
      for (const e of [-0.45, 0.45]) { hull.push().translate((xLow + xHigh) / 2, (y0 + y1) / 2 - 0.1, z + e).rotateZ(Math.atan2(y1 - y0, run)); hull.box(DARK, 0, 0, 0, Math.hypot(run, y1 - y0), 0.2, 0.06, 2); hull.pop(); }
      const ang = Math.atan2(y1 - y0, run);
      C(v((xLow + xHigh) / 2, (y0 + y1) / 2 - 0.05, z), v(Math.hypot(run, y1 - y0) / 2, 0.05, 0.42), 1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang));
    };
    for (const s of [1, -1]) {
      const zq = s * Math.max(1.3, wq * 0.62);
      stairs(qdX + S.qdH * 1.15, qdX, upper, upper + S.qdH, zq);
      const zf = s * Math.max(1.2, wf * 0.55);
      stairs(fcX - S.fcH * 1.15, fcX, upper, upper + S.fcH, zf);
    }
  }
  // the quarterdeck front, door opening facing forward
  {
    const wq = hb(qdX, upper + 1) - T;
    const g2 = new GeoBuilder();
    g2.push().translate(qdX + 0.12, upper, wq).rotateY(Math.PI / 2);
    g2.wall(OAK, wq * 2, S.qdH, 0.1, [{ x0: wq - 1.0, x1: wq, y0: 0, y1: Math.min(S.qdH - 0.15, 1.95) }, { x0: wq * 0.4 - 0.3, x1: wq * 0.4 + 0.3, y0: 0.9, y1: 1.5 }, { x0: wq * 1.6 - 0.3, x1: wq * 1.6 + 0.3, y0: 0.9, y1: 1.5 }], 0.6);
    g2.pop();
    hull.merge(g2, new THREE.Matrix4());
  }

  // ---- hatches and ladders between every pair of decks ----
  for (let di = 0; di < S.decks.length - 1; di++) {
    const y0 = S.decks[di], y1 = S.decks[di + 1];
    for (const hx of hatchXs) {
      if (di === S.decks.length - 2 && !(hx > qdX + hatchHalfX && hx < fcX - hatchHalfX)) continue;
      const g = di === S.decks.length - 2 ? hull : inside;
      // coaming round the opening above
      for (const s of [1, -1]) g.box(DARK, hx, y1 + 0.08, s * (hatchHalfZ + 0.06), hatchHalfX * 2 + 0.24, 0.16, 0.12, 2);
      for (const e of [-1, 1]) g.box(DARK, hx + e * (hatchHalfX + 0.06), y1 + 0.08, 0, 0.12, 0.16, hatchHalfZ * 2, 2);
      // a steep companion ladder rising aft-to-fore through the opening
      const xb = hx - hatchHalfX - 0.9, xt = hx + hatchHalfX - 0.15, n = Math.round((y1 - y0) / 0.25);
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; g.box('wood:planks|stain:honey|fin:raw|in:1', xb + (xt - xb) * t, y0 + (y1 - y0) * (k + 1) / n - 0.03, 0, (xt - xb) / n + 0.05, 0.05, 0.8, 1.2); }
      const ang = Math.atan2(y1 - y0, xt - xb);
      for (const e of [-0.44, 0.44]) { g.push().translate((xb + xt) / 2, (y0 + y1) / 2 - 0.05, e).rotateZ(ang); g.box(DARK + '|in:1', 0, 0, 0, Math.hypot(xt - xb, y1 - y0) + 0.2, 0.18, 0.06, 2); g.pop(); }
      C(v((xb + xt) / 2, (y0 + y1) / 2 - 0.08, 0), v(Math.hypot(xt - xb, y1 - y0) / 2, 0.05, 0.4), 1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang));
    }
  }

  // ---- guns: a carriage and barrel at every port ----
  const gun = (g: GeoBuilder, p: { x: number; y0: number; deck: number }, s: 1 | -1) => {
    const y = S.decks[p.deck] + (p.y0 - S.decks[p.deck] > 0.6 ? S.qdH : 0);
    const w = hb(p.x, p.y0 + 0.3) - T;
    const len = (cls === 'manowar' || cls === 'leviathan') && p.deck <= 2 ? 3.0 : cls === 'brigantine' ? 2.0 : 2.6;
    const r = len * 0.085;
    const zc = s * (w - len * 0.5 - 0.15);
    // carriage cheeks and axle trucks
    for (const e of [-1, 1]) g.box('wood:planks|stain:oxblood|fin:raw', p.x + e * 0.24, y + 0.32, zc + s * 0.1, 0.1, 0.42, len * 0.55, 1.5);
    g.box('wood:planks|stain:oxblood|fin:raw', p.x, y + 0.18, zc + s * 0.1, 0.52, 0.1, len * 0.5, 1.5);
    for (const tz of [-0.32, 0.32]) for (const e of [-1, 1]) { g.push().translate(p.x + e * 0.3, y + 0.14, zc + s * 0.1 + tz * len * 0.6).rotateZ(Math.PI / 2); g.cyl(DARK, 0, -0.05, 0, 0.14, 0.14, 0.1, 10); g.pop(); }
    // the barrel, muzzle at the port
    g.push().translate(p.x, y + 0.62, zc).rotateX(s * Math.PI / 2);
    g.cyl('iron', 0, -len * 0.5, 0, r * 1.25, r * 0.85, len, 14, true, 1);
    g.cyl('iron', 0, len * 0.5 - 0.06, 0, r * 1.0, r * 1.0, 0.12, 14, true, 1);
    g.ellipsoid('iron', 0, -len * 0.5 - 0.04, 0, r * 1.0, r * 0.8, r * 1.0, 8);
    g.pop();
    guns.push({ pos: v(p.x, y + 0.62, s * (w + 0.2)), side: s, deck: p.deck });
  };
  for (const p of ports) for (const s of [1, -1] as (1 | -1)[]) gun(p.weather ? hull : inside, p, s);
  // gun decks: hammocks slung between the beams and mess tables between the guns
  for (const di of [...S.gunDecks, ...(S.decks.length > 2 ? [0] : [])]) {
    const y = S.decks[di], yUp = S.decks[di + 1];
    for (let x = -H * 0.6; x < H * 0.55; x += 2.6) for (const s of [1, -1]) if (hb(x, y + 1) > 2.2) hammocks.push(v(x, yUp - 0.45, s * Math.min(hb(x, y + 1) - 1.6, 2.4)));
  }
  if (S.decks.length === 2) for (let x = -H * 0.3; x < H * 0.4; x += 2.8) hammocks.push(v(x, upper - 0.5, 0));

  // ---- the great cabin under the quarterdeck ----
  const cab = { x0: -H + 0.4, x1: qdX - 0.1, y: upper, hw: hb(qdX, upper + 0.5) - T };
  inside.box(DECKIN, (cab.x0 + cab.x1) / 2, upper + S.qdH - 0.08, 0, cab.x1 - cab.x0, 0.06, cab.hw * 2, 0.8);    // cabin ceiling (underside of the qd)
  for (const s of [1, -1]) inside.box(S.paint.inner, (cab.x0 + cab.x1) / 2, upper + S.qdH / 2, s * (cab.hw - 0.02), cab.x1 - cab.x0, S.qdH, 0.04, 0.7);
  // table and chairs, a bunk against the side, a chart, a chest
  const cx = (cab.x0 + cab.x1) / 2;
  inside.box('wood:fine|stain:chestnut|fin:varnished', cx, upper + 0.74, 0, 2.2, 0.06, 1.1, 1);
  for (const e of [-1, 1]) for (const f of [-1, 1]) inside.box(DARK, cx + e * 0.95, upper + 0.37, f * 0.45, 0.07, 0.74, 0.07, 2);
  inside.box('paper', cx + 0.2, upper + 0.775, 0.1, 0.8, 0.005, 0.55, 1);
  for (const e of [-1, 1]) { inside.box('wood:fine|stain:chestnut|fin:varnished', cx + e * 0.5, upper + 0.45, -0.85, 0.45, 0.05, 0.45, 1); inside.box('wood:fine|stain:chestnut|fin:varnished', cx + e * 0.5, upper + 0.7, -1.06, 0.45, 0.5, 0.05, 1); }
  inside.box('wood:fine|stain:walnut|fin:oiled', cab.x0 + 1.2, upper + 0.45, cab.hw - 0.5, 2.0, 0.4, 0.9, 1);
  inside.box('cloth:wool|dye:woad', cab.x0 + 1.2, upper + 0.7, cab.hw - 0.5, 1.9, 0.12, 0.8, 1);
  inside.box('wood:planks|stain:oxblood|fin:raw', cab.x1 - 0.8, upper + 0.3, -cab.hw + 0.45, 0.9, 0.55, 0.5, 1);
  inside.cyl('brass', cx, upper + S.qdH - 0.45, 0, 0.14, 0.1, 0.35, 8); inside.ellipsoid('color:ffc070|e:5', cx, upper + S.qdH - 0.3, 0, 0.08, 0.1, 0.08, 6);
  lights.push(v(cx, upper + S.qdH - 0.4, 0));

  // ---- masts, tops, yards, shrouds, bowsprit ----
  const wTop = (x: number) => weatherY(x);
  for (const m of S.masts) {
    const mx = m.at * H, base = S.decks[0], y0 = wTop(mx);
    const r0 = 0.22 + L * 0.006;
    hull.cyl('wood:pine|stain:honey|fin:oiled', mx, y0 - 0.1, 0, r0, r0 * 0.75, m.h * 0.55, 14, true, 2);                    // lower mast
    hull.cyl('wood:pine|stain:honey|fin:oiled', mx, y0 + m.h * 0.5, 0, r0 * 0.7, r0 * 0.5, m.h * 0.35, 12, true, 2);          // topmast
    hull.cyl('wood:pine|stain:honey|fin:oiled', mx, y0 + m.h * 0.82, 0, r0 * 0.45, r0 * 0.25, m.h * 0.2, 10, true, 2);        // topgallant
    inside.cyl('wood:pine|stain:honey|fin:oiled|in:1', mx, base, 0, r0 * 1.05, r0 * 1.05, y0 - base, 12, false, 2);          // the mast runs down to the keelson
    // fighting top
    hull.cyl(DARK, mx, y0 + m.h * 0.5 - 0.15, 0, r0 * 6, r0 * 6, 0.15, 14, true, 1);
    // yards and the sails hung beneath them
    const yards: number[] = [];
    for (let k = 0; k < m.yards; k++) yards.push(y0 + m.h * (0.24 + k * (0.7 / m.yards)) + 1.2);
    yards.push(y0 + m.h * 0.97);
    for (let k = 0; k < yards.length; k++) {
      const yy = yards[k], span = (S.B * 1.25) * (1 - k * 0.17);
      hull.push().translate(mx + 0.35, yy, 0).rotateX(Math.PI / 2); hull.cyl('wood:pine|stain:walnut|fin:oiled', 0, -span / 2, 0, 0.09 + L * 0.002, 0.06, span, 8, true, 2); hull.pop();
      if (k < yards.length - 1) {
        const nextSpan = (S.B * 1.25) * (1 - (k + 1) * 0.17);
        sails.push({ x: mx + 0.55, top: yards[k + 1] - 0.2, bottom: yy + 0.15, z0: -Math.min(span, nextSpan) * 0.47, z1: Math.min(span, nextSpan) * 0.47 });
      }
    }
    // the course: the big lowest sail from the lowest yard down toward the deck
    sails.push({ x: mx + 0.55, top: yards[0] - 0.15, bottom: y0 + 2.6, z0: -S.B * 0.58, z1: S.B * 0.58 });
    // shrouds down to the channels on each side, with ratlines suggested by a few cross lines
    for (const s of [1, -1]) {
      const chX = [mx - 1.2, mx - 0.4, mx + 0.4, mx + 1.2];
      for (const cx2 of chX) {
        const a = v(cx2, top(cx2) - 0.2, s * (hb(cx2, top(cx2) - 0.4) + 0.25)), b = v(mx, y0 + m.h * 0.5, s * r0 * 4);
        line(hull, a, b, 0.025);
      }
      for (let k = 1; k < 7; k++) { const t = k / 8; const a = v(mx - 1.2 + 0, 0, 0); void a; const p0 = v(mx - 1.2, top(mx) - 0.2, s * (hb(mx, top(mx) - 0.4) + 0.25)).lerp(v(mx, y0 + m.h * 0.5, s * r0 * 4), t); const p1 = v(mx + 1.2, top(mx) - 0.2, s * (hb(mx, top(mx) - 0.4) + 0.25)).lerp(v(mx, y0 + m.h * 0.5, s * r0 * 4), t); line(hull, p0, p1, 0.012); }
    }
  }
  // stays fore and aft between the mastheads, and the bowsprit with its jib
  for (let i = 0; i < S.masts.length - 1; i++) { const a = S.masts[i], b = S.masts[i + 1]; line(hull, v(a.at * H, wTop(a.at * H) + 2, 0), v(b.at * H, wTop(b.at * H) + b.h * 0.95, 0), 0.03); }
  {
    const bx = H + 0.1, by = top(H) - 0.6, ang = 0.28;
    hull.push().translate(bx, by, 0).rotateZ(-Math.PI / 2 + ang); hull.cyl('wood:pine|stain:honey|fin:oiled', 0, 0, 0, 0.28, 0.14, S.bowsprit, 10, true, 2); hull.pop();
    const tip = v(bx + Math.cos(ang) * S.bowsprit, by + Math.sin(ang) * S.bowsprit, 0);
    const fm = S.masts[0];
    const head = v(fm.at * H, wTop(fm.at * H) + fm.h * 0.78, 0);
    line(hull, tip, head, 0.035);
    sails.push({ x: tip.x, top: head.y, bottom: tip.y + 0.4, z0: -0.01, z1: 0.01, jib: true });
    (sails[sails.length - 1] as { jibFrom?: THREE.Vector3; jibTo?: THREE.Vector3 }).jibFrom = tip;
    (sails[sails.length - 1] as { jibFrom?: THREE.Vector3; jibTo?: THREE.Vector3 }).jibTo = head;
  }
  // capstan, bell and the helm on the quarterdeck
  hull.cyl(DARK, H * 0.05 - 2.4, upper, 0, 0.45, 0.4, 1.0, 12, true, 1);
  hull.cyl('brass', fcX - 0.6, upper + S.fcH + 1.2, 0, 0.18, 0.12, 0.3, 10);
  const helm = v(qdX - 2.6 - S.qdH * 0.2, upper + S.qdH, 0);

  // ---- keel ballast and buoyancy points ----
  const yb0 = S.decks[0];
  C(v(0, yb0 * 0.5, 0), v(H * 0.78, Math.max(0.3, yb0 * 0.5), Math.max(0.6, hb(0, yb0 * 0.6) * 0.75)), 1);
  // lower hull side colliders (the outside of the hull below the lowest deck, so the hull meets the sea bed or a dock)
  for (let x = -H * 0.8; x < H * 0.8; x += 3) for (const s of [1, -1]) { const w = hb(x + 1.5, wl * 0.7); if (w > 0.6) C(v(x + 1.5, wl * 0.6, s * (w * 0.6)), v(1.5, wl * 0.35, w * 0.4), 1); }
  const buoy: THREE.Vector3[] = [];
  const nb = cls === 'brigantine' ? 6 : cls === 'leviathan' ? 14 : 9;
  for (let i = 0; i < nb; i++) { const x = -H * 0.85 + (i + 0.5) / nb * H * 1.7; const w = hb(x, wl) * 0.75; for (const s of [1, -1]) buoy.push(v(x, wl - 1, s * w)); }

  return { spec: S, cls, hull, inside, colliders, sails, guns, doors, lights, hammocks, cabin: cab, helm, buoy, waterline: wl, deckY: upper, topY: top(0), hb, top, weatherY,
    stairs: stairList, hatches: hatchXs.filter((hx) => hx > qdX + hatchHalfX && hx < fcX - hatchHalfX).map((x) => ({ x, hx: hatchHalfX, hz: hatchHalfZ })), qdX, fcX };
}

/** A rope or stay: a thin cylinder from a to b. */
function line(g: GeoBuilder, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = b.clone().sub(a), len = d.length();
  if (len < 0.05) return;
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.push(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
  g.cyl('color:3a2e22|r:0.9', 0, 0, 0, r, r, len, 4, false, 1);
  g.pop();
}
