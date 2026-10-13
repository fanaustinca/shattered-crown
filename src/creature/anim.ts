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
  private initFeet = true;

  private gait(speed: number) {
    const s = speed / Math.max(0.2, this.scale);
    if (this.hop) return { off: [0.12, 0.12, 0, 0], duty: 0.45, freq: 2.2 + speed * 0.8, bob: 0.25, name: 'hop' };
    if (s < 1.6) return { off: [0.25, 0.75, 0.0, 0.5], duty: 0.68, freq: 0.9 + s * 0.35, bob: 0.02, name: 'walk' };
    if (s < 3.6) return { off: [0.0, 0.5, 0.5, 0.0], duty: 0.48, freq: 1.4 + s * 0.12, bob: 0.035, name: 'trot' };
    if (s < 6.2) return { off: [0.3, 0.55, 0.0, 0.3], duty: 0.42, freq: 1.7 + s * 0.06, bob: 0.06, name: 'canter' };
    return { off: [0.5, 0.6, 0.0, 0.1], duty: 0.36, freq: 1.9 + s * 0.05, bob: 0.08, name: 'gallop' };
  }

  update(dt: number, st: MoveState) {
    const rig = this.rig, root = rig.root;
    this.t += dt;
    const speed = st.speed;
    const g = this.gait(speed);
    const moving = speed > 0.05;
    if (moving) this.phase = (this.phase + dt * g.freq) % 1;
    const wantGraze = st.action === 'graze' || st.action === 'eat' ? 1 : 0;
    this.graze += (wantGraze - this.graze) * Math.min(1, dt * 2);
    const wantSleep = st.action === 'sleep' || st.action === 'dead' ? 1 : 0;
    this.sleep += (wantSleep - this.sleep) * Math.min(1, dt * 1.2);

    // body placement: average the ground under the four hips, pitch to the slope
    const fy = this.ground(st.pos.x + Math.sin(st.yaw) * this.scale * 0.6, st.pos.z + Math.cos(st.yaw) * this.scale * 0.6);
    const by = this.ground(st.pos.x - Math.sin(st.yaw) * this.scale * 0.6, st.pos.z - Math.cos(st.yaw) * this.scale * 0.6);
    const pitch = Math.atan2(fy - by, this.scale * 1.2);
    this.bodyPitch += (pitch - this.bodyPitch) * Math.min(1, dt * 6);
    const turnRate = st.turn;
    this.bodyRoll += ((-turnRate * speed * 0.03) - this.bodyRoll) * Math.min(1, dt * 4);
    const bob = moving ? -Math.abs(Math.sin(this.phase * Math.PI * 2 * (g.name === 'walk' ? 2 : 1))) * g.bob * this.scale : 0;
    const breathe = Math.sin(this.t * 1.6) * 0.004 * this.scale;
    const lie = this.sleep * this.scale * 0.55;
    root.position.set(st.pos.x, (fy + by) / 2 + bob + breathe - lie, st.pos.z);
    root.rotation.set(0, st.yaw, 0);
    root.rotateX(-this.bodyPitch);
    root.rotateZ(this.bodyRoll);
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(this.modelQ);

    // reset all bone rotations (rest pose) before applying this frame's pose
    for (const b of rig.bones) b.quaternion.identity();
    const B = rig.byName;
    // spine: bend into turns, flex with gallop
    const flex = g.name === 'gallop' || g.name === 'hop' ? Math.sin(this.phase * Math.PI * 2) * 0.12 : 0;
    B.spine.quaternion.setFromEuler(new THREE.Euler(flex, turnRate * 0.12, 0));
    B.chest.quaternion.setFromEuler(new THREE.Euler(-flex * 0.5, turnRate * 0.12, 0));
    // neck & head: nod in walk, graze down to the grass, look at things
    const nod = moving && g.name === 'walk' ? Math.sin(this.phase * Math.PI * 4) * 0.06 : moving ? Math.sin(this.phase * Math.PI * 2) * 0.05 : 0;
    const grazeDown = this.graze * (rig.anatomy.id === 'pig' ? 0.5 : 1.0);
    let lookYaw = 0, lookPitch = 0;
    if (st.look) {
      _v.copy(st.look).sub(st.pos);
      lookYaw = THREE.MathUtils.clamp(Math.atan2(_v.x, _v.z) - st.yaw, -1, 1);
      lookYaw = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw));
      lookPitch = THREE.MathUtils.clamp(Math.atan2(_v.y - 1, Math.hypot(_v.x, _v.z)), -0.4, 0.4);
    }
    const idleLook = Math.sin(this.t * 0.31) * 0.25 * (moving ? 0.2 : 1) * (1 - this.graze);
    if (B.neck1) {
      B.neck1.quaternion.setFromEuler(new THREE.Euler(nod + grazeDown * 0.75 - this.sleep * 0.3, (lookYaw + idleLook) * 0.5, 0));
      B.neck2.quaternion.setFromEuler(new THREE.Euler(nod * 0.5 + grazeDown * 0.55 - lookPitch * 0.5, (lookYaw + idleLook) * 0.4, 0));
      B.head.quaternion.setFromEuler(new THREE.Euler(-nod * 0.5 + grazeDown * 0.2 - lookPitch * 0.5, (lookYaw + idleLook) * 0.2, 0));
      // chewing while grazing
      if (B.jaw) B.jaw.quaternion.setFromEuler(new THREE.Euler(this.graze * Math.max(0, Math.sin(this.t * 7)) * 0.12, 0, 0));
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
      if (bone) bone.quaternion.setFromEuler(new THREE.Euler(-0.1 + Math.sin(this.t * 40) * this.earA[e] * 0.3 + (st.action === 'flee' ? 0.6 : 0), 0, (e === 0 ? 1 : -1) * (this.earA[e] * 0.4 + lookYaw * 0.3)));
    }
    // tail: spring that lags body turns, swishes at flies
    const yawRate = (st.yaw - this.lastYaw) / Math.max(dt, 1e-3);
    this.lastYaw = st.yaw;
    const swish = Math.sin(this.t * 2.3) * 0.25 * (1 - Math.min(1, speed)) + Math.sin(this.t * 9) * 0.1 * (Math.sin(this.t * 0.4) > 0.7 ? 1 : 0);
    const tailTarget = -THREE.MathUtils.clamp(yawRate, -3, 3) * 0.15 + swish;
    this.tailV += (tailTarget - this.tailA) * dt * 40 - this.tailV * dt * 6;
    this.tailA += this.tailV * dt;
    const lift = g.name === 'gallop' || g.name === 'canter' ? -0.5 : 0;
    if (B.tail1) B.tail1.quaternion.setFromEuler(new THREE.Euler(lift + (rig.anatomy.id === 'pig' ? -1.2 : 0), this.tailA, 0));
    if (B.tail2) B.tail2.quaternion.setFromEuler(new THREE.Euler(lift * 0.5, this.tailA * 1.2, 0));
    if (B.tail3) B.tail3.quaternion.setFromEuler(new THREE.Euler(0, this.tailA * 1.4, 0));
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
      const lp = moving ? (this.phase - g.off[i] + 1) % 1 : 1;
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
        F = S.from.clone().lerp(S.to, sp * sp * (3 - 2 * sp));
        F.y += Math.sin(sp * Math.PI) * (0.12 + speed * 0.03) * this.scale * (L.front ? 1.2 : 0.9);
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
      const back = new THREE.Vector3(-Math.sin(st.yaw), 0, -Math.cos(st.yaw)).multiplyScalar(L.front ? fold * 0.9 : fold * 0.4);
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
  private modelQ = new THREE.Quaternion();
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
    const freq = moving ? 0.75 + speed * 0.32 : 0;
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
    const run = Math.min(1, Math.max(0, (speed - 3) / 3));
    const bob = moving ? (Math.cos(this.phase * Math.PI * 4) * 0.025 * (1 + run)) - run * 0.06 : 0;
    const limpDrop = this.limp * Math.max(0, Math.sin(this.phase * Math.PI * 2)) * 0.06;
    root.position.set(st.pos.x, (st.ridden || st.riding ? st.pos.y : Math.max(gy, st.pos.y)) + bob - limpDrop - this.sit * 0.48 * (1 - this.ride) - this.sleep * 0.85 - this.dead * 0.85, st.pos.z);
    root.rotation.set(0, st.yaw, 0);
    if (this.sleep > 0.01 || this.dead > 0.01) root.rotateX(-Math.PI / 2 * Math.max(this.sleep, this.dead));
    root.scale.setScalar(this.heightScale);
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(this.modelQ);
    for (const b of rig.bones) b.quaternion.identity();
    const E = (x: number, y: number, z: number) => _q.setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
    // torso: lean forward when running, counter-rotate shoulders against hips
    const sw = Math.sin(this.phase * Math.PI * 2);
    B.hips.quaternion.copy(E(0, sw * 0.08 * Math.min(1, speed), this.limp * sw * 0.06));
    B.spine.quaternion.copy(E(run * 0.18 + this.carry * -0.05, -sw * 0.06, 0));
    B.chest.quaternion.copy(E(run * 0.05, -sw * 0.08 * Math.min(1, speed), 0));
    // head look
    let ly = 0, lp = 0;
    if (st.look) {
      _v.copy(st.look).sub(st.pos);
      ly = Math.atan2(_v.x, _v.z) - st.yaw; ly = Math.atan2(Math.sin(ly), Math.cos(ly));
      ly = THREE.MathUtils.clamp(ly, -1.1, 1.1);
      lp = THREE.MathUtils.clamp(-Math.atan2(_v.y - 1.6, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
    }
    B.neck.quaternion.copy(E(lp * 0.4, ly * 0.4, 0));
    B.head.quaternion.copy(E(lp * 0.6 + this.eat * 0.15, ly * 0.6, 0));
    // arms: swing, carry, eat, weapon swing, block
    for (const s of [1, -1]) {
      const n = s > 0 ? 'L' : 'R';
      const armSwing = moving ? -sw * s * (0.35 + run * 0.5) : Math.sin(this.t * 0.8 + s) * 0.02;
      let ax = armSwing, az = s * 0.08, fx = -0.15 - (moving ? 0.2 + run * 0.9 : 0), ay = 0;
      // carrying: both arms forward holding something at the chest
      ax = THREE.MathUtils.lerp(ax, -1.1, this.carry); fx = THREE.MathUtils.lerp(fx, -0.9, this.carry); az = THREE.MathUtils.lerp(az, s * -0.15, this.carry);
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
        }
      } else if (this.block > 0.01) {
        ax = THREE.MathUtils.lerp(ax, -1.3, this.block); fx = THREE.MathUtils.lerp(fx, -1.4, this.block); az = THREE.MathUtils.lerp(az, -0.6, this.block);
      }
      // riding: hands forward on the reins
      ax = THREE.MathUtils.lerp(ax, -0.7, this.ride); fx = THREE.MathUtils.lerp(fx, -0.8, this.ride);
      B['arm' + n].quaternion.copy(E(ax, ay, az));
      B['fore' + n].quaternion.copy(E(fx, 0, 0));
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
      const duty = 0.6 - run * 0.18;
      let F: THREE.Vector3;
      if (moving && lp > duty) {
        const sp = (lp - duty) / (1 - duty);
        if (!this.swinging[i]) { this.swinging[i] = true; this.from[i].copy(this.planted[i]); }
        const stride = speed / Math.max(freq, 0.1) * duty * 0.5;
        this.to[i].set(home.x + Math.sin(st.yaw) * stride, 0, home.z + Math.cos(st.yaw) * stride);
        this.to[i].y = this.ground(this.to[i].x, this.to[i].z);
        F = this.from[i].clone().lerp(this.to[i], sp * sp * (3 - 2 * sp));
        F.y += Math.sin(sp * Math.PI) * (0.1 + run * 0.15);
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
      const footPitch = moving && lp > duty ? -0.3 * Math.sin(((lp - duty) / (1 - duty)) * Math.PI) : 0;
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
