// Procedural furniture library. Every category has several designs; modifiers (wood species, stain,
// finish, fabric, dye, pillows, wear, size, contents) multiply them into well over 750 distinct
// variants. Doors, drawers and lids are separate pivoted parts so they can really open.
import * as THREE from 'three';
import { GeoBuilder } from '../build/geom';
import { WOODS, STAINS, FINISHES, FABRICS, DYES } from './palette';
import { mulberry32 } from '../core/noise';

export interface Movable {
  kind: 'door' | 'drawer' | 'lid' | 'curtain';
  geo: GeoBuilder;
  pivot: THREE.Vector3;          // hinge point / closed position (furniture local space)
  axis: THREE.Vector3;           // rotation axis (door/lid) or slide direction (drawer)
  range: number;                 // radians or metres
  container?: { w: number; h: number; name: string };
  size: THREE.Vector3;           // for the collider
}
export interface CandleSpot { pos: THREE.Vector3; height: number; radius: number }
export interface FurnitureModel {
  id: string; category: Category; name: string;
  geo: GeoBuilder;
  movables: Movable[];
  size: THREE.Vector3;           // footprint w (x), h (y), d (z); origin at floor centre, front faces +z
  container?: { w: number; h: number; name: string };   // whole-piece storage (chests open via lid)
  sleep?: { pos: THREE.Vector3; yaw: number }[];
  seats?: { pos: THREE.Vector3; yaw: number }[];
  surfaces?: { y: number; w: number; d: number; x: number; z: number }[];  // where props can be placed
  candles?: CandleSpot[];
  colliders: { c: THREE.Vector3; h: THREE.Vector3 }[];   // boxes for physics (centre, half extents)
  value: number;
}
export type Category = 'bed' | 'chair' | 'stool' | 'bench' | 'table' | 'desk' | 'wardrobe' | 'drawers' | 'chest' | 'shelf' | 'cupboard' | 'candle' | 'rug' | 'hearth' | 'misc' | 'hammock';

export interface Mods { wood: string; stain: string; fin: string; fabric: string; dye: string; dye2: string; pillows: number; wear: number; size: number; fill: number; seed: number }
const WOOD_KEYS = Object.keys(WOODS).filter((w) => !['planks', 'weathered', 'rough'].includes(w));
const STAIN_KEYS = Object.keys(STAINS);
const FIN_KEYS = Object.keys(FINISHES);
const SHEET_FABRICS = ['linen', 'gingham', 'jacquard', 'floral', 'weave', 'stripe', 'wool', 'fleece', 'velvet', 'satin', 'herringbone'];
const DYE_KEYS = Object.keys(DYES);

const W = (m: Mods) => `wood:${m.wood}|stain:${m.stain}|fin:${m.fin}`;
const C = (m: Mods, second = false) => `cloth:${m.fabric}|dye:${second ? m.dye2 : m.dye}`;

type Design = (g: GeoBuilder, m: Mods, out: FurnitureModel, r: () => number) => void;

function leg(g: GeoBuilder, key: string, x: number, z: number, h: number, w: number, turned: boolean) {
  if (turned) {
    g.cyl(key, x, 0, z, w * 0.45, w * 0.38, h * 0.2, 10);
    g.cyl(key, x, h * 0.2, z, w * 0.55, w * 0.55, h * 0.06, 10);
    g.cyl(key, x, h * 0.26, z, w * 0.38, w * 0.48, h * 0.5, 10);
    g.cyl(key, x, h * 0.76, z, w * 0.55, w * 0.5, h * 0.24, 10);
  } else g.box(key, x, h / 2, z, w, h, w, 2);
}
const box = (g: GeoBuilder, k: string, cx: number, cy: number, cz: number, w: number, h: number, d: number, uv = 2) => g.box(k, cx, cy, cz, w, h, d, uv);
function col(out: FurnitureModel, cx: number, cy: number, cz: number, w: number, h: number, d: number) { out.colliders.push({ c: new THREE.Vector3(cx, cy, cz), h: new THREE.Vector3(w / 2, h / 2, d / 2) }); }

/** A drawer (box with front panel and knob) as a movable part. */
function drawer(out: FurnitureModel, m: Mods, x: number, y: number, zFront: number, w: number, h: number, depth: number, knob = 'brass') {
  const g = new GeoBuilder();
  const k = W(m);
  g.box(k, 0, 0, -0.01, w, h, 0.02, 3);                        // front
  g.box(k, 0, -h / 2 + 0.01, -depth / 2, w - 0.04, 0.012, depth - 0.02, 3); // bottom
  g.box(k, -w / 2 + 0.02, 0, -depth / 2, 0.012, h - 0.02, depth - 0.02, 3);
  g.box(k, w / 2 - 0.02, 0, -depth / 2, 0.012, h - 0.02, depth - 0.02, 3);
  g.box(k, 0, 0, -depth + 0.01, w - 0.04, h - 0.02, 0.012, 3);
  if (knob === 'brass' || knob === 'iron') { g.cyl(knob, 0, -0.005, 0.0, 0.012, 0.012, 0.0, 8); g.push().translate(0, 0, 0.012).rotateX(Math.PI / 2); g.cyl(knob, 0, -0.012, 0, 0.014, 0.012, 0.024, 10); g.pop(); }
  else { g.box(k, 0, 0, 0.015, w * 0.25, 0.02, 0.02, 3); }
  out.movables.push({ kind: 'drawer', geo: g, pivot: new THREE.Vector3(x, y, zFront), axis: new THREE.Vector3(0, 0, 1), range: depth * 0.8, container: { w: Math.max(2, Math.round(w / 0.12)), h: Math.max(1, Math.round(depth / 0.15)), name: 'Drawer' }, size: new THREE.Vector3(w, h, depth) });
}
/** A hinged door panel. hingeX is the hinge side (-1 left, +1 right). */
function door(out: FurnitureModel, m: Mods, x0: number, y0: number, zFront: number, w: number, h: number, hinge: -1 | 1, style: number, knob = 'brass') {
  const g = new GeoBuilder();
  const k = W(m);
  const cx = -hinge * w / 2;
  g.box(k, cx, h / 2, -0.012, w, h, 0.024, 3);
  if (style === 1) { // raised panels
    g.box(k, cx, h * 0.28, 0.004, w * 0.72, h * 0.36, 0.012, 3);
    g.box(k, cx, h * 0.72, 0.004, w * 0.72, h * 0.36, 0.012, 3);
  } else if (style === 2) { // planks + battens
    for (let i = 0; i < 4; i++) g.box(k, cx - w / 2 + w * (i + 0.5) / 4, h / 2, 0.002, w / 4 - 0.006, h, 0.01, 3);
    g.box(k, cx, h * 0.2, 0.01, w * 0.9, 0.06, 0.012, 3); g.box(k, cx, h * 0.8, 0.01, w * 0.9, 0.06, 0.012, 3);
  } else if (style === 3) { // lattice / pie-safe
    for (let i = 1; i < 4; i++) g.box(k, cx, h * i / 4, 0.006, w * 0.9, 0.02, 0.012, 3);
    g.box('iron', cx, h / 2, 0.0, w * 0.75, h * 0.8, 0.003, 3);
  }
  g.box(knob === 'iron' ? 'iron' : 'brass', cx - hinge * (w / 2 - 0.04), h * 0.5, 0.02, 0.018, 0.06, 0.02, 3);
  for (const hy of [0.15, 0.85]) g.box('iron', hinge * 0.0 + (hinge > 0 ? -0.03 : 0.03) * 0, h * hy, 0.008, 0.05, 0.03, 0.004, 3);
  out.movables.push({ kind: 'door', geo: g, pivot: new THREE.Vector3(x0 + (hinge > 0 ? w : 0) * 1 - (hinge > 0 ? 0 : 0), y0, zFront), axis: new THREE.Vector3(0, hinge, 0), range: 1.9, container: undefined, size: new THREE.Vector3(w, h, 0.024) });
}

