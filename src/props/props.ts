// Physical props: dynamic rigid bodies with real mass and convex shapes; breakable ceramics shatter
// into shards and spill; food ages and rots (slower in cold cellars, salted or smoked); items that
// come to rest inside an open container (basket, crate, cart bed, ship hold) are carried with it.
import * as THREE from 'three';
import { RAPIER, groups, G_PROP, G_HELD, G_DEBRIS, ALL, type Physics, v3, q4 } from '../physics/physics';
import { ITEMS, buildItemMesh, type ItemDef } from './items';
import { instanceModel, hullPoints, preload } from './models';

export interface Carrier { contents: Prop[]; obj: THREE.Object3D }
export interface Stack { id: string; n: number; age?: number; salted?: boolean; smoked?: boolean; owner?: string | null; contents?: Stack[] }

let NEXT = 1;
const itemGeoCache = new Map<string, THREE.Object3D>();
const hullCache = new Map<string, Float32Array>();
const boxCache = new Map<string, THREE.Box3>();

export class Prop {
  id = NEXT++;
  obj: THREE.Object3D;
  body: RAPIER.RigidBody | null = null;
  collider: RAPIER.Collider | null = null;
  owner: string | null = null;      // household/shop id that owns it (taking it is theft)
  age = 0;                           // game hours
  salted = false; smoked = false;
  contents: Prop[] = [];             // physically stowed props (they ride inside)
  stowedIn: Carrier | null = null;
  inv: Stack[] = [];                 // abstract contents (closed containers)
  held = false;
  broken = false;
  prevVel = new THREE.Vector3();
  rotten = 0;
  container?: { w: number; h: number; open: boolean };
  restT = 0;
  /** cached: resting inside a building */
  indoors: boolean | undefined;
  constructor(public def: ItemDef, public mgr: PropManager) {
    const glb = def.glb ? instanceModel(def.glb) : null;
    let mesh: THREE.Object3D | null = glb;
    if (!mesh) {
      let src = itemGeoCache.get(def.id);
      if (!src) { src = buildItemMesh(def) ?? new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial()); itemGeoCache.set(def.id, src); mgr.prep?.(src); }
      mesh = src.clone(true);
    }
    this.obj = new THREE.Group();
    this.obj.add(mesh);
    // the parts never move relative to the prop: only the prop's own transform is recomputed each frame
    mesh.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; (o as THREE.Mesh).castShadow = false; });
    this.obj.userData.cast = false;
    this.obj.userData.prop = this;
    this.container = def.container;
  }
  get pos() { return this.obj.position; }
  get bbox(): THREE.Box3 {
    let b = boxCache.get(this.def.id);
    if (!b) { this.obj.updateMatrixWorld(true); const q = this.obj.quaternion.clone(), p = this.obj.position.clone(); this.obj.position.set(0, 0, 0); this.obj.quaternion.identity(); this.obj.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(this.obj, true); this.obj.position.copy(p); this.obj.quaternion.copy(q); this.obj.updateMatrixWorld(true); boxCache.set(this.def.id, b); }
    return b;
  }
  get mass(): number { return this.def.mass + this.contents.reduce((s: number, c: Prop): number => s + c.mass, 0) + this.inv.reduce((s, c) => s + (ITEMS[c.id]?.mass ?? 0) * c.n, 0); }
  get freshness() { const f = this.def.food; if (!f) return 1; const days = this.age / 24; return Math.max(0, 1 - days / (f.spoilDays * (this.salted ? 15 : this.smoked ? 10 : 1))); }
}

