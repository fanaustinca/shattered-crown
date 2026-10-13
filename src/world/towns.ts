// Settlement planning: streets, plazas, walls, building plots with types/styles, and the households
// that live in them. Runs at boot after terrain/roads; levels the ground and paints paving.
import * as THREE from 'three';
import { SITES, type Site, riverX, riverWidth } from './layout';
import type { World } from './world';
import type { BType, BuildingSpec, Style } from '../build/building';
import { mulberry32 } from '../core/noise';

export interface Person {
  id: string; name: string; age: number; female: boolean; role: string; home: string; work: string | null;
  variant: number; skin: number; hair: number; cloth1: number; cloth2: number; bed: number; faction: 'vanguardia' | 'ironreach' | 'isles' | 'river';
  temperament: number; // 0 timid .. 1 aggressive
}
export interface Household { id: string; family: string; members: Person[]; wealth: number }
export interface Placed {
  id: string; spec: BuildingSpec; x: number; z: number; yaw: number; y: number; site: string;
  household: Household | null; owner: string | null;
}
export interface WallPlan { site: string; pts: [number, number][]; r: number; gates: number[]; height: number; style: 'stone' | 'dark' | 'palisade' }
export interface TownPlan {
  site: Site; buildings: Placed[]; walls: WallPlan | null; plaza: { x: number; z: number; r: number };
  wells: [number, number][]; stalls: { x: number; z: number; yaw: number; goods: string }[];
  keep: Placed | null; docks: { x: number; z: number; yaw: number; len: number }[]; streets: [number, number][][];
}

const FIRST_M = ['Aldric', 'Bran', 'Cedric', 'Dunstan', 'Edmund', 'Falk', 'Godric', 'Harold', 'Ivo', 'Jory', 'Kenric', 'Leofric', 'Merek', 'Nyle', 'Osric', 'Piers', 'Quill', 'Roderick', 'Simon', 'Tobias', 'Ulric', 'Wat', 'Wystan', 'Hugh', 'Gerald', 'Ansel', 'Brom', 'Corin', 'Daveth', 'Emeric'];
const FIRST_F = ['Ada', 'Beatrix', 'Cecily', 'Edith', 'Elena', 'Freya', 'Gwen', 'Hilda', 'Isolde', 'Joan', 'Katherine', 'Linnet', 'Maud', 'Nell', 'Odile', 'Petra', 'Rowena', 'Sybil', 'Tamsin', 'Una', 'Wenna', 'Agnes', 'Brida', 'Clemence', 'Elsbeth', 'Margery'];
const FAMILY = ['Ashdown', 'Blackwood', 'Carter', 'Fletcher', 'Miller', 'Thatcher', 'Smith', 'Cooper', 'Tanner', 'Weaver', 'Mason', 'Fisher', 'Hollis', 'Marsh', 'Underhill', 'Greaves', 'Holloway', 'Pike', 'Stone', 'Crowe', 'Ironside', 'Duncombe', 'Reed', 'Wright', 'Barrow', 'Fenwick', 'Gale', 'Harrow', 'Kettle', 'Lark'];

export class Towns {
  plans: TownPlan[] = [];
  people: Person[] = [];
  byBuilding = new Map<string, Placed>();
  constructor(private world: World) {}

  plan() {
    for (const s of SITES) this.plans.push(this.planSite(s));
    for (const p of this.plans) for (const b of p.buildings) this.byBuilding.set(b.id, b);
  }