// -------------------- designs --------------------
const BEDS: Record<string, Design> = {
  plank(g, m, out, r) { bedFrame(g, m, out, r, 0.42, false, 0); },
  four_poster(g, m, out, r) { bedFrame(g, m, out, r, 0.5, true, 0); },
  canopy(g, m, out, r) { bedFrame(g, m, out, r, 0.55, true, 1); },
  pallet(g, m, out, r) { // straw pallet on the floor
    const w = m.size > 0 ? 1.3 : 0.9, l = 1.95;
    g.ellipsoid('straw', 0, 0.09, 0, w / 2, 0.09, l / 2, 16, 0.25);
    bedding(g, m, out, r, w, l, 0.17);
    col(out, 0, 0.09, 0, w, 0.18, l);
  },
  bunk(g, m, out, r) {
    const w = 0.95, l = 2.0, k = W(m);
    for (const [x, z] of [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]]) leg(g, k, x, z, 1.75, 0.08, false);
    for (const y of [0.35, 1.25]) {
      box(g, k, 0, y, -l / 2, w, 0.18, 0.04); box(g, k, 0, y, l / 2, w, 0.18, 0.04);
      box(g, k, -w / 2, y, 0, 0.04, 0.18, l); box(g, k, w / 2, y, 0, 0.04, 0.18, l);
      g.push().translate(0, y - 0.05, 0); bedding(g, m, out, r, w - 0.06, l - 0.06, 0.12); g.pop();
      out.sleep!.push({ pos: new THREE.Vector3(0, y + 0.1, 0), yaw: 0 });
    }
    // ladder
    for (let i = 0; i < 4; i++) box(g, k, w / 2 + 0.02, 0.25 + i * 0.3, l / 2 - 0.4, 0.03, 0.03, 0.4);
    col(out, 0, 0.875, 0, w, 1.75, l);
  },
  cot(g, m, out, r) { // camp cot on X legs with taut canvas
    const w = 0.8, l = 1.95, k = W(m);
    for (const z of [-l / 2 + 0.1, l / 2 - 0.1]) {
      g.push().translate(0, 0.22, z).rotateZ(0.6); box(g, k, 0, 0, 0, 0.04, 0.6, 0.04); g.pop();
      g.push().translate(0, 0.22, z).rotateZ(-0.6); box(g, k, 0, 0, 0, 0.04, 0.6, 0.04); g.pop();
    }
    box(g, k, -w / 2, 0.45, 0, 0.05, 0.05, l); box(g, k, w / 2, 0.45, 0, 0.05, 0.05, l);
    box(g, 'cloth:canvas|dye:undyed', 0, 0.44, 0, w, 0.01, l - 0.1, 2);
    g.push().translate(0, 0.38, 0); bedding(g, m, out, r, w - 0.1, l - 0.2, 0.06); g.pop();
    col(out, 0, 0.23, 0, w, 0.46, l);
  },
  boxbed(g, m, out, r) { // enclosed cupboard bed with an opening and a curtain
    const w = 1.3, l = 2.0, h = 1.9, k = W(m);
    box(g, k, 0, h / 2, -l / 2 + 0.02, w + 0.1, h, 0.04); box(g, k, 0, h / 2, l / 2 - 0.02, w + 0.1, h, 0.04);
    box(g, k, -w / 2, h / 2, 0, 0.04, h, l); box(g, k, 0, h - 0.02, 0, w + 0.1, 0.04, l);
    // front wall with a wide opening (front faces +x here; bed long axis along z)
    box(g, k, w / 2, 0.22, 0, 0.04, 0.44, l); box(g, k, w / 2, h - 0.25, 0, 0.04, 0.5, l);
    box(g, k, w / 2, h / 2, -l / 2 + 0.2, 0.04, h, 0.4); box(g, k, w / 2, h / 2, l / 2 - 0.2, 0.04, h, 0.4);
    g.push().translate(0, 0.3, 0); bedding(g, m, out, r, w - 0.1, l - 0.1, 0.14); g.pop();
    // curtain half drawn
    for (let i = 0; i < 6; i++) g.box(C(m, true), w / 2 + 0.05, 0.95, -l / 2 + 0.3 + i * 0.08 + Math.sin(i * 2) * 0.01, 0.02, 0.9, 0.06, 2);
    out.sleep!.push({ pos: new THREE.Vector3(0, 0.55, 0), yaw: 0 });
    col(out, 0, h / 2, 0, w + 0.1, h, l);
  },
  trundle(g, m, out, r) { // low wide bed with a carved headboard and a pull-out drawer
    bedFrame(g, m, out, r, 0.48, false, 2);
    drawer(out, m, 0, 0.14, 1.0, 1.1, 0.18, 0.8, 'iron');
  },
};
function bedding(g: GeoBuilder, m: Mods, out: FurnitureModel, r: () => number, w: number, l: number, y: number) {
  // mattress, sheet, blanket (folded back or spread), pillows
  g.ellipsoid('cloth:linen|dye:cream', 0, y, 0, w / 2, 0.08, l / 2, 18, 0.18);
  const sheet = C(m), blanket = C(m, true);
  const spread = r() < 0.5;
  if (spread) g.ellipsoid(blanket, 0, y + 0.055, l * 0.06, w / 2 + 0.02, 0.05, l * 0.44, 18, 0.12);
  else { g.ellipsoid(blanket, 0, y + 0.06, l * 0.3, w / 2 + 0.02, 0.05, l * 0.2, 16, 0.12); g.ellipsoid(sheet, 0, y + 0.045, -l * 0.05, w / 2, 0.035, l * 0.3, 16, 0.12); }
  // throw over the foot
  if (r() < 0.4) g.ellipsoid('cloth:fur|dye:undyed', 0, y + 0.1, l * 0.4, w / 2 + 0.03, 0.03, 0.18, 12, 0.2);
  for (let i = 0; i < m.pillows; i++) {
    const px = m.pillows === 1 ? 0 : (i - (m.pillows - 1) / 2) * (w / m.pillows) * 0.95;
    g.push().translate(px, y + 0.1 + (i % 2) * 0.03, -l / 2 + 0.25).rotateX(-0.25 - r() * 0.15).rotateZ((r() - 0.5) * 0.15);
    g.ellipsoid(i % 2 ? sheet : 'cloth:linen|dye:cream', 0, 0, 0, Math.min(0.32, w / Math.max(1, m.pillows) * 0.48), 0.07, 0.18, 14, 0.25);
    g.pop();
  }
}
function bedFrame(g: GeoBuilder, m: Mods, out: FurnitureModel, r: () => number, hgt: number, posts: boolean, canopy: number) {
  const w = m.size > 0 ? 1.45 : 1.0, l = 2.05, k = W(m), turned = posts || r() < 0.5;
  const postH = posts ? 2.1 : hgt + 0.25;
  for (const [x, z, tall] of [[-w / 2, -l / 2, 1], [w / 2, -l / 2, 1], [-w / 2, l / 2, 0], [w / 2, l / 2, 0]] as const) leg(g, k, x, z, tall || posts ? Math.max(postH, 0.95) : hgt + 0.1, 0.085, turned);
  box(g, k, 0, hgt - 0.08, -l / 2, w, 0.16, 0.05); box(g, k, 0, hgt - 0.08, l / 2, w, 0.16, 0.05);
  box(g, k, -w / 2, hgt - 0.08, 0, 0.05, 0.16, l); box(g, k, w / 2, hgt - 0.08, 0, 0.05, 0.16, l);
  // headboard
  const hb = canopy === 2 ? 0.75 : 0.5;
  box(g, k, 0, hgt + hb / 2, -l / 2, w - 0.02, hb, 0.04);
  if (canopy === 2) for (let i = 0; i < 5; i++) g.ellipsoid(k, -w / 2 + (i + 0.5) * w / 5, hgt + hb - 0.05, -l / 2 + 0.02, 0.06, 0.08, 0.03, 8);
  box(g, k, 0, hgt + 0.15, l / 2, w - 0.02, 0.3, 0.04);
  for (let i = 0; i < 7; i++) box(g, k, 0, hgt - 0.12, -l / 2 + (i + 0.5) * l / 7, w - 0.06, 0.03, 0.08); // slats
  if (posts) {
    // top rails
    box(g, k, 0, postH - 0.04, -l / 2, w, 0.08, 0.06); box(g, k, 0, postH - 0.04, l / 2, w, 0.08, 0.06);
    box(g, k, -w / 2, postH - 0.04, 0, 0.06, 0.08, l); box(g, k, w / 2, postH - 0.04, 0, 0.06, 0.08, l);
    if (canopy === 1) {
      g.box(C(m, true), 0, postH + 0.01, 0, w + 0.06, 0.02, l + 0.06, 2);
      // pleated curtains tied back at the posts
      for (const [x, z] of [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]]) {
        for (let i = 0; i < 4; i++) {
          g.push().translate(x + (i - 1.5) * 0.04 * Math.sign(-x), postH * 0.55, z).rotateZ(Math.sign(x) * 0.08);
          g.ellipsoid(C(m, true), 0, 0, 0, 0.035, postH * 0.45, 0.05, 8);
          g.pop();
        }
      }
    }
  }
  g.push().translate(0, hgt - 0.04, 0); bedding(g, m, out, r, w - 0.08, l - 0.1, 0.06); g.pop();
  out.sleep!.push({ pos: new THREE.Vector3(m.size > 0 ? -0.3 : 0, hgt + 0.15, 0), yaw: 0 });
  if (m.size > 0) out.sleep!.push({ pos: new THREE.Vector3(0.3, hgt + 0.15, 0), yaw: 0 });
  col(out, 0, (hgt + 0.2) / 2, 0, w, hgt + 0.2, l);
  if (posts) for (const [x, z] of [[-w / 2, -l / 2], [w / 2, -l / 2], [-w / 2, l / 2], [w / 2, l / 2]]) col(out, x, postH / 2, z, 0.09, postH, 0.09);
  else col(out, 0, hgt + 0.25, -l / 2, w, 0.5, 0.05);
}

