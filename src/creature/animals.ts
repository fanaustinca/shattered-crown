// Animals: herds that graze, wander, flee and sleep; rideable horses/donkeys with saddles and
// saddlebags; leading by rope and hitching to carts. Birds fly in flocks, land, peck and scatter.
import * as THREE from 'three';
import { RAPIER, groups, G_CHAR, G_SENSOR, G_HELD, G_STATIC, ALL, type Physics } from '../physics/physics';
import { CreatureLib, coatFor, AnimLod, releaseRig, type Rig } from './rig';
import { QuadAnimator, BirdAnimator, type MoveState } from './anim';
import type { World } from '../world/world';
import type { Input } from '../core/input';
import type { Player, Seat } from '../player/player';
import { mulberry32 } from '../core/noise';
import { SITES } from '../world/layout';

export type Species = 'horse' | 'donkey' | 'cow' | 'pig' | 'bunny';
const SPEC: Record<Species, { walk: number; run: number; radius: number; half: number; bodyY: number; skittish: number; rideable: boolean; mass: number }> = {
  horse: { walk: 1.5, run: 13, radius: 0.42, half: 0.75, bodyY: 1.15, skittish: 0.25, rideable: true, mass: 500 },
  donkey: { walk: 1.2, run: 7, radius: 0.38, half: 0.55, bodyY: 0.95, skittish: 0.1, rideable: true, mass: 250 },
  cow: { walk: 1.0, run: 5, radius: 0.48, half: 0.8, bodyY: 1.05, skittish: 0.15, rideable: false, mass: 600 },
  pig: { walk: 0.9, run: 4.5, radius: 0.32, half: 0.4, bodyY: 0.45, skittish: 0.5, rideable: false, mass: 120 },
  bunny: { walk: 0.8, run: 7.5, radius: 0.08, half: 0.07, bodyY: 0.11, skittish: 1, rideable: false, mass: 2 },
};

export interface GameCtx { physics: Physics; world: World; input: Input; player: Player; creatures: CreatureLib; scene: THREE.Scene; groundAt(x: number, z: number, fromY?: number): number; hours: () => number; sound?(name: string, pos: THREE.Vector3, vol?: number): void }

