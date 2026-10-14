// Settlement planning: streets, plazas, walls, building plots with types/styles, and the households
// that live in them. Runs at boot after terrain/roads; levels the ground and paints paving.
import * as THREE from 'three';
import { SITES, HALF, kingdomAt, type Site, riverX, riverWidth } from './layout';
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
export interface WallPlan { site: string; pts: [number, number][]; r: number; gates: number[]; height: number; style: 'stone' | 'dark' | 'palisade'; center?: [number, number] }
export interface TownPlan {
  site: Site; buildings: Placed[]; walls: WallPlan | null; plaza: { x: number; z: number; r: number };
  wells: [number, number][]; stalls: { x: number; z: number; yaw: number; goods: string }[];
  keep: Placed | null; docks: { x: number; z: number; yaw: number; len: number }[]; streets: [number, number][][];
  /** fenced rectangles: kitchen gardens, paddocks, orchards (x,z centre, w,d, yaw) */
  gardens: { x: number; z: number; w: number; d: number; yaw: number }[];
  paddocks: { x: number; z: number; w: number; d: number; yaw: number; species: 'cow' | 'pig' | 'horse' | 'donkey' }[];
  orchards: { x: number; z: number; w: number; d: number; yaw: number }[];
  haystacks: [number, number][];
  lamps: [number, number][];
  /** radius around the site centre that contains every building (streaming) */
  siteR: number;
  anyLive?: boolean;
  /** a lone farmstead (no walls, market or name on the map) */
  minor?: boolean;
  /** the stable yard by the road outside town: where you hire horses and where fast travel arrives */
  stableYard?: { x: number; z: number; yaw: number; stable: string; arrive: [number, number] };
  /** small structures: water troughs, harbour cranes, lighthouses, cargo stacks, fish racks, quays */
  extras: { kind: 'trough' | 'crane' | 'lighthouse' | 'cargo' | 'rack' | 'quay'; x: number; z: number; yaw: number; len?: number }[];
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
    this.planHomesteads();
    for (const p of this.plans) for (const b of p.buildings) this.byBuilding.set(b.id, b);
    this.levelThresholds();
  }

  /** Buildings levelled later can leave a neighbour's doorstep on a bank or in a hollow. Last of all, bring
   *  the ground in front of every door back to the step (unless that would cut into another house), then
   *  re-seat each footprint so nothing that the aprons touched is left uneven. */
  private levelThresholds() {
    const w = this.world;
    const all = this.plans.flatMap((p) => p.buildings);
    const inside = (b: Placed, x: number, z: number, pad: number) => {
      const c = Math.cos(b.yaw), sn = Math.sin(b.yaw), px = x - b.x, pz = z - b.z;
      const u = c * px - sn * pz, v = sn * px + c * pz;
      return Math.abs(u) < b.spec.w / 2 + pad && Math.abs(v) < b.spec.d / 2 + pad;
    };
    for (const b of all) {
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), D = b.spec.d / 2 + 1.3;
      const ax = b.x + fx * D, az = b.z + fz * D;
      if (all.some((o) => o !== b && Math.hypot(o.x - ax, o.z - az) < 40 && inside(o, ax, az, 1.2))) continue;
      w.levelRect(ax, az, 2.6, 2.0, b.yaw, b.y, 1.8);
    }
    for (const b of all) w.levelRect(b.x, b.z, b.spec.w + 0.6, b.spec.d + 0.6, b.yaw, b.y, 0.05);
  }

  /** Lone farmsteads scattered over the open country of both kingdoms (and a few on the isles). */
  private planHomesteads() {
    const w = this.world, r = mulberry32(8080);
    const spots: [number, number][] = [];
    const want = { vanguardia: 64, ironreach: 46, isles: 8, river: 0 } as Record<string, number>;
    const got: Record<string, number> = { vanguardia: 0, ironreach: 0, isles: 0, river: 0 };
    for (let tries = 0; tries < 9000; tries++) {
      const x = (r() - 0.5) * (HALF * 2 - 300), z = (r() - 0.5) * (HALF * 2 - 300);
      const k = kingdomAt(x, z);
      if (got[k] >= want[k]) continue;
      const h = w.heightAt(x, z);
      if (h < 4 || h > (k === 'ironreach' ? 230 : 120) || h < w.waterLevelAt(x, z) + 2) continue;
      if (w.slopeAt(x, z) > (k === 'ironreach' ? 0.16 : 0.1)) continue;
      if (w.fieldAt(x, z) > 0.05 || w.roadAt(x, z) > 0.05 || w.forestAt(x, z) > 0.45 || w.riverbedAt(x, z) > 0.01) continue;
      if (this.plans.some((p) => Math.hypot(p.site.x - x, p.site.z - z) < p.siteR + 70)) continue;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 170)) continue;
      // close enough to a road to have a track to it
      let near = false;
      for (const road of w.roads) { for (let i = 0; i < road.pts.length; i += 30) if (Math.hypot(road.pts[i] - x, road.pts[i + 1] - z) < 520) { near = true; break; } if (near) break; }
      if (!near && r() < 0.8) continue;
      // about a third are little hamlets: three or four farmhouses spread around a green with a well
      const hamlet = r() < 0.34 && w.slopeAt(x, z) < 0.07 && !spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 300);
      spots.push([x, z]); got[k]++;
      const fam = FAMILY[Math.floor(r() * FAMILY.length)];
      const site: Site = { id: `farm${spots.length}`, name: hamlet ? (() => { const suf = ['ley', 'thorpe', 'wick', 'stead', 'cott', 'ham'][Math.floor(r() * 6)]; const base = fam.replace(/(wick|ley|ham|stead|ton|by|worth|field|wood|ford|brook)$/i, ''); return (base.length > 2 ? base : fam) + suf; })() : `${fam} Farm`, kind: 'village', kingdom: k, x, z, r: hamlet ? 60 : 24 };
      this.hamletNext = hamlet;
      const plan = this.planSite(site, true);
      this.hamletNext = false;
      if (plan.buildings.length) this.plans.push(plan);
    }
  }

  private planSite(site: Site, minor = false): TownPlan {
    const w = this.world;
    const r = mulberry32(site.x * 13 + site.z * 7 + 99);
    const N = w.noise;
    const plan: TownPlan = { site, buildings: [], walls: null, plaza: { x: site.x, z: site.z, r: site.kind === 'capital' ? 22 : minor ? 0 : 13 }, wells: [], stalls: [], keep: null, docks: [], streets: [], gardens: [], paddocks: [], orchards: [], haystacks: [], lamps: [], siteR: site.r, minor, extras: [] };
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
    // the wall line (if any) is an irregular polygon around the centre; buildings stay well inside it
    let wallR: ((ang: number) => number) | null = null;
    const okGround = (x: number, z: number, hw: number, hd: number, relaxed = false) => {
      for (const [u, v] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const px = x + u * hw, pz = z + v * hd;
        const h = w.heightAt(px, pz);
        if (h < 1.8 || h < w.waterLevelAt(px, pz) + 1.2) return false;
        if (Math.abs(px - riverX(pz)) < riverWidth(pz) * 0.5 + 8) return false;
        if (!relaxed && Math.abs(h - baseY) > 14 && site.h !== undefined) return false;
        if (w.roadAt(px, pz) > 0.5 && w.ctrl(w.ctrlA, 1, px, pz) < 0.3) return false;   // never on a country road
      }
      if (wallR) {
        // inside the walls stays inside; the roadside quarters stay clear of the wall and its ditch
        const ang = Math.atan2(z - site.z, x - site.x), d = Math.hypot(x - site.x, z - site.z), e = Math.max(hw, hd);
        if (relaxed ? d - e < wallR(ang) + 8 : d + e > wallR(ang) - 7) return false;
      }
      return w.slopeAt(x, z) < (relaxed ? 0.6 : 0.35);
    };
    let nId = 0;
    const add = (type: BType, x: number, z: number, yaw: number, opts: Partial<BuildingSpec> = {}, relaxed = false) => {
      const dims: Record<BType, [number, number, number, number]> = {
        cottage: [5.5, 7, 4.5, 5.5], house: [7, 10, 5.5, 7.5], townhouse: [6, 8, 6, 7.5], shop: [7, 9, 6, 7.5], tavern: [11, 14, 8, 10], smithy: [7, 9, 6, 7],
        stable: [12, 16, 7, 8], barn: [10, 14, 7, 9], chapel: [8, 10, 15, 20], barracks: [12, 16, 7, 8], warehouse: [10, 14, 8, 10], hall: [16, 20, 10, 12], guard: [6, 7, 6, 7],
      };
      const [w0, w1, d0, d1] = dims[type];
      const bw = opts.w ?? w0 + r() * (w1 - w0), bd = opts.d ?? d0 + r() * (d1 - d0);
      if (overlaps(x, z, bw / 2, bd / 2, yaw) || !okGround(x, z, bw / 2, bd / 2, relaxed)) return null;
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
      w.levelRect(x, z, spec.w + 1.2, spec.d + 1.2, yaw, y, relaxed ? 4.5 : 3);
      w.paveRect(x, z, spec.w, spec.d, yaw);
      const p: Placed = { id: spec.id, spec, x, z, yaw, y, site: site.id, household: null, owner: null };
      plan.buildings.push(p);
      // a worn path to the door: cobbles in the capital's core, beaten earth elsewhere
      const fx = x + Math.sin(yaw) * (spec.d / 2 + 2.5), fz = z + Math.cos(yaw) * (spec.d / 2 + 2.5);
      if (site.kind === 'capital' && !relaxed) w.paveLine(x + Math.sin(yaw) * spec.d / 2, z + Math.cos(yaw) * spec.d / 2, fx, fz, 1.8, iron ? 1 : 0.6);
      else w.trail(x + Math.sin(yaw) * spec.d / 2, z + Math.cos(yaw) * spec.d / 2, fx, fz, 1.6, 0.7);
      return p;
    };
    // ---- organic streets ----
    type Path = [number, number][];
    /** a street from a to b that bends and wanders like one that grew over centuries */
    const curved = (x0: number, z0: number, x1: number, z1: number, bend: number, step = 5): Path => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.ceil(len / step));
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      const out: Path = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, s = Math.sin(Math.PI * t);
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        const off = bend * s + 6 * s * N.noise(x / 60 + site.x, z / 60);
        out.push([x + nx * off, z + nz * off]);
      }
      return out;
    };
    /** a lane wandering off in a direction until it runs out of room */
    const wander = (x0: number, z0: number, heading: number, len: number): Path => {
      const out: Path = [[x0, z0]];
      let x = x0, z = z0, h = heading;
      for (let d = 0; d < len; d += 4) {
        h += N.noise(x / 40 + 31, z / 40) * 0.22;
        x += Math.cos(h) * 4; z += Math.sin(h) * 4;
        if (!w.inBounds(x, z) || w.heightAt(x, z) < w.waterLevelAt(x, z) + 1) break;
        if (wallR && Math.hypot(x - site.x, z - site.z) > wallR(Math.atan2(z - site.z, x - site.x)) - 10) break;
        out.push([x, z]);
      }
      return out;
    };
    const paveStreet = (p: Path, width: number, cobble: boolean, main = true) => {
      for (let i = 0; i < p.length - 1; i++) {
        if (cobble) w.paveLine(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], width, site.kind === 'village' ? 0.5 : 1);
        else w.trail(p[i][0], p[i][1], p[i + 1][0], p[i + 1][1], width, 0.85);
        if (main) plan.streets.push([p[i], p[i + 1]]);
      }
    };
    /** houses along both sides of a street, facing it, with uneven setbacks, angles and gaps */
    const along = (p: Path, setback: number, pickType: (t: number, side: number) => BType, from = 0, gapChance = 0.12) => {
      const seg: number[] = [0];
      for (let i = 1; i < p.length; i++) seg.push(seg[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
      const total = seg[seg.length - 1];
      const at = (t: number) => {
        let i = 1; while (i < seg.length - 1 && seg[i] < t) i++;
        const a = p[i - 1], b = p[i], f = (t - seg[i - 1]) / Math.max(1e-6, seg[i] - seg[i - 1]);
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return { x: a[0] + dx * f, z: a[1] + dz * f, tx: dx / l, tz: dz / l };
      };
      for (const side of [1, -1]) {
        let t = from + r() * 4;
        while (t < total - 3) {
          if (r() < gapChance) { t += 4 + r() * 9; continue; }      // a yard, an alley, a garden wall
          const type = pickType(t, side);
          const q = at(t);
          const nx = -q.tz * side, nz = q.tx * side;           // from the street toward this side
          const off = setback + (type === 'chapel' || type === 'tavern' || type === 'hall' ? 4 : 2) + r() * 2.6;
          const x = q.x + nx * off, z = q.z + nz * off;
          const yaw = Math.atan2(-nx, -nz) + (r() - 0.5) * 0.22;
          const b = add(type, x, z, yaw);
          t += b ? Math.max(b.spec.w, 5) + 0.4 + r() * (site.kind === 'capital' ? 1.2 : 3.5) : 2.5;
        }
      }
    };
    /** fill open ground with homes facing the nearest street (the town grows into its gaps) */
    const infill = (count: number, rad: number, types: BType[]) => {
      const pts = plan.streets.flatMap((s) => s);
      for (let k = 0, tries = 0; k < count && tries < count * 8; tries++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
        const x = site.x + Math.cos(a) * d, z = site.z + Math.sin(a) * d;
        let best = pts[0], bd = 1e9;
        for (const p of pts) { const dd = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (dd < bd) { bd = dd; best = p; } }
        if (!best || bd < 8 * 8 || bd > 60 * 60) continue;
        const yaw = Math.atan2(best[0] - x, best[1] - z) + (r() - 0.5) * 0.5;
        const b = add(types[Math.floor(r() * types.length)], x, z, yaw);
        if (!b) continue;
        k++;
        w.trail(x + Math.sin(yaw) * b.spec.d / 2, z + Math.cos(yaw) * b.spec.d / 2, best[0], best[1], 1.6, 0.65);
      }
    };
    // plaza + well
    if (!minor) {
      w.pave(site.x, site.z, plan.plaza.r, 1);
      plan.wells.push([site.x + 4, site.z + 3]);
    }
    const R = site.r;
    if (site.kind === 'capital') {
      // the walls: an irregular ring that bulges and kinks with the ground, gates where the roads come in
      // a gate wherever a road reaches the wall, then a few more so no quarter is cut off
      const gates: number[] = roadGates(w, site, R * 0.97);
      if (!gates.length) gates.push(site.gateYaw ?? 0);
      for (let k = 0; gates.length < 4 && k < 12; k++) {
        // the widest stretch of wall without a gate gets one in its middle
        const sorted = [...gates].sort((a, b) => a - b);
        let gapA = 0, gapW = 0;
        for (let i = 0; i < sorted.length; i++) { const a0 = sorted[i], a1 = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2; if (a1 - a0 > gapW) { gapW = a1 - a0; gapA = a0; } }
        if (gapW < 1.3) break;
        gates.push(gapA + gapW / 2);
      }
      const wp = organicRing(site, R * 0.97, 34, gates, w, r, 0.13);
      wallR = (ang) => polyRadius(wp, site.x, site.z, ang);
      plan.walls = { site: site.id, pts: wp, r: R * 0.97, gates, height: 11, style: iron ? 'dark' : 'stone', center: [site.x, site.z] };
      // the keep and the cathedral first
      const ka = (site.gateYaw ?? 0) + Math.PI + (r() - 0.5) * 0.5;
      plan.keep = add('hall', site.x + Math.cos(ka) * R * 0.36, site.z + Math.sin(ka) * R * 0.36, -ka + Math.PI / 2 + (r() - 0.5) * 0.3, { floors: 3, w: 22, d: 16, style: iron ? 'dark' : 'stone', wealth: 1 } as Partial<BuildingSpec>);
      add('chapel', site.x + Math.cos(axis + 1.3) * 36, site.z + Math.sin(axis + 1.3) * 36, Math.atan2(-Math.cos(axis + 1.3), -Math.sin(axis + 1.3)) + Math.PI / 2 + (r() - 0.5) * 0.3, { w: 12, d: 24 } as Partial<BuildingSpec>);
      // main streets from the market square out to each gate, each bending its own way
      const radials: Path[] = [];
      for (const ga of gates) {
        const gr = wallR(ga) - 2;
        const p = curved(site.x + Math.cos(ga) * plan.plaza.r, site.z + Math.sin(ga) * plan.plaza.r, site.x + Math.cos(ga) * gr, site.z + Math.sin(ga) * gr, (r() - 0.5) * 34);
        paveStreet(p, 6 + r() * 2, true);
        radials.push(p);
      }
      // a crooked ring street about halfway out
      const ringPath: Path = [];
      const rr = 0.52 + r() * 0.08;
      for (let i = 0; i <= 60; i++) { const a = (i / 60) * Math.PI * 2; const rad = wallR(a) * rr * (1 + 0.07 * N.noise(Math.cos(a) * 2 + site.x, Math.sin(a) * 2)); ringPath.push([site.x + Math.cos(a) * rad, site.z + Math.sin(a) * rad]); }
      paveStreet(ringPath, 4.5, true);
      const shopish = (t: number): BType => (t < R * 0.28 ? (r() < 0.45 ? 'shop' : r() < 0.15 ? 'tavern' : 'townhouse') : t > R * 0.75 && r() < 0.2 ? (r() < 0.5 ? 'barracks' : 'stable') : r() < 0.08 ? 'smithy' : r() < 0.6 ? 'townhouse' : 'house');
      for (const p of radials) along(p, 4, shopish, 6, 0.08);
      along(ringPath, 4, () => (r() < 0.55 ? 'townhouse' : r() < 0.6 ? 'house' : 'shop'), 0, 0.1);
      // crooked lanes and alleys branching off the main streets (beaten earth and old cobbles)
      for (let i = 0; i < 16; i++) {
        const src = radials[Math.floor(r() * radials.length)];
        const j = 3 + Math.floor(r() * Math.max(1, src.length - 6));
        const [x0, z0] = src[Math.min(j, src.length - 1)], [x1, z1] = src[Math.min(j + 1, src.length - 1)];
        const h = Math.atan2(z1 - z0, x1 - x0) + (r() < 0.5 ? 1 : -1) * (Math.PI / 2 + (r() - 0.5) * 0.9);
        const lane = wander(x0, z0, h, 35 + r() * 70);
        if (lane.length < 5) continue;
        paveStreet(lane, 3 + r(), r() < 0.4, false);
        plan.streets.push(...lane.slice(0, -1).map((p, k) => [p, lane[k + 1]] as [[number, number], [number, number]]));
        along(lane, 2.5, () => (r() < 0.5 ? 'house' : r() < 0.6 ? 'cottage' : 'townhouse'), 4, 0.2);
      }
      infill(70, R * 0.88, ['house', 'townhouse', 'cottage', 'house']);
      for (let i = 0; i < ringPath.length; i += 6) plan.lamps.push(ringPath[i]);
      for (let i = 0; i < 10; i++) { const a = i * 0.63 + r() * 0.2, rd = plan.plaza.r - 4 - r() * 3; plan.stalls.push({ x: site.x + Math.cos(a) * rd, z: site.z + Math.sin(a) * rd, yaw: -a + Math.PI / 2 + (r() - 0.5) * 0.4, goods: ['fruit', 'bread', 'cloth', 'pottery', 'meat', 'cheese', 'weapons', 'fish', 'candles', 'tools'][i] }); }
      // the town has spilled out past its walls along every road (and up the mountain to Ironspire)
      this.faubourgs(plan, add, wallR, iron ? 720 : 380, iron ? 1 : 0.7, r);
    } else if (site.kind === 'castle') {
      // the castle gate faces the road that climbs to it
      const rg = roadGates(w, site, R * 0.84);
      const gates = [rg.length ? rg[0] : site.gateYaw ?? 0];
      const wp = organicRing(site, R * 0.84, 9 + Math.floor(r() * 4), gates, w, r, 0.17);
      wallR = (ang) => polyRadius(wp, site.x, site.z, ang);
      plan.walls = { site: site.id, pts: wp, r: R * 0.84, gates, height: 13, style: iron ? 'dark' : 'stone', center: [site.x, site.z] };
      // the keep sits off-centre on the highest ground, the rest crowd the curtain wall
      const ka = (site.gateYaw ?? 0) + Math.PI + (r() - 0.5) * 1.2;
      const kd = R * (0.1 + r() * 0.18);
      plan.keep = add('hall', site.x + Math.cos(ka) * kd, site.z + Math.sin(ka) * kd, (site.gateYaw ?? 0) + Math.PI / 2 + (r() - 0.5) * 0.5, { floors: 3, w: 18, d: 14, style: iron ? 'dark' : 'stone', wealth: 1 } as Partial<BuildingSpec>);
      const ring = (t: BType, ang: number) => {
        const a = (site.gateYaw ?? 0) + ang + (r() - 0.5) * 0.3;
        for (let k = 0; k < 4; k++) {
          const d = wallR!(a) - 11 - r() * 6 - k * 3;
          const b = add(t, site.x + Math.cos(a) * d, site.z + Math.sin(a) * d, -a - Math.PI / 2 + (r() - 0.5) * 0.2);
          if (b) return b;
        }
        return null;
      };
      ring('barracks', 1.2); ring('stable', -1.2); ring('smithy', 2.2); ring('chapel', -2.3); ring('guard', 0.6); ring('house', -0.7); ring('warehouse', 2.9);
      paveStreet(curved(site.x, site.z, site.x + Math.cos(site.gateYaw ?? 0) * (wallR(site.gateYaw ?? 0) - 2), site.z + Math.sin(site.gateYaw ?? 0) * (wallR(site.gateYaw ?? 0) - 2), (r() - 0.5) * 12), 6, true);
    } else if (!minor) {
      // towns, villages, ports: a crooked high street along the road, a cross street, lanes, and homes in between
      const L = R * 0.95;
      const ends = [axis, axis + Math.PI].map((a) => curved(site.x, site.z, site.x + Math.cos(a) * L, site.z + Math.sin(a) * L, (r() - 0.5) * 30));
      const cross = [axis + Math.PI / 2, axis - Math.PI / 2].map((a) => curved(site.x, site.z, site.x + Math.cos(a) * L * (0.45 + r() * 0.25), site.z + Math.sin(a) * L * (0.45 + r() * 0.25), (r() - 0.5) * 22));
      for (const p of ends) paveStreet(p, 6, true);
      for (const p of cross) paveStreet(p, 4.5, r() < 0.6);
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
      for (const p of ends) along(p, 4, pick, plan.plaza.r + 2, 0.18);
      for (const p of cross) along(p, 3.5, pick, plan.plaza.r + 2, 0.25);
      for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
        const src = [...ends, ...cross][Math.floor(r() * 4)];
        const j = 2 + Math.floor(r() * Math.max(1, src.length - 4));
        const [x0, z0] = src[Math.min(j, src.length - 1)], [x1, z1] = src[Math.min(j + 1, src.length - 1)];
        const lane = wander(x0, z0, Math.atan2(z1 - z0, x1 - x0) + (r() < 0.5 ? 1 : -1) * (1.2 + r() * 0.8), 30 + r() * 50);
        if (lane.length < 4) continue;
        paveStreet(lane, 3, false, false);
        plan.streets.push(...lane.slice(0, -1).map((p, k) => [p, lane[k + 1]] as [[number, number], [number, number]]));
        along(lane, 2.5, () => (r() < 0.6 ? 'cottage' : 'house'), 3, 0.3);
      }
      infill(10 + Math.floor(r() * 10), R * 0.9, ['cottage', 'house', 'cottage']);
      if (site.dock) {
        plan.docks.push({ x: site.dock.x, z: site.dock.z, yaw: site.dock.yaw, len: 40 });
        paveStreet(curved(site.x, site.z, site.dock.x, site.dock.z, (r() - 0.5) * 20), 5, true);
      }
      // a ferry landing on the river for Eastford/Greyford
      if (site.id === 'eastford' || site.id === 'greyford') {
        const z = site.z, rx = riverX(z), wv = riverWidth(z) / 2, sd = site.id === 'eastford' ? -1 : 1;
        plan.docks.push({ x: rx + sd * (wv + 2), z, yaw: sd > 0 ? -Math.PI / 2 : Math.PI / 2, len: 14 });
        w.trail(site.x, site.z, rx + sd * (wv + 6), z, 4, 0.9);
      }
      for (let i = 0; i < 4; i++) { const a = axis + i * 1.57 + 0.78 + (r() - 0.5) * 0.4; plan.stalls.push({ x: site.x + Math.cos(a) * (plan.plaza.r - 3), z: site.z + Math.sin(a) * (plan.plaza.r - 3), yaw: -a - Math.PI / 2, goods: ['fruit', 'bread', 'cloth', 'meat'][i] }); }
    }
    if (!minor) this.stableYardFor(plan, add, wallR, r);
    if (!minor && site.dock) this.harbour(plan, add, r);
    if (minor && this.hamletNext) this.hamlet(plan, add, r);
    else if (minor) this.homestead(plan, add, r);
    else this.enrich(plan, r, add, overlaps, okGround, placed);
    this.populate(plan, r);
    for (const b of plan.buildings) plan.siteR = Math.max(plan.siteR, Math.hypot(b.x - site.x, b.z - site.z) + 12);
    return plan;
  }

  /** Houses lining the roads beyond the walls: inns, smithies and cottages on terraces cut into the slope. */
  private faubourgs(plan: TownPlan, add: (t: BType, x: number, z: number, yaw: number, o?: Partial<BuildingSpec>, relaxed?: boolean) => Placed | null, wallR: (a: number) => number, reach: number, density: number, r: () => number) {
    const site = plan.site, w = this.world;
    for (const road of w.roads) {
      if (road.kind !== 'road') continue;
      const P = road.pts, n = P.length / 3;
      // does this road start or end at the town?
      const d0 = Math.hypot(P[0] - site.x, P[1] - site.z), d1 = Math.hypot(P[(n - 1) * 3] - site.x, P[(n - 1) * 3 + 1] - site.z);
      if (Math.min(d0, d1) > site.r * 0.6) continue;
      const dir = d0 < d1 ? 1 : -1;
      let lastT = -1e9;
      let inn = false;
      for (let k = dir > 0 ? 0 : n - 1; k >= 0 && k < n; k += dir) {
        const x = P[k * 3], z = P[k * 3 + 1];
        const dc = Math.hypot(x - site.x, z - site.z);
        if (dc < wallR(Math.atan2(z - site.z, x - site.x)) + 14) continue;
        if (dc > wallR(0) + reach) break;
        // arc length since the last plot (points are ~2 m apart)
        const t = k * 2 * dir;
        if (Math.abs(t - lastT) < 9 + r() * 9) continue;
        lastT = t;
        const k2 = Math.min(n - 1, Math.max(0, k + dir * 2));
        const tx = P[k2 * 3] - x, tz = P[k2 * 3 + 1] - z, tl = Math.hypot(tx, tz) || 1;
        const fade = 1 - (dc - wallR(0)) / (reach + 1);                 // denser near the gates
        for (const side of [1, -1]) {
          if (r() > density * (0.45 + 0.55 * fade)) continue;
          const nx = -tz / tl * side, nz = tx / tl * side;
          const type: BType = !inn && r() < 0.06 ? 'tavern' : r() < 0.05 ? 'smithy' : r() < 0.04 ? 'stable' : fade > 0.6 && r() < 0.4 ? 'townhouse' : r() < 0.55 ? 'house' : 'cottage';
          const off = 8.5 + r() * 3 + (type === 'tavern' ? 3 : 0);   // clear of the carriageway and its verge
          const bx = x + nx * off, bz = z + nz * off;
          const b = add(type, bx, bz, Math.atan2(-nx, -nz) + (r() - 0.5) * 0.18, {}, true);
          if (b && type === 'tavern') inn = true;
          if (b && r() < 0.4) plan.lamps.push([x + nx * 3.6, z + nz * 3.6]);
        }
      }
    }
  }

  /** A lone farmstead out on the land: a cottage, maybe a barn, a garden, a paddock, a path to the road. */
  private hamletNext = false;
  /** A stable yard on the main road just outside town: the stable, a paddock of horses, hay and a trough. */
  private stableYardFor(plan: TownPlan, add: (t: BType, x: number, z: number, yaw: number, o?: Partial<BuildingSpec>, relaxed?: boolean) => Placed | null, wallR: ((a: number) => number) | null, r: () => number) {
    const site = plan.site, w = this.world;
    const edge = (x: number, z: number) => (wallR ? wallR(Math.atan2(z - site.z, x - site.x)) : site.r * 0.8);
    for (const road of w.roads) {
      const P = road.pts, n = P.length / 3;
      const d0 = Math.hypot(P[0] - site.x, P[1] - site.z), d1 = Math.hypot(P[(n - 1) * 3] - site.x, P[(n - 1) * 3 + 1] - site.z);
      if (Math.min(d0, d1) > site.r * 0.6) continue;
      const dir = d0 < d1 ? 1 : -1;
      for (let k = dir > 0 ? 0 : n - 1; k >= 0 && k < n; k += dir) {
        const x = P[k * 3], z = P[k * 3 + 1];
        const dc = Math.hypot(x - site.x, z - site.z);
        if (dc < edge(x, z) + 28) continue;
        if (dc > edge(x, z) + 160) break;
        const k2 = Math.min(n - 1, Math.max(0, k + dir * 3));
        const tx = P[k2 * 3] - x, tz = P[k2 * 3 + 1] - z, tl = Math.hypot(tx, tz) || 1;
        for (const side of [1, -1]) {
          const nx = -tz / tl * side, nz = tx / tl * side;
          const bx = x + nx * 13, bz = z + nz * 13;
          const st = add('stable', bx, bz, Math.atan2(-nx, -nz), { style: site.kingdom === 'ironreach' ? 'stone' : 'timber', wealth: 0.4 } as Partial<BuildingSpec>, true);
          if (!st) continue;
          // paddock alongside, trough by the gate, hay
          const px = bx + tx / tl * 20, pz = bz + tz / tl * 20, pyaw = Math.atan2(-nx, -nz);
          if (w.slopeAt(px, pz) < 0.25) { w.paintPlot(px, pz, 18, 14, pyaw, 0, 0.35); plan.paddocks.push({ x: px, z: pz, w: 18, d: 14, yaw: pyaw, species: 'horse' }); }
          plan.extras.push({ kind: 'trough', x: x + nx * 6 + tx / tl * 6, z: z + nz * 6 + tz / tl * 6, yaw: Math.atan2(tx, tz) });
          plan.haystacks.push([bx - tx / tl * 9, bz - tz / tl * 9]);
          plan.lamps.push([x + nx * 4, z + nz * 4]);
          plan.stableYard = { x: bx, z: bz, yaw: Math.atan2(-nx, -nz), stable: st.id, arrive: [x + nx * 5, z + nz * 5] };
          w.trail(bx, bz, x, z, 3, 0.8);
          return;
        }
      }
    }
  }
  /** A working harbour: stone quay, treadwheel crane, cargo stacks, fish-drying racks, more jetties, a lighthouse. */
  private harbour(plan: TownPlan, add: (t: BType, x: number, z: number, yaw: number, o?: Partial<BuildingSpec>, relaxed?: boolean) => Placed | null, r: () => number) {
    const d = plan.site.dock!, w = this.world;
    const fx = Math.sin(d.yaw), fz = Math.cos(d.yaw);           // out along the main pier
    const sx = Math.cos(d.yaw), sz = -Math.sin(d.yaw);          // along the shore
    // walk back from the pier head to find the shore line
    let qx = d.x, qz = d.z;
    for (let k = 0; k < 60; k++) { const x = d.x - fx * k, z = d.z - fz * k; if (w.heightAt(x, z) > 1.0) { qx = x; qz = z; break; } }
    plan.extras.push({ kind: 'quay', x: qx, z: qz, yaw: d.yaw, len: 70 });
    plan.extras.push({ kind: 'crane', x: qx + sx * 9 - fx * 2, z: qz + sz * 9 - fz * 2, yaw: d.yaw });
    for (let i = 0; i < 4; i++) plan.extras.push({ kind: 'cargo', x: qx + sx * (-14 - i * 4.5) - fx * (3 + r() * 3), z: qz + sz * (-14 - i * 4.5) - fz * (3 + r() * 3), yaw: d.yaw + (r() - 0.5) * 0.4 });
    for (let i = 0; i < 3; i++) plan.extras.push({ kind: 'rack', x: qx + sx * (22 + i * 5) - fx * 6, z: qz + sz * (22 + i * 5) - fz * 6, yaw: d.yaw + Math.PI / 2 });
    for (const sd of [-1, 1]) plan.docks.push({ x: qx + sx * sd * 28 + fx * 11, z: qz + sz * sd * 28 + fz * 11, yaw: d.yaw, len: 22 });
    // lighthouse at the end of the breakwater, on the seaward side
    plan.extras.push({ kind: 'lighthouse', x: d.x + fx * 55 + sx * 70, z: d.z + fz * 55 + sz * 70, yaw: d.yaw });
    // harbour warehouses on the quay
    for (const sd of [-1, 1]) add('warehouse', qx + sx * sd * 16 - fx * 15, qz + sz * sd * 16 - fz * 15, d.yaw + Math.PI, {}, true);
  }
  /** A farming hamlet: a few houses well apart around a green and a well, gardens, a barn, open fields. */
  private hamlet(plan: TownPlan, add: (t: BType, x: number, z: number, yaw: number, o?: Partial<BuildingSpec>, relaxed?: boolean) => Placed | null, r: () => number) {
    const s = plan.site, w = this.world, iron = s.kingdom === 'ironreach';
    const style = () => ({ style: iron ? (r() < 0.5 ? 'stone' : 'dark') : r() < 0.4 ? 'timber' : r() < 0.5 ? 'plaster' : 'rustic', roof: iron ? 'slate' : r() < 0.6 ? 'thatch' : 'shingle', wealth: r() * 0.45 } as Partial<BuildingSpec>);
    plan.wells.push([s.x + (r() - 0.5) * 4, s.z + (r() - 0.5) * 4]);
    const n = 3 + (r() < 0.5 ? 1 : 0);
    const a0 = r() * Math.PI * 2;
    const homes: Placed[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.7, rad = 20 + r() * 22;
      const hx = s.x + Math.cos(a) * rad, hz = s.z + Math.sin(a) * rad;
      // face the green, not quite squarely
      const yaw = Math.atan2(s.x - hx, s.z - hz) + (r() - 0.5) * 0.5;
      const h = add(r() < 0.6 ? 'cottage' : 'house', hx, hz, yaw, style(), true);
      if (!h) continue;
      homes.push(h);
      const back = [-Math.sin(yaw), -Math.cos(yaw)];
      const gd = 6 + r() * 4, gw = 7 + r() * 5;
      const gx = hx + back[0] * (h.spec.d / 2 + gd / 2 + 1.5), gz = hz + back[1] * (h.spec.d / 2 + gd / 2 + 1.5);
      if (w.slopeAt(gx, gz) < 0.2) { w.paintPlot(gx, gz, gw, gd, yaw, r() < 0.6 ? 3 : 1, 1); plan.gardens.push({ x: gx, z: gz, w: gw, d: gd, yaw }); }
      // a worn path from the door to the green
      w.trail(hx + Math.sin(yaw) * (h.spec.d / 2), hz + Math.cos(yaw) * (h.spec.d / 2), s.x, s.z, 1.6, 0.6);
    }
    if (!homes.length) return;
    // the shared barn and a paddock on the edge
    const ba = a0 + Math.PI / n, bx = s.x + Math.cos(ba) * 34, bz = s.z + Math.sin(ba) * 34;
    add('barn', bx, bz, Math.atan2(s.x - bx, s.z - bz) + Math.PI / 2, { style: 'rustic' } as Partial<BuildingSpec>, true);
    const pa = ba + 0.6, px = s.x + Math.cos(pa) * 55, pz = s.z + Math.sin(pa) * 55;
    if (w.slopeAt(px, pz) < 0.2 && w.heightAt(px, pz) > w.waterLevelAt(px, pz) + 1) {
      w.paintPlot(px, pz, 22, 16, pa, 0, 0.35);
      plan.paddocks.push({ x: px, z: pz, w: 22, d: 16, yaw: pa, species: (iron ? ['pig', 'donkey'] : ['cow', 'cow', 'horse', 'pig'])[Math.floor(r() * (iron ? 2 : 4))] as TownPlan['paddocks'][number]['species'] });
    }
    // strip fields all around, the way open-field villages farmed
    for (let f = 0; f < 4 + Math.floor(r() * 3); f++) {
      const fa = r() * Math.PI * 2, fr = 75 + r() * 45, fx = s.x + Math.cos(fa) * fr, fz = s.z + Math.sin(fa) * fr;
      if (w.slopeAt(fx, fz) > 0.12 || w.roadAt(fx, fz) > 0.05 || w.heightAt(fx, fz) < w.waterLevelAt(fx, fz) + 1.5) continue;
      w.paintPlot(fx, fz, 18 + r() * 14, 40 + r() * 30, fa + Math.PI / 2, 1 + Math.floor(r() * 3), 1);
    }
    for (let h = 0; h < 2 + Math.floor(r() * 3); h++) plan.haystacks.push([bx + (r() - 0.5) * 14, bz + (r() - 0.5) * 14]);
    // the lane out to the nearest road
    let tx = 0, tz = 0, bd = 1e9;
    for (const road of w.roads) for (let i = 0; i < road.pts.length; i += 15) { const d = (road.pts[i] - s.x) ** 2 + (road.pts[i + 1] - s.z) ** 2; if (d < bd) { bd = d; tx = road.pts[i]; tz = road.pts[i + 1]; } }
    if (bd < 800 * 800) w.trail(s.x, s.z, tx, tz, 2.6, 0.8);
  }

  private homestead(plan: TownPlan, add: (t: BType, x: number, z: number, yaw: number, o?: Partial<BuildingSpec>, relaxed?: boolean) => Placed | null, r: () => number) {
    const s = plan.site, w = this.world;
    // face the nearest road (or the nearest town)
    let tx = 0, tz = 0, bd = 1e9;
    for (const road of w.roads) for (let i = 0; i < road.pts.length; i += 15) { const d = (road.pts[i] - s.x) ** 2 + (road.pts[i + 1] - s.z) ** 2; if (d < bd) { bd = d; tx = road.pts[i]; tz = road.pts[i + 1]; } }
    const yaw = Math.atan2(tx - s.x, tz - s.z) + (r() - 0.5) * 0.6;
    const iron = s.kingdom === 'ironreach';
    const house = add(r() < 0.75 ? 'cottage' : 'house', s.x, s.z, yaw, { style: iron ? (r() < 0.5 ? 'stone' : 'dark') : r() < 0.5 ? 'timber' : r() < 0.5 ? 'plaster' : 'rustic', roof: iron ? 'slate' : r() < 0.7 ? 'thatch' : 'shingle', wealth: r() * 0.4 } as Partial<BuildingSpec>, true);
    if (!house) return;
    const side = [Math.cos(yaw), -Math.sin(yaw)], back = [-Math.sin(yaw), -Math.cos(yaw)];
    const sd = r() < 0.5 ? 1 : -1;
    if (r() < 0.6) add(r() < 0.7 ? 'barn' : 'stable', s.x + side[0] * sd * 13 + back[0] * 3, s.z + side[1] * sd * 13 + back[1] * 3, yaw + Math.PI / 2 * sd + (r() - 0.5) * 0.3, { style: 'rustic' } as Partial<BuildingSpec>, true);
    // garden behind, paddock to the side, a haystack or two, sometimes a well
    const gd = 6 + r() * 5, gw = 6 + r() * 5;
    const gx = s.x + back[0] * (house.spec.d / 2 + gd / 2 + 1.5), gz = s.z + back[1] * (house.spec.d / 2 + gd / 2 + 1.5);
    if (w.slopeAt(gx, gz) < 0.2) { w.paintPlot(gx, gz, gw, gd, yaw, r() < 0.6 ? 3 : 1, 1); plan.gardens.push({ x: gx, z: gz, w: gw, d: gd, yaw }); }
    if (r() < 0.55) {
      const pw = 14 + r() * 10, pd = 10 + r() * 8;
      const px = s.x - side[0] * sd * (pw / 2 + 9), pz = s.z - side[1] * sd * (pw / 2 + 9);
      if (w.slopeAt(px, pz) < 0.22 && w.heightAt(px, pz) > w.waterLevelAt(px, pz) + 1) {
        w.paintPlot(px, pz, pw, pd, yaw, 0, 0.35);
        const sp = (iron ? ['pig', 'donkey', 'horse'] : ['cow', 'pig', 'horse', 'donkey', 'cow'])[Math.floor(r() * (iron ? 3 : 5))] as TownPlan['paddocks'][number]['species'];
        plan.paddocks.push({ x: px, z: pz, w: pw, d: pd, yaw, species: sp });
      }
    }
    for (let h = 0; h < Math.floor(r() * 3); h++) plan.haystacks.push([s.x + back[0] * (14 + h * 3) + side[0] * sd * 8, s.z + back[1] * (14 + h * 3) + side[1] * sd * 8]);
    if (r() < 0.35) plan.wells.push([s.x + side[0] * -sd * 6 + Math.sin(yaw) * 6, s.z + side[1] * -sd * 6 + Math.cos(yaw) * 6]);
    // the track to the road
    if (bd < 700 * 700) w.trail(s.x + Math.sin(yaw) * (house.spec.d / 2), s.z + Math.cos(yaw) * (house.spec.d / 2), tx, tz, 2.2, 0.75);
  }

  /** Life around the houses: kitchen gardens, farmsteads with paddocks and haystacks, orchards, lamps. */
  private enrich(plan: TownPlan, r: () => number, add: (t: BType, x: number, z: number, yaw: number, o?: Partial<BuildingSpec>) => Placed | null,
    overlaps: (x: number, z: number, hw: number, hd: number, yaw: number) => boolean, okGround: (x: number, z: number, hw: number, hd: number) => boolean,
    placed: { x: number; z: number; hw: number; hd: number; yaw: number }[]) {
    const w = this.world, site = plan.site;
    const rect = (x: number, z: number, wd: number, dd: number, yaw: number, crop: number, fieldAmt = 1) => {
      // paint soil (and a crop for the grass system) into the terrain control maps
      w.paintPlot(x, z, wd, dd, yaw, crop, fieldAmt);
      placed.push({ x, z, hw: wd / 2, hd: dd / 2, yaw });
    };
    // kitchen gardens behind homes
    for (const b of [...plan.buildings]) {
      if (!['house', 'cottage', 'townhouse'].includes(b.spec.type) || r() < 0.25) continue;
      const gd = 5 + r() * 6, gw = Math.max(4, b.spec.w * (0.7 + r() * 0.4));
      const back = b.spec.d / 2 + gd / 2 + 1.2;
      const x = b.x - Math.sin(b.yaw) * back, z = b.z - Math.cos(b.yaw) * back;
      if (overlaps(x, z, gw / 2, gd / 2, b.yaw) || !okGround(x, z, gw / 2, gd / 2)) continue;
      rect(x, z, gw, gd, b.yaw, r() < 0.7 ? 3 : 1);
      plan.gardens.push({ x, z, w: gw, d: gd, yaw: b.yaw });
    }
    if (site.kind === 'castle') return;
    // farmsteads ringing the town: farmhouse, barn, paddock with livestock, haystacks, an orchard
    const n = site.kind === 'capital' ? 8 : site.kind === 'port' ? 3 : 5;
    for (let k = 0, tries = 0; k < n && tries < 80; tries++) {
      const a = r() * Math.PI * 2, d = site.r * (site.kind === 'capital' ? 1.15 : 1.05) + 40 + r() * 140;
      const fx = site.x + Math.cos(a) * d, fz = site.z + Math.sin(a) * d;
      const yaw = Math.atan2(site.x - fx, site.z - fz); // farmhouse faces the town
      if (w.roadAt(fx, fz) > 0.2 || w.fieldAt(fx, fz) > 0.2) continue;
      const house = add('cottage', fx, fz, yaw, { style: site.kingdom === 'ironreach' ? 'stone' : r() < 0.5 ? 'timber' : 'plaster', roof: site.kingdom === 'ironreach' ? 'slate' : 'thatch' } as Partial<BuildingSpec>);
      if (!house) continue;
      k++;
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const bx = fx + side.x * 13, bz = fz + side.z * 13;
      add('barn', bx, bz, yaw + Math.PI / 2, { style: 'rustic' } as Partial<BuildingSpec>);
      // paddock behind
      const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const pw = 18 + r() * 10, pd = 12 + r() * 8;
      const px = fx + back.x * (pd / 2 + 8) + side.x * 4, pz = fz + back.z * (pd / 2 + 8) + side.z * 4;
      if (!overlaps(px, pz, pw / 2, pd / 2, yaw) && okGround(px, pz, pw / 2, pd / 2)) {
        const sp = (site.kingdom === 'ironreach' ? ['pig', 'horse', 'donkey', 'pig'] : ['cow', 'cow', 'pig', 'horse', 'donkey'])[Math.floor(r() * (site.kingdom === 'ironreach' ? 4 : 5))] as TownPlan['paddocks'][number]['species'];
        rect(px, pz, pw, pd, yaw, 0, 0.35);
        plan.paddocks.push({ x: px, z: pz, w: pw, d: pd, yaw, species: sp });
      }
      for (let h = 0; h < 2 + Math.floor(r() * 3); h++) plan.haystacks.push([bx + back.x * (6 + h * 2.5) + (r() - 0.5) * 3, bz + back.z * (6 + h * 2.5) + (r() - 0.5) * 3]);
      // orchard on the other side
      if (r() < 0.6) {
        const ow = 26 + r() * 20, od = 20 + r() * 14;
        const ox = fx - side.x * (ow / 2 + 8), oz = fz - side.z * (ow / 2 + 8);
        if (!overlaps(ox, oz, ow / 2, od / 2, yaw) && okGround(ox, oz, ow / 2, od / 2)) { rect(ox, oz, ow, od, yaw, 0, 0); plan.orchards.push({ x: ox, z: oz, w: ow, d: od, yaw }); }
      }
      // a cart track back to town
      w.trail(fx + Math.sin(yaw) * 4, fz + Math.cos(yaw) * 4, site.x + (fx - site.x) * 0.35, site.z + (fz - site.z) * 0.35, 2.6, 0.8);
    }
    // torches along the streets, now and then
    plan.streets.forEach(([[x0, z0], [x1, z1]], i) => {
      if (i % 5 !== 2) return;
      const len = Math.hypot(x1 - x0, z1 - z0) || 1, sd = i % 10 < 5 ? 1 : -1;
      plan.lamps.push([x0 + (z1 - z0) / len * 3.6 * sd, z0 - (x1 - x0) / len * 3.6 * sd]);
    });
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
      } else if (t === 'stable' && plan.stableYard?.stable === b.id) {
        const members = [mk(b.id, 'stablemaster', r() < 0.25, 30 + Math.floor(r() * 25)), mk(b.id, 'laborer', r() < 0.3, 16 + Math.floor(r() * 10))];
        members[0].work = b.id; members[1].work = b.id;
        b.household = { id: b.id, family: 'the stables', members, wealth: 0.4 };
        this.people.push(...members);
      } else if (t === 'warehouse' && plan.site.dock && !plan.buildings.some((x) => x.household?.members.some((m) => m.role === 'ferryman'))) {
        const members = [mk(b.id, 'ferryman', false, 35 + Math.floor(r() * 25))];
        members[0].work = b.id;
        b.household = { id: b.id, family: 'the harbour', members, wealth: 0.3 };
        this.people.push(...members);
      } else if (t === 'chapel') {
        const members = [mk(b.id, 'priest', r() < 0.3, 50)];
        b.household = { id: b.id, family: 'the chapel', members, wealth: 0.5 };
        this.people.push(...members);
      }
    }
  }
}