const CHAIRS: Record<string, Design> = {
  stick(g, m, out) { chairBase(g, m, out, 0.44, false); const k = W(m); for (let i = 0; i < 6; i++) g.cyl(k, -0.17 + i * 0.068, 0.46, -0.2, 0.012, 0.01, 0.48, 6); g.push().translate(0, 0.96, -0.2); box(g, k, 0, 0, 0, 0.44, 0.06, 0.05); g.pop(); },
  ladderback(g, m, out) { chairBase(g, m, out, 0.45, true); const k = W(m); for (let i = 0; i < 4; i++) box(g, k, 0, 0.6 + i * 0.12, -0.21, 0.4, 0.06, 0.02); },
  panel(g, m, out) { chairBase(g, m, out, 0.46, true); const k = W(m); box(g, k, 0, 0.82, -0.21, 0.42, 0.6, 0.03); g.ellipsoid(k, 0, 1.15, -0.21, 0.23, 0.06, 0.03, 10); },
  armchair(g, m, out) { chairBase(g, m, out, 0.44, true, 0.58); const k = W(m); box(g, k, 0, 0.78, -0.25, 0.54, 0.62, 0.04); for (const x of [-0.29, 0.29]) { box(g, k, x, 0.66, 0, 0.05, 0.04, 0.5); leg(g, k, x, 0.22, 0.66, 0.045, true); } g.ellipsoid(C(m), 0, 0.5, 0.02, 0.25, 0.05, 0.23, 12, 0.3); g.ellipsoid(C(m), 0, 0.8, -0.21, 0.24, 0.24, 0.05, 12, 0.3); },
  folding(g, m, out) { // savonarola X-frame
    const k = W(m);
    for (const x of [-0.22, 0.22]) for (const s of [1, -1]) { g.push().translate(x, 0.24, 0).rotateX(s * 0.75); box(g, k, 0, 0, 0, 0.04, 0.62, 0.04); g.pop(); }
    box(g, 'cloth:leather|dye:undyed', 0, 0.46, 0, 0.44, 0.02, 0.4); box(g, k, 0, 0.78, -0.2, 0.46, 0.08, 0.03);
    for (const x of [-0.22, 0.22]) box(g, k, x, 0.62, -0.2, 0.04, 0.32, 0.03);
    out.seats!.push({ pos: new THREE.Vector3(0, 0.47, 0), yaw: 0 }); col(out, 0, 0.4, 0, 0.5, 0.8, 0.45);
  },
  throne(g, m, out) {
    chairBase(g, m, out, 0.5, true, 0.72);
    const k = W(m);
    box(g, k, 0, 1.25, -0.3, 0.7, 1.5, 0.08);
    for (const x of [-0.36, 0.36]) { box(g, k, x, 0.78, -0.02, 0.08, 0.1, 0.62); g.ellipsoid('gold', x, 0.85, 0.28, 0.05, 0.05, 0.05, 8); g.cyl(k, x, 0, 0.28, 0.05, 0.05, 0.8, 10); }
    g.ellipsoid('gold', 0, 2.05, -0.3, 0.12, 0.12, 0.04, 10);
    g.ellipsoid(`cloth:velvet|dye:${m.dye}`, 0, 0.56, 0.0, 0.32, 0.06, 0.3, 12, 0.3);
    g.box(`cloth:velvet|dye:${m.dye}`, 0, 1.1, -0.25, 0.56, 1.0, 0.03, 2);
    col(out, 0, 1.0, -0.2, 0.8, 2.0, 0.3);
  },
  settle(g, m, out) { // high-backed wooden settle (seats two)
    const k = W(m);
    box(g, k, 0, 0.42, 0, 1.2, 0.05, 0.45); box(g, k, 0, 0.9, -0.21, 1.2, 1.0, 0.04);
    for (const x of [-0.6, 0.6]) box(g, k, x, 0.6, 0, 0.05, 1.2, 0.48);
    box(g, k, 0, 0.2, 0.2, 1.2, 0.4, 0.03);
    out.seats!.push({ pos: new THREE.Vector3(-0.3, 0.44, 0), yaw: 0 }, { pos: new THREE.Vector3(0.3, 0.44, 0), yaw: 0 });
    col(out, 0, 0.6, 0, 1.25, 1.2, 0.48);
  },
  spindle(g, m, out) { chairBase(g, m, out, 0.44, true); const k = W(m); for (let i = 0; i < 5; i++) g.cyl(k, -0.16 + i * 0.08, 0.46, -0.21, 0.014, 0.014, 0.4, 8); box(g, k, 0, 0.9, -0.21, 0.42, 0.08, 0.04); },
};
function chairBase(g: GeoBuilder, m: Mods, out: FurnitureModel, seatH: number, turned: boolean, w = 0.44) {
  const k = W(m), d = 0.42;
  for (const [x, z] of [[-w / 2 + 0.03, -d / 2 + 0.03], [w / 2 - 0.03, -d / 2 + 0.03], [-w / 2 + 0.03, d / 2 - 0.03], [w / 2 - 0.03, d / 2 - 0.03]]) leg(g, k, x, z, seatH, 0.045, turned);
  // back posts
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) box(g, k, x, seatH + 0.28, -d / 2 + 0.03, 0.045, 0.56, 0.045);
  box(g, k, 0, seatH, 0, w, 0.04, d);
  for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) box(g, k, 0, seatH * 0.35, z, w - 0.06, 0.03, 0.025);
  if (m.fill > 0.5) g.ellipsoid(C(m), 0, seatH + 0.035, 0.01, w / 2 - 0.03, 0.03, d / 2 - 0.03, 10, 0.3);
  out.seats!.push({ pos: new THREE.Vector3(0, seatH + 0.02, 0), yaw: 0 });
  col(out, 0, seatH / 2, 0, w, seatH, d);
  col(out, 0, seatH + 0.3, -d / 2 + 0.03, w, 0.6, 0.05);
}

const STOOLS: Record<string, Design> = {
  milking(g, m, out) { const k = W(m); g.cyl(k, 0, 0.27, 0, 0.16, 0.16, 0.04, 16); for (let i = 0; i < 3; i++) { const a = i * 2.094; g.push().translate(Math.cos(a) * 0.09, 0.13, Math.sin(a) * 0.09).rotateZ(Math.cos(a) * -0.2).rotateX(Math.sin(a) * 0.2); g.cyl(k, 0, -0.14, 0, 0.018, 0.02, 0.28, 8); g.pop(); } out.seats!.push({ pos: new THREE.Vector3(0, 0.31, 0), yaw: 0 }); col(out, 0, 0.15, 0, 0.3, 0.3, 0.3); },
  square(g, m, out) { const k = W(m); box(g, k, 0, 0.45, 0, 0.36, 0.04, 0.36); for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) leg(g, k, x, z, 0.44, 0.04, false); for (const z of [-0.15, 0.15]) box(g, k, 0, 0.15, z, 0.3, 0.03, 0.02); out.seats!.push({ pos: new THREE.Vector3(0, 0.47, 0), yaw: 0 }); col(out, 0, 0.23, 0, 0.36, 0.47, 0.36); },
  tall(g, m, out) { const k = W(m); g.cyl(k, 0, 0.72, 0, 0.18, 0.18, 0.05, 16); for (let i = 0; i < 4; i++) { const a = i * 1.571 + 0.785; leg(g, k, Math.cos(a) * 0.14, Math.sin(a) * 0.14, 0.72, 0.035, true); } g.cyl('iron', 0, 0.26, 0, 0.16, 0.16, 0.02, 16, false); out.seats!.push({ pos: new THREE.Vector3(0, 0.77, 0), yaw: 0 }); col(out, 0, 0.38, 0, 0.36, 0.77, 0.36); },
  foot(g, m, out) { const k = W(m); for (const [x, z] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) leg(g, k, x, z, 0.2, 0.035, true); g.ellipsoid(C(m), 0, 0.25, 0, 0.23, 0.07, 0.16, 12, 0.3); box(g, k, 0, 0.19, 0, 0.42, 0.04, 0.3); col(out, 0, 0.15, 0, 0.44, 0.3, 0.32); },
  stump(g, _m, out) { g.cyl('mat:pine_bark', 0, 0, 0, 0.2, 0.18, 0.44, 14, false); g.cyl('wood:planks|stain:honey', 0, 0.44, 0, 0.18, 0.18, 0.005, 14); out.seats!.push({ pos: new THREE.Vector3(0, 0.45, 0), yaw: 0 }); col(out, 0, 0.22, 0, 0.38, 0.45, 0.38); },
  three_leg_round(g, m, out) { const k = W(m); g.cyl(k, 0, 0.42, 0, 0.17, 0.17, 0.045, 16); for (let i = 0; i < 3; i++) { const a = i * 2.094; leg(g, k, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.42, 0.04, true); } out.seats!.push({ pos: new THREE.Vector3(0, 0.47, 0), yaw: 0 }); col(out, 0, 0.23, 0, 0.34, 0.47, 0.34); },
};
const BENCHES: Record<string, Design> = {
  plank(g, m, out) { benchBase(g, m, out, 1.4 + m.size * 0.4, false); },
  backed(g, m, out) { benchBase(g, m, out, 1.5, true); },
  trestle(g, m, out) { const k = W(m), L = 1.8; box(g, k, 0, 0.45, 0, L, 0.05, 0.32); for (const x of [-L / 2 + 0.2, L / 2 - 0.2]) { g.push().translate(x, 0.22, 0).rotateX(0.25); box(g, k, 0, 0, 0, 0.05, 0.46, 0.05); g.pop(); g.push().translate(x, 0.22, 0).rotateX(-0.25); box(g, k, 0, 0, 0, 0.05, 0.46, 0.05); g.pop(); } for (const x of [-0.6, 0, 0.6]) out.seats!.push({ pos: new THREE.Vector3(x, 0.47, 0), yaw: 0 }); col(out, 0, 0.23, 0, L, 0.47, 0.34); },
  pew(g, m, out) { benchBase(g, m, out, 2.4, true); const k = W(m); for (const x of [-1.2, 1.2]) { box(g, k, x, 0.5, 0, 0.06, 1.0, 0.55); g.ellipsoid(k, x, 1.0, 0, 0.03, 0.1, 0.28, 10); } },
  log(g, _m, out) { g.push().rotateZ(Math.PI / 2); g.cyl('mat:pine_bark', 0, -0.9, 0, 0.2, 0.19, 1.8, 14, true, 1); g.pop(); for (const x of [-0.5, 0.5]) out.seats!.push({ pos: new THREE.Vector3(x, 0.4, 0), yaw: 0 }); col(out, 0, 0.2, 0, 1.8, 0.4, 0.4); },
};
function benchBase(g: GeoBuilder, m: Mods, out: FurnitureModel, L: number, back: boolean) {
  const k = W(m);
  box(g, k, 0, 0.44, 0, L, 0.05, 0.36);
  for (const x of [-L / 2 + 0.12, L / 2 - 0.12]) { box(g, k, x, 0.21, 0, 0.05, 0.42, 0.32); }
  box(g, k, 0, 0.12, 0, L - 0.3, 0.06, 0.03);
  if (back) { box(g, k, 0, 0.75, -0.2, L, 0.4, 0.035); for (const x of [-L / 2 + 0.12, L / 2 - 0.12]) box(g, k, x, 0.65, -0.19, 0.05, 0.45, 0.05); col(out, 0, 0.75, -0.2, L, 0.45, 0.05); }
  const n = Math.max(2, Math.floor(L / 0.55));
  for (let i = 0; i < n; i++) out.seats!.push({ pos: new THREE.Vector3(-L / 2 + (i + 0.5) * L / n, 0.47, 0), yaw: 0 });
  col(out, 0, 0.23, 0, L, 0.47, 0.36);
}

