// Rapier physics world: terrain heightfield, static architecture, dynamic props, character controllers.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { World } from '../world/world';
import { HM_N, WORLD } from '../world/layout';

export { RAPIER };
export type RB = RAPIER.RigidBody;
export type Col = RAPIER.Collider;

// collision groups: membership << 16 | filter
export const G_STATIC = 1, G_PROP = 2, G_CHAR = 4, G_TREE = 8, G_VEHICLE = 16, G_SENSOR = 32, G_DEBRIS = 64, G_HELD = 128;
export const groups = (member: number, filter: number) => (member << 16) | filter;
export const ALL = 0xffff;

export interface Owner { kind: string; onContact?(other: Owner | undefined, force: number, point: THREE.Vector3): void; [k: string]: unknown }

export class Physics {
  world!: RAPIER.World;
  events!: RAPIER.EventQueue;
  owners = new Map<number, Owner>();     // collider handle -> game object
  dt = 1 / 60;
  acc = 0;
  steps = 0;
  terrainCollider!: RAPIER.Collider;
  private stepHooks: ((dt: number) => void)[] = [];
  private postHooks: ((dt: number) => void)[] = [];

  async init(world: World) {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.numSolverIterations = 6;
    this.events = new RAPIER.EventQueue(true);
    // heightfield: parry stores heights column-major with rows along z and columns along x
    const n = HM_N, H = world.heights;
    const hf = new Float32Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) hf[x * n + z] = H[z * n + x];
    const desc = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, hf, { x: WORLD, y: 1, z: WORLD })
      .setFriction(0.9).setCollisionGroups(groups(G_STATIC, ALL));
    this.terrainCollider = this.world.createCollider(desc);
    this.owners.set(this.terrainCollider.handle, { kind: 'terrain' });
  }

  onStep(fn: (dt: number) => void) { this.stepHooks.push(fn); }
  onPostStep(fn: (dt: number) => void) { this.postHooks.push(fn); }

  /** World.step() re-walks every collider and body through the JS bridge after each step to map ones the
   *  pipeline created itself (it never creates any here); with tens of thousands of static colliders that costs
   *  ~2 ms per substep. Step the pipeline directly; creation/removal through the World API stays mapped. */
  private rawStep() {
    const w = this.world as unknown as Record<string, { step?: (...a: unknown[]) => void }> & { physicsPipeline?: { step: (...a: unknown[]) => void } };
    const pp = w.physicsPipeline;
    if (!pp) { this.world.step(this.events); return; }
    pp.step(w.gravity, w.integrationParameters, w.islands, w.broadPhase, w.narrowPhase, w.bodies, w.colliders, w.softBodies, w.impulseJoints, w.multibodyJoints, w.ccdSolver, this.events, undefined);
  }
  /** Advance with a fixed timestep; returns the number of substeps taken. */
  update(frameDt: number) {
    this.acc += Math.min(frameDt, 0.1);
    let n = 0;
    while (this.acc >= this.dt && n < 4) {
      for (const h of this.stepHooks) h(this.dt);
      this.world.timestep = this.dt;
      this.rawStep();
      this.drainEvents();
      for (const h of this.postHooks) h(this.dt);
      this.acc -= this.dt; n++; this.steps++;
    }
    if (n === 4) this.acc = 0;
    return n;
  }

  private tmpP = new THREE.Vector3();
  private drainEvents() {
    this.events.drainContactForceEvents((ev) => {
      const a = this.owners.get(ev.collider1()), b = this.owners.get(ev.collider2());
      const f = ev.totalForceMagnitude();
      const c1 = this.world.getCollider(ev.collider1());
      const t = c1?.translation();
      if (t) this.tmpP.set(t.x, t.y, t.z);
      a?.onContact?.(b, f, this.tmpP);
      b?.onContact?.(a, f, this.tmpP);
    });
    this.events.drainCollisionEvents(() => { /* sensors are polled */ });
  }

  /** Ray cast; returns hit point, normal, collider, distance. */
  ray(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number, filterGroups = groups(ALL, ALL), exclude?: RAPIER.Collider, excludeBody?: RAPIER.RigidBody) {
    const r = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(r, maxToi, true, undefined, filterGroups, exclude, excludeBody);
    if (!hit) return null;
    const p = new THREE.Vector3(origin.x + dir.x * hit.timeOfImpact, origin.y + dir.y * hit.timeOfImpact, origin.z + dir.z * hit.timeOfImpact);
    return { point: p, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider, toi: hit.timeOfImpact, owner: this.owners.get(hit.collider.handle) };
  }

  // ---------- builders ----------
  fixedBox(pos: THREE.Vector3, half: THREE.Vector3, quat?: THREE.Quaternion, owner?: Owner, friction = 0.8) {
    const d = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(pos.x, pos.y, pos.z).setFriction(friction)
      .setCollisionGroups(groups(G_STATIC, ALL));
    if (quat) d.setRotation(quat);
    const c = this.world.createCollider(d);
    if (owner) this.owners.set(c.handle, owner);
    return c;
  }
  fixedCylinder(pos: THREE.Vector3, halfH: number, r: number, owner?: Owner, group = G_STATIC) {
    const d = RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(pos.x, pos.y, pos.z).setCollisionGroups(groups(group, ALL));
    const c = this.world.createCollider(d);
    if (owner) this.owners.set(c.handle, owner);
    return c;
  }
  fixedTrimesh(geom: THREE.BufferGeometry, matrix: THREE.Matrix4, owner?: Owner) {
    const g = geom.index ? geom : geom;
    const P = g.getAttribute('position');
    const v = new Float32Array(P.count * 3);
    const t = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { t.fromBufferAttribute(P, i).applyMatrix4(matrix); v[i * 3] = t.x; v[i * 3 + 1] = t.y; v[i * 3 + 2] = t.z; }
    const idx = g.index ? new Uint32Array(g.index.array) : new Uint32Array(Array.from({ length: P.count }, (_, i) => i));
    const c = this.world.createCollider(RAPIER.ColliderDesc.trimesh(v, idx).setCollisionGroups(groups(G_STATIC, ALL)));
    if (owner) this.owners.set(c.handle, owner);
    return c;
  }
  remove(c: RAPIER.Collider | null | undefined) {
    if (!c) return;
    this.owners.delete(c.handle);
    if (this.world.getCollider(c.handle)) this.world.removeCollider(c, true);
  }
  removeBody(b: RAPIER.RigidBody | null | undefined) {
    if (!b) return;
    for (let i = 0; i < b.numColliders(); i++) this.owners.delete(b.collider(i).handle);
    if (this.world.getRigidBody(b.handle)) this.world.removeRigidBody(b);
  }
}

export const v3 = (v: { x: number; y: number; z: number }, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const q4 = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
