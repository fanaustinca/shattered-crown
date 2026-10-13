// The player: kinematic character controller with walking, sprinting, crouching, jumping, swimming,
// riding moving platforms (carts, ships), localized injuries, stamina, hunger and breath.
import * as THREE from 'three';
import { RAPIER, groups, G_CHAR, G_SENSOR, G_HELD, ALL, type Physics, v3 } from '../physics/physics';
import type { Input } from '../core/input';
import type { World } from '../world/world';
import { settings } from '../core/settings';
import { seaHeight, waterUniforms } from '../render/water';

export type Limb = 'head' | 'torso' | 'larm' | 'rarm' | 'lleg' | 'rleg';
export const LIMBS: Limb[] = ['head', 'torso', 'larm', 'rarm', 'lleg', 'rleg'];

export interface Seat {
  /** world transform of the seat each frame */
  getTransform(pos: THREE.Vector3, quat: THREE.Quaternion): void;
  /** called each frame while seated, with input */
  drive?(input: Input, dt: number, player: Player): void;
  leave(player: Player): void;
  label: string;
  /** camera eye offset above the seat */
  eye?: number;
  freeLook?: boolean;
}

const RADIUS = 0.3, HALF = 0.6, STAND_EYE = 1.66, CROUCH_EYE = 1.05;

export class Player {
  body!: RAPIER.RigidBody;
  collider!: RAPIER.Collider;
  kcc!: RAPIER.KinematicCharacterController;
  pos = new THREE.Vector3();           // feet
  vel = new THREE.Vector3();           // own velocity (not including platform)
  yaw = 0; pitch = 0;
  grounded = false;
  crouch = false;
  mode: 'walk' | 'swim' | 'seat' | 'dead' = 'walk';
  seat: Seat | null = null;
  platform: RAPIER.RigidBody | null = null;
  platformVel = new THREE.Vector3();
  stamina = 100; maxStamina = 100;
  health: Record<Limb, number> = { head: 100, torso: 100, larm: 100, rarm: 100, lleg: 100, rleg: 100 };
  bleeding = 0;          // hp per second
  satiety = 80;          // hunger (0 starving)
  breath = 30;
  sick = 0;
  carryWeight = 0; maxCarry = 45;
  eyeHeight = STAND_EYE;
  bob = 0; bobAmt = 0; landDip = 0;
  thirdPerson = settings.thirdPerson;
  camDist = 3.2;
  fallStartY = 0;
  inWater = 0;           // depth of water at the feet
  underwater = false;
  waterY = -1e9;
  sprinting = false;
  noise = 0;             // how loud the player is (for guards)
  wanted = 0;
  onHurt: ((limb: Limb, dmg: number, src: string) => void) | null = null;
  onDeath: (() => void) | null = null;
  footstep: ((surface: string, strength: number) => void) | null = null;
  private stepPhase = 0;
  private tmpQ = new THREE.Quaternion();

  constructor(private phys: Physics, private world: World, private input: Input) {}