const TABLES: Record<string, Design> = {
  trestle(g, m, out) { const k = W(m), L = 2.0, D = 0.85; top(g, k, out, L, D, 0.76, 0.05); for (const x of [-L / 2 + 0.25, L / 2 - 0.25]) { box(g, k, x, 0.38, 0, 0.08, 0.72, 0.08); box(g, k, x, 0.04, 0, 0.1, 0.08, D - 0.1); box(g, k, x, 0.7, 0, 0.08, 0.06, D - 0.1); } box(g, k, 0, 0.3, 0, L - 0.5, 0.08, 0.05); },
  round(g, m, out) { const k = W(m), R = 0.55 + m.size * 0.15; g.cyl(k, 0, 0.72, 0, R, R, 0.045, 28); g.cyl(k, 0, 0.0, 0, 0.09, 0.06, 0.72, 12); for (let i = 0; i < 4; i++) { g.push().rotateY(i * Math.PI / 2); box(g, k, 0.18, 0.04, 0, 0.38, 0.06, 0.07); g.pop(); } out.surfaces!.push({ y: 0.765, w: R * 1.4, d: R * 1.4, x: 0, z: 0 }); col(out, 0, 0.74, 0, R * 1.8, 0.05, R * 1.8); col(out, 0, 0.36, 0, 0.15, 0.72, 0.15); },
  square(g, m, out) { const k = W(m), L = 0.95, D = 0.95; top(g, k, out, L, D, 0.75, 0.045); legs4(g, k, L, D, 0.73, 0.06, m.fill > 0.5); },
  refectory(g, m, out) { const k = W(m), L = 3.2, D = 0.95; top(g, k, out, L, D, 0.77, 0.07); legs4(g, k, L, D, 0.7, 0.1, true); box(g, k, 0, 0.12, 0, L - 0.3, 0.06, 0.06); },
  side(g, m, out) { const k = W(m), L = 0.5, D = 0.45; top(g, k, out, L, D, 0.68, 0.03); legs4(g, k, L, D, 0.66, 0.04, true); box(g, k, 0, 0.2, 0, L - 0.08, 0.02, D - 0.08); },
  kitchen(g, m, out) { const k = W(m), L = 1.6, D = 0.75; top(g, k, out, L, D, 0.86, 0.06); legs4(g, k, L, D, 0.82, 0.08, false); box(g, k, 0, 0.18, 0, L - 0.1, 0.03, D - 0.1); drawer(out, m, 0, 0.74, D / 2 - 0.02, 0.5, 0.12, 0.55, 'iron'); },
  gateleg(g, m, out) { const k = W(m), L = 1.1, D = 1.2; top(g, k, out, L, 0.45, 0.74, 0.04); for (const s of [1, -1]) { g.push().translate(0, 0.74, s * 0.42).rotateX(-s * 0.08); box(g, k, 0, 0, 0, L, 0.035, 0.38); g.pop(); } legs4(g, k, L, 0.4, 0.72, 0.05, true); void D; },
  tavern(g, m, out) { const k = W(m), L = 1.3, D = 0.8; top(g, k, out, L, D, 0.76, 0.06); legs4(g, k, L, D, 0.72, 0.09, false); for (const z of [-D / 2 + 0.06, D / 2 - 0.06]) box(g, k, 0, 0.12, z, L - 0.15, 0.05, 0.04); },
  altar(g, m, out) { const k = W(m), L = 1.8, D = 0.8; top(g, k, out, L, D, 1.0, 0.08); box(g, k, 0, 0.48, 0, L - 0.15, 0.94, D - 0.15); g.box(`cloth:jacquard|dye:${m.dye}`, 0, 1.045, 0, L - 0.1, 0.01, D + 0.02, 2); g.box(`cloth:jacquard|dye:${m.dye}`, 0, 0.75, D / 2 + 0.005, 0.6, 0.6, 0.01, 2); },
  workbench(g, m, out) { const k = W(m), L = 2.0, D = 0.7; top(g, k, out, L, D, 0.86, 0.09); legs4(g, k, L, D, 0.8, 0.1, false); box(g, k, 0, 0.2, 0, L - 0.2, 0.04, D - 0.1); g.box('iron', -L / 2 + 0.15, 0.9, D / 2 - 0.05, 0.18, 0.08, 0.1, 3); },
};
function top(g: GeoBuilder, k: string, out: FurnitureModel, L: number, D: number, y: number, t: number) {
  box(g, k, 0, y, 0, L, t, D, 1.5);
  out.surfaces!.push({ y: y + t / 2, w: L - 0.1, d: D - 0.1, x: 0, z: 0 });
  col(out, 0, y, 0, L, t, D);
}
function legs4(g: GeoBuilder, k: string, L: number, D: number, h: number, w: number, turned: boolean) {
  for (const [x, z] of [[-L / 2 + w, -D / 2 + w], [L / 2 - w, -D / 2 + w], [-L / 2 + w, D / 2 - w], [L / 2 - w, D / 2 - w]]) leg(g, k, x, z, h, w, turned);
  for (const z of [-D / 2 + w, D / 2 - w]) box(g, k, 0, h - 0.06, z, L - w * 2, 0.08, 0.025);
  for (const x of [-L / 2 + w, L / 2 - w]) box(g, k, x, h - 0.06, 0, 0.025, 0.08, D - w * 2);
}

const DESKS: Record<string, Design> = {
  writing(g, m, out) { const k = W(m), L = 1.2, D = 0.6; top(g, k, out, L, D, 0.76, 0.035); legs4(g, k, L, D, 0.74, 0.045, true); drawer(out, m, -0.3, 0.68, D / 2 - 0.01, 0.45, 0.1, 0.5); drawer(out, m, 0.3, 0.68, D / 2 - 0.01, 0.45, 0.1, 0.5); },
  slant(g, m, out) { const k = W(m), L = 0.9, D = 0.6; legs4(g, k, L, D, 0.72, 0.045, true); g.push().translate(0, 0.86, 0).rotateX(0.32); box(g, k, 0, 0, 0, L, 0.03, D); g.pop(); box(g, k, 0, 1.0, -D / 2 + 0.05, L, 0.05, 0.12); g.box('paper', 0.1, 0.9, 0.05, 0.3, 0.004, 0.4); g.cyl('ceramic|c:2a2a2a|glaze:1', -0.3, 1.025, -0.25, 0.025, 0.03, 0.06, 10); out.surfaces!.push({ y: 1.025, w: L - 0.1, d: 0.1, x: 0, z: -D / 2 + 0.05 }); col(out, 0, 0.5, 0, L, 1.0, D); },
  bureau(g, m, out) {
    const k = W(m), L = 1.0, D = 0.55, H = 1.05;
    box(g, k, 0, H / 2, -D / 2 + 0.01, L, H, 0.02); for (const x of [-L / 2, L / 2]) box(g, k, x, H / 2, 0, 0.025, H, D);
    box(g, k, 0, 0.02, 0, L, 0.04, D); box(g, k, 0, H, 0, L, 0.03, D);
    for (let i = 0; i < 3; i++) drawer(out, m, 0, 0.14 + i * 0.2, D / 2, L - 0.06, 0.18, D - 0.05);
    // pigeonholes behind the writing flap
    for (let i = 0; i < 5; i++) box(g, k, -0.4 + i * 0.2, 0.9, -0.1, 0.012, 0.25, 0.25);
    box(g, k, 0, 0.78, 0.1, L - 0.04, 0.025, 0.4);
    out.surfaces!.push({ y: H + 0.015, w: L - 0.1, d: D - 0.1, x: 0, z: 0 });
    col(out, 0, H / 2, 0, L, H, D);
  },
  counter(g, m, out) { const k = W(m), L = 2.2, D = 0.65; top(g, k, out, L, D, 1.0, 0.06); box(g, k, 0, 0.5, D / 2 - 0.03, L, 0.98, 0.04); for (const x of [-L / 2, L / 2]) box(g, k, x, 0.5, 0, 0.04, 0.98, D); box(g, k, 0, 0.35, -0.05, L - 0.06, 0.03, D - 0.1); col(out, 0, 0.5, 0, L, 1.0, D); },
  lectern(g, m, out) { const k = W(m); g.cyl(k, 0, 0, 0, 0.2, 0.06, 0.08, 12); g.cyl(k, 0, 0.08, 0, 0.05, 0.05, 1.0, 10); g.push().translate(0, 1.15, 0).rotateX(0.5); box(g, k, 0, 0, 0, 0.55, 0.03, 0.4); g.box('paper|c:e8dcc0', 0, 0.025, 0, 0.42, 0.02, 0.3); g.pop(); col(out, 0, 0.6, 0, 0.5, 1.2, 0.4); },
  map(g, m, out) { const k = W(m), L = 1.8, D = 1.2; top(g, k, out, L, D, 0.85, 0.06); legs4(g, k, L, D, 0.8, 0.09, true); g.box('paper|c:d8c8a0', 0, 0.885, 0, 1.2, 0.003, 0.85); for (let i = 0; i < 6; i++) g.cyl(i % 2 ? 'color:a02820' : 'color:2040a0', -0.4 + i * 0.16, 0.886, Math.sin(i) * 0.3, 0.015, 0.01, 0.04, 8); },
};

