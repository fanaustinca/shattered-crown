// Procedural animation: foot-planting IK gaits for quadrupeds and hoppers, a biped walker with
// pose overlays (carry, eat, swing, sit, ride, sleep), and bird flight/walking.
import * as THREE from 'three';
import type { Rig } from './rig';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

export type Ground = (x: number, z: number) => number;

/** Rotate `bone` (rest = identity local) so that its rest direction restDir (model space) points along worldDir. */
function aimBone(bone: THREE.Bone, restDir: THREE.Vector3, worldDir: THREE.Vector3, modelQ: THREE.Quaternion) {
  bone.parent!.getWorldQuaternion(_qp);
  // current world direction of the rest axis if the bone had identity local rotation
  _v.copy(restDir).applyQuaternion(modelQ).normalize();
  // the bone's world rotation with identity local = parent world rotation; its rest dir in world = qp * (modelQ^-1 * ... ) simplified:
  // all rest frames are aligned with the model frame, so world rest dir = qp * restDir
  _v.copy(restDir).applyQuaternion(_qp).normalize();
  _q.setFromUnitVectors(_v, _v2.copy(worldDir).normalize());
  // world target = _q * qp  -> local = qp^-1 * _q * qp
  _q2.copy(_qp).invert().multiply(_q).multiply(_qp);
  bone.quaternion.copy(_q2);
  bone.updateMatrixWorld(true);
}

/** Two-bone IK: places joint between bones a and b so the chain end reaches target. */
function solve2(aPos: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outJoint: THREE.Vector3) {
  const d = _v3.copy(target).sub(aPos);
  let dist = d.length();
  dist = Math.min(dist, (l1 + l2) * 0.999);
  dist = Math.max(dist, Math.abs(l1 - l2) * 1.001 + 1e-4);
  d.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // bend direction: pole projected perpendicular to the chain
  const bend = pole.clone().sub(d.clone().multiplyScalar(pole.dot(d)));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
  bend.normalize();
  outJoint.copy(aPos).addScaledVector(d, l1 * cosA).addScaledVector(bend, l1 * sinA);
}

interface LegState { planted: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; swinging: boolean; l1: number; l2: number; l3: number; pole: THREE.Vector3; restFoot: THREE.Vector3 }

export interface MoveState {
  pos: THREE.Vector3; yaw: number; speed: number; turn: number;
  vel: THREE.Vector3;
  action?: 'idle' | 'graze' | 'eat' | 'sit' | 'sleep' | 'dead' | 'rear' | 'flee';
  look?: THREE.Vector3 | null;
  ridden?: boolean;
}