/**
 * An irregular wall circuit: vertices at uneven angles and radii (bulging with noise and pulled in where the
 * ground falls away), kept regular only around the gates so the gatehouses sit square on the roads.
 */
/** Angles (atan2(dz, dx) about the site) at which the roads cross a circle of radius R, nearest-first deduped. */
function roadGates(w: World, site: Site, R: number): number[] {
  const out: number[] = [];
  for (const rd of w.roads) {
    const P = rd.pts;
    for (let k = 0; k + 5 < P.length; k += 3) {
      const d0 = Math.hypot(P[k] - site.x, P[k + 1] - site.z), d1 = Math.hypot(P[k + 3] - site.x, P[k + 4] - site.z);
      if ((d0 - R) * (d1 - R) > 0) continue;
      const t = (R - d0) / ((d1 - d0) || 1e-6);
      const x = P[k] + (P[k + 3] - P[k]) * t, z = P[k + 1] + (P[k + 4] - P[k + 1]) * t;
      const a = Math.atan2(z - site.z, x - site.x);
      if (!out.some((o) => Math.abs(Math.atan2(Math.sin(o - a), Math.cos(o - a))) < 0.35)) out.push(a);
    }
  }
  return out;
}

function organicRing(site: Site, R: number, n: number, gates: number[], w: World, r: () => number, irregular: number): [number, number][] {
  const base = w.heightAt(site.x, site.z);
  const angs: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const nearGate = gates.some((g) => Math.abs(Math.atan2(Math.sin(g - a), Math.cos(g - a))) < (Math.PI * 2 / n) * 1.6);
    angs.push(a + (nearGate ? 0 : (r() - 0.5) * (Math.PI * 2 / n) * 0.55));
  }
  // make sure each gate falls on the middle of a segment
  for (const g of gates) {
    const step = Math.PI * 2 / n;
    let best = 0, bd = 9;
    angs.forEach((a, i) => { const d = Math.abs(Math.atan2(Math.sin(g - step / 2 - a), Math.cos(g - step / 2 - a))); if (d < bd) { bd = d; best = i; } });
    angs[best] = g - step / 2; angs[(best + 1) % n] = g + step / 2;
  }
  angs.sort((a, b) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - ((b % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
  const rad = angs.map((a) => {
    let rr = R * (1 - irregular * 0.5 + irregular * (0.5 + 0.5 * w.noise.noise(Math.cos(a) * 1.3 + site.x * 0.01, Math.sin(a) * 1.3 + site.z * 0.01)));
    // follow the brow of the hill: pull the wall in where the ground drops away
    for (let d = R * 0.55; d < rr; d += 3) { if (w.heightAt(site.x + Math.cos(a) * d, site.z + Math.sin(a) * d) < base - 5) { rr = Math.max(R * 0.6, d - 4); break; } }
    return rr;
  });
  // soften: neighbours pull toward each other a little
  const sm = rad.map((v, i) => v * 0.6 + (rad[(i + n - 1) % n] + rad[(i + 1) % n]) * 0.2);
  return angs.map((a, i) => [site.x + Math.cos(a) * sm[i], site.z + Math.sin(a) * sm[i]] as [number, number]);
}
/** Distance from the centre to a star-shaped polygon along a ray. */
function polyRadius(pts: [number, number][], cx: number, cz: number, ang: number): number {
  const dx = Math.cos(ang), dz = Math.sin(ang);
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - cx) * ez - (a[1] - cz) * ex) / den;
    const u = ((a[0] - cx) * dz - (a[1] - cz) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 100;
}
export const _v = new THREE.Vector3();
