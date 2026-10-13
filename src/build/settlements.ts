// Streams settlements in and out: far towns are merged low-detail meshes; near buildings get full
// exteriors, interiors, colliders, hinged doors, furniture with working drawers/doors/lids, candles,
// hearth fires, and their household's belongings (owned props).
import * as THREE from 'three';
import { RAPIER, groups, G_STATIC, ALL, type Physics } from '../physics/physics';
import type { World } from '../world/world';
import { Towns, type Placed, type TownPlan } from '../world/towns';
import { generateBuilding, type BuildingModel } from './building';
import { buildWalls, buildBridge, buildDock, fenceRect, well, stall, haystack, lampPost, type StructModel } from './structures';
import { GeoBuilder } from './geom';
import { material, meshesFrom } from '../props/palette';
import { furnish } from '../props/interior';
import { FurnitureNode, type MovableNode } from '../props/furnish';
import type { PropManager, Prop } from '../props/props';
import { ITEMS } from '../props/items';
import { mulberry32 } from '../core/noise';

const _tmpV = new THREE.Vector3();
export class Door {
  node = new THREE.Group();
  body: RAPIER.RigidBody;
  open = 0; target = 0;
  locked = false;
  owner: string | null;
  constructor(public phys: Physics, public parent: THREE.Object3D, pos: THREE.Vector3, yaw: number, public w: number, public h: number, public hinge: -1 | 1, public exterior: boolean, owner: string | null) {
    this.owner = owner;
    const g = new GeoBuilder();
    const k = exterior ? 'mat:rough_pine_door' : 'wood:planks|stain:walnut|fin:oiled';
    const cx = -hinge * w / 2;
    g.box(k, cx, h / 2, 0, w - 0.02, h - 0.02, 0.06, 1.2);
    for (const y of [0.3, h - 0.3]) g.box('wood:dark|stain:ebony|fin:raw', cx, y, -0.045, w - 0.1, 0.12, 0.03, 2);
    g.box('wood:dark|stain:ebony|fin:raw', cx, h / 2, -0.045, 0.1, h - 0.6, 0.03, 2);
    for (const y of [0.35, h - 0.35]) g.box('iron', -hinge * 0.25, y, 0.035, 0.5, 0.05, 0.01, 2);
    g.push().translate(cx - hinge * (w / 2 - 0.12), 1.0, 0.045).rotateX(Math.PI / 2); g.cyl('iron', 0, 0, 0, 0.035, 0.035, 0.012, 12, false); g.pop();
    g.box('iron', cx - hinge * (w / 2 - 0.12), 1.0, 0.05, 0.02, 0.1, 0.02, 3);
    for (const m of meshesFrom(g.build())) this.node.add(m);
    this.node.position.copy(pos);
    this.node.rotation.y = yaw;
    // the hinge sits at one edge of the opening
    this.node.translateX(hinge * w / 2);
    parent.add(this.node);
    this.node.updateMatrixWorld(true);
    const wp = this.node.getWorldPosition(new THREE.Vector3()), wq = this.node.getWorldQuaternion(new THREE.Quaternion());
    this.body = phys.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(wp.x, wp.y, wp.z).setRotation(wq));
    const c = phys.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2 - 0.02, h / 2, 0.04).setTranslation(cx, h / 2, 0).setCollisionGroups(groups(G_STATIC, ALL)), this.body);
    phys.owners.set(c.handle, { kind: 'door', door: this });
    this.node.userData.door = this;
  }
  toggle() { if (this.locked) return false; this.target = this.target > 0.5 ? 0 : 1; this.autoClose = 0; return true; }
  /** seconds until an NPC-opened door swings shut (only once the doorway is clear) */
  autoClose = 0;
  update(dt: number, people?: THREE.Vector3[]) {
    if (this.autoClose > 0) {
      const dp = this.node.getWorldPosition(_tmpV);
      const busy = people?.some((p) => p.distanceToSquared(dp) < 2.4 * 2.4);
      if (!busy) { this.autoClose -= dt; if (this.autoClose <= 0) this.target = 0; }
    }
    if (Math.abs(this.target - this.open) < 1e-3) return;
    this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * 1.6);
    const ease = this.open * this.open * (3 - 2 * this.open);
    this.node.children.forEach((c) => { c.rotation.y = -this.hinge * ease * 1.7; });
    this.node.updateMatrixWorld(true);
    const q = this.node.children[0].getWorldQuaternion(new THREE.Quaternion());
    this.body.setNextKinematicRotation(q);
  }
  dispose() { this.phys.removeBody(this.body); this.node.removeFromParent(); }
}