  private planSite(site: Site): TownPlan {
    const w = this.world;
    const r = mulberry32(site.x * 13 + site.z * 7 + 99);
    const plan: TownPlan = { site, buildings: [], walls: null, plaza: { x: site.x, z: site.z, r: site.kind === 'capital' ? 22 : 13 }, wells: [], stalls: [], keep: null, docks: [], streets: [] };
    const iron = site.kingdom === 'ironreach';
    const isles = site.kingdom === 'isles';
    const baseY = w.heightAt(site.x, site.z);
    // main axis: follow the road nearest the centre if any
    let axis = r() * Math.PI;
    let bestD = 1e9;
    for (const road of w.roads) for (let i = 0; i < road.pts.length - 3; i += 3) {
      const x = road.pts[i], z = road.pts[i + 1], dd = Math.hypot(x - site.x, z - site.z);
      if (dd < bestD && dd < site.r) { bestD = dd; axis = Math.atan2(road.pts[i + 4] - z, road.pts[i + 3] - x); }
    }
    const placed: { x: number; z: number; hw: number; hd: number; yaw: number }[] = [];
    const overlaps = (x: number, z: number, hw: number, hd: number, yaw: number) => {
      // cheap OBB test via separating axis
      const ax = [[Math.cos(yaw), -Math.sin(yaw)], [Math.sin(yaw), Math.cos(yaw)]];
      for (const p of placed) {
        if (Math.hypot(p.x - x, p.z - z) > hw + hd + p.hw + p.hd + 1) continue;
        const bx = [[Math.cos(p.yaw), -Math.sin(p.yaw)], [Math.sin(p.yaw), Math.cos(p.yaw)]];
        let sep = false;
        for (const a of [...ax, ...bx]) {
          const proj = (cx: number, cz: number, e: number[][], h1: number, h2: number) => { const c = cx * a[0] + cz * a[1]; const ext = Math.abs(e[0][0] * a[0] + e[0][1] * a[1]) * h1 + Math.abs(e[1][0] * a[0] + e[1][1] * a[1]) * h2; return [c - ext, c + ext]; };
          const [a0, a1] = proj(x, z, ax, hw + 0.8, hd + 0.8), [b0, b1] = proj(p.x, p.z, bx, p.hw, p.hd);
          if (a1 < b0 || b1 < a0) { sep = true; break; }
        }
        if (!sep) return true;
      }
      return false;
    };
    const okGround = (x: number, z: number, hw: number, hd: number) => {
      for (const [u, v] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const px = x + u * hw, pz = z + v * hd;
        const h = w.heightAt(px, pz);
        if (h < 1.8 || h < w.waterLevelAt(px, pz) + 1.2) return false;
        if (Math.abs(px - riverX(pz)) < riverWidth(pz) * 0.5 + 8) return false;
        if (Math.abs(h - baseY) > 14 && site.h !== undefined) return false;
      }
      return w.slopeAt(x, z) < 0.35;
    };
    let nId = 0;
    const add = (type: BType, x: number, z: number, yaw: number, opts: Partial<BuildingSpec> = {}) => {
      const dims: Record<BType, [number, number, number, number]> = {
        cottage: [5.5, 7, 4.5, 5.5], house: [7, 10, 5.5, 7.5], townhouse: [6, 8, 6, 7.5], shop: [7, 9, 6, 7.5], tavern: [11, 14, 8, 10], smithy: [7, 9, 6, 7],
        stable: [12, 16, 7, 8], barn: [10, 14, 7, 9], chapel: [8, 10, 15, 20], barracks: [12, 16, 7, 8], warehouse: [10, 14, 8, 10], hall: [16, 20, 10, 12], guard: [6, 7, 6, 7],
      };
      const [w0, w1, d0, d1] = dims[type];
      const bw = w0 + r() * (w1 - w0), bd = d0 + r() * (d1 - d0);
      // buildings face the street with their long side when it is a wide frontage
      if (overlaps(x, z, bw / 2, bd / 2, yaw) || !okGround(x, z, bw / 2, bd / 2)) return null;
      const floors = type === 'cottage' || type === 'smithy' || type === 'stable' || type === 'barn' || type === 'chapel' || type === 'warehouse' || type === 'hall' ? 1 : type === 'townhouse' ? (r() < 0.4 ? 3 : 2) : type === 'guard' ? 2 : 2;
      const style: Style = iron ? (r() < 0.6 ? 'stone' : 'dark') : isles ? (r() < 0.5 ? 'rustic' : 'plaster') : type === 'chapel' || type === 'hall' || type === 'barracks' || type === 'guard' ? 'stone' : r() < 0.75 ? 'timber' : 'plaster';
      const roof = type === 'cottage' || type === 'barn' ? (iron ? 'slate' : 'thatch') : iron ? 'slate' : isles ? (r() < 0.5 ? 'thatch' : 'shingle') : r() < 0.8 ? 'tile' : 'thatch';
      const spec: BuildingSpec = {
        id: `${site.id}-${nId++}`, type, style, w: Math.round(bw * 4) / 4, d: Math.round(bd * 4) / 4, floors, seed: Math.floor(r() * 1e9),
        roof: roof as BuildingSpec['roof'], jetty: style === 'timber' && floors > 1 && r() < 0.5, kingdom: site.kingdom,
        wealth: site.kind === 'capital' ? 0.4 + r() * 0.6 : site.kind === 'castle' ? 0.7 : r() * 0.6, ...opts,
      };
      const y = w.heightAt(x, z);
      placed.push({ x, z, hw: spec.w / 2, hd: spec.d / 2, yaw });
      w.levelRect(x, z, spec.w + 1.2, spec.d + 1.2, yaw, y, 3);
      w.paveRect(x, z, spec.w, spec.d, yaw);
      const p: Placed = { id: spec.id, spec, x, z, yaw, y, site: site.id, household: null, owner: null };
      plan.buildings.push(p);
      // path to the door
      const fx = x + Math.sin(yaw) * (spec.d / 2 + 2), fz = z + Math.cos(yaw) * (spec.d / 2 + 2);
      w.paveLine(x + Math.sin(yaw) * spec.d / 2, z + Math.cos(yaw) * spec.d / 2, fx, fz, 1.8, iron ? 1 : 0.6);
      return p;
    };
    // plaza + well
    w.pave(site.x, site.z, plan.plaza.r, 1);
    plan.wells.push([site.x + 4, site.z + 3]);

    const streetLine = (ang: number, from: number, to: number, width: number) => {
      const x0 = site.x + Math.cos(ang) * from, z0 = site.z + Math.sin(ang) * from, x1 = site.x + Math.cos(ang) * to, z1 = site.z + Math.sin(ang) * to;
      w.paveLine(x0, z0, x1, z1, width, site.kind === 'village' ? 0.5 : 1);
      plan.streets.push([[x0, z0], [x1, z1]]);
    };
    // lay buildings along a street on both sides, facing it
    const lineBuildings = (ang: number, from: number, to: number, setback: number, pickType: (dist: number) => BType) => {
      const ux = Math.cos(ang), uz = Math.sin(ang);
      for (const side of [1, -1]) {
        let t = from + r() * 3;
        while (t < to) {
          const type = pickType(t);
          const off = setback + (type === 'chapel' || type === 'tavern' || type === 'hall' ? 4 : 2) + r() * 2;
          const x = site.x + ux * t - uz * side * off, z = site.z + uz * t + ux * side * off;
          // face the street: building local +z points toward the street centreline
          const yaw = Math.atan2(uz * side, -ux * side);
          const p = add(type, x, z, yaw);
          t += p ? Math.max(p.spec.w, 6) + 1.5 + r() * 3 : 3;
        }
      }
    };
    const R = site.r;
    if (site.kind === 'capital') {
      const gates: number[] = [];
      const nRad = 6;
      for (let i = 0; i < nRad; i++) {
        const ang = (site.gateYaw ?? 0) + Math.PI / 2 * 0 + (i / nRad) * Math.PI * 2;
        streetLine(ang, plan.plaza.r, R * 0.98, 7);
        gates.push(ang);
      }
      // ring street
      const ringR = R * 0.55;
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2;
        w.paveLine(site.x + Math.cos(a0) * ringR, site.z + Math.sin(a0) * ringR, site.x + Math.cos(a1) * ringR, site.z + Math.sin(a1) * ringR, 5, 1);
      }
      // cathedral-like chapel and the royal hall at the plaza
      add('chapel', site.x + Math.cos(axis + 1.3) * 34, site.z + Math.sin(axis + 1.3) * 34, Math.atan2(-Math.cos(axis + 1.3), -Math.sin(axis + 1.3) ) + Math.PI / 2, { w: 12, d: 24 } as Partial<BuildingSpec>);
      for (let i = 0; i < nRad; i++) {
        const ang = (site.gateYaw ?? 0) + (i / nRad) * Math.PI * 2;
        lineBuildings(ang, plan.plaza.r + 6, R * 0.9, 5, (t) => (t < R * 0.3 ? (r() < 0.45 ? 'shop' : r() < 0.15 ? 'tavern' : 'townhouse') : t > R * 0.8 && r() < 0.25 ? (r() < 0.5 ? 'barracks' : 'stable') : r() < 0.1 ? 'smithy' : r() < 0.6 ? 'townhouse' : 'house'));
      }
      // fill along the ring street
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + 0.13;
        for (const side of [1, -1]) {
          const off = ringR + side * 9;
          const x = site.x + Math.cos(a) * off, z = site.z + Math.sin(a) * off;
          const yaw = Math.atan2(-Math.cos(a) * side, -Math.sin(a) * side);
          add(r() < 0.6 ? 'townhouse' : 'house', x, z, yaw);
        }
      }
      plan.walls = { site: site.id, pts: ringPts(site.x, site.z, R * 0.99, 40), r: R * 0.99, gates, height: 11, style: iron ? 'dark' : 'stone' };
      // the keep inside the walls, opposite the main gate
      const ka = (site.gateYaw ?? 0) + Math.PI;
      plan.keep = add('hall', site.x + Math.cos(ka) * R * 0.33, site.z + Math.sin(ka) * R * 0.33, -ka + Math.PI / 2, { floors: 3, w: 22, d: 16, style: iron ? 'dark' : 'stone', wealth: 1 } as Partial<BuildingSpec>);
      for (let i = 0; i < 10; i++) plan.stalls.push({ x: site.x + Math.cos(i * 0.63) * (plan.plaza.r - 4), z: site.z + Math.sin(i * 0.63) * (plan.plaza.r - 4), yaw: -i * 0.63 + Math.PI / 2, goods: ['fruit', 'bread', 'cloth', 'pottery', 'meat', 'cheese', 'weapons', 'fish', 'candles', 'tools'][i] });
    } else if (site.kind === 'castle') {
      plan.walls = { site: site.id, pts: ringPts(site.x, site.z, R * 0.82, 10), r: R * 0.82, gates: [site.gateYaw ?? 0], height: 13, style: iron ? 'dark' : 'stone' };
      plan.keep = add('hall', site.x, site.z, (site.gateYaw ?? 0) + Math.PI / 2, { floors: 3, w: 18, d: 14, style: iron ? 'dark' : 'stone', wealth: 1 } as Partial<BuildingSpec>);
      const ring = (t: BType, ang: number) => { const a = (site.gateYaw ?? 0) + ang; return add(t, site.x + Math.cos(a) * R * 0.55, site.z + Math.sin(a) * R * 0.55, Math.atan2(-Math.cos(a), -Math.sin(a)) * 0 + (-a - Math.PI / 2)); };
      ring('barracks', 1.2); ring('stable', -1.2); ring('smithy', 2.2); ring('chapel', -2.3); ring('guard', 0.6); ring('house', -0.7); ring('warehouse', 2.9);
      streetLine(site.gateYaw ?? 0, 0, R * 0.9, 6);
    } else {
      // towns, villages, ports: a main street on the road axis, a cross street, outskirts of cottages and barns
      const L = R * 0.95;
      streetLine(axis, 0, L, 6); streetLine(axis + Math.PI, 0, L, 6);
      streetLine(axis + Math.PI / 2, 0, L * 0.6, 5); streetLine(axis - Math.PI / 2, 0, L * 0.6, 5);
      let tavern = false, smithy = false, chapel = false, stable = false;
      const pick = (t: number): BType => {
        if (!tavern && t < 30) { tavern = true; return 'tavern'; }
        if (!smithy && r() < 0.3) { smithy = true; return 'smithy'; }
        if (!chapel && t > 25 && r() < 0.3) { chapel = true; return 'chapel'; }
        if (!stable && t > 40 && r() < 0.4) { stable = true; return 'stable'; }
        if (site.kind === 'port' && t > L * 0.5 && r() < 0.3) return 'warehouse';
        if (t > L * 0.7) return r() < 0.3 ? 'barn' : 'cottage';
        return r() < 0.25 ? 'shop' : r() < 0.5 ? 'house' : 'cottage';
      };
      for (const a of [axis, axis + Math.PI]) lineBuildings(a, plan.plaza.r + 4, L, 4, pick);
      for (const a of [axis + Math.PI / 2, axis - Math.PI / 2]) lineBuildings(a, plan.plaza.r + 4, L * 0.6, 3.5, pick);
      if (site.dock) {
        plan.docks.push({ x: site.dock.x, z: site.dock.z, yaw: site.dock.yaw, len: 40 });
        w.paveLine(site.x, site.z, site.dock.x, site.dock.z, 5, 0.8);
      }
      // a ferry landing on the river for Eastford/Greyford
      if (site.id === 'eastford' || site.id === 'greyford') {
        const z = site.z, rx = riverX(z), wv = riverWidth(z) / 2, sd = site.id === 'eastford' ? -1 : 1;
        plan.docks.push({ x: rx + sd * (wv + 2), z, yaw: sd > 0 ? -Math.PI / 2 : Math.PI / 2, len: 14 });
        w.paveLine(site.x, site.z, rx + sd * (wv + 6), z, 4, 0.7);
      }
      for (let i = 0; i < 4; i++) plan.stalls.push({ x: site.x + Math.cos(axis + i * 1.57 + 0.78) * (plan.plaza.r - 3), z: site.z + Math.sin(axis + i * 1.57 + 0.78) * (plan.plaza.r - 3), yaw: -(axis + i * 1.57 + 0.78) - Math.PI / 2, goods: ['fruit', 'bread', 'cloth', 'meat'][i] });
    }
    this.populate(plan, r);
    return plan;
  }

  /** Households for every dwelling; workers for workplaces. */
  private populate(plan: TownPlan, r: () => number) {
    const fac = plan.site.kingdom;
    const mk = (home: string, role: string, female: boolean, age: number): Person => {
      const first = female ? FIRST_F[Math.floor(r() * FIRST_F.length)] : FIRST_M[Math.floor(r() * FIRST_M.length)];
      return {
        id: `${home}-p${Math.floor(r() * 1e6)}`, name: first, age, female, role, home, work: null,
        variant: female ? (r() < 0.6 ? 2 : 3) : role === 'guard' ? 4 : r() < 0.5 ? 0 : r() < 0.5 ? 1 : 5,
        skin: Math.floor(r() * 4), hair: Math.floor(r() * 7), cloth1: Math.floor(r() * 1e6), cloth2: Math.floor(r() * 1e6), bed: -1,
        faction: fac, temperament: r(),
      };
    };
    const workplaces = plan.buildings.filter((b) => ['tavern', 'smithy', 'shop', 'stable', 'chapel', 'barracks', 'hall', 'guard', 'warehouse'].includes(b.spec.type));
    for (const b of plan.buildings) {
      const t = b.spec.type;
      if (['house', 'cottage', 'townhouse', 'shop', 'tavern', 'smithy'].includes(t)) {
        const fam = FAMILY[Math.floor(r() * FAMILY.length)];
        const n = 1 + Math.floor(r() * (t === 'cottage' ? 4 : 5));
        const members: Person[] = [];
        const role = t === 'tavern' ? 'innkeeper' : t === 'smithy' ? 'blacksmith' : t === 'shop' ? 'merchant' : r() < 0.5 && plan.site.kind !== 'capital' ? 'farmer' : ['baker', 'weaver', 'carpenter', 'laborer', 'potter', 'fisher', 'tanner'][Math.floor(r() * 7)];
        members.push(mk(b.id, role, r() < 0.4, 25 + Math.floor(r() * 35)));
        if (n > 1) members.push(mk(b.id, 'spouse', !members[0].female, 22 + Math.floor(r() * 35)));
        for (let i = 2; i < n; i++) members.push(mk(b.id, 'child', r() < 0.5, 6 + Math.floor(r() * 12)));
        if (['tavern', 'smithy', 'shop'].includes(t)) members[0].work = b.id;
        else if (members[0].role !== 'farmer' && workplaces.length && r() < 0.5) members[0].work = workplaces[Math.floor(r() * workplaces.length)].id;
        b.household = { id: b.id, family: fam, members, wealth: b.spec.wealth };
        b.owner = members[0].id;
        this.people.push(...members);
      } else if (t === 'barracks' || t === 'guard') {
        const members: Person[] = [];
        for (let i = 0; i < (t === 'barracks' ? 6 : 2); i++) members.push(mk(b.id, 'guard', false, 20 + Math.floor(r() * 20)));
        b.household = { id: b.id, family: 'the garrison', members, wealth: 0.3 };
        this.people.push(...members);
      } else if (t === 'hall') {
        const members = [mk(b.id, 'lord', r() < 0.3, 40 + Math.floor(r() * 20)), mk(b.id, 'steward', r() < 0.5, 30 + Math.floor(r() * 20)), mk(b.id, 'guard', false, 25), mk(b.id, 'guard', false, 30), mk(b.id, 'servant', true, 20)];
        b.household = { id: b.id, family: plan.site.kingdom === 'ironreach' ? 'House Varr' : plan.site.kingdom === 'vanguardia' ? 'House Aurel' : 'the Warden', members, wealth: 1 };
        b.owner = members[0].id;
        this.people.push(...members);
      } else if (t === 'chapel') {
        const members = [mk(b.id, 'priest', r() < 0.3, 50)];
        b.household = { id: b.id, family: 'the chapel', members, wealth: 0.5 };
        this.people.push(...members);
      }
    }
  }
}

function ringPts(cx: number, cz: number, r: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}
export const _v = new THREE.Vector3();
