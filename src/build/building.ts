// Procedural buildings with complete interiors: plinth, walls with doors/windows, half-timbering or
// stone, floors, beams, stairs, partitions, gable roofs, chimneys and hearths, shutters, hinged doors,
// physics colliders, rooms tagged for furnishing, and beds assigned to residents.
import * as THREE from 'three';
import { GeoBuilder } from './geom';
import { mulberry32 } from '../core/noise';

export type BType = 'cottage' | 'house' | 'townhouse' | 'shop' | 'tavern' | 'smithy' | 'stable' | 'barn' | 'chapel' | 'barracks' | 'warehouse' | 'hall' | 'guard';
export type Style = 'timber' | 'stone' | 'plaster' | 'rustic' | 'dark';
export type RoomKind = 'common' | 'kitchen' | 'bedroom' | 'shop' | 'taproom' | 'forge' | 'stalls' | 'nave' | 'dorm' | 'storage' | 'hall' | 'cellar' | 'loft' | 'guardroom';

export interface Room { kind: RoomKind; floor: number; min: THREE.Vector2; max: THREE.Vector2; y: number; h: number; walls: { side: 'n' | 's' | 'e' | 'w'; free: [number, number][] }[] }
export interface DoorSpec { pos: THREE.Vector3; yaw: number; w: number; h: number; exterior: boolean; hinge: -1 | 1 }
export interface BuildingSpec {
  id: string; type: BType; style: Style; w: number; d: number; floors: number; seed: number;
  roof: 'thatch' | 'tile' | 'slate' | 'shingle'; jetty: boolean; kingdom: 'vanguardia' | 'ironreach' | 'river' | 'isles';
  wealth: number; // 0 poor .. 1 rich
}
export interface BuildingModel {
  spec: BuildingSpec;
  exterior: GeoBuilder;    // seen from outside (and far LOD)
  interior: GeoBuilder;    // inner faces, floors, stairs, beams
  colliders: { c: THREE.Vector3; h: THREE.Vector3; q?: THREE.Quaternion }[];
  doors: DoorSpec[];
  rooms: Room[];
  hearths: THREE.Vector3[];       // fire positions (lights, warmth)
  chimneys: THREE.Vector3[];      // smoke emitters
  windows: { pos: THREE.Vector3; normal: THREE.Vector3 }[];
  stairs: { from: THREE.Vector3; to: THREE.Vector3 }[];
  height: number;
  floorY: number[];
  entrance: THREE.Vector3;        // just outside the front door
}

const PLINTH = 0.35, FH = 3.0, T = 0.32;

function mats(s: BuildingSpec) {
  const v = s.seed % 4;
  const plasterTints = ['f4ecdc', 'efe0c4', 'e8dcc8', 'f8f2e6'];
  const wallOut = (s.style === 'stone' ? ['mat:medieval_blocks_02', 'mat:castle_wall_varriation|tint:d8d0c0', 'mat:white_sandstone_blocks_02', 'mat:castle_brick_02_white|tint:e0d8c8'][v]
    : s.style === 'dark' ? ['mat:castle_wall_slates', 'mat:defense_wall|tint:9a9aa0', 'mat:stacked_stone_wall|tint:8a8a90', 'mat:castle_wall_slates|tint:b0b0b4'][v]
      : s.style === 'rustic' ? 'mat:stacked_stone_wall' : s.style === 'plaster' ? `mat:white_plaster_rough_01|tint:${plasterTints[v]}` : `mat:plastered_wall_02|tint:${plasterTints[v]}`) + '|wx:0.8';
  const ground = (s.style === 'timber' || s.style === 'plaster' ? (s.kingdom === 'ironreach' ? 'mat:stacked_stone_wall' : ['mat:medieval_blocks_02', 'mat:stacked_stone_wall|tint:d8c8b0'][v % 2]) : wallOut.replace('|wx:0.8', '')) + '|wx:1';
  const roof = s.roof === 'thatch' ? 'mat:thatch_roof_angled' : s.roof === 'tile' ? 'mat:clay_roof_tiles_02' : s.roof === 'slate' ? 'mat:roof_slates_02' : 'mat:reed_roof_04';
  return {
    wallOut, ground, roof, inner: s.wealth > 0.6 ? 'mat:clay_plaster|in:1' : 'mat:white_plaster_rough_01|tint:e8dcc4|in:1', timber: 'wood:dark|stain:ebony|fin:raw',
    floor: s.wealth > 0.5 ? 'mat:old_wood_floor' : s.type === 'stable' || s.type === 'barn' || s.type === 'smithy' ? 'mat:clay_floor_001' : 'mat:plank_flooring_02',
    stoneFloor: 'mat:monastery_stone_floor', beam: 'wood:dark|stain:walnut|fin:raw', plinth: 'mat:stacked_stone_wall', roofIn: 'wood:planks|stain:walnut|fin:raw',
    frame: 'wood:dark|stain:ebony|fin:oiled', glass: 'glass|c:b8c8b0', shutter: s.kingdom === 'ironreach' ? 'wood:weathered|stain:ebony|fin:raw' : 'mat:wood_shutter',
    chimney: 'mat:stacked_stone_wall|wx:1.2', hearth: 'mat:castle_brick_07',
  };
}