const WARDROBES: Record<string, Design> = {
  armoire(g, m, out, r) { cabinet(g, m, out, r, 1.2, 1.95, 0.58, 2, 0, 1); },
  single(g, m, out, r) { cabinet(g, m, out, r, 0.7, 1.9, 0.55, 1, 0, 2); },
  linen_press(g, m, out, r) { cabinet(g, m, out, r, 1.15, 1.9, 0.55, 2, 2, 1); },
  corner(g, m, out, r) { cabinet(g, m, out, r, 0.75, 1.8, 0.45, 1, 0, 1); },
  tall_narrow(g, m, out, r) { cabinet(g, m, out, r, 0.6, 2.1, 0.5, 1, 1, 2); },
  painted(g, m, out, r) { const mm = { ...m, wood: 'peeling' }; cabinet(g, mm, out, r, 1.1, 1.85, 0.55, 2, 0, 2); },
};
function cabinet(g: GeoBuilder, m: Mods, out: FurnitureModel, r: () => number, Wd: number, H: number, D: number, doors: number, drawersBelow: number, style: number) {
  const k = W(m), t = 0.025;
  box(g, k, 0, H / 2, -D / 2 + t / 2, Wd, H, t);
  for (const x of [-Wd / 2 + t / 2, Wd / 2 - t / 2]) box(g, k, x, H / 2, 0, t, H, D);
  box(g, k, 0, 0.06, 0, Wd, 0.04, D); box(g, k, 0, H - t / 2, 0, Wd, t, D);
  // cornice and plinth
  box(g, k, 0, H + 0.03, 0.01, Wd + 0.06, 0.06, D + 0.04); box(g, k, 0, 0.04, 0.01, Wd + 0.03, 0.08, D + 0.02);
  const drawerH = 0.2, base = 0.1 + drawersBelow * drawerH;
  for (let i = 0; i < drawersBelow; i++) drawer(out, m, 0, 0.1 + i * drawerH + drawerH / 2, D / 2, Wd - 0.06, drawerH - 0.02, D - 0.06);
  // shelves and a hanging rail
  box(g, k, 0, base + (H - base) * 0.75, 0, Wd - 0.05, 0.02, D - 0.05);
  g.cyl('iron', 0, 0, 0, 0, 0, 0, 4, false);
  g.push().translate(-Wd / 2 + 0.03, base + (H - base) * 0.68, 0).rotateZ(-Math.PI / 2); g.cyl('iron', 0, 0, 0, 0.012, 0.012, Wd - 0.06, 8); g.pop();
  // clothes hanging inside
  for (let i = 0; i < 3; i++) if (r() < 0.75) g.ellipsoid(`cloth:${['linen', 'wool', 'weave'][i % 3]}|dye:${DYE_KEYS[Math.floor(r() * DYE_KEYS.length)]}`, -Wd / 2 + 0.2 + i * (Wd - 0.3) / 2.5, base + (H - base) * 0.42, 0, 0.03, (H - base) * 0.25, D * 0.35, 8);
  const dw = (Wd - 0.04) / doors;
  for (let i = 0; i < doors; i++) {
    const hinge = (doors === 1 ? -1 : i === 0 ? -1 : 1) as -1 | 1;
    const x0 = -Wd / 2 + 0.02 + i * dw;
    door(out, m, hinge < 0 ? x0 : x0 + dw - dw, base, D / 2, dw - 0.004, H - base - 0.04, hinge, style);
    const mv = out.movables[out.movables.length - 1];
    mv.pivot.set(hinge < 0 ? x0 : x0 + dw, base, D / 2);
    mv.container = i === 0 ? { w: Math.round(Wd * 6), h: Math.round(H * 3), name: 'Wardrobe' } : undefined;
  }
  out.surfaces!.push({ y: H + 0.06, w: Wd - 0.1, d: D - 0.1, x: 0, z: 0 });
  col(out, 0, H / 2, -0.01, Wd, H, D - 0.02);
}

const DRAWERS: Record<string, Design> = {
  three(g, m, out) { chestOfDrawers(g, m, out, 0.9, 0.85, 0.5, [1, 1, 1], true); },
  tall(g, m, out) { chestOfDrawers(g, m, out, 0.85, 1.35, 0.5, [1, 1, 1, 1, 1], false); },
  wide(g, m, out) { chestOfDrawers(g, m, out, 1.4, 0.85, 0.52, [2, 2, 2], true); },
  nightstand(g, m, out) { chestOfDrawers(g, m, out, 0.45, 0.62, 0.4, [1], true); },
  apothecary(g, m, out) { chestOfDrawers(g, m, out, 1.0, 1.2, 0.4, [4, 4, 4, 4, 4], false, 'brass'); },
  dresser_mirror(g, m, out) { chestOfDrawers(g, m, out, 1.1, 0.82, 0.5, [2, 1, 1], true); const k = W(m); box(g, k, 0, 1.25, -0.22, 0.75, 0.8, 0.04); g.box('silver', 0, 1.25, -0.195, 0.62, 0.68, 0.005, 1); },
  blanket_low(g, m, out) { chestOfDrawers(g, m, out, 1.2, 0.5, 0.5, [2], true); },
};
function chestOfDrawers(g: GeoBuilder, m: Mods, out: FurnitureModel, Wd: number, H: number, D: number, rows: number[], legsOn: boolean, knob = m.seed % 2 ? 'brass' : 'iron') {
  const k = W(m), t = 0.025, foot = legsOn ? 0.1 : 0.05;
  box(g, k, 0, foot + (H - foot) / 2, -D / 2 + t / 2, Wd, H - foot, t);
  for (const x of [-Wd / 2 + t / 2, Wd / 2 - t / 2]) box(g, k, x, foot + (H - foot) / 2, 0, t, H - foot, D);
  box(g, k, 0, H, 0, Wd + 0.03, 0.03, D + 0.02);
  box(g, k, 0, foot + 0.01, 0, Wd, 0.02, D);
  if (legsOn) for (const [x, z] of [[-Wd / 2 + 0.04, -D / 2 + 0.04], [Wd / 2 - 0.04, -D / 2 + 0.04], [-Wd / 2 + 0.04, D / 2 - 0.04], [Wd / 2 - 0.04, D / 2 - 0.04]]) leg(g, k, x, z, foot, 0.05, true);
  else box(g, k, 0, foot / 2, 0.005, Wd, foot, D - 0.01);
  const rowH = (H - foot - 0.04) / rows.length;
  rows.forEach((n, ri) => {
    const y = H - 0.03 - rowH * (ri + 0.5);
    const dw = (Wd - 0.06) / n;
    for (let i = 0; i < n; i++) drawer(out, m, -Wd / 2 + 0.03 + dw * (i + 0.5), y, D / 2, dw - 0.008, rowH - 0.01, D - 0.05, knob);
    box(g, k, 0, y - rowH / 2, D / 2 - 0.01, Wd - 0.04, 0.015, 0.02);
  });
  out.surfaces!.push({ y: H + 0.015, w: Wd - 0.1, d: D - 0.1, x: 0, z: 0 });
  col(out, 0, H / 2, -0.02, Wd, H, D - 0.04);
}