export class QuadAnimator {
  legs: LegState[] = [];
  phase = 0;
  t = 0;
  bodyPitch = 0; bodyRoll = 0; bodyH = 0;
  graze = 0; sleep = 0;
  tailV = 0; tailA = 0; lastYaw = 0;
  earT = [0, 0]; earA = [0, 0];
  restRoot: THREE.Vector3;
  hop: boolean;
  scale: number;
  private modelQ = new THREE.Quaternion();
  constructor(public rig: Rig, public ground: Ground) {
    const a = rig.anatomy;
    this.hop = a.kind === 'hopper';
    this.restRoot = rig.rest[0].clone();
    this.scale = rig.rest[a.legs![0].upper].y;
    for (const L of a.legs!) {
      const A = rig.rest[L.upper], B = rig.rest[L.lower], C = rig.rest[L.cannon], F = rig.rest[L.foot];
      const mid = A.clone().add(C).multiplyScalar(0.5);
      this.legs.push({
        planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), swinging: false,
        l1: A.distanceTo(B), l2: B.distanceTo(C), l3: C.distanceTo(F), pole: L.pole ? new THREE.Vector3(...L.pole) : B.clone().sub(mid).normalize(), restFoot: F.clone(),
      });
    }
    this.initFeet = true;
  }
  initFeet = true;

  /** Gait table (speed normalised by leg height). Offsets are where each leg's stance begins in the stride,
   *  legs ordered FL, FR, HL, HR. Body motion per gait: vertical bob, rocking pitch (nose up > 0) and the
   *  neck pump, each as amplitude + phase (+ cycles per stride for the bob). */
  private static GAITS = [
    // walk: four-beat lateral sequence HL FL HR FR; the head nods down as each fore foot lands
    { name: 'walk', s0: 0, off: [0.25, 0.75, 0.0, 0.5], duty: 0.66, f0: 0.55, fk: 0.2, bob: 0.018, bobN: 2, bobPh: 0.25, pitch: 0.012, pitchPh: 0.25, neck: 0.07, neckN: 2, neckPh: 0.3, neckBase: 0, headBase: 0, liftF: 0.12, liftH: 0.09, tail: 0 },
    // trot: diagonal pairs, a springy bounce twice per stride, head steady
    { name: 'trot', s0: 2.6, off: [0.0, 0.5, 0.5, 0.0], duty: 0.45, f0: 1.1, fk: 0.08, bob: 0.04, bobN: 2, bobPh: 0.32, pitch: 0.01, pitchPh: 0, neck: 0.02, neckN: 2, neckPh: 0.1, neckBase: 0.05, headBase: -0.02, liftF: 0.2, liftH: 0.14, tail: -0.25 },
    // canter (right lead): HL, then HR+FL together, then FR; the rocking-horse motion
    { name: 'canter', s0: 5.6, off: [0.3, 0.55, 0.0, 0.3], duty: 0.4, f0: 1.35, fk: 0.05, bob: 0.06, bobN: 1, bobPh: 0.88, pitch: 0.075, pitchPh: 0.12, neck: 0.11, neckN: 1, neckPh: 0.5, neckBase: 0.12, headBase: -0.06, liftF: 0.3, liftH: 0.18, tail: -0.45 },
    // gallop (transverse, right lead): HL HR FL FR then a moment of suspension with every leg gathered
    { name: 'gallop', s0: 9.6, off: [0.36, 0.46, 0.0, 0.1], duty: 0.27, f0: 1.75, fk: 0.04, bob: 0.085, bobN: 1, bobPh: 0.86, pitch: 0.1, pitchPh: 0.16, neck: 0.16, neckN: 1, neckPh: 0.5, neckBase: 0.26, headBase: -0.16, liftF: 0.42, liftH: 0.22, tail: -0.6 },
  ];
  private gaitOff = [0.25, 0.75, 0.0, 0.5];
  private gaitName = 'walk';
  private gait(speed: number) {
    const s = speed / Math.max(0.2, this.scale);
    if (this.hop) return { off: [0.12, 0.12, 0, 0], duty: 0.45, freq: 2.2 + speed * 0.8, bob: 0.25, bobN: 1, bobPh: 0.5, pitch: 0, pitchPh: 0, neck: 0, neckN: 1, neckPh: 0, neckBase: 0, headBase: 0, liftF: 0.15, liftH: 0.15, tail: 0, name: 'hop', w: 0 };
    const G = QuadAnimator.GAITS;
    let i = 0;
    while (i < G.length - 1 && s > G[i + 1].s0) i++;
    // blend into the next gait across a short window below its threshold
    const a = G[i], b = G[Math.min(G.length - 1, i + 1)];
    const w = b === a ? 0 : THREE.MathUtils.smoothstep(s, b.s0 - 0.7, b.s0);
    const L = (x: number, y: number) => x + (y - x) * w;
    const fa = a.f0 + a.fk * s, fb = b.f0 + b.fk * s;
    return {
      name: w > 0.5 ? b.name : a.name, w, off: a.off.map((o, k) => { let d = b.off[k] - o; d -= Math.round(d); return (o + d * w + 1) % 1; }),
      duty: L(a.duty, b.duty), freq: L(fa, fb), bob: L(a.bob, b.bob), bobN: w > 0.5 ? b.bobN : a.bobN, bobPh: L(a.bobPh, b.bobPh),
      pitch: L(a.pitch, b.pitch), pitchPh: L(a.pitchPh, b.pitchPh), neck: L(a.neck, b.neck), neckN: w > 0.5 ? b.neckN : a.neckN, neckPh: L(a.neckPh, b.neckPh),
      neckBase: L(a.neckBase, b.neckBase), headBase: L(a.headBase, b.headBase), liftF: L(a.liftF, b.liftF), liftH: L(a.liftH, b.liftH), tail: L(a.tail, b.tail),
    };
  }
  /** smoothed per-gait body motion, so starting/stopping and gait changes ease in */
  private motion = { bob: 0, pitch: 0, neck: 0, neckBase: 0, headBase: 0, tail: 0 };
  /** the body's pitch and vertical bob this frame (riders feel them) */
  rock = { pitch: 0, bob: 0, roll: 0 };

  update(dt: number, st: MoveState) {
    const rig = this.rig, root = rig.root;
    this.t += dt;
    const speed = st.speed;
    const g = this.gait(Math.abs(speed));
    const moving = Math.abs(speed) > 0.05;
    // leg offsets ease toward the gait's (circularly), so a change of gait never pops the legs
    for (let k = 0; k < 4; k++) { let d = g.off[k] - this.gaitOff[k]; d -= Math.round(d); this.gaitOff[k] = (this.gaitOff[k] + d * Math.min(1, dt * 4) + 1) % 1; }
    this.gaitName = g.name;
    if (moving) this.phase = (this.phase + dt * g.freq * Math.sign(speed)  + 1) % 1;
    const wantGraze = st.action === 'graze' || st.action === 'eat' ? 1 : 0;
    this.graze += (wantGraze - this.graze) * Math.min(1, dt * 2);
    const wantSleep = st.action === 'sleep' || st.action === 'dead' ? 1 : 0;
    this.sleep += (wantSleep - this.sleep) * Math.min(1, dt * 1.2);
    const mv = this.motion, ease = Math.min(1, dt * 3), on = moving ? 1 : 0;
    mv.bob += (g.bob * on - mv.bob) * ease; mv.pitch += (g.pitch * on - mv.pitch) * ease; mv.neck += (g.neck * on - mv.neck) * ease;
    mv.neckBase += (g.neckBase * on - mv.neckBase) * ease; mv.headBase += (g.headBase * on - mv.headBase) * ease; mv.tail += (g.tail * on - mv.tail) * ease;
    const TAU = Math.PI * 2, ph = this.phase;

    // body placement: average the ground under the four hips, pitch to the slope
    const fy = this.ground(st.pos.x + Math.sin(st.yaw) * this.scale * 0.6, st.pos.z + Math.cos(st.yaw) * this.scale * 0.6);
    const by = this.ground(st.pos.x - Math.sin(st.yaw) * this.scale * 0.6, st.pos.z - Math.cos(st.yaw) * this.scale * 0.6);
    const pitch = Math.atan2(fy - by, this.scale * 1.2);
    this.bodyPitch += (pitch - this.bodyPitch) * Math.min(1, dt * 6);
    const turnRate = st.turn;
    // lean into turns like a running animal does (more at speed)
    this.bodyRoll += ((-turnRate * Math.abs(speed) * 0.035) - this.bodyRoll) * Math.min(1, dt * 4);
    // the rocking of the gait: rises in suspension, sinks as the fore legs take the weight; nose up while
    // the hind legs drive, down as the fore legs land
    const bob = (Math.cos(TAU * (ph * g.bobN - g.bobPh)) * 0.5 - 0.5) * mv.bob * this.scale * (g.bobN === 2 ? 1 : 1.4);
    const rockP = Math.cos(TAU * (ph - g.pitchPh)) * mv.pitch;
    this.rock.pitch = rockP; this.rock.bob = bob; this.rock.roll = this.bodyRoll;
    const breathe = Math.sin(this.t * (moving ? 3.2 : 1.6)) * (moving ? 0.006 : 0.004) * this.scale;
    const lie = this.sleep * this.scale * 0.55;
    root.position.set(st.pos.x, (fy + by) / 2 + bob + breathe - lie, st.pos.z);
    root.rotation.set(0, st.yaw, 0);
    root.rotateX(-(this.bodyPitch + rockP));
    root.rotateZ(this.bodyRoll);
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(this.modelQ);

    // reset all bone rotations (rest pose) before applying this frame's pose
    for (const b of rig.bones) b.quaternion.identity();
    const B = rig.byName;
    // spine: bend into turns; in canter/gallop the back rounds as the hind legs come under and lengthens
    // as they drive
    const flex = (g.name === 'gallop' || g.name === 'canter' || g.name === 'hop') ? Math.sin(TAU * (ph - 0.1)) * (g.name === 'canter' ? 0.05 : 0.09) * on : 0;
    B.spine.quaternion.setFromEuler(new THREE.Euler(flex, turnRate * 0.12, 0));
    B.chest.quaternion.setFromEuler(new THREE.Euler(-flex * 0.6, turnRate * 0.12, 0));
    // neck & head: the neck pumps with the stride (down as the fore legs land), partly cancelling the body's
    // rock so the eyes stay steadier than the body; at speed the neck stretches out and the nose comes forward
    const pump = Math.cos(TAU * (ph * g.neckN - g.neckPh)) * mv.neck;
    const steady = rockP * 0.55;
    const grazeDown = this.graze * (rig.anatomy.id === 'pig' ? 0.5 : 1.0);
    let lookYaw = 0, lookPitch = 0;
    if (st.look && !st.ridden) {
      _v.copy(st.look).sub(st.pos);
      lookYaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z) - st.yaw, -1, 1);
      lookYaw = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw));
      lookPitch = THREE.MathUtils.clamp(Math.atan2(_v.y - 1, Math.hypot(_v.x, _v.z)), -0.4, 0.4);
    }
    // a ridden horse looks where it is going (a little into turns)
    if (st.ridden) lookYaw = THREE.MathUtils.clamp(turnRate * 0.25, -0.4, 0.4);
    const idleLook = Math.sin(this.t * 0.31) * 0.25 * (moving ? 0.1 : 1) * (1 - this.graze) * (st.ridden ? 0.2 : 1);
    if (B.neck1) {
      B.neck1.quaternion.setFromEuler(new THREE.Euler(pump * 0.6 + steady * 0.6 + mv.neckBase + grazeDown * 0.75 - this.sleep * 0.3, (lookYaw + idleLook) * 0.5, 0));
      B.neck2.quaternion.setFromEuler(new THREE.Euler(pump * 0.4 + steady * 0.4 + mv.neckBase * 0.4 + grazeDown * 0.55 - lookPitch * 0.5, (lookYaw + idleLook) * 0.4, 0));
      B.head.quaternion.setFromEuler(new THREE.Euler(-pump * 0.35 + mv.headBase + grazeDown * 0.2 - lookPitch * 0.5, (lookYaw + idleLook) * 0.2, 0));
      // chewing while grazing; snorting breath at speed
      if (B.jaw) B.jaw.quaternion.setFromEuler(new THREE.Euler(this.graze * Math.max(0, Math.sin(this.t * 7)) * 0.12 + (g.name === 'gallop' ? Math.max(0, Math.sin(TAU * ph)) * 0.05 : 0), 0, 0));
    } else if (B.head) {
      // bunny: nose twitch, sniffing
      B.head.quaternion.setFromEuler(new THREE.Euler(grazeDown * 0.5 + Math.sin(this.t * 13) * 0.02, lookYaw * 0.6 + idleLook, 0));
    }
    // ears: flick occasionally, swivel toward sounds
    for (let e = 0; e < 2; e++) {
      this.earT[e] -= dt;
      if (this.earT[e] <= 0) { this.earT[e] = 1 + Math.random() * 5; this.earA[e] = 0.5; }
      this.earA[e] *= Math.exp(-dt * 6);
      const bone = e === 0 ? B.earL : B.earR;
      const fwdEar = THREE.MathUtils.clamp(Math.abs(speed) / 8, 0, 1) * -0.25;
      if (bone) bone.quaternion.setFromEuler(new THREE.Euler(-0.1 + fwdEar + Math.sin(this.t * 40) * this.earA[e] * 0.3 + (st.action === 'flee' ? 0.6 : 0), 0, (e === 0 ? 1 : -1) * (this.earA[e] * 0.4 + lookYaw * 0.3)));
    }
    // tail: spring that lags body turns, swishes at flies
    const yawRate = (st.yaw - this.lastYaw) / Math.max(dt, 1e-3);
    this.lastYaw = st.yaw;
    const swish = Math.sin(this.t * 2.3) * 0.25 * (1 - Math.min(1, speed)) + Math.sin(this.t * 9) * 0.1 * (Math.sin(this.t * 0.4) > 0.7 ? 1 : 0);
    const tailTarget = -THREE.MathUtils.clamp(yawRate, -3, 3) * 0.15 + swish;
    this.tailV += (tailTarget - this.tailA) * dt * 40 - this.tailV * dt * 6;
    this.tailA += this.tailV * dt;
    // at speed the tail streams out behind, rippling with the stride; the hair end trails lower
    const lift = mv.tail;
    const wave = Math.sin(TAU * (ph - 0.2)) * Math.abs(lift) * 0.35;
    if (B.tail1) B.tail1.quaternion.setFromEuler(new THREE.Euler(lift + wave * 0.3 + (rig.anatomy.id === 'pig' ? -1.2 : 0), this.tailA, 0));
    if (B.tail2) B.tail2.quaternion.setFromEuler(new THREE.Euler(lift * 0.25 - wave * 0.6, this.tailA * 1.2, 0));
    if (B.tail3) B.tail3.quaternion.setFromEuler(new THREE.Euler(-lift * 0.35 + wave, this.tailA * 1.4, 0));
    root.updateMatrixWorld(true);

    // legs
    const legsDef = rig.anatomy.legs!;
    const cosY = Math.cos(st.yaw), sinY = Math.sin(st.yaw);
    for (let i = 0; i < legsDef.length; i++) {
      const L = legsDef[i], S = this.legs[i];
      const upper = rig.bones[L.upper], lower = rig.bones[L.lower], cannon = rig.bones[L.cannon], foot = rig.bones[L.foot];
      const A = upper.getWorldPosition(new THREE.Vector3());
      // where this foot would rest under the body
      const rf = S.restFoot;
      const home = new THREE.Vector3(st.pos.x + rf.x * cosY + rf.z * sinY, 0, st.pos.z - rf.x * sinY + rf.z * cosY);
      home.y = this.ground(home.x, home.z);
      if (this.initFeet) { S.planted.copy(home); S.to.copy(home); }
      const lp = moving ? (this.phase - this.gaitOff[i] + 1) % 1 : 1;
      const swing = moving && lp > g.duty;
      let F: THREE.Vector3;
      if (swing) {
        const sp = (lp - g.duty) / (1 - g.duty);
        if (!S.swinging) { S.swinging = true; S.from.copy(S.planted); }
        // track the landing spot as the body moves: half a stance-length ahead of home at touchdown
        const stride = speed / g.freq * g.duty * 0.5;
        const remain = (1 - sp) * (1 - g.duty) / g.freq * speed;
        S.to.set(home.x + Math.sin(st.yaw) * (stride + remain * 0), 0, home.z + Math.cos(st.yaw) * (stride + remain * 0));
        S.to.y = this.ground(S.to.x, S.to.z);
        const fastG = THREE.MathUtils.clamp((Math.abs(speed) / this.scale - 3) / 6, 0, 1);
        // fore feet snap up and tuck, then reach out ahead before landing; hind feet sweep forward lower
        const e = L.front ? 1 - Math.pow(1 - sp, 2.2) : 1 - Math.pow(1 - sp, 1.6 + fastG * 0.8);
        F = S.from.clone().lerp(S.to, e);
        // at speed the hind leg folds up and comes under the body rather than trailing out behind
        if (!L.front) { const tuck = fastG * 0.4 * Math.sin(Math.min(1, sp * 1.5) * Math.PI); F.x += (home.x - F.x) * tuck; F.z += (home.z - F.z) * tuck; }
        const arc = L.front ? Math.pow(Math.sin(Math.min(1, sp * 1.15) * Math.PI), 0.7) : Math.sin(sp * Math.PI);
        F.y += arc * (L.front ? g.liftF : g.liftH) * this.scale * (this.hop ? 1 : 1);
      } else {
        if (S.swinging) { S.swinging = false; S.planted.copy(S.to); }
        if (!moving) {
          // stand: drift feet back home if far
          if (S.planted.distanceTo(home) > 0.25 * this.scale) S.planted.lerp(home, Math.min(1, dt * 3));
          S.planted.y = this.ground(S.planted.x, S.planted.z);
        }
        F = S.planted.clone();
      }
      if (this.sleep > 0.01) F.lerp(home.clone().setY(home.y + this.scale * 0.05), this.sleep);
      // fetlock point above the hoof; folds back during swing
      const fold = swing ? Math.sin(((lp - g.duty) / (1 - g.duty)) * Math.PI) : 0;
      // fore fetlocks fold right up under the forearm in the fast gaits; hind ones flex back less
      const fast = THREE.MathUtils.clamp((Math.abs(speed) / this.scale - 2) / 6, 0, 1);
      const back = new THREE.Vector3(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)).multiplyScalar(L.front ? fold * (0.9 + fast * 1.3) : fold * (0.4 + fast * 0.5));
      const P = F.clone().addScaledVector(_v.set(0, 1, 0).add(back).normalize(), S.l3);
      const pole = S.pole.clone().applyQuaternion(this.modelQ);
      if (this.sleep > 0.01) pole.lerp(new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw)).multiplyScalar(L.front ? -1 : 1), this.sleep);
      const J = new THREE.Vector3();
      solve2(A, P, S.l1, S.l2, pole, J);
      aimBone(upper, rig.rest[L.lower].clone().sub(rig.rest[L.upper]), J.clone().sub(A), this.modelQ);
      aimBone(lower, rig.rest[L.cannon].clone().sub(rig.rest[L.lower]), P.clone().sub(J), this.modelQ);
      aimBone(cannon, rig.rest[L.foot].clone().sub(rig.rest[L.cannon]), F.clone().sub(P), this.modelQ);
      // hoof flat on the ground
      foot.parent!.getWorldQuaternion(_qp);
      foot.quaternion.copy(_qp.invert().multiply(this.modelQ));
    }
    this.initFeet = false;
  }
}