export function generateBuilding(spec: BuildingSpec): BuildingModel {
  const r = mulberry32(spec.seed);
  const M = mats(spec);
  const ext = new GeoBuilder(), int = new GeoBuilder();
  const { w, d } = spec;
  const floors = spec.floors;
  const model: BuildingModel = { spec, exterior: ext, interior: int, colliders: [], doors: [], rooms: [], hearths: [], chimneys: [], windows: [], stairs: [], height: 0, floorY: [], entrance: new THREE.Vector3(0, 0, d / 2 + 1.2) };
  const col = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, q?: THREE.Quaternion) => model.colliders.push({ c: new THREE.Vector3(cx, cy, cz), h: new THREE.Vector3(hx, hy, hz), q });
  const open = spec.type === 'smithy';           // open-fronted workshop
  const big = spec.type === 'stable' || spec.type === 'barn' || spec.type === 'warehouse' || spec.type === 'chapel' || spec.type === 'hall';
  const fh = big ? (spec.type === 'chapel' || spec.type === 'hall' ? 6 : 4.5) : FH;
  const totalH = PLINTH + fh * floors;
  model.height = totalH;
  for (let f = 0; f < floors; f++) model.floorY.push(PLINTH + f * fh);

  // ---- plinth / foundation ----
  // stone base: its top sits a little below the floorboards inside (never coplanar with them, which flickers),
  // with a ring under the walls coming up flush to meet them
  ext.box(M.plinth, 0, (PLINTH - 0.05 - 0.5) / 2, 0, w + 0.12, PLINTH - 0.05 + 0.5, d + 0.12, 0.6);
  {
    const inX = w / 2 - T / 2, outX = w / 2 + 0.06, inZ = d / 2 - T / 2, outZ = d / 2 + 0.06, h = PLINTH + 0.5, cy = PLINTH / 2 - 0.25;
    for (const sd of [-1, 1]) {
      ext.box(M.plinth, sd * (inX + outX) / 2, cy, 0, outX - inX, h, d + 0.12, 0.6);
      ext.box(M.plinth, 0, cy, sd * (inZ + outZ) / 2, w - T, h, outZ - inZ, 0.6);
    }
  }
  col(0, PLINTH / 2 - 0.25, 0, (w + 0.12) / 2, (PLINTH + 0.5) / 2, (d + 0.12) / 2);
  // front step
  ext.box(M.plinth, 0, PLINTH / 2 - 0.1, d / 2 + 0.35, 1.6, PLINTH - 0.05, 0.6, 0.6);
  col(0, PLINTH / 2 - 0.1, d / 2 + 0.35, 0.8, (PLINTH - 0.05) / 2, 0.3);

  // ---- exterior walls with openings ----
  // walls: 's' front (+z), 'n' back (-z), 'e' (+x), 'w' (-x). Each wall runs along its local +x.
  const doorW = spec.type === 'stable' || spec.type === 'barn' || spec.type === 'warehouse' ? 2.6 : spec.type === 'chapel' || spec.type === 'hall' ? 1.8 : 1.1;
  const doorH = spec.type === 'stable' || spec.type === 'barn' || spec.type === 'warehouse' ? 3.0 : spec.type === 'chapel' || spec.type === 'hall' ? 3.2 : 2.15;
  const winW = spec.type === 'chapel' ? 0.9 : 0.85, winH = spec.type === 'chapel' ? 3.0 : 1.05;
  const sides: { side: 'n' | 's' | 'e' | 'w'; len: number; m: THREE.Matrix4 }[] = [
    { side: 's', len: w, m: new THREE.Matrix4().makeTranslation(-w / 2, 0, d / 2) },
    { side: 'n', len: w, m: new THREE.Matrix4().makeTranslation(w / 2, 0, -d / 2).multiply(new THREE.Matrix4().makeRotationY(Math.PI)) },
    { side: 'e', len: d, m: new THREE.Matrix4().makeTranslation(w / 2, 0, d / 2).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)) },
    { side: 'w', len: d, m: new THREE.Matrix4().makeTranslation(-w / 2, 0, -d / 2).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)) },
  ];
  const stairSide = r() < 0.5 ? -1 : 1;   // stairs along the west (-1) or east (+1) inside wall
  const hearthSide: 'e' | 'w' = stairSide < 0 ? 'e' : 'w';
  for (const S of sides) {
    for (let f = 0; f < floors; f++) {
      const y0 = PLINTH + f * fh;
      const openings: { x0: number; x1: number; y0: number; y1: number }[] = [];
      if (f === 0 && S.side === 's') {
        if (open) openings.push({ x0: 0.5, x1: S.len - 0.5, y0: 0, y1: fh - 0.5 });
        else openings.push({ x0: S.len / 2 - doorW / 2, x1: S.len / 2 + doorW / 2, y0: 0, y1: doorH });
      }
      if (f === 0 && S.side === 'n' && (spec.type === 'tavern' || spec.type === 'stable' || spec.type === 'barn' || (w > 9 && r() < 0.5))) openings.push({ x0: S.len * 0.7 - 0.5, x1: S.len * 0.7 + 0.5, y0: 0, y1: 2.1 });
      // windows every ~2.4 m, skipping doors, the hearth wall and the stair run
      const n = Math.floor((S.len - 1.2) / 2.4);
      if (spec.type !== 'barn' && spec.type !== 'warehouse' && !(S.side === hearthSide && f === 0 && spec.type !== 'chapel') && !open) {
        for (let i = 0; i < n; i++) {
          const cx = 0.6 + (S.len - 1.2) * (i + 0.5) / n;
          const wy0 = spec.type === 'stable' ? 2.0 : spec.type === 'chapel' ? 2.0 : 0.95;
          const wh = spec.type === 'stable' ? 0.7 : winH;
          const clash = openings.some((o) => cx + winW / 2 + 0.3 > o.x0 && cx - winW / 2 - 0.3 < o.x1 && o.y0 < wy0 + wh);
          if (clash) continue;
          openings.push({ x0: cx - winW / 2, x1: cx + winW / 2, y0: wy0, y1: wy0 + wh });
        }
      }
      ext.push(S.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, y0, 0)));
      const outKey = f === 0 ? M.ground : M.wallOut;
      ext.wall(outKey, S.len, fh, T, openings, 0.45, M.inner, M.inner);
      // half-timber framing on plaster walls of upper floors (and ground for timber style)
      if ((spec.style === 'timber' && (f > 0 || spec.kingdom !== 'ironreach')) || spec.style === 'plaster') halfTimber(ext, M.frame, S.len, fh, T, openings, r, f === 0 && spec.style === 'timber' ? 0 : 1);
      // window frames, glass, shutters; door frames
      for (const o of openings) {
        const isDoor = o.y0 === 0;
        const cx = (o.x0 + o.x1) / 2, ow = o.x1 - o.x0, oh = o.y1 - o.y0;
        ext.box(M.frame, o.x0 - 0.05, o.y0 + oh / 2, T / 2 + 0.02, 0.1, oh + 0.1, 0.08, 2);
        ext.box(M.frame, o.x1 + 0.05, o.y0 + oh / 2, T / 2 + 0.02, 0.1, oh + 0.1, 0.08, 2);
        ext.box(M.frame, cx, o.y1 + 0.06, T / 2 + 0.02, ow + 0.3, 0.14, 0.1, 2);
        if (!isDoor) {
          ext.box(M.frame, cx, o.y0 - 0.04, T / 2 + 0.04, ow + 0.26, 0.08, 0.14, 2);
          // leaded glass panes inset in the wall
          ext.box(M.glass, cx, o.y0 + oh / 2, 0, ow, oh, 0.02, 1);
          ext.box(M.frame, cx, o.y0 + oh / 2, 0.012, 0.03, oh, 0.03, 2);
          ext.box(M.frame, cx, o.y0 + oh / 2, 0.012, ow, 0.03, 0.03, 2);
          // shutters, swung open against the wall (or closed on some)
          const closed = r() < 0.12;
          for (const sd of [-1, 1]) {
            if (closed) ext.box(M.shutter, cx + sd * ow / 4, o.y0 + oh / 2, T / 2 + 0.03, ow / 2 - 0.01, oh, 0.035, 1.2);
            else ext.box(M.shutter, cx + sd * (ow / 2 + ow / 4 + 0.08), o.y0 + oh / 2, T / 2 + 0.06, ow / 2, oh, 0.035, 1.2);
          }
          // flower box on some Vanguardia windows
          if (spec.kingdom === 'vanguardia' && r() < 0.3) { ext.box('wood:weathered|stain:honey|fin:raw', cx, o.y0 - 0.12, T / 2 + 0.16, ow, 0.16, 0.2, 2); for (let i = 0; i < 5; i++) ext.ellipsoid(['color:c03040', 'color:e0c040', 'color:9040a0', 'color:f0f0f0'][i % 4], cx - ow / 2 + 0.1 + i * ow / 5, o.y0 - 0.0, T / 2 + 0.16, 0.06, 0.05, 0.06, 6); }
          const wp = new THREE.Vector3(cx, o.y0 + oh / 2, 0).applyMatrix4(ext.matrix);
          const wn = new THREE.Vector3(0, 0, 1).transformDirection(ext.matrix);
          model.windows.push({ pos: wp, normal: wn });
        } else if (!open) {
          const dp = new THREE.Vector3(cx, PLINTH, 0).applyMatrix4(S.m);
          const yaw = Math.atan2(new THREE.Vector3(0, 0, 1).transformDirection(S.m).x, new THREE.Vector3(0, 0, 1).transformDirection(S.m).z);
          model.doors.push({ pos: dp.setY(y0), yaw, w: ow, h: oh, exterior: true, hinge: r() < 0.5 ? -1 : 1 });
        }
      }
      // colliders for wall strips between openings
      wallColliders(model, S.m, y0, S.len, fh, T, openings);
      ext.pop();
    }
    // gable triangles on the short (e/w) sides above the top floor, roof ridge runs along x
  }
  const pitch = spec.roof === 'thatch' ? 0.85 : spec.type === 'chapel' ? 0.9 : 0.72;
  const ridgeH = (d / 2 + 0.45) * Math.tan(pitch);
  const eaveY = totalH;
  for (const S of sides.filter((s) => s.side === 'e' || s.side === 'w')) {
    ext.push(S.m.clone().multiply(new THREE.Matrix4().makeTranslation(0, eaveY, 0)));
    const gh = (d / 2) * Math.tan(pitch);
    for (const z of [T / 2, -T / 2]) {
      const k = z > 0 ? M.wallOut : M.inner;
      const A = new THREE.Vector3(0, 0, z), B = new THREE.Vector3(d, 0, z), C = new THREE.Vector3(d / 2, gh, z);
      if (z > 0) ext.quad(k, A, B, C, C.clone(), [[0, 0], [d * 0.45, 0], [d * 0.225, gh * 0.45], [d * 0.225, gh * 0.45]]);
      else ext.quad(k, B, A, C, C.clone(), [[0, 0], [d * 0.45, 0], [d * 0.225, gh * 0.45], [d * 0.225, gh * 0.45]]);
    }
    if (spec.style === 'timber' || spec.style === 'plaster') {
      ext.box(M.frame, d / 2, gh / 2, T / 2 + 0.02, 0.12, gh, 0.06, 2);
      ext.box(M.frame, d / 2, 0.05, T / 2 + 0.02, d, 0.12, 0.06, 2);
      for (const sd of [-1, 1]) { ext.push().translate(d / 2 + sd * d / 4, gh / 2 - 0.05, T / 2 + 0.02).rotateZ(sd * pitch); ext.box(M.frame, 0, 0, 0, 0.1, gh * 0.9 / Math.cos(pitch) * 0.5, 0.05, 2); ext.pop(); }
    }
    ext.pop();
    // gable collider (box approximation)
    const c = new THREE.Vector3(d / 2, eaveY + gh / 3, 0).applyMatrix4(S.m);
    col(c.x, c.y, c.z, S.side === 'e' || S.side === 'w' ? T / 2 : d / 3, gh / 3, S.side === 'e' || S.side === 'w' ? d / 3 : T / 2);
  }
  // jettied upper floors overhang the street a little (supported by brackets)
  if (spec.jetty && floors > 1) for (let i = 0; i < 4; i++) ext.push().translate(-w / 2 + 0.6 + i * (w - 1.2) / 3, PLINTH + fh - 0.25, d / 2 + 0.1).rotateX(0.7), ext.box(M.frame, 0, 0, 0, 0.12, 0.5, 0.12, 2), ext.pop();

  // ---- roof ----
  const over = 0.45, roofT = spec.roof === 'thatch' ? 0.35 : 0.12;
  const slopeL = (d / 2 + over) / Math.cos(pitch);
  for (const sd of [1, -1]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sd * pitch);
    const cz = sd * (d / 2 + over) / 2, cy = eaveY + ridgeH / 2 - (over * Math.tan(pitch)) / 2;
    ext.push(new THREE.Matrix4().compose(new THREE.Vector3(0, cy + roofT / 2, cz), q, new THREE.Vector3(1, 1, 1)));
    ext.box(M.roof, 0, 0, 0, w + over * 2, roofT, slopeL, 0.45, 0b110111);
    ext.box(M.roofIn, 0, -roofT / 2 - 0.02, 0, w + over * 2 - 0.02, 0.03, slopeL - 0.02, 0.8, 0b001000);
    // rafters seen from inside
    for (let i = 0; i <= Math.floor(w / 0.9); i++) int.push(new THREE.Matrix4().compose(new THREE.Vector3(0, cy + roofT / 2, cz), q, new THREE.Vector3(1, 1, 1))), int.box(M.beam, -w / 2 + i * w / Math.floor(w / 0.9), -roofT / 2 - 0.1, 0, 0.1, 0.16, slopeL - 0.2, 2), int.pop();
    ext.pop();
    col(0, cy + roofT / 2, cz, (w + over * 2) / 2, roofT / 2 + 0.05, slopeL / 2, q);
  }
  // ridge cap
  ext.push().translate(0, eaveY + ridgeH + roofT * 0.6, 0).rotateZ(Math.PI / 2);
  ext.cyl(spec.roof === 'thatch' ? M.roof : M.chimney, 0, -w / 2 - over, 0, 0.12, 0.12, w + over * 2, 8, true, 1);
  ext.pop();
  // ridge beam inside
  int.box(M.beam, 0, eaveY + ridgeH - 0.25, 0, w, 0.2, 0.2, 2);
  // tie beams across at the eaves
  for (let i = 1; i < Math.floor(w / 2.2); i++) int.box(M.beam, -w / 2 + i * w / Math.floor(w / 2.2), eaveY + 0.1, 0, 0.18, 0.2, d - T, 2);

  // ---- floors, ceilings, stairs ----
  // the flight starts a step back from the front wall, so there is a landing to walk onto it from
  const stairW = 0.95, stairLen = Math.max(2.4, Math.min(d - T - 1.7, fh * 1.25));
  const stairX = stairSide * (w / 2 - T / 2 - stairW / 2);
  const stairZ0 = Math.min(d / 2 - T / 2 - 0.95, -d / 2 + T / 2 + 0.6 + stairLen), stairZ1 = stairZ0 - stairLen; // climbs toward the back
  for (let f = 0; f < floors; f++) {
    const y = PLINTH + f * fh;
    const fk = big && spec.type !== 'chapel' && spec.type !== 'hall' && f === 0 ? M.floor : f === 0 && (spec.style === 'stone' || spec.type === 'tavern') && r() < 0.5 ? M.stoneFloor : M.floor;
    if (f === 0) {
      int.box(fk, 0, y - 0.03, 0, w - T, 0.06, d - T, 0.7);
    } else {
      // upper floor slab with a stairwell hole
      const hx0 = stairX - stairW / 2 - 0.05, hx1 = stairX + stairW / 2 + 0.05, hz0 = stairZ1 - 0.1, hz1 = stairZ0;
      const X0 = -w / 2 + T / 2, X1 = w / 2 - T / 2, Z0 = -d / 2 + T / 2, Z1 = d / 2 - T / 2;
      const slab = (x0: number, x1: number, z0: number, z1: number) => {
        if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
        int.box(fk, (x0 + x1) / 2, y - 0.06, (z0 + z1) / 2, x1 - x0, 0.12, z1 - z0, 0.7);
        col((x0 + x1) / 2, y - 0.06, (z0 + z1) / 2, (x1 - x0) / 2, 0.06, (z1 - z0) / 2);
      };
      slab(X0, X1, Z0, hz0); slab(X0, X1, hz1, Z1); slab(X0, hx0, hz0, hz1); slab(hx1, X1, hz0, hz1);
      // joists under the floor, cut short at the stairwell (with trimmer beams framing the opening) so nothing
      // crosses the stair headroom
      const nJ = Math.floor(w / 1.1);
      for (let i = 0; i < nJ; i++) {
        const jx = -w / 2 + (i + 0.5) * w / nJ;
        if (jx + 0.08 < hx0 || jx - 0.08 > hx1) { int.box(M.beam, jx, y - 0.22, 0, 0.16, 0.2, d - T, 2); continue; }
        if (hz0 - Z0 > 0.05) int.box(M.beam, jx, y - 0.22, (Z0 + hz0) / 2, 0.16, 0.2, hz0 - Z0, 2);
        if (Z1 - hz1 > 0.05) int.box(M.beam, jx, y - 0.22, (hz1 + Z1) / 2, 0.16, 0.2, Z1 - hz1, 2);
      }
      for (const tz of [hz0 - 0.08, hz1 + 0.08]) if (tz > Z0 && tz < Z1) int.box(M.beam, (hx0 + hx1) / 2, y - 0.22, tz, hx1 - hx0 + 0.3, 0.2, 0.16, 2);
      // stairs from the floor below
      const yb = y - fh, steps = Math.ceil(fh / 0.2);
      for (let s = 0; s < steps; s++) {
        const sz = stairZ0 - (s + 0.5) * stairLen / steps, sy = yb + (s + 1) * fh / steps;
        int.box('wood:planks|stain:walnut|fin:waxed', stairX, sy - 0.05, sz, stairW, 0.06, stairLen / steps + 0.03, 1.5);
        int.box(M.beam, stairX, sy - 0.12, sz, stairW - 0.1, 0.08, 0.04, 2);
      }
      for (const sd of [-1, 1]) {
        const ang = Math.atan2(fh, stairLen);
        int.push().translate(stairX + sd * stairW / 2, yb + fh / 2 - 0.1, (stairZ0 + stairZ1) / 2).rotateX(ang);
        int.box(M.beam, 0, 0, 0, 0.06, 0.25, Math.hypot(fh, stairLen), 2);
        int.pop();
      }
      // banister on the open side
      const inner = stairX - stairSide * stairW / 2;
      int.push().translate(inner, yb + fh / 2 + 0.85, (stairZ0 + stairZ1) / 2).rotateX(Math.atan2(fh, stairLen));
      int.box(M.beam, 0, 0, 0, 0.06, 0.06, Math.hypot(fh, stairLen), 2);
      int.pop();
      for (let s = 0; s < 6; s++) { const t = (s + 0.5) / 6; int.box(M.beam, inner, yb + fh * t + 0.42, stairZ0 - stairLen * t, 0.04, 0.85, 0.04, 2); }
      // ramp collider for walking up
      const ang = Math.atan2(fh, stairLen);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
      col(stairX, yb + fh / 2 - 0.08, (stairZ0 + stairZ1) / 2, stairW / 2, 0.06, Math.hypot(fh, stairLen) / 2, q);
      model.stairs.push({ from: new THREE.Vector3(stairX, yb, stairZ0 + 0.55), to: new THREE.Vector3(stairX, y, stairZ1 - 0.4) });
    }
    // ceiling beams under the next level / roof
    if (f === floors - 1) for (let i = 0; i < Math.floor(d / 1.4); i++) int.box(M.beam, 0, y + fh - 0.12, -d / 2 + (i + 0.5) * d / Math.floor(d / 1.4), w - T, 0.18, 0.16, 2);
  }
  col(0, PLINTH - 0.03, 0, (w - T) / 2, 0.04, (d - T) / 2);

  // ---- hearth, fireplace and chimney ----
  const hasHearth = !['stable', 'barn', 'warehouse', 'chapel'].includes(spec.type);
  if (hasHearth) {
    const hx = (hearthSide === 'e' ? 1 : -1) * (w / 2 - T / 2);
    const hz = -d / 2 + Math.min(d * 0.35, 2.2);
    const inward = hearthSide === 'e' ? -1 : 1;
    const fw = spec.type === 'smithy' ? 1.6 : 1.5;
    // firebox recessed into a stone breast
    int.box(M.hearth, hx + inward * 0.35, PLINTH + 0.75, hz, 0.7, 1.5, fw + 0.6, 0.8);
    int.box(M.hearth, hx + inward * 0.45, PLINTH + 0.06, hz, 0.95, 0.12, fw + 0.9, 0.8);
    int.box('mat:castle_brick_07|tint:3a3028', hx + inward * 0.68, PLINTH + 0.55, hz, 0.06, 1.0, fw - 0.2, 0.8);
    int.box(M.beam, hx + inward * 0.72, PLINTH + 1.35, hz, 0.2, 0.22, fw + 0.5, 2); // mantel beam
    // the chimney breast continues up through the floors
    for (let f = 0; f < floors; f++) int.box(M.hearth, hx + inward * 0.3, PLINTH + f * fh + (f === 0 ? 2.25 : fh / 2), hz, 0.6, f === 0 ? 1.5 : fh, fw * 0.7, 0.8);
    col(hx + inward * 0.35, PLINTH + 0.75, hz, 0.35, 0.75, (fw + 0.6) / 2);
    // logs and andirons
    for (let i = 0; i < 3; i++) { int.push().translate(hx + inward * 0.9, PLINTH + 0.18 + (i === 2 ? 0.12 : 0), hz + (i - 1) * 0.12 * (i === 2 ? 0 : 1)).rotateX(Math.PI / 2).rotateZ(0.1 * i); int.cyl('mat:bark_brown_02', 0, -0.3, 0, 0.07, 0.07, 0.6, 8, true, 2); int.pop(); }
    model.hearths.push(new THREE.Vector3(hx + inward * 0.95, PLINTH + 0.4, hz));
    // chimney stack outside
    const cx = hx - inward * 0.2;
    ext.box(M.chimney, cx, (totalH + ridgeH) / 2 + 0.6, hz, 0.8, totalH + ridgeH + 1.2 - PLINTH, 0.9, 0.6);
    ext.box(M.chimney, cx, totalH + ridgeH + 1.3, hz, 0.95, 0.2, 1.05, 0.6);
    col(cx, (totalH + ridgeH) / 2 + 0.6, hz, 0.4, (totalH + ridgeH + 1.2) / 2, 0.45);
    model.chimneys.push(new THREE.Vector3(cx, totalH + ridgeH + 1.4, hz));
  }

  // ---- rooms ----
  const X0 = -w / 2 + T / 2, X1 = w / 2 - T / 2, Z0 = -d / 2 + T / 2, Z1 = d / 2 - T / 2;
  const room = (kind: RoomKind, floor: number, x0: number, x1: number, z0: number, z1: number) =>
    model.rooms.push({ kind, floor, min: new THREE.Vector2(x0, z0), max: new THREE.Vector2(x1, z1), y: PLINTH + floor * fh, h: fh, walls: [] });
  const groundKind: RoomKind = ({ shop: 'shop', tavern: 'taproom', smithy: 'forge', stable: 'stalls', barn: 'stalls', chapel: 'nave', barracks: 'dorm', warehouse: 'storage', hall: 'hall', guard: 'guardroom', cottage: 'common', house: 'common', townhouse: 'common' } as Record<BType, RoomKind>)[spec.type];
  // ground floor: partition into a front room and a back room for houses
  if (['house', 'townhouse', 'shop', 'tavern'].includes(spec.type) && d >= 6.5) {
    const split = Z0 + (Z1 - Z0) * 0.42;
    partition(int, model, X0, X1, split, PLINTH, fh, M.inner, stairX, stairW, r);
    room(spec.type === 'tavern' ? 'kitchen' : spec.type === 'shop' ? 'storage' : 'kitchen', 0, X0, X1, Z0, split);
    room(groundKind, 0, X0, X1, split, Z1);
  } else room(groundKind, 0, X0, X1, Z0, Z1);
  for (let f = 1; f < floors; f++) {
    if (spec.type === 'barn' || spec.type === 'stable') { room('loft', f, X0, X1, Z0, Z1); continue; }
    if (w >= 7) {
      const split = (X0 + X1) / 2 + (stairSide > 0 ? -0.6 : 0.6);
      partitionX(int, model, split, Z0, Z1, PLINTH + f * fh, fh, M.inner, stairZ0, stairZ1);
      const kind: RoomKind = spec.type === 'barracks' ? 'dorm' : 'bedroom';
      room(kind, f, X0, Math.min(split, X1), Z0, Z1);
      room(kind, f, Math.max(split, X0), X1, Z0, Z1);
    } else room(spec.type === 'barracks' ? 'dorm' : 'bedroom', f, X0, X1, Z0, Z1);
  }
  // attic rooms in tall roofs
  if (ridgeH > 2.4 && !big) room('storage', floors, X0 + 0.5, X1 - 0.5, -0.8, 0.8);
  model.rooms.forEach((rm) => { (rm as Room & { stairX: number; stairZ0: number; stairZ1: number; stairW: number; hearth: string }).stairX = stairX; Object.assign(rm, { stairZ0, stairZ1, stairW, hearthSide, hasHearth }); });
  return model;
}