const CHESTS: Record<string, Design> = {
  plank(g, m, out) { chest(g, m, out, 0.9, 0.48, 0.5, 0, false); },
  dome(g, m, out) { chest(g, m, out, 0.9, 0.45, 0.52, 1, true); },
  strongbox(g, m, out) { chest(g, m, out, 0.6, 0.38, 0.4, 0, true); },
  dowry(g, m, out) { chest(g, m, out, 1.2, 0.55, 0.55, 2, false); },
  blanket(g, m, out) { chest(g, m, out, 1.1, 0.5, 0.48, 0, false); },
  sea(g, m, out) { chest(g, m, out, 0.95, 0.45, 0.5, 3, true); },
};
function chest(g: GeoBuilder, m: Mods, out: FurnitureModel, Wd: number, H: number, D: number, style: number, bands: boolean) {
  const k = W(m), t = 0.025;
  box(g, k, 0, H / 2, -D / 2 + t / 2, Wd, H, t); box(g, k, 0, H / 2, D / 2 - t / 2, Wd, H, t);
  for (const x of [-Wd / 2 + t / 2, Wd / 2 - t / 2]) box(g, k, x, H / 2, 0, t, H, D);
  box(g, k, 0, 0.03, 0, Wd, 0.03, D);
  if (style === 2) for (let i = 0; i < 3; i++) { g.box(k, -Wd / 3 + i * Wd / 3, H / 2, D / 2 + 0.005, Wd * 0.25, H * 0.6, 0.012, 3); g.ellipsoid(k, -Wd / 3 + i * Wd / 3, H / 2, D / 2 + 0.012, Wd * 0.07, H * 0.17, 0.01, 10); }
  if (bands) for (const x of [-Wd / 2 + 0.08, Wd / 2 - 0.08]) { g.box('iron', x, H / 2, D / 2 + 0.003, 0.04, H, 0.006, 3); g.box('iron', x, H / 2, -D / 2 - 0.003, 0.04, H, 0.006, 3); }
  if (style === 3) for (const x of [-Wd / 2 - 0.02, Wd / 2 + 0.02]) { g.push().translate(x, H * 0.7, 0).rotateZ(Math.PI / 2); g.cyl('cloth:hessian|dye:undyed', 0, -0.01, 0, 0.012, 0.012, 0.02, 6); g.pop(); g.ellipsoid('cloth:hessian|dye:undyed', x, H * 0.62, 0, 0.012, 0.06, 0.07, 8); }
  g.box('iron', 0, H - 0.07, D / 2 + 0.008, 0.07, 0.09, 0.01, 3);
  // lid hinged at the back
  const lg = new GeoBuilder();
  if (style === 1 || style === 3) {
    lg.push().translate(0, 0, D / 2).rotateZ(Math.PI / 2);
    lg.cyl(k, 0, -Wd / 2, 0, D / 2, D / 2, Wd, 16, true);
    lg.pop();
    lg.box(k, 0, -0.01, D / 2, Wd, 0.02, D, 2);
    if (bands) for (const x of [-Wd / 2 + 0.08, Wd / 2 - 0.08]) { lg.push().translate(x, 0, D / 2).rotateZ(Math.PI / 2); lg.cyl('iron', 0, -0.02, 0, D / 2 + 0.005, D / 2 + 0.005, 0.04, 16, false); lg.pop(); }
  } else {
    lg.box(k, 0, 0.02, D / 2, Wd + 0.02, 0.04, D + 0.02, 2);
    if (bands) for (const x of [-Wd / 2 + 0.08, Wd / 2 - 0.08]) lg.box('iron', x, 0.042, D / 2, 0.04, 0.005, D + 0.02, 3);
  }
  out.movables.push({ kind: 'lid', geo: lg, pivot: new THREE.Vector3(0, H, -D / 2), axis: new THREE.Vector3(-1, 0, 0), range: 1.7, container: { w: Math.round(Wd * 8), h: Math.round(D * 8), name: 'Chest' }, size: new THREE.Vector3(Wd, 0.04, D) });
  out.container = { w: Math.round(Wd * 8), h: Math.round(D * 8), name: 'Chest' };
  out.seats!.push({ pos: new THREE.Vector3(0, H + 0.03, 0), yaw: 0 });
  col(out, 0, H / 2, 0, Wd, H, D);
}

const SHELVES: Record<string, Design> = {
  wall(g, m, out, r) { shelfUnit(g, m, out, r, 1.0, 0.3, 0.22, 2, false, 1.4); },
  bookcase(g, m, out, r) { shelfUnit(g, m, out, r, 1.0, 1.9, 0.32, 5, true, 0); },
  open(g, m, out, r) { shelfUnit(g, m, out, r, 1.2, 1.6, 0.4, 4, false, 0); },
  plate_rack(g, m, out, r) { shelfUnit(g, m, out, r, 1.0, 0.8, 0.18, 2, false, 1.2, 'plates'); },
  spice(g, m, out, r) { shelfUnit(g, m, out, r, 0.7, 0.6, 0.16, 3, false, 1.3, 'jars'); },
  hanging(g, m, out, r) { shelfUnit(g, m, out, r, 1.1, 0.04, 0.3, 1, false, 1.8, 'pots'); },
};
function shelfUnit(g: GeoBuilder, m: Mods, out: FurnitureModel, r: () => number, Wd: number, H: number, D: number, n: number, books: boolean, mountY: number, fill = 'mixed') {
  const k = W(m);
  g.translate(0, mountY, 0);
  if (H > 0.2) { for (const x of [-Wd / 2, Wd / 2]) box(g, k, x, H / 2, 0, 0.025, H, D); box(g, k, 0, H / 2, -D / 2 + 0.01, Wd, H, 0.012); }
  for (let i = 0; i <= n; i++) {
    const y = n === 1 ? 0 : (H - 0.02) * (i / n) + 0.01;
    box(g, k, 0, y, 0, Wd, 0.025, D);
    if (i === n && n > 1) break;
    // contents on each shelf
    let x = -Wd / 2 + 0.05;
    const space = n === 1 ? 0.35 : (H / n) - 0.04;
    while (x < Wd / 2 - 0.06) {
      const kind = books || fill === 'mixed' && r() < 0.5 ? 'book' : fill === 'plates' ? 'plate' : fill === 'jars' ? 'jar' : fill === 'pots' ? 'pot' : r() < 0.5 ? 'jar' : 'bowl';
      if (r() < 0.15) { x += 0.08; continue; }
      if (kind === 'book') {
        const bw = 0.03 + r() * 0.035, bh = space * (0.62 + r() * 0.3), lean = r() < 0.1 ? 0.25 : 0;
        g.push().translate(x + bw / 2, y + 0.0125 + bh / 2, 0.02).rotateZ(lean);
        g.box(`cloth:leather|dye:${DYE_KEYS[Math.floor(r() * DYE_KEYS.length)]}`, 0, 0, 0, bw, bh, D * 0.75, 4);
        g.pop();
        x += bw + 0.003 + (lean ? 0.06 : 0);
      } else if (kind === 'plate') {
        g.push().translate(x + 0.12, y + 0.13, -D / 2 + 0.05).rotateX(-1.3); g.cyl('ceramic|c:e8e0d0|glaze:1', 0, 0, 0, 0.12, 0.11, 0.015, 18); g.pop(); x += 0.26;
      } else if (kind === 'jar') {
        const jr = 0.035 + r() * 0.03, jh = Math.min(space * 0.8, 0.08 + r() * 0.1);
        g.cyl(`ceramic|c:${['8a5030', 'b08850', '506070', 'c0b090'][Math.floor(r() * 4)]}${r() < 0.5 ? '|glaze:1' : ''}`, x + jr, y + 0.0125, 0, jr, jr * 0.75, jh, 12);
        x += jr * 2 + 0.02;
      } else if (kind === 'pot') {
        g.cyl('iron', x + 0.1, y - 0.25, 0, 0.1, 0.11, 0.18, 14); g.cyl('iron', x + 0.1, y - 0.07, 0, 0.004, 0.004, 0.07, 4); x += 0.24;
      } else {
        g.cyl('wood:walnut|stain:natural|fin:oiled', x + 0.07, y + 0.0125, 0, 0.05, 0.07, 0.06, 14); x += 0.16;
      }
    }
  }
  g.translate(0, -mountY, 0);
  if (H > 0.2 && mountY === 0) col(out, 0, H / 2, 0, Wd, H, D);
  out.surfaces!.push({ y: mountY + (n === 1 ? 0.0125 : H), w: Wd - 0.05, d: D - 0.05, x: 0, z: 0 });
}

const CUPBOARDS: Record<string, Design> = {
  hutch(g, m, out, r) { cabinet(g, m, out, r, 1.3, 0.9, 0.5, 2, 0, 1); g.push().translate(0, 0.95, -0.12); shelfUnit(g, m, out, r, 1.3, 0.9, 0.24, 3, false, 0, 'plates'); g.pop(); },
  pie_safe(g, m, out, r) { cabinet(g, m, out, r, 0.9, 1.4, 0.45, 2, 1, 3); },
  welsh_dresser(g, m, out, r) { chestOfDrawers(g, m, out, 1.5, 0.85, 0.5, [3, 1], true); g.push().translate(0, 0.88, -0.15); shelfUnit(g, m, out, r, 1.5, 1.0, 0.22, 3, false, 0, 'plates'); g.pop(); },
  sideboard(g, m, out, r) { cabinet(g, m, out, r, 1.6, 0.85, 0.5, 2, 1, 1); },
  larder(g, m, out, r) { cabinet(g, m, out, r, 1.0, 2.0, 0.6, 2, 0, 2); },
};