export interface LiveBuilding {
  placed: Placed; model: BuildingModel; root: THREE.Group; body: RAPIER.RigidBody;
  doors: Door[]; furniture: FurnitureNode[]; props: Prop[]; fires: THREE.Vector3[];
  bedOwners: { node: FurnitureNode; sleep: THREE.Vector3; person: string | null }[];
}

export class Settlements {
  towns: Towns;
  structures = new THREE.Group();
  lod = new THREE.Group();
  live = new Map<string, LiveBuilding>();
  models = new Map<string, BuildingModel>();
  queue: Placed[] = [];
  townLod = new Map<string, { meshes: THREE.Mesh[]; flags: THREE.DataTexture; index: Map<string, number> }>();
  torches: THREE.Vector3[] = [];
  saved = new Map<string, { id: string; pos: THREE.Vector3; quat: THREE.Quaternion; owner: string | null; age: number }[]>();
  candleState = new Map<string, number[]>();
  nearR = 140;
  detailR = 115;
  /** positions of characters near doors (set by the game each frame) */
  people: THREE.Vector3[] = [];
  constructor(public world: World, public phys: Physics, public scene: THREE.Scene, public props: PropManager, towns: Towns) {
    this.towns = towns;
    scene.add(this.structures, this.lod);
  }

  /** Build static fortifications, bridges, docks and the far-LOD town meshes. */
  buildStatic() {
    const ground = (x: number, z: number) => this.world.heightAt(x, z);
    const add = (s: StructModel) => {
      for (const m of meshesFrom(s.geo.build())) this.structures.add(m);
      const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const c of s.colliders) {
        const d = RAPIER.ColliderDesc.cuboid(c.h.x, c.h.y, c.h.z).setTranslation(c.c.x, c.c.y, c.c.z).setCollisionGroups(groups(G_STATIC, ALL));
        if (c.q) d.setRotation(c.q);
        this.phys.world.createCollider(d, body);
      }
      this.torches.push(...s.torches);
    };
    for (const p of this.towns.plans) {
      if (p.walls) add(buildWalls(p.walls, ground));
      for (const d of p.docks) add(buildDock(d.x, d.z, d.yaw, d.len, ground));
      // the life of the town: fences, wells, market stalls, haystacks, street torches
      const town: StructModel = { geo: new GeoBuilder(), colliders: [], gates: [], torches: [] };
      for (const gd of p.gardens) fenceRect(town, gd.x, gd.z, gd.w + 0.4, gd.d + 0.4, gd.yaw, ground, 'wood:weathered|stain:honey|fin:raw', 1.4);
      for (const pd of p.paddocks) fenceRect(town, pd.x, pd.z, pd.w, pd.d, pd.yaw, ground, 'wood:worn|stain:walnut|fin:raw', 0);
      for (const o of p.orchards) fenceRect(town, o.x, o.z, o.w + 2, o.d + 2, o.yaw, ground, 'wood:weathered|stain:natural|fin:raw', 3);
      for (const [x, z] of p.wells) well(town, x, z, ground);
      p.stalls.forEach((st, i) => stall(town, st.x, st.z, st.yaw, st.goods, ground, i + p.site.x));
      p.haystacks.forEach(([x, z], i) => haystack(town, x, z, ground, 0.8 + (i % 3) * 0.15));
      for (const [x, z] of p.lamps) lampPost(town, x, z, ground);
      add(town);
      this.buildTownLod(p);
    }
    for (const b of this.world.bridges) add(buildBridge(b, ground));
  }

  private buildTownLod(p: TownPlan) {
    // simple boxes + gable roofs for every building of the town, merged per material
    const g = new GeoBuilder();
    const bid: Record<string, number[]> = {};
    const index = new Map<string, number>();
    p.buildings.forEach((b, i) => {
      index.set(b.id, i);
      const s = b.spec;
      const H = 0.35 + (s.type === 'chapel' || s.type === 'hall' ? 6 : s.type === 'stable' || s.type === 'barn' || s.type === 'warehouse' ? 4.5 : 3) * s.floors;
      // same stone/plaster family as the detailed building, darkened a touch for the far view
      const wallK = s.style === 'stone' ? 'mat:medieval_blocks_02|tint:c8c0b0' : s.style === 'dark' ? 'mat:castle_wall_slates|tint:9a9a9a' : s.style === 'rustic' ? 'mat:stacked_stone_wall|tint:b0a898' : s.style === 'plaster' ? 'mat:white_plaster_rough_01|tint:d8d0c0' : 'mat:plastered_wall_02|tint:d0c4ac';
      const roofK = s.roof === 'thatch' ? 'mat:thatch_roof_angled' : s.roof === 'tile' ? 'mat:clay_roof_tiles_02' : s.roof === 'slate' ? 'mat:roof_slates_02' : 'mat:reed_roof_04';
      const before = new Map([...g.parts].map(([k, v]) => [k, v.pos.length / 3]));
      g.push().translate(b.x, b.y, b.z).rotateY(b.yaw);
      g.box(wallK, 0, H / 2 - 0.3, 0, s.w, H + 0.6, s.d, 0.45, 0b110111);
      const pitch = s.roof === 'thatch' ? 0.85 : s.type === 'chapel' ? 0.9 : 0.72;
      const rh = (s.d / 2 + 0.45) * Math.tan(pitch);
      for (const sd of [1, -1]) {
        g.push().translate(0, H + rh / 2 - 0.45 * Math.tan(pitch) / 2, sd * (s.d / 2 + 0.45) / 2).rotateX(sd * pitch);
        g.box(roofK, 0, 0, 0, s.w + 0.9, 0.15, (s.d / 2 + 0.45) / Math.cos(pitch), 0.45, 0b110111);
        g.pop();
      }
      for (const sd of [1, -1]) {
        const gh = (s.d / 2) * Math.tan(pitch);
        g.quad(wallK, new THREE.Vector3(sd * s.w / 2, H, sd * s.d / 2), new THREE.Vector3(sd * s.w / 2, H, -sd * s.d / 2), new THREE.Vector3(sd * s.w / 2, H + gh, 0), new THREE.Vector3(sd * s.w / 2, H + gh, 0), [[0, 0], [s.d * 0.45, 0], [s.d * 0.22, gh * 0.45], [s.d * 0.22, gh * 0.45]]);
      }
      g.pop();
      for (const [k, part] of g.parts) {
        const from = before.get(k) ?? 0;
        (bid[k] ??= []);
        for (let v = from; v < part.pos.length / 3; v++) bid[k][v] = i;
      }
    });
    const flags = new THREE.DataTexture(new Uint8Array(Math.max(1, p.buildings.length) * 4), Math.max(1, p.buildings.length), 1, THREE.RGBAFormat);
    flags.needsUpdate = true;
    const meshes: THREE.Mesh[] = [];
    for (const [k, geo] of g.build()) {
      const arr = new Float32Array(geo.getAttribute('position').count);
      bid[k].forEach((v, i) => { arr[i] = v; });
      geo.setAttribute('aBid', new THREE.BufferAttribute(arr, 1));
      const base = material(k) as THREE.MeshStandardMaterial;
      const m = base.clone();
      const n = p.buildings.length;
      const prev = base.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        sh.uniforms.tLodFlags = { value: flags };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\nattribute float aBid; uniform sampler2D tLodFlags;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n if (texture2D(tLodFlags, vec2((aBid + 0.5) / ${n.toFixed(1)}, 0.5)).r > 0.5) transformed = vec3(0.0, -1e5, 0.0);`);
      };
      m.customProgramCacheKey = () => 'lod-' + k + '-' + n;
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.lod.add(mesh);
      meshes.push(mesh);
    }
    this.townLod.set(p.site.id, { meshes, flags, index });
  }

  private setLodHidden(b: Placed, hidden: boolean) {
    const t = this.townLod.get(b.site);
    if (!t) return;
    const i = t.index.get(b.id)!;
    (t.flags.image.data as Uint8Array)[i * 4] = hidden ? 255 : 0;
    t.flags.needsUpdate = true;
  }

  /** Stream buildings around the player; build at most `budget` per call. */
  update(player: THREE.Vector3, budget = 1) {
    for (const p of this.towns.plans) {
      const d = Math.hypot(p.site.x - player.x, p.site.z - player.z);
      if (d > p.site.r + this.nearR + 60) {
        for (const b of p.buildings) if (this.live.has(b.id)) this.unload(b);
        continue;
      }
      for (const b of p.buildings) {
        const db = Math.hypot(b.x - player.x, b.z - player.z);
        const isLive = this.live.has(b.id);
        if (db < this.nearR && !isLive && !this.queue.includes(b)) this.queue.push(b);
        else if (db > this.nearR + 40 && isLive) this.unload(b);
      }
    }
    this.queue.sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
    for (let i = 0; i < budget && this.queue.length; i++) {
      const b = this.queue.shift()!;
      if (Math.hypot(b.x - player.x, b.z - player.z) < this.nearR + 20 && !this.live.has(b.id)) this.load(b);
    }
  }

  model(b: Placed) {
    let m = this.models.get(b.id);
    if (!m) { m = generateBuilding(b.spec); this.models.set(b.id, m); }
    return m;
  }

  load(b: Placed) {
    const m = this.model(b);
    const root = new THREE.Group();
    root.position.set(b.x, b.y, b.z);
    root.rotation.y = b.yaw;
    root.updateMatrixWorld(true);
    const exterior = new THREE.Group();
    exterior.name = 'exterior';
    root.add(exterior);
    for (const mesh of meshesFrom(m.exterior.build())) exterior.add(mesh);
    const interior = new THREE.Group();
    interior.name = 'interior';
    root.add(interior);
    const addInterior = (geos: Map<string, THREE.BufferGeometry>) => {
      for (const [k, geo] of geos) {
        const mesh = new THREE.Mesh(geo, material(k.includes('|in:1') || k.startsWith('flame') || k.startsWith('glass') ? k : k + '|in:1'));
        mesh.castShadow = false; mesh.receiveShadow = true;
        if (k.startsWith('glass') || k.startsWith('flame')) mesh.layers.set(1);
        interior.add(mesh);
      }
    };
    addInterior(m.interior.build());
    this.scene.add(root);
    const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(b.x, b.y, b.z).setRotation(root.quaternion));
    for (const c of m.colliders) {
      const d = RAPIER.ColliderDesc.cuboid(Math.max(0.01, c.h.x), Math.max(0.01, c.h.y), Math.max(0.01, c.h.z)).setTranslation(c.c.x, c.c.y, c.c.z).setCollisionGroups(groups(G_STATIC, ALL));
      if (c.q) d.setRotation(c.q);
      const col = this.phys.world.createCollider(d, body);
      this.phys.owners.set(col.handle, { kind: 'building', building: b });
    }
    const live: LiveBuilding = { placed: b, model: m, root, body, doors: [], furniture: [], props: [], fires: [], bedOwners: [] };
    for (const d of m.doors) live.doors.push(new Door(this.phys, d.exterior ? root : interior, d.pos, d.yaw, d.w, d.h, d.hinge, d.exterior, b.owner));
    // furniture
    const fr = furnish(m, b.spec.seed + 17);
    const candles = this.candleState.get(b.id);
    let ci = 0;
    // all static furniture of the building merged into a handful of meshes
    const merged = new GeoBuilder();
    for (const f of fr.furniture) merged.merge(f.model.geo, new THREE.Matrix4().compose(f.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw), new THREE.Vector3(1, 1, 1)));
    addInterior(merged.build());
    for (const f of fr.furniture) {
      const node = new FurnitureNode(f.model, candles ? 0 : 0.1 + mulberry32(b.spec.seed + ci)() * 0.5, 0xf2e8d0, true);
      node.group.position.copy(f.pos);
      node.group.rotation.y = f.yaw;
      interior.add(node.group);
      node.group.updateMatrixWorld(true);
      for (const cd of node.candles) { if (candles && candles[ci] !== undefined) cd.burn = candles[ci]; ci++; }
      // static colliders for the furniture body (movable parts get their own when open)
      for (const c of f.model.colliders) {
        const lp = c.c.clone().applyEuler(new THREE.Euler(0, f.yaw, 0)).add(f.pos);
        const d = RAPIER.ColliderDesc.cuboid(c.h.x, c.h.y, c.h.z).setTranslation(lp.x, lp.y, lp.z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw)).setCollisionGroups(groups(G_STATIC, ALL));
        const col = this.phys.world.createCollider(d, body);
        this.phys.owners.set(col.handle, { kind: 'furniture', furniture: node, building: b });
      }
      // sensor-ish pick boxes for movables so the player can aim at drawers and doors
      node.movables.forEach((mv) => {
        const s = mv.def.size;
        const center = mv.def.kind === 'drawer' ? new THREE.Vector3(0, 0, -s.z / 2) : mv.def.kind === 'lid' ? new THREE.Vector3(0, 0, s.z / 2) : new THREE.Vector3(-(mv.def.axis.y || 1) * s.x / 2, s.y / 2, 0);
        const lp = mv.def.pivot.clone().add(center).applyEuler(new THREE.Euler(0, f.yaw, 0)).add(f.pos);
        const d = RAPIER.ColliderDesc.cuboid(Math.max(0.02, s.x / 2), Math.max(0.02, s.y / 2), Math.max(0.02, s.z / 2 + 0.02)).setTranslation(lp.x, lp.y, lp.z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw)).setSensor(true).setCollisionGroups(groups(32, ALL));
        const col = this.phys.world.createCollider(d, body);
        this.phys.owners.set(col.handle, { kind: 'movable', movable: mv as MovableNode, furniture: node, building: b });
      });
      live.furniture.push(node);
      for (const sp of f.model.sleep ?? []) live.bedOwners.push({ node, sleep: sp.pos.clone().applyEuler(new THREE.Euler(0, f.yaw, 0)).add(f.pos).applyMatrix4(root.matrixWorld), person: null });
    }
    // assign beds to household members
    const members = b.household?.members ?? [];
    live.bedOwners.forEach((bo, i) => { bo.person = members[i]?.id ?? null; if (members[i]) members[i].bed = i; });
    for (const h of m.hearths) live.fires.push(h.clone());
    // props: restore saved state or spawn the household's belongings
    const saved = this.saved.get(b.id);
    const mat = root.matrixWorld;
    if (saved) {
      for (const s of saved) { const p = this.props.spawn(s.id, s.pos, s.quat, { owner: s.owner, sleep: true }); if (p) { p.age = s.age; live.props.push(p); } }
    } else {
      const r = mulberry32(b.spec.seed + 5);
      for (const it of fr.items) {
        const id = ITEMS[it.item] ? it.item : null;
        if (!id) continue;
        const wp = it.pos.clone().applyMatrix4(mat);
        wp.y += 0.03;
        const p = this.props.spawn(id, wp, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), { owner: b.id, sleep: true });
        if (p) { p.age = r() * 24 * (ITEMS[id].food?.spoilDays ?? 1) * 0.5; live.props.push(p); }
      }
    }
    this.live.set(b.id, live);
    exterior.visible = false;
  }

  unload(b: Placed) {
    const live = this.live.get(b.id);
    if (!live) return;
    // remember props still inside, and the candles' burn
    const inv = new THREE.Matrix4().copy(live.root.matrixWorld).invert();
    const keep: { id: string; pos: THREE.Vector3; quat: THREE.Quaternion; owner: string | null; age: number }[] = [];
    for (const p of live.props) {
      if (!this.props.props.has(p) || p.held || p.stowedIn) continue;
      const lp = p.obj.position.clone().applyMatrix4(inv);
      if (Math.abs(lp.x) < live.model.spec.w / 2 + 1 && Math.abs(lp.z) < live.model.spec.d / 2 + 1) {
        keep.push({ id: p.def.id, pos: p.obj.position.clone(), quat: p.obj.quaternion.clone(), owner: p.owner, age: p.age });
        this.props.destroy(p);
      }
    }
    this.saved.set(b.id, keep);
    this.candleState.set(b.id, live.furniture.flatMap((f) => f.candles.map((c) => c.burn)));
    for (const d of live.doors) d.dispose();
    this.phys.removeBody(live.body);
    live.root.removeFromParent();
    live.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry && !m.parent?.userData.furniture) m.geometry.dispose(); });
    this.live.delete(b.id);
    this.setLodHidden(b, false);
  }

  update2(dt: number, hours: number, t: number, cam?: THREE.Vector3) {
    for (const l of this.live.values()) {
      if (cam) {
        const d = l.root.position.distanceTo(cam);
        const int = l.root.getObjectByName('interior');
        if (int) int.visible = d < 28 + Math.max(l.model.spec.w, l.model.spec.d) * 0.5;
        if (int?.visible) for (const f of l.furniture) for (const mv of f.movables) mv.node.visible = mv.open > 0.01 || mv.node.getWorldPosition(_tmpV).distanceToSquared(cam) < 16 * 16;
        // detailed exterior up close, the merged low-detail box beyond
        const ext = l.root.getObjectByName('exterior');
        const detailed = d < this.detailR + Math.max(l.model.spec.w, l.model.spec.d);
        if (ext && ext.visible !== detailed) { ext.visible = detailed; this.setLodHidden(l.placed, detailed); }
      }
      for (const d of l.doors) d.update(dt, this.people);
      for (const f of l.furniture) f.update(dt, hours, t);
    }
  }

  /** Light sources near the camera: candles, hearths, torches. */
  lights(cam: THREE.Vector3, night: number): { pos: THREE.Vector3; intensity: number; range?: number; color?: THREE.Color }[] {
    const out: { pos: THREE.Vector3; intensity: number; range?: number; color?: THREE.Color }[] = [];
    for (const l of this.live.values()) {
      if (l.root.position.distanceTo(cam) > 60) continue;
      for (const f of l.furniture) for (const c of f.candles) if (c.lit && c.burn > 0) out.push({ pos: c.flameWorld, intensity: 1.2, range: 6 });
      for (const h of l.fires) out.push({ pos: h.clone().applyMatrix4(l.root.matrixWorld).setY(h.y + l.root.position.y + 0.2), intensity: 9, range: 11, color: new THREE.Color(1, 0.55, 0.25) });
    }
    if (night > 0.3) for (const t of this.torches) if (t.distanceTo(cam) < 80) out.push({ pos: t, intensity: 14 * night, range: 16 });
    return out;
  }

  /** Which live building (if any) contains the point (for interior exposure, trespass). */
  inside(p: THREE.Vector3): LiveBuilding | null {
    for (const l of this.live.values()) {
      const lp = l.root.worldToLocal(p.clone());
      if (Math.abs(lp.x) < l.model.spec.w / 2 - 0.1 && Math.abs(lp.z) < l.model.spec.d / 2 - 0.1 && lp.y > 0 && lp.y < l.model.height + 3) return l;
    }
    return null;
  }
}