function halfTimber(g: GeoBuilder, key: string, len: number, h: number, t: number, openings: { x0: number; x1: number; y0: number; y1: number }[], r: () => number, from: number) {
  const z = t / 2 + 0.025;
  g.box(key, len / 2, 0.08, z, len, 0.16, 0.06, 2);
  g.box(key, len / 2, h - 0.08, z, len, 0.16, 0.06, 2);
  const posts = Math.max(2, Math.round(len / 1.15));
  for (let i = 0; i <= posts; i++) {
    const x = (len * i) / posts;
    const inOpen = openings.some((o) => x > o.x0 - 0.05 && x < o.x1 + 0.05);
    if (inOpen) continue;
    g.box(key, Math.min(len - 0.07, Math.max(0.07, x)), h / 2, z, 0.14, h, 0.06, 2);
    // mid rail and braces in the open panels
    if (i < posts) {
      const xm = len * (i + 0.5) / posts;
      const blocked = openings.some((o) => xm > o.x0 - 0.6 && xm < o.x1 + 0.6);
      if (!blocked) {
        g.box(key, xm, h * 0.48, z, len / posts, 0.12, 0.055, 2);
        if (r() < 0.6 * from + 0.2) {
          const ang = Math.atan2(h * 0.45, len / posts) * (r() < 0.5 ? 1 : -1);
          g.push().translate(xm, h * 0.74, z).rotateZ(ang);
          g.box(key, 0, 0, 0, Math.hypot(len / posts, h * 0.45) * 0.95, 0.12, 0.05, 2);
          g.pop();
        }
      }
    }
  }
}