export class Animal implements Seat {
  rig: Rig;
  lod = new AnimLod();
  anim: QuadAnimator;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;
  st: MoveState;
  target = new THREE.Vector3();
  timer = 0;
  mode: 'idle' | 'wander' | 'graze' | 'flee' | 'sleep' | 'ridden' | 'led' | 'hitched' | 'dead' | 'cavalry' = 'idle';
  /** cavalry: where the rider wants to go and how fast */
  cav: { target: THREE.Vector3; speed: number } | null = null;
  /** cavalry: the rider's collider (the horse's controller ignores it) */
  npcRider: number | null = null;
  rider: Player | null = null;
  leader: Player | null = null;
  hitch: { pos: THREE.Vector3; yaw: number } | null = null;
  saddled = false;
  saddlebags: unknown[] = [];       // container items (filled by the inventory system)
  bagMeshes: THREE.Object3D[] = [];
  health = 100;
  fear = 0;
  label: string;
  eye = 1.25;
  freeLook = true;
  speedCmd = 0;                     // ridden throttle 0..4
  name: string;
  owner: string | null = null;      // owning NPC/site (stealing a horse is a crime)
  vy = 0;
  private rnd: () => number;
  constructor(public species: Species, public ctx: GameCtx, pos: THREE.Vector3, public home: THREE.Vector3, public homeR: number, seed: number) {
    this.rnd = mulberry32(seed);
    this.rig = ctx.creatures.instance(species, coatFor(species, this.rnd));
    this.anim = new QuadAnimator(this.rig, (x, z) => ctx.groundAt(x, z, this.st?.pos.y ?? 999));
    this.st = { pos: pos.clone(), yaw: this.rnd() * Math.PI * 2, speed: 0, turn: 0, vel: new THREE.Vector3(), action: 'idle', look: null };
    const sp = SPEC[species];
    this.body = ctx.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + sp.bodyY, pos.z));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    this.collider = ctx.physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(sp.half, sp.radius).setRotation(q).setCollisionGroups(groups(G_CHAR, ALL & ~G_SENSOR & ~G_HELD)), this.body);
    ctx.physics.owners.set(this.collider.handle, { kind: 'animal', animal: this });
    this.kcc = ctx.physics.world.createCharacterController(0.05);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(sp.mass);
    this.label = species === 'horse' ? 'Ride' : 'Ride';
    const names: Record<Species, string[]> = { horse: ['Ember', 'Thistle', 'Brannoc', 'Willow', 'Ash', 'Dapple', 'Gale'], donkey: ['Mule', 'Barley', 'Pip', 'Old Tom', 'Burdock'], cow: ['Bess', 'Clover', 'Daisy', 'Marigold'], pig: ['Grub', 'Truffle', 'Bramble'], bunny: ['Hare'] };
    this.name = names[species][Math.floor(this.rnd() * names[species].length)];
    ctx.scene.add(this.rig.root);
    this.pickWander();
  }

  get spec() { return SPEC[this.species]; }

  dispose() {
    this.ctx.scene.remove(this.rig.root);
    this.ctx.physics.removeBody(this.body);
    this.ctx.physics.world.removeCharacterController(this.kcc);
    (this.rig.mesh.material as THREE.Material).dispose();
    releaseRig(this.rig);
  }

  private pickWander() {
    const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * this.homeR;
    this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
    this.timer = 4 + this.rnd() * 10;
  }

  // ---- Seat (riding) ----
  getTransform(pos: THREE.Vector3, quat: THREE.Quaternion) {
    const spine = this.rig.byName.spine;
    spine.getWorldPosition(pos);
    pos.y += this.species === 'horse' ? 0.08 : 0.05;
    // the rider's feet origin sits a little below the saddle so the eye lands right
    pos.y -= 0.85;
    quat.setFromEuler(new THREE.Euler(0, this.st.yaw, 0));
  }
  mount(p: Player) {
    if (!this.spec.rideable || this.mode === 'dead') return false;
    this.rider = p; this.mode = 'ridden'; this.leader = null; this.speedCmd = 0;
    p.yaw = this.st.yaw + Math.PI; // player yaw 0 faces -z; animals' yaw 0 faces +z
    p.sitIn(this);
    return true;
  }
  teleport(p: THREE.Vector3) {
    this.st.pos.copy(p);
    const y = p.y + this.spec.bodyY;
    this.body.setTranslation({ x: p.x, y, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y, z: p.z });
    if ('initFeet' in this.anim) this.anim.initFeet = true;
  }
  leave(_p: Player) { this.rider = null; this.mode = 'idle'; this.timer = 3; }
  /** the rider's view rocks with the gait (a little less than the horse: the rider's body absorbs some) */
  sway() { const r = (this.anim as { rock?: { pitch: number; roll: number } }).rock; return r ? { pitch: r.pitch * 0.45, roll: -r.roll * 0.5 } : { pitch: 0, roll: 0 }; }
  drive(input: Input, dt: number) {
    if (input.hit('KeyW')) this.speedCmd = Math.min(4, this.speedCmd + 1);
    if (input.hit('KeyS')) this.speedCmd = Math.max(-1, this.speedCmd - 1);
    if (input.key('ShiftLeft') && input.key('KeyW')) this.speedCmd = 4;
    const turn = (input.key('KeyA') ? 1 : 0) - (input.key('KeyD') ? 1 : 0);
    const speeds = [0, this.spec.walk * 1.1, this.spec.walk * 2.4, this.spec.run * 0.6, this.spec.run];
    const want = this.speedCmd < 0 ? -0.8 : speeds[this.speedCmd];
    this.st.speed += (want - this.st.speed) * Math.min(1, dt * 1.5);
    this.st.turn = turn * (1.6 - Math.min(1, Math.abs(this.st.speed) / 10) * 0.9);
    this.st.yaw += this.st.turn * dt;
    if (input.hit('Space') && this.species === 'horse' && this.onGround) this.vy = 4.2;
  }
  onGround = true;

  /** Fixed-step update: AI decisions + collision-aware movement. */
  step(dt: number) {
    const st = this.st, ctx = this.ctx, sp = this.spec;
    if (this.mode === 'dead') { st.speed = 0; st.action = 'dead'; return; }
    const player = ctx.player;
    const dP = player.pos.distanceTo(st.pos);
    if (this.mode === 'cavalry') {
      st.look = null; st.ridden = true;
      if (this.cav) { this.target.copy(this.cav.target); const d = Math.hypot(this.target.x - st.pos.x, this.target.z - st.pos.z); this.steer(dt, d > 1.5 ? this.cav.speed : 0); }
      else this.steer(dt, 0);
    } else if (this.mode === 'ridden' && this.rider) {
      st.look = null;
      this.drive(ctx.input, dt);
    } else if (this.mode === 'hitched' && this.hitch) {
      st.look = null;
      // walk to the cart's hitch point; the cart is pulled by its harness constraint
      this.target.copy(this.hitch.pos);
      st.yaw = this.hitch.yaw;
      const d = Math.hypot(this.target.x - st.pos.x, this.target.z - st.pos.z);
      st.speed = d > 0.05 ? Math.min(sp.run * 0.5, d / dt * 0.9) : 0;
    } else if (this.mode === 'led' && this.leader) {
      this.target.copy(this.leader.pos);
      const d = Math.hypot(this.target.x - st.pos.x, this.target.z - st.pos.z);
      this.steer(dt, d > 2.4 ? Math.min(sp.run * 0.6, (d - 2) * 1.5) : 0);
    } else {
      // fear: the player sprinting close, or attacks, spook animals
      const threat = dP < 4 + sp.skittish * 14 && (player.sprinting || player.noise > 0.5 || sp.skittish > 0.8) ? 1 : 0;
      this.fear = Math.max(this.fear - dt * 0.15, threat * sp.skittish);
      const night = ctx.hours() < 5.5 || ctx.hours() > 21.5;
      if (this.fear > 0.3) {
        this.mode = 'flee';
        const away = st.pos.clone().sub(player.pos).setY(0).normalize();
        this.target.copy(st.pos).addScaledVector(away, 15);
        this.steer(dt, sp.run * Math.min(1, this.fear + 0.3));
        st.action = 'flee';
      } else {
        this.timer -= dt;
        if (this.timer <= 0) {
          const r = this.rnd();
          if (night && this.species !== 'bunny') { this.mode = 'sleep'; this.timer = 20 + this.rnd() * 30; }
          else if (r < 0.45) { this.mode = 'graze'; this.timer = 6 + this.rnd() * 14; }
          else if (r < 0.75) { this.mode = 'wander'; this.pickWander(); }
          else { this.mode = 'idle'; this.timer = 3 + this.rnd() * 6; }
        }
        if (this.mode === 'wander') {
          const d = Math.hypot(this.target.x - st.pos.x, this.target.z - st.pos.z);
          if (d < 0.8) { this.mode = 'graze'; this.timer = 5 + this.rnd() * 8; this.steer(dt, 0); }
          else this.steer(dt, this.species === 'bunny' ? 1.2 : sp.walk);
        } else this.steer(dt, 0);
        st.action = this.mode === 'graze' ? 'graze' : this.mode === 'sleep' ? 'sleep' : 'idle';
        st.look = dP < 8 ? player.eyePos() : null;
      }
    }
    // move with collisions; stick to the ground under us (terrain, bridges, decks)
    const dirX = Math.sin(st.yaw), dirZ = Math.cos(st.yaw);
    const t = this.collider.translation();
    const gy = ctx.groundAt(t.x, t.z, t.y + 0.5);
    let dy = 0;
    const want = gy + sp.bodyY;
    if (this.vy > 0 || t.y > want + 0.05) { this.vy -= 9.81 * dt; dy = this.vy * dt; if (t.y + dy <= want) { dy = want - t.y; this.vy = 0; } }
    else { dy = (want - t.y) * Math.min(1, dt * 12); this.vy = 0; }
    this.onGround = t.y + dy <= want + 0.05;
    let desired = { x: dirX * st.speed * dt, y: dy, z: dirZ * st.speed * dt };
    if (this.mode === 'hitched' && this.hitch) desired = { x: this.hitch.pos.x - st.pos.x, y: dy, z: this.hitch.pos.z - st.pos.z };
    // water: animals refuse deep water unless ridden (horses can swim)
    const wl = ctx.world.waterLevelAt(t.x + desired.x * 8, t.z + desired.z * 8);
    if (this.mode !== 'ridden' && wl > ctx.groundAt(t.x + desired.x * 8, t.z + desired.z * 8) + 0.9) { desired.x = 0; desired.z = 0; this.pickWander(); }
    this.body.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.yaw));
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G_CHAR, this.mode === 'hitched' ? G_STATIC : (G_STATIC | G_CHAR | 2 | 16) & ~(this.rider ? G_CHAR : 0)), (c) => c.handle !== this.rider?.collider.handle && c.handle !== this.npcRider);
    const mv = this.kcc.computedMovement();
    const nt = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    this.body.setNextKinematicTranslation(nt);
    const moved = Math.hypot(mv.x, mv.z) / dt;
    st.vel.set(mv.x / dt, mv.y / dt, mv.z / dt);
    st.pos.set(nt.x, nt.y - sp.bodyY, nt.z);
    if (this.mode !== 'hitched') st.speed = Math.sign(st.speed) * Math.min(Math.abs(st.speed), moved + 0.3);
  }

  private steer(dt: number, speed: number) {
    const st = this.st;
    if (speed > 0) {
      const want = Math.atan2(this.target.x - st.pos.x, this.target.z - st.pos.z);
      let d = want - st.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const tr = THREE.MathUtils.clamp(d * 2, -1.8, 1.8);
      st.turn = tr;
      st.yaw += tr * dt;
    } else st.turn *= 0.9;
    st.speed += (speed - st.speed) * Math.min(1, dt * 2.5);
  }

  animate(dt: number) {
    this.st.ridden = !!this.rider;
    this.anim.update(dt, this.st);
  }
}

