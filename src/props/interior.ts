// Furnishing rules: each room kind gets a layout of furniture against walls and in the middle,
// avoiding doors, stairs, the hearth and each other. Wealth picks finer woods and fabrics.
import * as THREE from 'three';
import type { Room, BuildingModel, RoomKind } from '../build/building';
import { makeFurniture, modsFor, CATALOG, type Category, type FurnitureModel, type Mods } from './furniture';
import { mulberry32 } from '../core/noise';

export interface Placement { model: FurnitureModel; pos: THREE.Vector3; yaw: number; room: number; mods: Mods; wallMounted?: boolean }
export interface ItemSpot { item: string; pos: THREE.Vector3; owner: 'house' | 'shop' }

type Ext = Room & { stairX: number; stairZ0: number; stairZ1: number; stairW: number; hearthSide: 'e' | 'w'; hasHearth: boolean };

class Grid {
  cells: Uint8Array; nx: number; nz: number;
  constructor(public x0: number, public z0: number, public x1: number, public z1: number, public cell = 0.2) {
    this.nx = Math.max(1, Math.ceil((x1 - x0) / cell)); this.nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    this.cells = new Uint8Array(this.nx * this.nz);
  }
  rect(cx: number, cz: number, hw: number, hd: number, test: boolean): boolean {
    const i0 = Math.floor((cx - hw - this.x0) / this.cell), i1 = Math.ceil((cx + hw - this.x0) / this.cell);
    const j0 = Math.floor((cz - hd - this.z0) / this.cell), j1 = Math.ceil((cz + hd - this.z0) / this.cell);
    if (test && (i0 < 0 || j0 < 0 || i1 > this.nx || j1 > this.nz)) return false;
    // marking clamps to the room, so keep-out zones that straddle a partition still apply
    for (let j = Math.max(0, j0); j < Math.min(this.nz, j1); j++) for (let i = Math.max(0, i0); i < Math.min(this.nx, i1); i++) {
      if (test) { if (this.cells[j * this.nx + i]) return false; } else this.cells[j * this.nx + i] = 1;
    }
    return true;
  }
}

const designs = (c: Category) => Object.keys(CATALOG[c]);