function wallColliders(model: BuildingModel, m: THREE.Matrix4, y0: number, len: number, h: number, t: number, openings: { x0: number; x1: number; y0: number; y1: number }[]) {
  const xs = new Set<number>([0, len]);
  for (const o of openings) { xs.add(o.x0); xs.add(o.x1); }
  const sx = [...xs].sort((a, b) => a - b);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const add = (x0: number, x1: number, ya: number, yb: number) => {
    if (x1 - x0 < 0.02 || yb - ya < 0.02) return;
    const c = new THREE.Vector3((x0 + x1) / 2, y0 + (ya + yb) / 2, 0).applyMatrix4(m);
    model.colliders.push({ c, h: new THREE.Vector3((x1 - x0) / 2, (yb - ya) / 2, t / 2), q });
  };
  for (let i = 0; i < sx.length - 1; i++) {
    const x0 = sx[i], x1 = sx[i + 1], xm = (x0 + x1) / 2;
    const cuts = openings.filter((o) => xm > o.x0 && xm < o.x1).sort((a, b) => a.y0 - b.y0);
    let y = 0;
    // windows are solid for collision (glass); doors are open
    for (const o of cuts) { if (o.y0 > 0.01) continue; add(x0, x1, y, o.y0); y = o.y1; }
    add(x0, x1, y, h);
  }
}