// candles: the wax column is tagged so the game can melt it (scaled by remaining burn)
const CANDLES: Record<string, Design> = {
  taper(g, m, out) { holder(g, 'brass', 0.06); candle(g, out, 0, 0.05, 0, 0.012, 0.22, m); },
  pillar(g, m, out) { g.cyl('pewter', 0, 0, 0, 0.08, 0.08, 0.012, 18); candle(g, out, 0, 0.012, 0, 0.035, 0.16, m); },
  cluster(g, m, out, r) { g.cyl('wood:dark|stain:natural|fin:oiled', 0, 0, 0, 0.14, 0.14, 0.02, 18); for (let i = 0; i < 5; i++) { const a = i * 1.26 + r(); candle(g, out, Math.cos(a) * 0.08, 0.02, Math.sin(a) * 0.08, 0.018 + r() * 0.012, 0.08 + r() * 0.12, m); } },
  candelabra(g, m, out) { const k = m.seed % 2 ? 'brass' : 'silver'; g.cyl(k, 0, 0, 0, 0.09, 0.05, 0.03, 16); g.cyl(k, 0, 0.03, 0, 0.012, 0.012, 0.3, 8); for (const s of [-1, 1]) { g.push().translate(s * 0.07, 0.25, 0).rotateZ(s * 1.2); g.cyl(k, 0, -0.07, 0, 0.008, 0.008, 0.14, 6); g.pop(); g.cyl(k, s * 0.13, 0.27, 0, 0.025, 0.02, 0.025, 10); candle(g, out, s * 0.13, 0.29, 0, 0.011, 0.16, m); } g.cyl(k, 0, 0.33, 0, 0.025, 0.02, 0.025, 10); candle(g, out, 0, 0.35, 0, 0.011, 0.16, m); },
  sconce(g, m, out) { g.box('iron', 0, 1.6, -0.04, 0.1, 0.22, 0.01, 3); g.box('iron', 0, 1.52, 0.0, 0.015, 0.015, 0.09, 3); g.cyl('iron', 0, 1.52, 0.06, 0.04, 0.03, 0.02, 12); candle(g, out, 0, 1.54, 0.06, 0.012, 0.18, m); },
  chandelier(g, m, out) { const k = 'iron'; g.push().translate(0, 2.4, 0).rotateX(Math.PI / 2); g.cyl(k, 0, -0.02, 0, 0.5, 0.5, 0.04, 32, false); g.pop(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.push().translate(Math.cos(a) * 0.25, 2.8, Math.sin(a) * 0.25).rotateZ(Math.cos(a) * 0.55).rotateX(-Math.sin(a) * 0.55); g.cyl(k, 0, -0.45, 0, 0.005, 0.005, 0.9, 4, false); g.pop(); } for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.cyl(k, Math.cos(a) * 0.5, 2.42, Math.sin(a) * 0.5, 0.03, 0.025, 0.03, 10); candle(g, out, Math.cos(a) * 0.5, 2.44, Math.sin(a) * 0.5, 0.014, 0.18, m); } },
  stand(g, m, out) { g.cyl('iron', 0, 0, 0, 0.18, 0.04, 0.05, 3); g.cyl('iron', 0, 0.05, 0, 0.015, 0.015, 1.25, 8); g.cyl('iron', 0, 1.3, 0, 0.05, 0.04, 0.03, 12); candle(g, out, 0, 1.33, 0, 0.03, 0.3, m); col(out, 0, 0.7, 0, 0.3, 1.4, 0.3); },
  saucer(g, m, out) { g.cyl('ceramic|c:a87048|glaze:1', 0, 0, 0, 0.07, 0.06, 0.02, 16); g.push().translate(0.075, 0.03, 0).rotateZ(Math.PI / 2); g.cyl('ceramic|c:a87048|glaze:1', 0, -0.006, 0, 0.012, 0.012, 0.012, 8); g.pop(); candle(g, out, 0, 0.02, 0, 0.016, 0.1, m); },
};
function holder(g: GeoBuilder, k: string, h: number) { g.cyl(k, 0, 0, 0, 0.06, 0.05, 0.012, 16); g.cyl(k, 0, 0.012, 0, 0.012, 0.012, h - 0.02, 8); g.cyl(k, 0, h - 0.012, 0, 0.022, 0.018, 0.012, 12); }
function candle(_g: GeoBuilder, out: FurnitureModel, x: number, y: number, z: number, r: number, h: number, _m: Mods) {
  // the wax itself is built by the candle entity (so it can melt); we only record the spot
  out.candles!.push({ pos: new THREE.Vector3(x, y, z), height: h, radius: r });
}

const RUGS: Record<string, Design> = {
  woven(g, m, out) { rug(g, out, `cloth:weave|dye:${m.dye}|rep:2`, 2.0, 1.4); },
  striped(g, m, out) { rug(g, out, `cloth:stripe|dye:${m.dye}|rep:2`, 2.2, 1.2); },
  jacquard(g, m, out) { rug(g, out, `cloth:jacquard|dye:${m.dye}|rep:2`, 2.6, 1.8); },
  fur(g, _m, out) { g.ellipsoid('cloth:fur|dye:undyed', 0, 0.01, 0, 0.9, 0.015, 1.2, 20, 0.15); },
  braided(g, m, out) { for (let i = 0; i < 6; i++) { g.push().translate(0, 0.004 + i * 0.0005, 0); g.cyl(`cloth:fleece|dye:${i % 2 ? m.dye : m.dye2}`, 0, 0, 0, 0.75 - i * 0.12, 0.75 - i * 0.12, 0.012, 32); g.pop(); } void out; },
  herringbone(g, m, out) { rug(g, out, `cloth:herringbone|dye:${m.dye}|rep:2`, 1.8, 1.0); },
};
function rug(g: GeoBuilder, _out: FurnitureModel, key: string, L: number, D: number) {
  g.box(key, 0, 0.006, 0, L, 0.012, D, 0.6);
  for (let i = 0; i < Math.floor(D / 0.04); i++) for (const s of [-1, 1]) g.box(key, s * (L / 2 + 0.03), 0.004, -D / 2 + 0.02 + i * 0.04, 0.06, 0.006, 0.012, 2);
}

const HAMMOCKS: Record<string, Design> = {
  canvas(g, m, out) { hammock(g, m, out, 'cloth:canvas|dye:undyed'); },
  net(g, m, out) { hammock(g, m, out, `cloth:hessian|dye:${m.dye}`); },
};
function hammock(g: GeoBuilder, _m: Mods, out: FurnitureModel, key: string) {
  // the sling hangs from two hooks; the hammock entity swings the whole part about the hook line
  const sg = new GeoBuilder();
  const L = 2.0, n = 12;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const sag = (t: number) => -Math.sin(t * Math.PI) * 0.45;
    sg.push().translate(-L / 2 + t0 * L, sag(t0), 0);
    sg.box(key, (t1 - t0) * L / 2, (sag(t1) - sag(t0)) / 2, 0, (t1 - t0) * L + 0.01, 0.01, 0.7 * Math.sin(0.25 + t0 * 2.6), 1);
    sg.pop();
  }
  g.box('iron', -L / 2 - 0.15, 0, 0, 0.04, 0.04, 0.04, 3); g.box('iron', L / 2 + 0.15, 0, 0, 0.04, 0.04, 0.04, 3);
  out.movables.push({ kind: 'curtain', geo: sg, pivot: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(1, 0, 0), range: 0.5, size: new THREE.Vector3(L, 0.5, 0.7) });
  out.sleep!.push({ pos: new THREE.Vector3(0, -0.35, 0), yaw: Math.PI / 2 });
}