export function furnish(model: BuildingModel, seed: number): { furniture: Placement[]; items: ItemSpot[] } {
  const r = mulberry32(seed);
  const out: Placement[] = [];
  const items: ItemSpot[] = [];
  const wealth = model.spec.wealth;
  const iron = model.spec.kingdom === 'ironreach';
  const woodPool = wealth > 0.7 ? ['walnut', 'fine', 'oak', 'dark'] : wealth > 0.35 ? ['oak', 'table', 'kitchen', 'pine', 'cabinet'] : ['worn', 'pine', 'kitchen', 'peeling'];
  const finPool = wealth > 0.7 ? ['varnished', 'lacquered', 'waxed'] : wealth > 0.35 ? ['oiled', 'waxed'] : ['raw', 'oiled'];
  const fabPool = wealth > 0.7 ? ['velvet', 'jacquard', 'satin', 'floral'] : wealth > 0.35 ? ['linen', 'gingham', 'weave', 'wool', 'stripe'] : ['linen', 'wool', 'fleece', 'herringbone'];
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  // a household shares a style: one main wood, stain and finish
  const house: Partial<Mods> = { wood: pick(woodPool), stain: iron ? pick(['walnut', 'ebony', 'chestnut', 'natural']) : pick(['natural', 'honey', 'amber', 'chestnut', 'whitewash']), fin: pick(finPool) };
  const mods = (over: Partial<Mods> = {}) => modsFor(Math.floor(r() * 1e9), { ...house, fabric: pick(fabPool), ...over });

  model.rooms.forEach((rm0, ri) => {
    const rm = rm0 as Ext;
    const g = new Grid(rm.min.x, rm.min.y, rm.max.x, rm.max.y);
    // keep clear: stairs footprint, doors, hearth
    // open-fronted workshops keep their whole front clear
    if (model.spec.type === 'smithy' && rm.floor === 0) g.rect((rm.min.x + rm.max.x) / 2, rm.max.y - 0.6, (rm.max.x - rm.min.x) / 2, 1.3, false);
    // the stair run plus a landing at the bottom and the top must stay clear
    if (model.spec.floors > 1) g.rect(rm.stairX, (rm.stairZ0 + rm.stairZ1) / 2, rm.stairW / 2 + 0.35, Math.abs(rm.stairZ0 - rm.stairZ1) / 2 + 1.2, false);
    // and a walkway from the front door to the foot of the stairs
    if (model.spec.floors > 1 && rm.floor === 0) g.rect((rm.stairX + 0) / 2, rm.stairZ0 - 0.2, Math.abs(rm.stairX) / 2 + 0.6, 0.7, false);
    for (const d of model.doors) if (Math.abs(d.pos.y - rm.y) < 0.5) g.rect(d.pos.x, d.pos.z, 0.9, 0.9, false);
    if (rm.hasHearth && rm.floor === 0) { const hx = rm.hearthSide === 'e' ? rm.max.x : rm.min.x; g.rect(hx, model.rooms[0] ? -model.spec.d / 2 + Math.min(model.spec.d * 0.35, 2.2) : 0, 1.6, 1.6, false); }
    // place helpers
    const tryPlace = (cat: Category, design: string, m: Mods, against: boolean, pad = 0.1, tries = 40): Placement | null => {
      const fm = makeFurniture(cat, design, m);
      const hw = fm.size.x / 2 + pad, hd = fm.size.z / 2 + pad;
      for (let t = 0; t < tries; t++) {
        let x: number, z: number, yaw: number;
        if (against) {
          const side = Math.floor(r() * 4);
          // back to the wall, front facing into the room
          if (side === 0) { yaw = 0; x = rm.min.x + hw + r() * Math.max(0, rm.max.x - rm.min.x - hw * 2); z = rm.min.y + hd; }
          else if (side === 1) { yaw = Math.PI; x = rm.min.x + hw + r() * Math.max(0, rm.max.x - rm.min.x - hw * 2); z = rm.max.y - hd; }
          else if (side === 2) { yaw = Math.PI / 2; z = rm.min.y + hw + r() * Math.max(0, rm.max.y - rm.min.y - hw * 2); x = rm.min.x + hd; }
          else { yaw = -Math.PI / 2; z = rm.min.y + hw + r() * Math.max(0, rm.max.y - rm.min.y - hw * 2); x = rm.max.x - hd; }
        } else {
          yaw = r() < 0.5 ? 0 : Math.PI / 2;
          x = rm.min.x + 0.8 + r() * Math.max(0, rm.max.x - rm.min.x - 1.6); z = rm.min.y + 0.8 + r() * Math.max(0, rm.max.y - rm.min.y - 1.6);
        }
        const rot = Math.abs(Math.sin(yaw)) > 0.5;
        const ex = rot ? hd : hw, ez = rot ? hw : hd;
        if (!g.rect(x, z, ex, ez, true)) continue;
        g.rect(x, z, ex, ez, false);
        const p: Placement = { model: fm, pos: new THREE.Vector3(x, rm.y, z), yaw, room: ri, mods: m };
        out.push(p);
        return p;
      }
      return null;
    };
    const wallThing = (cat: Category, design: string, m: Mods) => {
      // wall-mounted: does not block the floor; pick a wall position at a random spot
      const fm = makeFurniture(cat, design, m);
      const side = Math.floor(r() * 4);
      const along = r();
      let x = 0, z = 0, yaw = 0;
      if (side === 0) { yaw = 0; x = rm.min.x + 0.6 + along * (rm.max.x - rm.min.x - 1.2); z = rm.min.y + 0.05; }
      else if (side === 1) { yaw = Math.PI; x = rm.min.x + 0.6 + along * (rm.max.x - rm.min.x - 1.2); z = rm.max.y - 0.05; }
      else if (side === 2) { yaw = Math.PI / 2; x = rm.min.x + 0.05; z = rm.min.y + 0.6 + along * (rm.max.y - rm.min.y - 1.2); }
      else { yaw = -Math.PI / 2; x = rm.max.x - 0.05; z = rm.min.y + 0.6 + along * (rm.max.y - rm.min.y - 1.2); }
      // never over the staircase
      if (model.spec.floors > 1 && Math.abs(x - rm.stairX) < rm.stairW + 0.5 && z < Math.max(rm.stairZ0, rm.stairZ1) + 1 && z > Math.min(rm.stairZ0, rm.stairZ1) - 1) return;
      // avoid windows
      for (const w of model.windows) if (Math.hypot(w.pos.x - x, w.pos.z - z) < 1.0 && Math.abs(w.pos.y - (rm.y + 1.5)) < 1.5) return;
      out.push({ model: fm, pos: new THREE.Vector3(x, rm.y, z), yaw, room: ri, mods: m, wallMounted: true });
    };
    const onSurface = (p: Placement | null, things: string[], n: number) => {
      if (!p) return;
      for (const s of p.model.surfaces ?? []) for (let i = 0; i < n; i++) {
        const lx = s.x + (r() - 0.5) * s.w * 0.8, lz = s.z + (r() - 0.5) * s.d * 0.8;
        const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
        items.push({ item: pick(things), pos: new THREE.Vector3(p.pos.x + lx * c + lz * sn, p.pos.y + s.y, p.pos.z - lx * sn + lz * c), owner: rm.kind === 'shop' ? 'shop' : 'house' });
      }
    };
    const area = (rm.max.x - rm.min.x) * (rm.max.y - rm.min.y);
    switch (rm.kind) {
      case 'bedroom': case 'dorm': {
        const nBeds = rm.kind === 'dorm' ? Math.max(2, Math.floor(area / 5)) : area > 14 ? 2 : 1;
        for (let i = 0; i < nBeds; i++) {
          const design = rm.kind === 'dorm' ? pick(['bunk', 'cot', 'plank']) : wealth > 0.75 ? pick(['canopy', 'four_poster', 'trundle']) : wealth > 0.35 ? pick(['plank', 'four_poster', 'trundle', 'boxbed']) : pick(['pallet', 'plank', 'cot']);
          const bed = tryPlace('bed', design, mods({ pillows: 1 + Math.floor(r() * 3), size: rm.kind === 'dorm' ? 0 : r() < 0.6 ? 1 : 0 }), true, 0.25);
          if (bed && r() < 0.7) tryPlace('drawers', 'nightstand', mods(), true);
        }
        if (r() < 0.8) tryPlace('chest', pick(designs('chest')), mods(), true);
        if (r() < 0.75) tryPlace('wardrobe', pick(designs('wardrobe')), mods(), true);
        if (r() < 0.5) tryPlace('drawers', pick(['three', 'tall', 'dresser_mirror']), mods(), true);
        if (r() < 0.5) tryPlace('chair', pick(designs('chair').filter((d) => d !== 'throne')), mods(), true);
        if (r() < 0.6) tryPlace('rug', pick(designs('rug')), mods(), false, 0);
        if (r() < 0.4) wallThing('misc', pick(['painting', 'tapestry']), mods());
        if (r() < 0.25 && model.spec.type !== 'barracks') tryPlace('misc', 'cradle', mods(), true);
        tryPlace('misc', 'chamberpot', mods(), true, 0.05);
        for (let i = 0; i < 2; i++) { const c = tryPlace('candle', pick(['taper', 'pillar', 'saucer']), mods(), true, 0.05); void c; }
        break;
      }
      case 'common': case 'kitchen': {
        const tbl = tryPlace('table', rm.kind === 'kitchen' ? pick(['kitchen', 'trestle', 'workbench']) : pick(['trestle', 'square', 'round', 'refectory', 'gateleg', 'tavern']), mods(), false, 0.7);
        if (tbl) {
          // chairs drawn up square to the table's sides: along both long sides of a long table, one to a
          // side of a square or round one; each faces the table, a little pulled out or askew
          const rot = Math.abs(Math.sin(tbl.yaw)) > 0.5;
          const hx = (rot ? tbl.model.size.z : tbl.model.size.x) / 2, hz = (rot ? tbl.model.size.x : tbl.model.size.z) / 2;
          const L = Math.max(hx, hz), S = Math.min(hx, hz), alongX = hx >= hz;
          const seats: [number, number, number][] = [];
          const perSide = L - S < 0.25 ? 1 : Math.max(1, Math.min(3, Math.floor((2 * L) / 0.62)));
          for (let k = 0; k < perSide; k++) for (const sd of [-1, 1]) {
            const al = perSide === 1 ? 0 : ((k + 0.5) / perSide) * 2 * L - L, off = S + 0.36;
            seats.push(alongX ? [tbl.pos.x + al, tbl.pos.z + sd * off, sd > 0 ? Math.PI : 0] : [tbl.pos.x + sd * off, tbl.pos.z + al, sd > 0 ? -Math.PI / 2 : Math.PI / 2]);
          }
          // the ends (the head of a long table, the other two sides of a square one)
          for (const sd of [-1, 1]) { const off = L + 0.36; seats.push(alongX ? [tbl.pos.x + sd * off, tbl.pos.z, sd > 0 ? -Math.PI / 2 : Math.PI / 2] : [tbl.pos.x, tbl.pos.z + sd * off, sd > 0 ? Math.PI : 0]); }
          const n = Math.min(seats.length, 2 + Math.floor(r() * (seats.length - 1)));
          const isChairs = r() < 0.75, design = isChairs ? pick(['stick', 'ladderback', 'spindle', 'panel']) : pick(['square', 'three_leg_round', 'milking']);
          let placed = 0;
          for (const [x, z, yaw] of seats) {
            if (placed >= n) break;
            if (x < rm.min.x + 0.3 || x > rm.max.x - 0.3 || z < rm.min.y + 0.3 || z > rm.max.y - 0.3) continue;
            // (the table's own clearance already keeps other furniture off these seats)
            const m = mods({ fill: r() });
            const cm = makeFurniture(isChairs ? 'chair' : 'stool', design, m);
            const pull = r() * 0.08;
            out.push({ model: cm, pos: new THREE.Vector3(x - Math.sin(yaw) * pull, rm.y, z - Math.cos(yaw) * pull), yaw: yaw + (r() - 0.5) * 0.12, room: ri, mods: m });
            placed++;
          }
          onSurface(tbl, ['bread', 'apple', 'cheese', 'jug', 'cup', 'bowl', 'plate', 'onion', 'pear', 'candle'], 3 + Math.floor(r() * 4));
          const c = makeFurniture('candle', pick(['taper', 'cluster', 'candelabra', 'pillar']), mods());
          out.push({ model: c, pos: new THREE.Vector3(tbl.pos.x, tbl.pos.y + (tbl.model.surfaces?.[0]?.y ?? 0.78), tbl.pos.z), yaw: 0, room: ri, mods: mods() });
        }
        if (rm.kind === 'kitchen') {
          tryPlace('cupboard', pick(designs('cupboard')), mods(), true);
          wallThing('shelf', pick(['spice', 'plate_rack', 'wall']), mods());
          wallThing('shelf', 'hanging', mods());
          for (let i = 0; i < 2; i++) items.push({ item: pick(['barrel', 'crate', 'sack', 'basket', 'bucket']), pos: placeFree(g, rm, r, 0.4), owner: 'house' });
          tryPlace('misc', pick(['firewood', 'washtub']), mods(), true);
        } else {
          if (r() < 0.7) tryPlace('chair', pick(['armchair', 'settle']), mods({ fill: 1 }), true);
          if (r() < 0.6) tryPlace('shelf', 'bookcase', mods(), true);
          if (r() < 0.5) tryPlace('chest', pick(designs('chest')), mods(), true);
          tryPlace('rug', pick(designs('rug')), mods(), false, 0);
          if (r() < 0.6) wallThing('misc', pick(['painting', 'tapestry', 'banner']), mods());
          if (r() < 0.3) tryPlace('misc', pick(['loom']), mods(), true);
          tryPlace('candle', 'stand', mods(), true, 0.05);
          if (r() < 0.4) items.push({ item: 'broom', pos: placeFree(g, rm, r, 0.2), owner: 'house' });
        }
        break;
      }
      case 'taproom': {
        tryPlace('desk', 'counter', mods({ wood: 'dark' }), true, 0.6);
        tryPlace('misc', 'barrel_stack', mods(), true);
        const n = Math.max(2, Math.floor(area / 9));
        for (let i = 0; i < n; i++) {
          const t = tryPlace('table', pick(['tavern', 'round', 'trestle']), mods(), false, 0.9);
          if (!t) continue;
          for (let s = 0; s < 4; s++) {
            const a = s * Math.PI / 2 + 0.2, cd = Math.max(t.model.size.x, t.model.size.z) / 2 + 0.3;
            const p = new THREE.Vector3(t.pos.x + Math.cos(a) * cd, rm.y, t.pos.z + Math.sin(a) * cd);
            const m = mods();
            out.push({ model: makeFurniture('stool', pick(['tall', 'square', 'three_leg_round']), m), pos: p, yaw: Math.atan2(t.pos.x - p.x, t.pos.z - p.z), room: ri, mods: m });
          }
          onSurface(t, ['tankard', 'cup', 'bread', 'jug', 'cheese'], 2 + Math.floor(r() * 3));
          const c = makeFurniture('candle', pick(['pillar', 'saucer', 'cluster']), mods());
          out.push({ model: c, pos: new THREE.Vector3(t.pos.x, t.pos.y + (t.model.surfaces?.[0]?.y ?? 0.78), t.pos.z), yaw: 0, room: ri, mods: mods() });
        }
        out.push({ model: makeFurniture('candle', 'chandelier', mods()), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y + rm.h - 2.9, (rm.min.y + rm.max.y) / 2), yaw: 0, room: ri, mods: mods(), wallMounted: true });
        wallThing('shelf', 'wall', mods());
        break;
      }
      case 'shop': {
        const ctr = tryPlace('desk', 'counter', mods(), true, 0.7);
        for (let i = 0; i < 3; i++) tryPlace('shelf', pick(['open', 'bookcase']), mods(), true);
        onSurface(ctr, ['apple', 'bread', 'cheese', 'jug', 'cup', 'candle', 'pear', 'onion', 'sword', 'shield', 'axe', 'cloth'], 6);
        for (let i = 0; i < 4; i++) items.push({ item: pick(['crate', 'barrel', 'sack', 'basket']), pos: placeFree(g, rm, r, 0.4), owner: 'shop' });
        tryPlace('candle', 'stand', mods(), true, 0.05);
        break;
      }
      case 'forge': {
        tryPlace('misc', 'anvil', mods(), false, 0.6);
        tryPlace('misc', 'grindstone', mods(), true);
        tryPlace('table', 'workbench', mods(), true);
        tryPlace('misc', 'weapon_rack', mods(), true);
        tryPlace('misc', 'washtub', mods(), true);
        for (let i = 0; i < 3; i++) items.push({ item: pick(['sword', 'axe', 'hatchet', 'mace', 'shield', 'spade']), pos: placeFree(g, rm, r, 0.3), owner: 'shop' });
        break;
      }
      case 'stalls': {
        const n = Math.floor((rm.max.x - rm.min.x) / 3);
        for (let i = 0; i < n; i++) {
          // stall partitions along the back wall, a trough and hay in each
          const x = rm.min.x + 1.5 + i * 3;
          out.push({ model: makeFurniture('misc', 'trough', mods({ wood: 'weathered' as string })), pos: new THREE.Vector3(x, rm.y, rm.min.y + 0.4), yaw: 0, room: ri, mods: mods() });
          if (i % 2 === 0) out.push({ model: makeFurniture('misc', 'hay', mods()), pos: new THREE.Vector3(x, rm.y, rm.min.y + 1.6), yaw: 0.3, room: ri, mods: mods() });
        }
        tryPlace('misc', 'saddle_rack', mods(), true);
        tryPlace('misc', 'saddle_rack', mods(), true);
        for (let i = 0; i < 3; i++) items.push({ item: pick(['bucket', 'sack', 'pitchfork', 'hay']), pos: placeFree(g, rm, r, 0.4), owner: 'house' });
        break;
      }
      case 'loft': { for (let i = 0; i < 4; i++) tryPlace('misc', 'hay', mods(), false, 0.1); break; }
      case 'nave': {
        const rows = Math.floor((rm.max.y - rm.min.y - 4) / 1.3);
        for (let i = 0; i < rows; i++) for (const s of [-1, 1]) {
          const m = mods({ wood: 'dark' });
          out.push({ model: makeFurniture('bench', 'pew', m), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2 + s * 1.9, rm.y, rm.max.y - 2 - i * 1.3), yaw: 0, room: ri, mods: m });
        }
        const altar = makeFurniture('table', 'altar', mods({ dye: 'madder' }));
        out.push({ model: altar, pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y, rm.min.y + 1.2), yaw: 0, room: ri, mods: mods() });
        for (const s of [-1, 1]) out.push({ model: makeFurniture('candle', 'stand', mods()), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2 + s * 1.3, rm.y, rm.min.y + 1.0), yaw: 0, room: ri, mods: mods() });
        out.push({ model: makeFurniture('candle', 'candelabra', mods()), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y + 1.04, rm.min.y + 1.2), yaw: 0, room: ri, mods: mods() });
        out.push({ model: makeFurniture('desk', 'lectern', mods()), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2 + 2, rm.y, rm.min.y + 2.6), yaw: Math.PI, room: ri, mods: mods() });
        wallThing('misc', 'banner', mods({ dye: 'woad' })); wallThing('misc', 'banner', mods({ dye: 'madder' }));
        break;
      }
      case 'hall': {
        const t = tryPlace('table', 'refectory', mods(), false, 1.2);
        if (t) {
          for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
            const p = new THREE.Vector3(t.pos.x - 1.2 + i * 0.5, rm.y, t.pos.z + s * 0.85);
            const m = mods();
            out.push({ model: makeFurniture('chair', 'panel', m), pos: p, yaw: s > 0 ? Math.PI : 0, room: ri, mods: m });
          }
          onSurface(t, ['bread', 'apple', 'cheese', 'goblet', 'jug', 'plate', 'pear', 'meat'], 8);
          for (const dx of [-0.8, 0.8]) out.push({ model: makeFurniture('candle', 'candelabra', mods()), pos: new THREE.Vector3(t.pos.x + dx, rm.y + 0.84, t.pos.z), yaw: 0, room: ri, mods: mods() });
        }
        out.push({ model: makeFurniture('chair', 'throne', mods({ dye: iron ? 'soot' : 'madder', wood: 'dark' })), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y, rm.min.y + 1.0), yaw: 0, room: ri, mods: mods() });
        for (let i = 0; i < 3; i++) wallThing('misc', pick(['tapestry', 'banner']), mods({ dye: iron ? pick(['soot', 'madder']) : pick(['woad', 'weld']) }));
        tryPlace('misc', 'armor_stand', mods(), true); tryPlace('misc', 'armor_stand', mods(), true);
        out.push({ model: makeFurniture('candle', 'chandelier', mods()), pos: new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y + rm.h - 2.9, (rm.min.y + rm.max.y) / 2), yaw: 0, room: ri, mods: mods(), wallMounted: true });
        tryPlace('rug', 'jacquard', mods({ dye: 'madder' }), false, 0);
        break;
      }
      case 'guardroom': {
        tryPlace('table', 'square', mods(), false, 0.6); tryPlace('misc', 'weapon_rack', mods(), true); tryPlace('misc', 'armor_stand', mods(), true);
        for (let i = 0; i < 3; i++) tryPlace('stool', 'square', mods(), false, 0.1);
        break;
      }
      case 'storage': case 'cellar': {
        for (let i = 0; i < 6; i++) items.push({ item: pick(['crate', 'barrel', 'sack', 'basket', 'wine_barrel']), pos: placeFree(g, rm, r, 0.45), owner: 'house' });
        tryPlace('shelf', 'open', mods(), true);
        break;
      }
    }
    // big rooms shouldn't echo: keep furnishing until the floor is reasonably used (a dresser, a settle,
    // a cupboard of plates, chests, a side table, firewood by the hearth…)
    const FILL: Partial<Record<RoomKind, [Category, string[] | null][]>> = {
      common: [['cupboard', null], ['shelf', null], ['chest', null], ['bench', null], ['chair', ['armchair', 'settle']], ['drawers', null], ['misc', ['firewood', 'washtub', 'loom', 'barrel_stack']], ['desk', null], ['candle', ['stand']]],
      kitchen: [['cupboard', null], ['shelf', null], ['table', ['workbench', 'kitchen']], ['misc', ['firewood', 'washtub', 'barrel_stack']], ['bench', null], ['chest', null]],
      bedroom: [['chest', null], ['drawers', null], ['wardrobe', null], ['chair', null], ['desk', null], ['shelf', null], ['bench', null]],
      shop: [['shelf', null], ['cupboard', null], ['chest', null], ['misc', ['barrel_stack']], ['table', null]],
      hall: [['bench', null], ['chest', null], ['cupboard', null], ['misc', ['armor_stand', 'weapon_rack']], ['shelf', null]],
      dorm: [['chest', null], ['bench', null], ['misc', ['weapon_rack', 'armor_stand']]],
    };
    const fill = FILL[rm.kind];
    if (fill) {
      const floorThings = () => out.filter((q) => q.room === ri && !q.wallMounted && !['chair', 'stool', 'candle', 'rug'].includes(q.model.category)).length;
      const target = Math.floor(area / (rm.kind === 'bedroom' ? 5.5 : 5.2));
      for (let t = 0; t < 14 && floorThings() < target; t++) {
        const [cat, names] = fill[Math.floor(r() * fill.length)];
        const ok = designs(cat).filter((d) => d !== 'throne' && (!names || names.includes(d)));
        if (!ok.length) continue;
        tryPlace(cat, pick(ok), mods(), true, 0.1, 25);
      }
      // and the everyday clutter of a lived-in house
      if (rm.kind === 'common' || rm.kind === 'kitchen') for (let i = 0; i < Math.floor(area / 9); i++) items.push({ item: pick(['basket', 'sack', 'bucket', 'crate', 'jug', 'lidded_basket']), pos: placeFree(g, rm, r, 0.3), owner: 'house' });
    }
  });
  return { furniture: out, items };
}
function placeFree(g: Grid, rm: Room, r: () => number, rad: number) {
  for (let t = 0; t < 30; t++) {
    const x = rm.min.x + rad + r() * (rm.max.x - rm.min.x - rad * 2), z = rm.min.y + rad + r() * (rm.max.y - rm.min.y - rad * 2);
    if (g.rect(x, z, rad, rad, true)) { g.rect(x, z, rad, rad, false); return new THREE.Vector3(x, rm.y, z); }
  }
  return new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y, (rm.min.y + rm.max.y) / 2);
}