/** Interior partition across x at z=zs with a doorway (kept clear of the stairs). */
function partition(g: GeoBuilder, model: BuildingModel, x0: number, x1: number, zs: number, y: number, h: number, key: string, stairX: number, stairW: number, r: () => number) {
  const len = x1 - x0;
  let dx = len * (0.3 + r() * 0.4);
  if (Math.abs(x0 + dx - stairX) < stairW + 0.6) dx = stairX < 0 ? len * 0.72 : len * 0.28;
  const m = new THREE.Matrix4().makeTranslation(x0, y, zs);
  g.push(m);
  const op = [{ x0: dx - 0.5, x1: dx + 0.5, y0: 0, y1: 2.1 }];
  g.wall(key, len, h, 0.14, op, 0.45, key, key);
  g.box('wood:dark|stain:ebony|fin:oiled', dx - 0.55, 1.05, 0, 0.1, 2.1, 0.18, 2);
  g.box('wood:dark|stain:ebony|fin:oiled', dx + 0.55, 1.05, 0, 0.1, 2.1, 0.18, 2);
  g.box('wood:dark|stain:ebony|fin:oiled', dx, 2.15, 0, 1.2, 0.12, 0.18, 2);
  g.pop();
  wallColliders(model, m, y, len, h, 0.14, op);
  model.doors.push({ pos: new THREE.Vector3(x0 + dx, y, zs), yaw: 0, w: 1.0, h: 2.1, exterior: false, hinge: 1 });
}
/** Upper-floor partition along z at x=xs with a doorway near the stair landing. */
function partitionX(g: GeoBuilder, model: BuildingModel, xs: number, z0: number, z1: number, y: number, h: number, key: string, stairZ0: number, stairZ1: number) {
  const len = z1 - z0;
  // doorway opposite the top of the stairs
  const dz = Math.min(len - 0.8, Math.max(0.8, (stairZ1 - z0) - 0.4));
  const m = new THREE.Matrix4().makeTranslation(xs, y, z0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.push(m);
  const op = [{ x0: dz - 0.5, x1: dz + 0.5, y0: 0, y1: 2.05 }];
  g.wall(key, len, h, 0.14, op, 0.45, key, key);
  g.pop();
  wallColliders(model, m, y, len, h, 0.14, op);
  void stairZ0;
  model.doors.push({ pos: new THREE.Vector3(xs, y, z0 + dz), yaw: Math.PI / 2, w: 1.0, h: 2.05, exterior: false, hinge: 1 });
}

/**
 * Indoor route planning over the room graph: rooms are connected by interior doorways and stairs;
 * the front door connects to the outside. Returns local-space waypoints.
 */
export function navPath(m: BuildingModel, from: THREE.Vector3 | 'outside', to: THREE.Vector3 | 'outside'): THREE.Vector3[] {
  const rooms = m.rooms.filter((r) => r.floor < m.spec.floors);
  const OUT = -1;
  const floorOf = (y: number) => m.floorY.reduce((f, fy, i) => (y > fy - 0.6 ? i : f), 0);
  const roomAt = (p: THREE.Vector3) => {
    const f = floorOf(p.y);
    let best = -1, bd = 1e9;
    rooms.forEach((r, i) => {
      if (r.floor !== f) return;
      const dx = Math.max(r.min.x - p.x, 0, p.x - r.max.x), dz = Math.max(r.min.y - p.z, 0, p.z - r.max.y);
      const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };
  type Edge = { to: number; pts: THREE.Vector3[] };
  const adj = new Map<number, Edge[]>();
  const link = (a: number, b: number, ab: THREE.Vector3[]) => {
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, pts: ab });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, pts: [...ab].reverse() });
  };
  const center = (i: number) => i === OUT ? new THREE.Vector3(0, m.floorY[0], m.spec.d / 2 + 3) : new THREE.Vector3((rooms[i].min.x + rooms[i].max.x) / 2, rooms[i].y, (rooms[i].min.y + rooms[i].max.y) / 2);
  for (const d of m.doors) {
    const f = floorOf(d.pos.y + 0.1);
    const n = Math.abs(Math.sin(d.yaw)) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const pa = d.pos.clone().addScaledVector(n, 0.8), pb = d.pos.clone().addScaledVector(n, -0.8);
    pa.y = pb.y = m.floorY[f];
    if (d.exterior) {
      // the outside is on the +z side of the front door
      const inside = d.pos.clone().setZ(d.pos.z - 1.0).setY(m.floorY[0]);
      const ri = roomAt(inside);
      if (ri >= 0) link(ri, OUT, [inside, d.pos.clone().setY(m.floorY[0]), d.pos.clone().setZ(d.pos.z + 1.6).setY(m.floorY[0])]);
      continue;
    }
    const ra = roomAt(pa), rb = roomAt(pb);
    if (ra >= 0 && rb >= 0 && ra !== rb) link(ra, rb, [pa, d.pos.clone().setY(m.floorY[f]), pb]);
  }
  m.stairs.forEach((s, i) => {
    const a = roomAt(s.from.clone().setY(m.floorY[i])), b = roomAt(s.to.clone().setY(m.floorY[i + 1]));
    if (a >= 0 && b >= 0) link(a, b, [s.from.clone(), s.to.clone()]);
  });
  const start = from === 'outside' ? OUT : roomAt(from), goal = to === 'outside' ? OUT : roomAt(to);
  // BFS
  const prev = new Map<number, { from: number; e: Edge }>();
  const q = [start]; const seen = new Set([start]);
  while (q.length) {
    const c = q.shift()!;
    if (c === goal) break;
    for (const e of adj.get(c) ?? []) if (!seen.has(e.to)) { seen.add(e.to); prev.set(e.to, { from: c, e }); q.push(e.to); }
  }
  const chain: Edge[] = [];
  let c = goal;
  while (c !== start && prev.has(c)) { const p = prev.get(c)!; chain.unshift(p.e); c = p.from; }
  const out: THREE.Vector3[] = [];
  for (const e of chain) out.push(...e.pts.map((p) => p.clone()));
  if (to !== 'outside') out.push(to.clone());
  else if (!chain.length) out.push(center(OUT));
  return out;
}