/** Human walker: IK legs with heel-toe, counter-swinging arms, and pose overlays. */
export class BipedAnimator {
  phase = 0; t = 0;
  feet = [new THREE.Vector3(), new THREE.Vector3()];
  planted = [new THREE.Vector3(), new THREE.Vector3()];
  swinging = [false, false];
  from = [new THREE.Vector3(), new THREE.Vector3()];
  to = [new THREE.Vector3(), new THREE.Vector3()];
  l1: number; l2: number; footH: number;
  init = true;
  sit = 0; ride = 0; sleep = 0; carry = 0; eat = 0; dead = 0;
  swingT = -1; swingDir: 'left' | 'right' | 'over' | 'thrust' = 'right';
  block = 0;
  limp = 0;
  heightScale = 1;
  /** talking (gesturing hands, nodding); set by conversations */
  talking = 0;
  private modelQ = new THREE.Quaternion();
  /** springy arm angles: upper arm pitch/roll, elbow flex and their velocities, per side (L, R) */
  private arm = [0, 1].map(() => ({ ax: 0, az: 0, fx: -0.3, hx: 0, vax: 0, vaz: 0, vfx: 0, vhx: 0 }));
  /** idle fidgets: hands on hips, arms folded, scratching the head, looking about, rubbing hands */
  private fidget: 'none' | 'hips' | 'fold' | 'scratch' | 'look' | 'rub' | 'stretch' = 'none';
  private fidgetT = 4 + Math.random() * 10;
  private fidgetW = 0;
  private gestT = 0; private gest = [0, 0, 0];
  private seed = Math.random() * 100;
  constructor(public rig: Rig, public ground: Ground) {
    const r = rig.rest, B = rig.anatomy.bones;
    const iT = B.findIndex((b) => b.name === 'thighL'), iS = B.findIndex((b) => b.name === 'shinL'), iF = B.findIndex((b) => b.name === 'footL');
    this.l1 = r[iT].distanceTo(r[iS]); this.l2 = r[iS].distanceTo(r[iF]); this.footH = r[iF].y;
  }