export class PropManager {
  props = new Set<Prop>();
  group = new THREE.Group();
  shards: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number }[] = [];
  spills: { mesh: THREE.Mesh; t: number }[] = [];
  prep: ((o: THREE.Object3D) => void) | null = null;
  onBreak: ((p: Prop, at: THREE.Vector3) => void) | null = null;
  onImpact: ((p: Prop, speed: number, at: THREE.Vector3) => void) | null = null;
  coldAt: (p: THREE.Vector3) => boolean = () => false;
  constructor(public phys: Physics, public scene: THREE.Scene, public ground: (x: number, z: number) => number) {
    scene.add(this.group);
  }
  /** Every model the world uses: item meshes plus the big set pieces (ships, cannons). */
  async preloadAll() { await preload([...new Set([...Object.values(ITEMS).map((d) => d.glb).filter(Boolean) as string[], 'dutch_ship_medium', 'cannon_01'])]); }

  spawn(id: string, pos: THREE.Vector3, quat?: THREE.Quaternion, opts: { owner?: string | null; sleep?: boolean; vel?: THREE.Vector3 } = {}): Prop | null {
    const def = ITEMS[id];
    if (!def) return null;
    const p = new Prop(def, this);
    p.owner = opts.owner ?? null;
    p.obj.position.copy(pos);
    if (quat) p.obj.quaternion.copy(quat);
    this.group.add(p.obj);
    this.props.add(p);
    // resting belongings stay dormant (no rigid body) until someone comes near; everything else is live
    if (opts.sleep && !this.nearActivator(p)) this.makeDormant(p);
    else this.makeBody(p, false);
    if (opts.vel && p.body) p.body.setLinvel(opts.vel, true);
    return p;
  }

  private shapeFor(p: Prop): RAPIER.ColliderDesc {
    const d = p.def, b = p.bbox;
    const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    let desc: RAPIER.ColliderDesc | null = null;
    const shape = d.shape ?? 'hull';
    if (shape === 'ball') desc = RAPIER.ColliderDesc.ball(Math.max(0.01, Math.max(size.x, size.y, size.z) / 2 * 0.95)).setTranslation(c.x, c.y, c.z);
    else if (shape === 'box') desc = RAPIER.ColliderDesc.cuboid(Math.max(0.005, size.x / 2), Math.max(0.005, size.y / 2), Math.max(0.005, size.z / 2)).setTranslation(c.x, c.y, c.z);
    else if (shape === 'cyl') desc = RAPIER.ColliderDesc.cylinder(Math.max(0.005, size.y / 2), Math.max(0.005, Math.max(size.x, size.z) / 2)).setTranslation(c.x, c.y, c.z);
    else {
      let pts = hullCache.get(d.id);
      if (!pts) { const tmp = p.obj.children[0].clone(true); pts = hullPoints(tmp, 120); hullCache.set(d.id, pts); }
      desc = pts.length >= 12 ? RAPIER.ColliderDesc.convexHull(pts) : null;
      if (!desc) desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(c.x, c.y, c.z);
    }
    desc.setMass(Math.max(0.02, d.mass)).setFriction(d.id === 'barrel' ? 0.6 : 0.7).setRestitution(shape === 'ball' ? 0.35 : 0.12);
    desc.setCollisionGroups(groups(G_PROP, ALL));
    desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
    desc.setContactForceEventThreshold(Math.max(5, d.mass * 30));
    return desc;
  }

  /** Props within this horizontal distance of an activator get real rigid bodies. */
  activeR = 11;
  activators: THREE.Vector3[] = [];
  dormant = new Set<Prop>();
  private nearActivator(p: Prop, r = this.activeR) {
    const q = p.obj.position;
    for (const a of this.activators) { const dx = a.x - q.x, dz = a.z - q.z; if (dx * dx + dz * dz < r * r && Math.abs(a.y - q.y) < 30) return true; }
    return false;
  }
  makeDormant(p: Prop) {
    this.removeBody(p);
    this.dormant.add(p);
    p.obj.matrixAutoUpdate = false;
    p.obj.updateMatrix();
    p.obj.updateMatrixWorld(true);
  }
  wake(p: Prop) {
    if (!this.dormant.delete(p)) return;
    p.obj.matrixAutoUpdate = true;
    if (!p.body && !p.stowedIn && !p.held) this.makeBody(p, false);
  }
  /** Bring props near the player to life; put far, resting ones back to sleep without bodies. */
  private actT = 0;
  updateActivity(dt: number) {
    this.actT -= dt;
    if (this.actT > 0) return;
    this.actT = 0.2;
    for (const p of this.dormant) if (this.nearActivator(p)) this.wake(p);
    for (const p of this.props) {
      if (!p.body || p.held || p.stowedIn || this.dormant.has(p)) continue;
      if (p.body.isSleeping() && !this.nearActivator(p, this.activeR + 6)) this.makeDormant(p);
    }
  }

  makeBody(p: Prop, sleep: boolean) {
    const t = p.obj.position, q = p.obj.quaternion;
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(q).setLinearDamping(0.05).setAngularDamping(0.25).setCcdEnabled(p.def.mass < 1);
    p.body = this.phys.world.createRigidBody(bd);
    p.collider = this.phys.world.createCollider(this.shapeFor(p), p.body);
    this.phys.owners.set(p.collider.handle, { kind: 'prop', prop: p, onContact: (_o, f, at) => this.contact(p, f, at) });
    if (sleep) p.body.sleep();
  }
  removeBody(p: Prop) {
    if (p.body) { this.phys.removeBody(p.body); p.body = null; p.collider = null; }
  }
  destroy(p: Prop) {
    this.removeBody(p);
    this.dormant.delete(p);
    p.obj.parent?.remove(p.obj);
    this.props.delete(p);
    for (const c of [...p.contents]) this.destroy(c);
  }

  private contact(p: Prop, _force: number, at: THREE.Vector3) {
    const speed = p.prevVel.length();
    if (speed > 1.5) this.onImpact?.(p, speed, at);
    const br = p.def.breakable;
    if (br && !p.broken && !p.held && speed > br.threshold) this.shatter(p);
  }

  /** Break into shards that scatter with the item's momentum; liquids leave a spill. */
  shatter(p: Prop) {
    p.broken = true;
    const br = p.def.breakable!;
    const at = p.obj.position.clone();
    const b = p.bbox, size = b.getSize(new THREE.Vector3());
    const mat = new THREE.MeshStandardMaterial({ color: br.color, roughness: 0.5 });
    this.prep?.(mat as never);
    for (let i = 0; i < br.shards; i++) {
      const pts: number[] = [];
      const s = Math.max(size.x, size.z) * (0.25 + Math.random() * 0.25);
      for (let k = 0; k < 6; k++) pts.push((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.6, (Math.random() - 0.5) * s * 0.3);
      const geo = new THREE.BufferGeometry();
      // a tiny convex shard: triangulate the points as a fan (good enough for small pieces)
      const P = pts;
      const idx = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5, 1, 2, 5, 2, 3, 5];
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      const off = new THREE.Vector3((Math.random() - 0.5) * size.x, Math.random() * size.y, (Math.random() - 0.5) * size.z);
      mesh.position.copy(at).add(off);
      this.group.add(mesh);
      const body = this.phys.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(mesh.position.x, mesh.position.y, mesh.position.z).setLinvel(p.prevVel.x * 0.4 + (Math.random() - 0.5) * 2, Math.random() * 2, p.prevVel.z * 0.4 + (Math.random() - 0.5) * 2).setAngvel({ x: Math.random() * 10, y: Math.random() * 10, z: Math.random() * 10 }));
      const hull = RAPIER.ColliderDesc.convexHull(new Float32Array(P)) ?? RAPIER.ColliderDesc.ball(s * 0.3);
      this.phys.world.createCollider(hull.setMass(p.def.mass / br.shards).setCollisionGroups(groups(G_DEBRIS, ALL & ~G_DEBRIS)).setRestitution(0.2), body);
      this.shards.push({ body, mesh, t: 0 });
    }
    if (br.spill) {
      const col = br.spill === 'wine' ? 0x3a0808 : br.spill === 'milk' ? 0xe0e0d8 : 0x101418;
      const spill = new THREE.Mesh(new THREE.CircleGeometry(0.4 + Math.random() * 0.3, 20), new THREE.MeshStandardMaterial({ color: col, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      spill.rotation.x = -Math.PI / 2;
      spill.position.set(at.x, this.ground(at.x, at.z) + 0.01, at.z);
      if (at.y - spill.position.y > 0.3) spill.position.y = at.y - 0.05;
      this.group.add(spill);
      this.spills.push({ mesh: spill, t: 0 });
    }
    this.onBreak?.(p, at);
    for (const c of [...p.contents]) this.unstow(c);
    this.destroy(p);
  }

  // ---------- containers carry their contents ----------
  stow(item: Prop, into: Carrier) {
    if (item.stowedIn || item === into) return;
    this.removeBody(item);
    item.stowedIn = into;
    into.contents.push(item);
    // keep the current world pose, expressed in the container's frame
    into.obj.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(into.obj.matrixWorld).invert().multiply(item.obj.matrixWorld);
    into.obj.add(item.obj);
    m.decompose(item.obj.position, item.obj.quaternion, item.obj.scale);
  }
  unstow(item: Prop, vel?: THREE.Vector3) {
    const c = item.stowedIn;
    if (!c) return;
    item.obj.updateMatrixWorld(true);
    const wp = item.obj.getWorldPosition(new THREE.Vector3()), wq = item.obj.getWorldQuaternion(new THREE.Quaternion());
    this.group.add(item.obj);
    item.obj.position.copy(wp); item.obj.quaternion.copy(wq);
    c.contents.splice(c.contents.indexOf(item), 1);
    item.stowedIn = null;
    this.makeBody(item, false);
    if (vel && item.body) item.body.setLinvel(vel, true);
  }
  /** Generic container volumes that are not props (cart beds, ship holds) register here. */
  volumes: { obj: THREE.Object3D; box: THREE.Box3; carrier: { contents: Prop[] }; moving: () => boolean }[] = [];

  /** Per physics step: sync transforms, detect resting-in-container, age food. */
  private ageAcc = 0; private ageT = 0;
  step(dt: number, hours: number) {
    const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
    // food ages in batches (cold cellars slow it): no need to test every prop every physics step
    this.ageAcc += hours; this.ageT += dt;
    if (this.ageT > 0.5) {
      for (const p of this.props) if (p.def.food) p.age += this.ageAcc * (this.coldAt(p.obj.getWorldPosition(tmpP)) ? 0.25 : 1);
      this.ageAcc = 0; this.ageT = 0;
    }
    for (const p of this.props) {
      if (!p.body) continue;
      const lv = p.body.linvel();
      p.prevVel.set(lv.x, lv.y, lv.z);
      v3(p.body.translation(), p.obj.position);
      q4(p.body.rotation(), p.obj.quaternion);
      // fell out of the world: put it back on the ground
      if (p.obj.position.y < this.ground(p.obj.position.x, p.obj.position.z) - 3) {
        const gy = this.ground(p.obj.position.x, p.obj.position.z) + 0.5;
        p.body.setTranslation({ x: p.obj.position.x, y: gy, z: p.obj.position.z }, true);
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      // resting inside an open container -> ride along with it
      if (!p.held && p.prevVel.lengthSq() < 0.05 && !p.body.isSleeping()) p.restT += dt; else if (p.prevVel.lengthSq() >= 0.05) p.restT = 0;
      if (p.restT > 0.4 && !p.held && p.def.mass < 40) {
        for (const c of this.props) {
          if (c === p || !c.container?.open || c.stowedIn === (p as Carrier)) continue;
          if (c.obj.position.distanceToSquared(p.obj.position) > 1.5) continue;
          if (this.insideOpen(c, p.obj.position)) { this.stow(p, c); break; }
        }
        if (p.body) for (const v of this.volumes) {
          const local = v.obj.worldToLocal(p.obj.position.clone());
          if (v.box.containsPoint(local)) { this.stowVolume(p, v); break; }
        }
        p.restT = 0;
      }
    }
    // tipped-over containers spill their contents
    for (const c of this.props) if (c.contents.length && c.body) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(c.obj.quaternion);
      if (up.y < 0.25) for (const it of [...c.contents]) this.unstow(it, c.prevVel.clone().add(new THREE.Vector3(0, 0.5, 0)));
    }
    // shards and spills fade away
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.t += dt;
      v3(s.body.translation(), s.mesh.position); q4(s.body.rotation(), s.mesh.quaternion);
      if (s.t > 90) { this.phys.world.removeRigidBody(s.body); s.mesh.removeFromParent(); this.shards.splice(i, 1); }
    }
    for (let i = this.spills.length - 1; i >= 0; i--) {
      const s = this.spills[i]; s.t += dt;
      (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.55 * Math.max(0, 1 - s.t / 240);
      if (s.t > 240) { s.mesh.removeFromParent(); this.spills.splice(i, 1); }
    }
    void tmpQ;
  }
  private insideOpen(c: Prop, worldPos: THREE.Vector3) {
    const local = c.obj.worldToLocal(worldPos.clone());
    const b = c.bbox;
    return local.x > b.min.x + 0.01 && local.x < b.max.x - 0.01 && local.z > b.min.z + 0.01 && local.z < b.max.z - 0.01 && local.y > b.min.y - 0.02 && local.y < b.max.y + 0.05;
  }
  private stowVolume(p: Prop, v: PropManager['volumes'][number]) {
    this.removeBody(p);
    v.carrier.contents.push(p);
    p.stowedIn = { contents: v.carrier.contents, obj: v.obj };
    v.obj.updateMatrixWorld(true);
    const m = new THREE.Matrix4().copy(v.obj.matrixWorld).invert().multiply(p.obj.matrixWorld);
    v.obj.add(p.obj);
    m.decompose(p.obj.position, p.obj.quaternion, p.obj.scale);
  }
  /** Distance culling: small props vanish beyond ~26 m; shadows only up close (indoors the walls already shade them). */
  insideAt: (p: THREE.Vector3) => boolean = () => false;
  cull(cam: THREE.Vector3) {
    for (const p of this.props) {
      if (p.stowedIn) continue;
      const d2 = p.obj.position.distanceToSquared(cam);
      const big = p.def.mass > 5;
      p.obj.visible = d2 < (big ? 70 * 70 : 26 * 26);
      if (p.indoors === undefined || p.body) p.indoors = this.insideAt(p.obj.position);
      const cast = d2 < (p.indoors ? 8 * 8 : big ? 32 * 32 : 14 * 14);
      if (p.obj.userData.cast !== cast) { p.obj.userData.cast = cast; p.obj.traverse((o) => { (o as THREE.Mesh).castShadow = cast; }); }
    }
  }
  /** Visual rot: darken and brown food as it spoils. */
  updateLooks() {
    for (const p of this.props) {
      if (!p.def.food) continue;
      const rot = 1 - p.freshness;
      if (Math.abs(rot - p.rotten) < 0.05) continue;
      p.rotten = rot;
      p.obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.userData.origMat) { m.userData.origMat = m.material; m.material = (m.material as THREE.MeshStandardMaterial).clone(); }
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.color.copy((m.userData.origMat as THREE.MeshStandardMaterial).color).lerp(new THREE.Color(0.18, 0.14, 0.06), Math.min(1, rot * 1.1));
        mat.roughness = 0.5 + rot * 0.5;
      });
      if (rot > 0.6) p.obj.scale.setScalar(1 - (rot - 0.6) * 0.3);
    }
  }
}
export function heldGroups() { return groups(G_HELD, ALL & ~4); }