// ---------------- birds ----------------
interface Bird { rig: Rig; anim: BirdAnimator; pos: THREE.Vector3; vel: THREE.Vector3; yaw: number; flying: boolean; landT: number; groundT: number; peck: boolean; species: string }
export class Flock {
  birds: Bird[] = [];
  center = new THREE.Vector3();
  goal = new THREE.Vector3();
  t = 0;
  constructor(public ctx: GameCtx, species: string, center: THREE.Vector3, n: number, seed: number) {
    const r = mulberry32(seed);
    this.center.copy(center); this.goal.copy(center);
    for (let i = 0; i < n; i++) {
      const rig = ctx.creatures.instance(species, coatFor(species, r));
      rig.mesh.castShadow = species === 'chicken';
      const pos = center.clone().add(new THREE.Vector3((r() - 0.5) * 10, 0, (r() - 0.5) * 10));
      pos.y = ctx.groundAt(pos.x, pos.z);
      this.birds.push({ rig, anim: new BirdAnimator(rig), pos, vel: new THREE.Vector3(), yaw: r() * 6.28, flying: false, landT: 0, groundT: 3 + r() * 10, peck: false, species });
      ctx.scene.add(rig.root);
    }
  }
  dispose() { for (const b of this.birds) { this.ctx.scene.remove(b.rig.root); releaseRig(b.rig); } }
  update(dt: number) {
    this.t += dt;
    const p = this.ctx.player;
    const chicken = this.birds[0]?.species === 'chicken';
    for (const b of this.birds) {
      const dP = b.pos.distanceTo(p.pos);
      if (!b.flying) {
        b.groundT -= dt;
        // hop/walk around pecking; scatter when the player comes close
        const scare = dP < (chicken ? 2.5 : 6) && (p.noise > 0.3 || dP < 2);
        if (scare) {
          if (chicken) { const away = b.pos.clone().sub(p.pos).setY(0).normalize(); b.vel.copy(away).multiplyScalar(3); b.yaw = Math.atan2(away.x, away.z); }
          else { b.flying = true; b.vel.set((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3); this.goal.copy(this.center).add(new THREE.Vector3((Math.random() - 0.5) * 120, 0, (Math.random() - 0.5) * 120)); this.ctx.sound?.('flap', b.pos, 0.5); }
        } else if (b.groundT <= 0) {
          if (!chicken && Math.random() < 0.15) { b.flying = true; b.vel.set(0, 3, 0); }
          else { b.groundT = 0.5 + Math.random() * 3; b.yaw += (Math.random() - 0.5) * 2; b.vel.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)).multiplyScalar(chicken ? 0.6 : 0.4); b.peck = Math.random() < 0.6; }
        }
        b.vel.multiplyScalar(Math.exp(-dt * 2));
        b.pos.addScaledVector(b.vel, dt);
        b.pos.y = this.ctx.groundAt(b.pos.x, b.pos.z, b.pos.y + 1);
        b.anim.update(dt, b.pos, b.yaw, 0, false, 0, b.peck && b.vel.lengthSq() < 0.05);
      } else {
        // boids: cohesion toward the flock goal, separation, cruise altitude, then land
        const ground = this.ctx.groundAt(b.pos.x, b.pos.z);
        const toGoal = this.goal.clone().sub(b.pos);
        const alt = b.landT > 0 ? 0 : 12 + Math.sin(this.t * 0.3) * 4;
        toGoal.y = ground + alt - b.pos.y;
        const acc = toGoal.normalize().multiplyScalar(6);
        for (const o of this.birds) if (o !== b && o.flying) { const d = b.pos.distanceTo(o.pos); if (d < 1.2) acc.add(b.pos.clone().sub(o.pos).multiplyScalar(4 / (d + 0.1))); }
        b.vel.addScaledVector(acc, dt);
        const sp = b.vel.length(), max = 9;
        if (sp > max) b.vel.multiplyScalar(max / sp);
        b.pos.addScaledVector(b.vel, dt);
        if (b.pos.y < ground + 0.05) b.pos.y = ground + 0.05;
        b.yaw = Math.atan2(b.vel.x, b.vel.z);
        const pitch = Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z));
        const nearGoal = Math.hypot(b.pos.x - this.goal.x, b.pos.z - this.goal.z) < 8;
        if (nearGoal) b.landT += dt;
        if (b.landT > 3 && b.pos.y - ground < 0.3) { b.flying = false; b.landT = 0; b.groundT = 2 + Math.random() * 8; b.vel.set(0, 0, 0); }
        const flapping = b.vel.y > -0.5 || sp < 5;
        b.anim.update(dt, b.pos, b.yaw, pitch, true, flapping ? (b.species === 'crow' ? 4 : 9) : 0.2, false);
      }
    }
    // occasionally move the whole flock
    if (Math.random() < dt * 0.01 && !chicken) { this.goal.copy(this.center).add(new THREE.Vector3((Math.random() - 0.5) * 150, 0, (Math.random() - 0.5) * 150)); for (const b of this.birds) if (!b.flying) { b.flying = true; b.vel.set(0, 3, 0); } }
  }
}