  attack(dir: BipedAnimator['swingDir']) { this.swingT = 0; this.swingDir = dir; }

  update(dt: number, st: MoveState & { carry?: boolean; eating?: boolean; sitting?: boolean; riding?: boolean; blocking?: boolean; armed?: boolean }) {
    const rig = this.rig, root = rig.root, B = rig.byName;
    this.t += dt;
    const speed = st.speed;
    const moving = speed > 0.08;
    // gait cycle rate from a stride length that grows with speed (a walk ~0.9 cycles/s, a run ~1.7):
    // a high cadence with short steps reads as scurrying and hopping
    const strideLen = Math.min(3.6, 1.0 + speed * 0.42) * this.heightScale;
    const freq = moving ? Math.max(0.55, speed / strideLen) : 0;
    this.phase = (this.phase + dt * freq) % 1;
    const k = Math.min(1, dt * 6);
    this.sit += ((st.sitting ? 1 : 0) - this.sit) * k;
    this.ride += ((st.riding ? 1 : 0) - this.ride) * k;
    this.sleep += ((st.action === 'sleep' ? 1 : 0) - this.sleep) * k;
    this.dead += ((st.action === 'dead' ? 1 : 0) - this.dead) * Math.min(1, dt * 3);
    this.carry += ((st.carry ? 1 : 0) - this.carry) * k;
    this.eat += ((st.eating ? 1 : 0) - this.eat) * k;
    this.block += ((st.blocking ? 1 : 0) - this.block) * Math.min(1, dt * 10);
    const gy = this.ground(st.pos.x, st.pos.z);
    const run = Math.min(1, Math.max(0, (speed - 2.6) / 3));
    // walking vaults over the stance leg (highest at mid-stance, lowest in double support); running
    // is a bounce (lowest at mid-stance as the leg compresses, highest in the flight between steps)
    const duty0 = 0.6 - run * 0.32;
    const bob = moving ? Math.cos((this.phase - 0.3) * Math.PI * 4) * 0.018 * (1 - run) - Math.cos((this.phase - duty0 / 2) * Math.PI * 4) * 0.035 * run - run * 0.05 : 0;
    // and the pelvis shifts over whichever foot is bearing the weight
    const sway = moving ? Math.sin((this.phase - 0.05) * Math.PI * 2) * 0.028 * (1 - run * 0.7) : 0;
    const limpDrop = this.limp * Math.max(0, Math.sin(this.phase * Math.PI * 2)) * 0.06;
    root.position.set(st.pos.x, (st.ridden || st.riding ? st.pos.y : Math.max(gy, st.pos.y)) + bob - limpDrop - this.sit * 0.48 * (1 - this.ride) - this.sleep * 0.85 - this.dead * 0.85, st.pos.z);
    root.position.x += Math.cos(st.yaw) * sway; root.position.z -= Math.sin(st.yaw) * sway;
    root.rotation.set(0, st.yaw, 0);
    if (this.sleep > 0.01 || this.dead > 0.01) root.rotateX(-Math.PI / 2 * Math.max(this.sleep, this.dead));
    root.scale.setScalar(this.heightScale);
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(this.modelQ);
    for (const b of rig.bones) b.quaternion.identity();
    const E = (x: number, y: number, z: number) => _q.setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    // torso: lean forward when running, counter-rotate shoulders against hips; at rest the weight shifts slowly
    // from foot to foot and the chest rises with each breath
    const sw = Math.sin(this.phase * Math.PI * 2);
    const still = moving ? 0 : 1;
    const shift = Math.sin(this.t * 0.37 + this.seed) * 0.035 * still * (1 - this.sit);
    const breath = Math.sin(this.t * (moving ? 2.4 + run * 2 : 1.35) + this.seed);
    B.hips.quaternion.copy(E(0, sw * 0.09 * Math.min(1, speed), this.limp * sw * 0.06 + shift));
    B.spine.quaternion.copy(E(run * 0.26 + this.carry * -0.05 + breath * 0.008, -sw * 0.07 * Math.min(1, speed), -shift * 0.7));
    B.chest.quaternion.copy(E(run * 0.06 - breath * 0.012, -sw * 0.1 * Math.min(1, speed), -shift * 0.4));
    // idle fidgets (only standing about, hands free)
    const free = !moving && this.carry < 0.1 && this.eat < 0.1 && this.sit < 0.1 && this.ride < 0.1 && this.sleep < 0.1 && this.dead < 0.1 && !st.armed && this.block < 0.1 && this.swingT < 0;
    this.fidgetT -= dt;
    if (this.fidgetT <= 0) {
      if (this.fidget === 'none' && free && this.talking < 0.2) {
        const opts: BipedAnimator['fidget'][] = ['hips', 'fold', 'fold', 'scratch', 'look', 'look', 'rub', 'stretch'];
        this.fidget = opts[Math.floor(Math.random() * opts.length)];
        this.fidgetT = this.fidget === 'scratch' || this.fidget === 'stretch' ? 2.5 : 4 + Math.random() * 7;
      } else { this.fidget = 'none'; this.fidgetT = 5 + Math.random() * 12; }
    }
    if (!free) this.fidget = 'none';
    this.fidgetW += ((this.fidget !== 'none' ? 1 : 0) - this.fidgetW) * Math.min(1, dt * 3);
    // head look
    let ly = 0, lp = 0;
    if (st.look) {
      _v.copy(st.look).sub(st.pos);
      ly = Math.atan2(_v.x, _v.z) - st.yaw; ly = Math.atan2(Math.sin(ly), Math.cos(ly));
      ly = THREE.MathUtils.clamp(ly, -1.5, 1.5);
      lp = THREE.MathUtils.clamp(-Math.atan2(_v.y - 1.6, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
    } else if (this.fidget === 'look') { ly = Math.sin(this.t * 0.7 + this.seed) * 0.8 * this.fidgetW; lp = Math.sin(this.t * 0.45) * 0.15 * this.fidgetW; }
    // talking: little nods and head tilts with the phrasing
    const nod = this.talking * (Math.sin(this.t * 5.1 + this.seed) * 0.05 + Math.sin(this.t * 1.7) * 0.04);
    const tilt = this.talking * Math.sin(this.t * 0.9 + this.seed) * 0.06 + (this.fidget === 'scratch' ? 0.15 * this.fidgetW : 0);
    // the head stays level against the walking bob and the shoulder twist
    B.neck.quaternion.copy(E(lp * 0.4 + nod * 0.5 - run * 0.08, ly * 0.3 + sw * 0.05 * Math.min(1, speed), tilt * 0.5));
    B.head.quaternion.copy(E(lp * 0.6 + this.eat * 0.15 + nod - run * 0.06, ly * 0.45, tilt * 0.5));
    // a long look round brings the shoulders with it
    if (ly) B.chest.quaternion.multiply(E(0, ly * 0.28, 0));
    // talking gestures: every second or so a new hand shape (open palm out, a point, a shrug)
    if (this.talking > 0.05) {
      this.gestT -= dt;
      if (this.gestT <= 0) { this.gestT = 0.7 + Math.random() * 1.4; this.gest = [Math.random() < 0.6 ? Math.random() : 0, Math.random() < 0.35 ? Math.random() : 0, Math.random()]; }
    }
    // arms: a target pose from the activity, then a damped spring toward it (follow-through and settle)
    const wk = Math.min(1, speed / 1.4);
    for (const s of [1, -1]) {
      const n = s > 0 ? 'L' : 'R', A = this.arm[s > 0 ? 0 : 1];
      // relaxed: the arm hangs a touch forward and out, elbow softly bent
      let ax = 0.04, az = s * 0.1, fx = -0.28, ay = 0, hx = 0.1;
      if (moving) {
        // walking: the upper arm swings from the shoulder; the elbow bends more on the forward swing
        const swing = -sw * s;
        ax = swing * (0.32 + run * 0.55) * wk + 0.05;
        fx = -0.3 - Math.max(0, -swing) * (0.45 + run * 0.4) * wk - run * 1.15;
        az = s * (0.1 + run * 0.08);
        hx = 0.15 + run * 0.2;
      } else {
        ax += Math.sin(this.t * 0.8 + s + this.seed) * 0.015;
        const fw = this.fidgetW;
        if (this.fidget === 'hips') { ax = THREE.MathUtils.lerp(ax, 0.35, fw); az = THREE.MathUtils.lerp(az, s * 0.75, fw); fx = THREE.MathUtils.lerp(fx, -1.6, fw); ay = s * -0.3 * fw; }
        else if (this.fidget === 'fold') { ax = THREE.MathUtils.lerp(ax, -0.35, fw); az = THREE.MathUtils.lerp(az, s * 0.05, fw); fx = THREE.MathUtils.lerp(fx, -1.95, fw); ay = s * 0.45 * fw; }
        else if (this.fidget === 'scratch' && s < 0) { const sc = Math.sin(this.t * 14) * 0.08; ax = THREE.MathUtils.lerp(ax, -2.3, fw); az = THREE.MathUtils.lerp(az, -0.5, fw); fx = THREE.MathUtils.lerp(fx, -2.0 + sc, fw); }
        else if (this.fidget === 'rub') { ax = THREE.MathUtils.lerp(ax, -0.55, fw); az = THREE.MathUtils.lerp(az, s * -0.1, fw); fx = THREE.MathUtils.lerp(fx, -1.2 + Math.sin(this.t * 9 + s) * 0.08, fw); ay = s * 0.35 * fw; }
        else if (this.fidget === 'stretch') { ax = THREE.MathUtils.lerp(ax, -2.9, fw); az = THREE.MathUtils.lerp(az, s * 0.35, fw); fx = THREE.MathUtils.lerp(fx, -0.3, fw); }
        if (this.talking > 0.05) {
          const g = s < 0 ? this.gest[0] : this.gest[1];
          ax = THREE.MathUtils.lerp(ax, -0.25 - g * 0.6, this.talking); fx = THREE.MathUtils.lerp(fx, -1.0 - g * 0.6, this.talking);
          az = THREE.MathUtils.lerp(az, s * (0.15 + g * 0.35), this.talking); ay = THREE.MathUtils.lerp(ay, s * g * 0.5, this.talking); hx = -0.2 * g;
        }
      }
      // carrying: both arms forward holding something at the chest
      ax = THREE.MathUtils.lerp(ax, -1.1, this.carry); fx = THREE.MathUtils.lerp(fx, -0.9, this.carry); az = THREE.MathUtils.lerp(az, s * -0.15, this.carry);
      let snap = false;
      if (s < 0) {
        // right hand: eating brings food to the mouth
        ax = THREE.MathUtils.lerp(ax, -0.6, this.eat); fx = THREE.MathUtils.lerp(fx, -2.2 + Math.sin(this.t * 6) * 0.15 * this.eat, this.eat); az = THREE.MathUtils.lerp(az, 0.35, this.eat);
        if (st.armed) { ax = THREE.MathUtils.lerp(ax, -0.4, 0.6); fx = THREE.MathUtils.lerp(fx, -1.0, 0.6); }
        if (this.swingT >= 0) {
          this.swingT += dt / 0.55;
          const p = Math.min(1, this.swingT);
          const wind = p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65;
          const strike = p < 0.35 ? 0 : Math.sin(((p - 0.35) / 0.65) * Math.PI);
          if (this.swingDir === 'over') { ax = -2.6 * wind + 0.4 * strike; fx = -0.5; }
          else if (this.swingDir === 'thrust') { ax = -1.4; fx = -1.6 * wind; }
          else { const sd = this.swingDir === 'right' ? 1 : -1; ax = -1.4; ay = sd * (1.2 * wind - 1.4 * strike); fx = -0.4; }
          if (p >= 1) this.swingT = -1;
          snap = true;   // blows are driven, not sprung
        }
      } else if (this.block > 0.01) {
        ax = THREE.MathUtils.lerp(ax, -1.3, this.block); fx = THREE.MathUtils.lerp(fx, -1.4, this.block); az = THREE.MathUtils.lerp(az, -0.6, this.block);
      }
      // riding: hands forward on the reins, moving with the horse
      ax = THREE.MathUtils.lerp(ax, -0.7, this.ride); fx = THREE.MathUtils.lerp(fx, -0.8, this.ride);
      if (this.dead > 0.5 || this.sleep > 0.5) { ax = 0; az = s * 0.15; fx = -0.1; }
      // spring: stiff enough to track a swing, soft enough to overshoot and settle like a real limb
      const w = 15, z = 0.55, h = Math.min(dt, 1 / 30);
      if (snap || this.init) { A.ax = ax; A.az = az; A.fx = fx; A.hx = hx; A.vax = A.vaz = A.vfx = A.vhx = 0; }
      else {
        A.vax += ((ax - A.ax) * w * w - 2 * z * w * A.vax) * h; A.ax += A.vax * h;
        A.vaz += ((az - A.az) * w * w - 2 * z * w * A.vaz) * h; A.az += A.vaz * h;
        A.vfx += ((fx - A.fx) * w * w * 0.8 - 2 * z * w * A.vfx) * h; A.fx += A.vfx * h;
        A.vhx += ((hx - A.hx) * w * w * 0.6 - 2 * z * w * A.vhx) * h; A.hx += A.vhx * h;
      }
      B['arm' + n].quaternion.copy(E(A.ax, ay, A.az));
      B['fore' + n].quaternion.copy(E(Math.min(0, A.fx), s * 0.1 * Math.min(0, A.fx), 0));
      if (B['hand' + n]) B['hand' + n].quaternion.copy(E(A.hx, 0, s * -0.08));
      // the collar bone shrugs a little with the arm
      if (B['clav' + n]) B['clav' + n].quaternion.copy(E(0, 0, s * Math.max(-0.12, Math.min(0.12, -A.ax * 0.05 + (this.fidget === 'stretch' ? 0.1 * this.fidgetW : 0)))));
    }
    root.updateMatrixWorld(true);
    // legs
    const cosY = Math.cos(st.yaw), sinY = Math.sin(st.yaw);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1, n = i === 0 ? 'L' : 'R';
      const thigh = B['thigh' + n], shin = B['shin' + n], foot = B['foot' + n];
      if (this.sit > 0.01 || this.ride > 0.01 || this.sleep > 0.01 || this.dead > 0.01) {
        // seated/riding/lying: fixed leg poses
        const sx = -1.5 * Math.max(this.sit, this.ride * 0.8), spread = this.ride * 0.45 * s;
        thigh.quaternion.copy(E(sx, 0, spread));
        shin.quaternion.copy(E(1.5 * Math.max(this.sit, this.ride * 0.9), 0, 0));
        continue;
      }
      const hx = rig.rest[rig.anatomy.bones.findIndex((b) => b.name === 'foot' + n)].x * this.heightScale;
      const home = new THREE.Vector3(st.pos.x + hx * cosY, 0, st.pos.z - hx * sinY);
      home.y = this.ground(home.x, home.z);
      if (this.init) { this.planted[i].copy(home); }
      const lp = moving ? (this.phase + (i === 0 ? 0 : 0.5)) % 1 : 1;
      const duty = duty0;
      let F: THREE.Vector3;
      if (moving && lp > duty) {
        const sp = (lp - duty) / (1 - duty);
        if (!this.swinging[i]) { this.swinging[i] = true; this.from[i].copy(this.planted[i]); }
        // a walker lands the foot well ahead; a runner lands it nearly under the hips and pushes off behind
        const stride = speed / Math.max(freq, 0.1) * duty * (0.5 - run * 0.18);
        this.to[i].set(home.x + Math.sin(st.yaw) * stride, 0, home.z + Math.cos(st.yaw) * stride);
        this.to[i].y = this.ground(this.to[i].x, this.to[i].z);
        // running: the heel kicks up behind first, then the knee drives through and the foot reaches
        // forward and comes down; walking: a low, even arc
        const pe = Math.pow(sp, 1 - run * 0.15);
        F = this.from[i].clone().lerp(this.to[i], pe * pe * (3 - 2 * pe));
        // a runner's recovering foot folds up under the seat rather than trailing out behind
        const tuck = run * 0.45 * Math.sin(Math.min(1, sp * 1.4) * Math.PI);
        F.x += (home.x - F.x) * tuck; F.z += (home.z - F.z) * tuck;
        F.y += Math.sin(Math.pow(sp, 0.8 - run * 0.2) * Math.PI) * (0.1 + run * 0.4);
      } else {
        if (this.swinging[i]) { this.swinging[i] = false; this.planted[i].copy(this.to[i]); }
        if (!moving && this.planted[i].distanceTo(home) > 0.12) this.planted[i].lerp(home, Math.min(1, dt * 5));
        this.planted[i].y = this.ground(this.planted[i].x, this.planted[i].z);
        F = this.planted[i].clone();
      }
      const ankle = F.clone(); ankle.y += this.footH * this.heightScale;
      const A = thigh.getWorldPosition(new THREE.Vector3());
      const pole = new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
      const J = new THREE.Vector3();
      solve2(A, ankle, this.l1 * this.heightScale, this.l2 * this.heightScale, pole, J);
      const iS = rig.anatomy.bones.findIndex((b) => b.name === 'shin' + n), iT = iS - 1, iF = iS + 1;
      aimBone(thigh, rig.rest[iS].clone().sub(rig.rest[iT]), J.clone().sub(A), this.modelQ);
      aimBone(shin, rig.rest[iF].clone().sub(rig.rest[iS]), ankle.clone().sub(J), this.modelQ);
      foot.parent!.getWorldQuaternion(_qp);
      // heel rises before toe-off, the toe points through the swing
      const footPitch = moving ? (lp > duty ? -(0.3 + run * 0.4) * Math.sin(((lp - duty) / (1 - duty)) * Math.PI) : -0.35 * Math.max(0, (lp - duty * 0.65) / (duty * 0.35))) : 0;
      foot.quaternion.copy(_qp.invert().multiply(this.modelQ).multiply(E(footPitch, 0, 0)));
    }
    this.init = false;
  }
}

/** Birds: flapping flight, gliding, hopping and pecking on the ground. */
export class BirdAnimator {
  t = Math.random() * 10; flap = 0; flying = 0; peck = 0;
  constructor(public rig: Rig) {}
  update(dt: number, pos: THREE.Vector3, yaw: number, pitch: number, flying: boolean, flapRate: number, pecking: boolean) {
    const B = this.rig.byName, root = this.rig.root;
    this.t += dt;
    this.flying += ((flying ? 1 : 0) - this.flying) * Math.min(1, dt * 8);
    this.peck += ((pecking ? 1 : 0) - this.peck) * Math.min(1, dt * 6);
    this.flap += dt * flapRate;
    root.position.copy(pos);
    root.rotation.set(0, yaw, 0);
    root.rotateX(-pitch * this.flying);
    for (const b of this.rig.bones) b.quaternion.identity();
    const fl = this.flying;
    const beat = Math.sin(this.flap * Math.PI * 2);
    for (const s of [1, -1]) {
      const n = s > 0 ? 'L' : 'R';
      // spread: swing the folded wing out sideways, then beat about the body axis
      B['w1' + n].quaternion.setFromEuler(new THREE.Euler(0, s * 1.45 * fl, s * (-beat * 0.9 - 0.1) * fl, 'YZX'));
      B['w2' + n].quaternion.setFromEuler(new THREE.Euler(0, s * 0.1 * fl, s * -beat * 0.35 * fl));
      B['leg' + n].quaternion.setFromEuler(new THREE.Euler(fl * 0.9, 0, 0));
    }
    B.tail1.quaternion.setFromEuler(new THREE.Euler(fl * 0.1 + Math.sin(this.t * 3) * 0.05, 0, 0));
    const hopPeck = this.peck * Math.max(0, Math.sin(this.t * 9));
    B.neck.quaternion.setFromEuler(new THREE.Euler(hopPeck * 0.9, Math.sin(this.t * 1.7) * 0.4 * (1 - fl), 0));
    B.head.quaternion.setFromEuler(new THREE.Euler(hopPeck * 0.5, Math.sin(this.t * 2.9 + 1) * 0.5 * (1 - fl), 0));
    root.updateMatrixWorld(true);
  }
}