  spawn(x: number, z: number, yaw = 0) {
    const y = this.world.heightAt(x, z) + 0.05;
    const R = RAPIER;
    if (!this.body) {
      this.body = this.phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF + RADIUS, z));
      this.collider = this.phys.world.createCollider(
        R.ColliderDesc.capsule(HALF, RADIUS).setCollisionGroups(groups(G_CHAR, ALL & ~G_SENSOR & ~G_HELD)).setFriction(0.0), this.body);
      this.phys.owners.set(this.collider.handle, { kind: 'player', player: this });
      this.kcc = this.phys.world.createCharacterController(0.03);
      this.kcc.setUp({ x: 0, y: 1, z: 0 });
      this.kcc.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
      this.kcc.setMinSlopeSlideAngle((55 * Math.PI) / 180);
      this.kcc.enableAutostep(0.42, 0.18, true);
      this.kcc.enableSnapToGround(0.35);
      this.kcc.setApplyImpulsesToDynamicBodies(true);
      this.kcc.setCharacterMass(75);
    }
    this.body.setTranslation({ x, y: y + HALF + RADIUS, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + HALF + RADIUS, z });
    this.phys.world.propagateModifiedBodyPositionsToColliders();
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.mode = 'walk';
    this.fallStartY = y;
  }

  get alive() { return this.mode !== 'dead'; }
  get totalHealth() { return (this.health.head * 1.5 + this.health.torso * 2 + this.health.larm + this.health.rarm + this.health.lleg + this.health.rleg) / 7.5; }
  /** 0..1 how badly the legs are hurt (drives the limp) */
  get limp() { return Math.max(0, 1 - Math.min(this.health.lleg, this.health.rleg) / 100); }
  /** arm injuries make aiming and bow draw weaker */
  get armSteadiness() { return Math.min(this.health.larm, this.health.rarm) / 100; }
  eyePos(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z); }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  /** dev: no damage */
  god = false;
  hurt(limb: Limb, dmg: number, src = 'hit', bleed = 0) {
    if (!this.alive || this.god) return;
    this.health[limb] = Math.max(0, this.health[limb] - dmg);
    this.bleeding += bleed;
    this.onHurt?.(limb, dmg, src);
    if (this.health.head <= 0 || this.health.torso <= 0 || this.totalHealth <= 8) this.die();
  }
  heal(amount: number) {
    for (const l of LIMBS) this.health[l] = Math.min(100, this.health[l] + amount);
  }
  die() {
    if (this.mode === 'dead') return;
    if (this.seat) { const s = this.seat; this.seat = null; s.leave(this); }
    this.mode = 'dead';
    this.onDeath?.();
  }

  sitIn(seat: Seat) {
    this.seat = seat; this.mode = 'seat';
    this.collider.setEnabled(false);
  }
  standUp(at?: THREE.Vector3) {
    if (!this.seat) return;
    const s = this.seat;
    this.seat = null;
    this.mode = 'walk';
    this.collider.setEnabled(true);
    const p = at ?? this.pos.clone().add(new THREE.Vector3(Math.cos(this.yaw) * 1.4, 0.3, -Math.sin(this.yaw) * 1.4));
    this.body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS + 0.05, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF + RADIUS + 0.05, z: p.z });
    this.phys.world.propagateModifiedBodyPositionsToColliders();
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    s.leave(this);
  }

  /** Mouse look (called every frame). */
  look(dt: number) {
    const m = this.input.mouse;
    if (!this.input.uiOpen) {
      const s = 0.0022 * settings.sensitivity;
      this.yaw -= m.dx * s;
      this.pitch -= m.dy * s * (settings.invertY ? -1 : 1);
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    }
    void dt;
  }

  /** Fixed-step movement. */
  step(dt: number) {
    if (this.mode === 'dead') return;
    if (this.mode === 'seat' && this.seat) {
      this.seat.drive?.(this.input, dt, this);
      if (!this.seat) return;
      this.seat.getTransform(this.pos, this.tmpQ);
      this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + HALF + RADIUS, z: this.pos.z });
      this.body.setTranslation({ x: this.pos.x, y: this.pos.y + HALF + RADIUS, z: this.pos.z }, false);
      this.vitals(dt, 0);
      return;
    }
    const inp = this.input;
    const fwd = (inp.key('KeyW') ? 1 : 0) - (inp.key('KeyS') ? 1 : 0);
    const str = (inp.key('KeyD') ? 1 : 0) - (inp.key('KeyA') ? 1 : 0);
    const wantSprint = inp.key('ShiftLeft') || inp.key('ShiftRight');
    if (inp.hit('KeyC') || inp.hit('ControlLeft')) this.crouch = !this.crouch;

    // water
    const t = this.collider.translation();
    const feet = t.y - HALF - RADIUS;
    let wl = this.world.waterLevelAt(t.x, t.z);
    if (wl === 0) wl = seaHeight(t.x, t.z, performance.now() / 1000, waterUniforms.uWaveAmp.value) * 0.6;
    this.waterY = wl;
    this.inWater = Math.max(0, wl - feet);
    const enc = Math.max(0, Math.min(1, this.carryWeight / this.maxCarry));
    const limp = this.limp;
    const cf = Math.cos(this.yaw), sf = Math.sin(this.yaw);
    // desired planar velocity in world space (yaw 0 faces -z)
    const dir = new THREE.Vector3(str * cf - fwd * sf, 0, -str * sf - fwd * cf);
    if (dir.lengthSq() > 1) dir.normalize();

    if (this.mode === 'walk' && this.inWater > 1.3) { this.mode = 'swim'; this.crouch = false; }
    if (this.mode === 'swim' && this.inWater < 1.1) this.mode = 'walk';

    let desired = new THREE.Vector3();
    if (this.mode === 'swim') {
      const sp = (wantSprint && this.stamina > 5 ? 2.6 : 1.5) * (1 - enc * 0.6) * (1 - limp * 0.3);
      const look = this.forward();
      const sw = new THREE.Vector3(str * cf - fwd * sf, 0, -str * sf - fwd * cf);
      // swim toward where you look when moving forward
      sw.y = fwd > 0 ? look.y * fwd : 0;
      if (inp.key('Space')) sw.y += 1;
      if (inp.key('ControlLeft') || inp.key('KeyC')) sw.y -= 1;
      if (sw.lengthSq() > 1) sw.normalize();
      this.vel.lerp(sw.multiplyScalar(sp), 1 - Math.exp(-dt * 3));
      // buoyancy: float with the head at the surface unless diving
      const floatY = wl - 1.45;
      if (!inp.key('ControlLeft') && !inp.key('KeyC') && !(fwd > 0 && look.y < -0.3)) this.vel.y += (floatY - feet) * dt * 4;
      this.vel.y -= enc * 1.5 * dt; // heavy packs drag you down
      const cur = this.world.currentAt(t.x, t.z);
      desired.set(this.vel.x + cur[0] * 0.8, this.vel.y, this.vel.z + cur[1] * 0.8).multiplyScalar(dt);
      this.stamina = Math.max(0, this.stamina - dt * (wantSprint ? 9 : 2.5) * (1 + enc));
      if (this.stamina <= 0) this.vel.y -= 2 * dt;
      this.sprinting = false;
      this.noise = 0.3;
    } else {
      const canSprint = wantSprint && this.stamina > 1 && fwd > 0 && !this.crouch;
      this.sprinting = canSprint;
      let speed = this.crouch ? 1.5 : canSprint ? 6.4 : 3.1;
      speed *= (1 - enc * 0.55) * (1 - limp * 0.6) * (this.inWater > 0.5 ? 0.6 : 1);
      if (limp > 0.3) speed *= 0.85 + 0.15 * Math.abs(Math.sin(this.stepPhase)); // hobbling gait
      const target = dir.multiplyScalar(speed);
      const accel = this.grounded ? 12 : 2;
      this.vel.x += (target.x - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (target.z - this.vel.z) * Math.min(1, accel * dt);
      if (this.grounded) {
        this.vel.y = -1;
        if (inp.hit('Space') && this.stamina > 8 && limp < 0.8) {
          this.vel.y = 4.6 * (1 - enc * 0.4) * (1 - limp * 0.5);
          this.stamina -= 8;
          this.grounded = false;
          this.fallStartY = feet;
          // keep the platform's momentum when jumping off a moving cart
          this.vel.x += this.platformVel.x; this.vel.z += this.platformVel.z;
          this.platform = null; this.platformVel.set(0, 0, 0);
        }
      } else {
        this.vel.y -= 9.81 * dt;
      }
      if (canSprint && dir.lengthSq() > 0) this.stamina = Math.max(0, this.stamina - dt * 11 * (1 + enc));
      else this.stamina = Math.min(this.maxStamina, this.stamina + dt * (this.grounded ? 9 : 3) * (this.satiety > 15 ? 1 : 0.35));
      desired.copy(this.vel).multiplyScalar(dt);
      this.noise = dir.lengthSq() > 0 ? (this.crouch ? 0.15 : canSprint ? 1 : 0.45) : 0.05;
    }
    // ride the platform we stand on
    if (this.platform && this.grounded) {
      const pb = this.platform;
      if (this.phys.world.getRigidBody(pb.handle)) {
        const lv = pb.linvel(), av = pb.angvel(), com = pb.translation();
        const r = new THREE.Vector3(t.x - com.x, feet - com.y, t.z - com.z);
        const w = new THREE.Vector3(av.x, av.y, av.z);
        const pv = new THREE.Vector3(lv.x, lv.y, lv.z).add(w.clone().cross(r));
        this.platformVel.copy(pv);
        desired.addScaledVector(pv, dt);
        this.yaw += av.y * dt;
      } else { this.platform = null; this.platformVel.set(0, 0, 0); }
    }
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G_CHAR, ALL & ~G_SENSOR & ~G_HELD));
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.mode === 'walk' && this.kcc.computedGrounded();
    // find the ground collider for platform riding
    this.platform = null;
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) {
      const c = this.kcc.computedCollision(i);
      if (!c || !c.collider) continue;
      if (c.normal1.y > 0.55 || c.normal2.y < -0.55) {
        const b = c.collider.parent();
        if (b && !b.isFixed()) this.platform = b;
      }
    }
    if (!this.platform) this.platformVel.set(0, 0, 0);
    const nt = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    // never sink below the terrain (safety net if a collider is skipped)
    const gy = this.world.heightAt(nt.x, nt.z) + HALF + RADIUS - 0.05;
    if (nt.y < gy && this.mode === 'walk') nt.y = gy;
    this.body.setNextKinematicTranslation(nt);
    this.pos.set(nt.x, nt.y - HALF - RADIUS, nt.z);
    // landing
    if (!wasGrounded && this.grounded) {
      const fall = this.fallStartY - this.pos.y;
      this.landDip = Math.min(0.25, fall * 0.04);
      if (fall > 4.5) {
        const dmg = (fall - 4.5) * 14;
        this.hurt(Math.random() < 0.5 ? 'lleg' : 'rleg', dmg, 'fall');
        if (fall > 9) this.hurt('torso', (fall - 9) * 10, 'fall');
      }
      this.footstep?.(this.surface(), Math.min(1, fall * 0.2 + 0.4));
    }
    if (this.grounded || this.mode === 'swim') this.fallStartY = this.pos.y;
    else this.fallStartY = Math.max(this.fallStartY, this.pos.y);
    // footsteps + head bob
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && planar > 0.3) {
      const prev = this.stepPhase;
      this.stepPhase += dt * planar * 1.9;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) this.footstep?.(this.surface(), Math.min(1, planar / 6));
    }
    this.bobAmt += ((this.grounded ? Math.min(1, planar / 5) : 0) - this.bobAmt) * Math.min(1, dt * 8);
    this.eyeHeight += ((this.crouch ? CROUCH_EYE : this.mode === 'swim' ? 1.45 : STAND_EYE) - this.eyeHeight) * Math.min(1, dt * 10);
    this.landDip *= Math.exp(-dt * 6);
    this.underwater = this.pos.y + this.eyeHeight < wl - 0.05;
    this.vitals(dt, planar);
  }

  surface(): string {
    const w = this.world, x = this.pos.x, z = this.pos.z;
    if (this.platform) return 'wood';
    if (this.inWater > 0.15) return 'water';
    if (w.ctrl(w.ctrlA, 1, x, z) > 0.5) return 'stone';
    if (w.ctrl(w.ctrlB, 2, x, z) > 0.4) return 'mud';
    if (w.heightAt(x, z) > 320) return 'snow';
    if (w.roadAt(x, z) > 0.4) return 'gravel';
    if (w.slopeAt(x, z) > 0.3) return 'stone';
    return 'grass';
  }

  private vitals(dt: number, planar: number) {
    // hunger drains faster when exerting; bleeding drains health until bandaged
    this.satiety = Math.max(0, this.satiety - dt * (0.012 + planar * 0.004 + (this.sprinting ? 0.02 : 0)));
    if (this.satiety <= 0) this.hurt('torso', dt * 0.4, 'starvation');
    if (this.bleeding > 0) {
      this.hurt('torso', this.bleeding * dt, 'bleeding');
      this.bleeding = Math.max(0, this.bleeding - dt * 0.01);
    }
    if (this.sick > 0) { this.sick = Math.max(0, this.sick - dt * 0.02); this.stamina = Math.max(0, this.stamina - dt * this.sick * 3); }
    if (this.underwater) {
      this.breath -= dt;
      if (this.breath < 0) this.hurt('torso', dt * 8, 'drowning');
    } else this.breath = Math.min(30, this.breath + dt * 6);
    // slow natural regeneration when fed and not bleeding
    if (this.satiety > 40 && this.bleeding <= 0.01) for (const l of LIMBS) this.health[l] = Math.min(100, this.health[l] + dt * 0.08);
  }

  /** Place the camera (first or third person). */
  updateCamera(cam: THREE.PerspectiveCamera, dt: number) {
    if (this.input.hit('KeyV')) this.thirdPerson = !this.thirdPerson;
    const eye = new THREE.Vector3();
    if (this.mode === 'seat' && this.seat) {
      const q = new THREE.Quaternion();
      this.seat.getTransform(eye, q);
      eye.y += this.seat.eye ?? 1.2;
    } else {
      eye.set(this.pos.x, this.pos.y + this.eyeHeight - this.landDip, this.pos.z);
      // head bob, stronger and lopsided with a limp
      const b = this.bobAmt * (this.thirdPerson ? 0 : 1);
      eye.y += Math.sin(this.stepPhase * 2) * 0.035 * b + this.limp * Math.max(0, Math.sin(this.stepPhase)) * -0.06 * b;
      eye.x += Math.cos(this.yaw) * Math.sin(this.stepPhase) * 0.02 * b;
      eye.z -= Math.sin(this.yaw) * Math.sin(this.stepPhase) * 0.02 * b;
    }
    const roll = this.mode === 'walk' ? -Math.sin(this.stepPhase) * 0.004 * this.bobAmt : 0;
    cam.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
    if (this.thirdPerson || this.mode === 'dead') {
      const back = this.forward().multiplyScalar(-1);
      const want = this.mode === 'dead' ? 4 : this.camDist;
      let d = want;
      const hit = this.phys.ray(eye, back, want + 0.3, groups(ALL, ALL & ~G_CHAR & ~G_HELD), this.collider);
      if (hit) d = Math.max(0.4, hit.toi - 0.3);
      cam.position.copy(eye).addScaledVector(back, d);
      cam.position.addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), 0.45);
    } else {
      cam.position.copy(eye);
    }
    const fovT = settings.fov + (this.sprinting ? 6 : 0);
    if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov += (fovT - cam.fov) * Math.min(1, dt * 6); cam.updateProjectionMatrix(); }
  }

  get bodyPos() { return v3(this.collider.translation()); }
}