// ---------------- population: herds spawn inside the simulation bubble ----------------
interface HerdDef { species: Species; x: number; z: number; r: number; n: number; seed: number; owner: string | null }
interface FlockDef { species: string; x: number; z: number; n: number; seed: number }
export class Fauna {
  herds: HerdDef[] = [];
  flockDefs: FlockDef[] = [];
  live = new Map<HerdDef, Animal[]>();
  liveFlocks = new Map<FlockDef, Flock>();
  extra: Animal[] = [];   // animals the player took away (ridden/led horses persist)
  constructor(public ctx: GameCtx, towns?: { plans: { site: { id: string }; paddocks: { x: number; z: number; w: number; d: number; species: Species }[]; buildings: { spec: { type: string }; x: number; z: number }[] }[] }) {
    const r = mulberry32(31337);
    // livestock in the farm paddocks, hens around every farmhouse
    for (const p of towns?.plans ?? []) {
      for (const pd of p.paddocks) this.herds.push({ species: pd.species, x: pd.x, z: pd.z, r: Math.min(pd.w, pd.d) * 0.7, n: pd.species === 'horse' || pd.species === 'donkey' ? 2 + Math.floor(r() * 2) : 3 + Math.floor(r() * 4), seed: Math.floor(r() * 1e9), owner: p.site.id });
      for (const b of p.buildings) if (b.spec.type === 'cottage' && r() < 0.6) this.flockDefs.push({ species: 'chicken', x: b.x + (r() - 0.5) * 10, z: b.z + (r() - 0.5) * 10, n: 3 + Math.floor(r() * 5), seed: Math.floor(r() * 1e9) });
    }
    const w = ctx.world;
    for (const s of SITES) {
      const farms = w.fields.filter((f) => f.site === s.id).slice(0, 6);
      const ok = (x: number, z: number) => w.heightAt(x, z) > 2 && w.slopeAt(x, z) < 0.2 && w.roadAt(x, z) < 0.1 && w.fieldAt(x, z) < 0.1;
      const near = (rad: number) => { for (let k = 0; k < 30; k++) { const a = r() * 6.28, d = s.r * 1.1 + r() * rad; const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d; if (ok(x, z)) return [x, z]; } return null; };
      const add = (species: Species, n: number, rad: number, hr: number) => { const p = near(rad); if (p) this.herds.push({ species, x: p[0], z: p[1], r: hr, n, seed: Math.floor(r() * 1e9), owner: s.id }); };
      if (s.kind !== 'castle') { add('cow', 3 + Math.floor(r() * 4), 120, 18); add('pig', 2 + Math.floor(r() * 4), 60, 8); add('donkey', 1 + Math.floor(r() * 2), 40, 8); }
      add('horse', 2 + Math.floor(r() * 4), s.kind === 'castle' ? 60 : 100, 16);
      this.flockDefs.push({ species: 'chicken', x: s.x + (r() - 0.5) * s.r, z: s.z + (r() - 0.5) * s.r, n: 5 + Math.floor(r() * 6), seed: Math.floor(r() * 1e9) });
      this.flockDefs.push({ species: s.kingdom === 'ironreach' ? 'crow' : 'pigeon', x: s.x, z: s.z, n: 6 + Math.floor(r() * 8), seed: Math.floor(r() * 1e9) });
      void farms;
    }
    // wild bunnies and sparrows across the meadows
    for (let i = 0; i < 420; i++) {
      const x = (r() - 0.5) * 5200, z = (r() - 0.5) * 5200;
      if (w.heightAt(x, z) < 3 || w.heightAt(x, z) > 300 || w.slopeAt(x, z) > 0.25 || w.forestAt(x, z) > 0.6) continue;
      if (r() < 0.6) this.herds.push({ species: 'bunny', x, z, r: 12, n: 1 + Math.floor(r() * 3), seed: Math.floor(r() * 1e9), owner: null });
      else this.flockDefs.push({ species: r() < 0.7 ? 'sparrow' : 'crow', x, z, n: 4 + Math.floor(r() * 8), seed: Math.floor(r() * 1e9) });
    }
  }
  /** Spawn/despawn around the player according to the simulation bubble radius. */
  updateBubble(radius: number) {
    const p = this.ctx.player.pos;
    for (const h of this.herds) {
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      const live = this.live.get(h);
      if (d < radius && !live) {
        const r = mulberry32(h.seed);
        const arr: Animal[] = [];
        for (let i = 0; i < h.n; i++) {
          const x = h.x + (r() - 0.5) * h.r, z = h.z + (r() - 0.5) * h.r;
          const a = new Animal(h.species, this.ctx, new THREE.Vector3(x, this.ctx.groundAt(x, z), z), new THREE.Vector3(h.x, 0, h.z), h.r, h.seed + i);
          a.owner = h.owner;
          arr.push(a);
        }
        this.live.set(h, arr);
      } else if (live && d > radius + 40) {
        // keep animals the player is riding or leading
        for (const a of live) { if (a.rider || a.leader || a.mode === 'hitched') this.extra.push(a); else a.dispose(); }
        this.live.delete(h);
      }
    }
    for (const f of this.flockDefs) {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      const live = this.liveFlocks.get(f);
      if (d < radius * 0.8 && !live) this.liveFlocks.set(f, new Flock(this.ctx, f.species, new THREE.Vector3(f.x, 0, f.z), f.n, f.seed));
      else if (live && d > radius * 0.8 + 40) { live.dispose(); this.liveFlocks.delete(f); }
    }
  }
  all(): Animal[] { const out = [...this.extra]; for (const a of this.live.values()) out.push(...a); return out; }
  step(dt: number) { for (const a of this.all()) a.step(dt); }
  animate(dt: number) {
    const cam = this.ctx.player.pos;
    for (const a of this.all()) {
      // animation LOD: far animals update at a lower rate
      const d = a.st.pos.distanceTo(cam);
      const t = a.lod.step(a.rig, d, dt);
      if (t > 0) a.animate(t);
    }
    for (const f of this.liveFlocks.values()) f.update(dt);
  }
}