const MISC: Record<string, Design> = {
  hay(g, _m, out) { g.ellipsoid('straw', 0, 0.3, 0, 0.55, 0.3, 0.38, 14, 0.25); col(out, 0, 0.3, 0, 1.1, 0.6, 0.76); },
  trough(g, m, out) { const k = W(m); box(g, k, 0, 0.3, 0.2, 2.0, 0.4, 0.04); box(g, k, 0, 0.3, -0.2, 2.0, 0.4, 0.04); box(g, k, -1, 0.3, 0, 0.04, 0.4, 0.44); box(g, k, 1, 0.3, 0, 0.04, 0.4, 0.44); box(g, k, 0, 0.12, 0, 2.0, 0.04, 0.4); col(out, 0, 0.25, 0, 2.0, 0.5, 0.44); },
  saddle_rack(g, m, out) { const k = W(m); for (const x of [-0.3, 0.3]) { box(g, k, x, 0.45, 0, 0.06, 0.9, 0.06); } g.push().translate(0, 0.95, 0).rotateZ(Math.PI / 2); g.cyl(k, 0, -0.4, 0, 0.06, 0.06, 0.8, 10); g.pop(); g.ellipsoid('cloth:leather|dye:walnut', 0, 1.02, 0, 0.32, 0.12, 0.28, 14, 0.4); col(out, 0, 0.5, 0, 0.8, 1.1, 0.4); },
  weapon_rack(g, m, out) { const k = W(m); box(g, k, 0, 0.05, 0, 1.2, 0.1, 0.4); box(g, k, 0, 1.4, -0.15, 1.2, 0.08, 0.08); for (const x of [-0.58, 0.58]) box(g, k, x, 0.75, -0.15, 0.06, 1.5, 0.06); for (let i = 0; i < 6; i++) g.cyl('iron', -0.45 + i * 0.18, 0.1, 0, 0.012, 0.004, 1.35, 6); col(out, 0, 0.75, 0, 1.2, 1.5, 0.4); },
  armor_stand(g, m, out) { const k = W(m); g.cyl(k, 0, 0, 0, 0.25, 0.25, 0.05, 12); g.cyl(k, 0, 0.05, 0, 0.03, 0.03, 1.5, 8); g.ellipsoid('iron', 0, 1.3, 0, 0.22, 0.3, 0.14, 14, 0.6); g.ellipsoid('iron', 0, 1.72, 0, 0.11, 0.13, 0.12, 12); g.box(k, 0, 1.55, 0, 0.6, 0.05, 0.05); col(out, 0, 0.9, 0, 0.5, 1.8, 0.4); },
  anvil(g, _m, out) { g.cyl('wood:dark|stain:natural|fin:raw', 0, 0, 0, 0.22, 0.24, 0.5, 12); g.box('iron', 0, 0.62, 0, 0.5, 0.12, 0.16, 3); g.box('iron', 0, 0.54, 0, 0.18, 0.1, 0.14, 3); g.push().translate(0.3, 0.64, 0).rotateZ(-Math.PI / 2); g.cyl('iron', 0, 0, 0, 0.07, 0.01, 0.16, 10); g.pop(); col(out, 0, 0.35, 0, 0.6, 0.7, 0.3); },
  cradle(g, m, out) { const k = W(m); for (const z of [-0.45, 0.45]) { g.push().translate(0, 0.08, z).rotateX(Math.PI / 2); g.cyl(k, 0, -0.02, 0, 0.35, 0.35, 0.04, 20, true); g.pop(); } box(g, k, 0, 0.35, 0, 0.5, 0.3, 0.85); g.ellipsoid(C(m), 0, 0.48, 0, 0.2, 0.04, 0.36, 10, 0.2); col(out, 0, 0.3, 0, 0.6, 0.6, 0.95); },
  washtub(g, _m, out) { g.cyl('wood:planks|stain:honey|fin:raw', 0, 0, 0, 0.42, 0.36, 0.38, 20, true); g.cyl('iron', 0, 0.3, 0, 0.425, 0.425, 0.03, 20, false); g.cyl('iron', 0, 0.06, 0, 0.375, 0.375, 0.03, 20, false); col(out, 0, 0.19, 0, 0.8, 0.38, 0.8); },
  loom(g, m, out) { const k = W(m); for (const x of [-0.6, 0.6]) for (const z of [-0.4, 0.4]) box(g, k, x, 0.8, z, 0.06, 1.6, 0.06); for (const y of [0.4, 1.55]) box(g, k, 0, y, 0, 1.26, 0.06, 0.86); box(g, `cloth:weave|dye:${m.dye}`, 0, 0.75, 0.38, 1.1, 0.7, 0.005, 2); col(out, 0, 0.8, 0, 1.3, 1.6, 0.9); },
  tapestry(g, m, out) { g.box(`cloth:jacquard|dye:${m.dye}`, 0, 1.7, -0.02, 1.4, 2.0, 0.01, 0.8); g.cyl('wood:dark|stain:natural|fin:oiled', -0.75, 2.7, -0.03, 0.02, 0.02, 0.0, 6); g.push().translate(-0.78, 2.72, -0.02).rotateZ(-Math.PI / 2); g.cyl('wood:dark|stain:natural|fin:oiled', 0, 0, 0, 0.025, 0.025, 1.56, 8); g.pop(); void out; },
  banner(g, m, out) { g.box(`cloth:velvet|dye:${m.dye}`, 0, 2.0, -0.02, 0.8, 1.8, 0.01, 1); g.ellipsoid('gold', 0, 2.3, -0.012, 0.18, 0.18, 0.005, 16); g.push().translate(-0.45, 2.92, -0.02).rotateZ(-Math.PI / 2); g.cyl('iron', 0, 0, 0, 0.015, 0.015, 0.9, 8); g.pop(); void out; },
  painting(g, m, out) { g.box(W(m), 0, 1.6, -0.02, 0.9, 0.7, 0.04, 2); g.box(`paper|c:${['6a7a5a', '8a6a4a', '4a5a7a', '7a5a6a'][m.seed % 4]}`, 0, 1.6, 0.002, 0.78, 0.58, 0.005, 1); void out; },
  barrel_stack(g, _m, out) { for (let i = 0; i < 3; i++) { g.push().translate(-0.6 + i * 0.6, 0.3, 0).rotateX(Math.PI / 2); g.cyl('mat:wooden_barrel', 0, -0.42, 0, 0.29, 0.29, 0.84, 18, true, 1); g.pop(); } col(out, 0, 0.3, 0, 1.8, 0.6, 0.84); },
  rope_coil(g, _m, out) { for (let i = 0; i < 6; i++) { g.push().translate(0, 0.02 + i * 0.03, 0).rotateX(Math.PI / 2); g.cyl('cloth:hessian|dye:walnut', 0, -0.015, 0, 0.25 - i * 0.012, 0.25 - i * 0.012, 0.03, 20, false); g.pop(); } col(out, 0, 0.1, 0, 0.5, 0.2, 0.5); },
  firewood(g, _m, out, r) { for (let i = 0; i < 18; i++) { const row = Math.floor(i / 6); g.push().translate(-0.5 + (i % 6) * 0.2 + (row % 2) * 0.1, 0.08 + row * 0.15, 0).rotateX(Math.PI / 2); g.cyl('mat:bark_brown_02', 0, -0.25, 0, 0.07 + r() * 0.02, 0.07, 0.5, 8, true, 2); g.pop(); } col(out, 0, 0.25, 0, 1.2, 0.5, 0.5); },
  grindstone(g, _m, out) { g.push().translate(0, 0.6, 0).rotateZ(Math.PI / 2); g.cyl('stone:stone_tiles_02', 0, -0.06, 0, 0.35, 0.35, 0.12, 24); g.pop(); for (const x of [-0.12, 0.12]) g.box('wood:planks|stain:natural|fin:raw', x, 0.35, 0, 0.06, 0.7, 0.08, 2); col(out, 0, 0.5, 0, 0.8, 1.0, 0.3); },
  well_bucket(g, _m, out) { g.cyl('wood:planks|stain:honey|fin:raw', 0, 0, 0, 0.17, 0.14, 0.3, 14, true); g.cyl('iron', 0, 0.26, 0, 0.175, 0.175, 0.02, 14, false); void out; },
  chamberpot(g, _m, out) { g.cyl('ceramic|c:e0d8c8|glaze:1', 0, 0, 0, 0.12, 0.13, 0.18, 16); void out; },
};

export const CATALOG: Record<Category, Record<string, Design>> = {
  bed: BEDS, chair: CHAIRS, stool: STOOLS, bench: BENCHES, table: TABLES, desk: DESKS, wardrobe: WARDROBES, drawers: DRAWERS,
  chest: CHESTS, shelf: SHELVES, cupboard: CUPBOARDS, candle: CANDLES, rug: RUGS, hearth: {}, misc: MISC, hammock: HAMMOCKS,
};
const BASE_VALUE: Record<Category, number> = { bed: 40, chair: 8, stool: 3, bench: 10, table: 20, desk: 35, wardrobe: 45, drawers: 30, chest: 25, shelf: 12, cupboard: 40, candle: 2, rug: 15, hearth: 0, misc: 10, hammock: 6 };

/** Deterministic modifiers from a seed, optionally constrained (e.g. a wealthy home gets velvet). */
export function modsFor(seed: number, over: Partial<Mods> = {}): Mods {
  const r = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  return {
    wood: pick(WOOD_KEYS), stain: pick(STAIN_KEYS), fin: pick(FIN_KEYS), fabric: pick(SHEET_FABRICS), dye: pick(DYE_KEYS), dye2: pick(DYE_KEYS),
    pillows: Math.floor(r() * 4), wear: r(), size: r() < 0.4 ? 1 : 0, fill: r(), seed: Math.floor(r() * 1e6), ...over,
  };
}

const modelCache = new Map<string, FurnitureModel>();
export function variantId(cat: Category, design: string, m: Mods) {
  return `${cat}/${design}/${m.wood}.${m.stain}.${m.fin}/${m.fabric}.${m.dye}.${m.dye2}/p${m.pillows}s${m.size}f${m.fill > 0.5 ? 1 : 0}/${m.seed % 7}`;
}
export function makeFurniture(cat: Category, design: string, m: Mods): FurnitureModel {
  const id = variantId(cat, design, m);
  const hit = modelCache.get(id);
  if (hit) return hit;
  const g = new GeoBuilder();
  const out: FurnitureModel = { id, category: cat, name: `${design.replace(/_/g, ' ')} ${cat}`, geo: g, movables: [], size: new THREE.Vector3(), sleep: [], seats: [], surfaces: [], candles: [], colliders: [], value: BASE_VALUE[cat] };
  const r = mulberry32(m.seed);
  const fn = CATALOG[cat]?.[design];
  if (!fn) throw new Error('unknown furniture ' + cat + '/' + design);
  fn(g, m, out, r);
  const fancy = ['walnut', 'fine', 'dark', 'oak'].includes(m.wood) ? 1.6 : 1;
  const finish = { raw: 0.8, oiled: 1, waxed: 1.1, varnished: 1.3, lacquered: 1.6 }[m.fin] ?? 1;
  out.value = Math.round(out.value * fancy * finish * (['velvet', 'satin', 'jacquard', 'fur'].includes(m.fabric) ? 1.5 : 1));
  // footprint from colliders
  const bb = new THREE.Box3();
  for (const c of out.colliders) { bb.expandByPoint(c.c.clone().sub(c.h)); bb.expandByPoint(c.c.clone().add(c.h)); }
  if (!bb.isEmpty()) out.size.copy(bb.getSize(new THREE.Vector3()));
  modelCache.set(id, out);
  return out;
}

/** Enumerate the distinct catalogue: every design × a spread of modifier combinations. */
export function enumerateCatalog(perDesign = 24): { cat: Category; design: string; mods: Mods; id: string }[] {
  const out: { cat: Category; design: string; mods: Mods; id: string }[] = [];
  const seen = new Set<string>();
  let s = 1;
  for (const cat of Object.keys(CATALOG) as Category[]) for (const design of Object.keys(CATALOG[cat])) {
    for (let i = 0; i < perDesign; i++) {
      const mods = modsFor(s++ * 7919);
      const id = variantId(cat, design, mods);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ cat, design, mods, id });
    }
  }
  return out;
}
export const DESIGN_COUNT = Object.values(CATALOG).reduce((n, c) => n + Object.keys(c).length, 0);
