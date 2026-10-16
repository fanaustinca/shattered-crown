// Ragdolls. When a person dies the animated pose hands over to physics: eleven capsules (pelvis, belly,
// chest, head, upper and lower arms, thighs and shins) joined by ball joints at the hips, shoulders, elbows,
// knees and neck, thrown by the blow that killed them. They tumble, fold over obstacles and settle on the
// slope; after a few seconds (or once at rest) the bodies are removed and the pose is frozen where it lies.
// Only a dozen are ever simulated at once — older ones freeze early.
import * as THREE from 'three';
import type { Game } from '../game';
import type { Rig } from './rig';
import { RAPIER, groups, G_STATIC, G_DEBRIS } from '../physics/physics';

interface Part { bone: THREE.Bone; body: RAPIER.RigidBody; offset: THREE.Quaternion; local: THREE.Vector3 }
interface Doll { rig: Rig; parts: Part[]; joints: RAPIER.ImpulseJoint[]; t: number; frozen: boolean; scale: number }

// segment: bone, the bone whose head ends it, capsule radius, the parent segment index (joined at our head)
const SEGS: [string, string, number, number][] = [
  ['hips', 'spine', 0.15, -1], ['spine', 'chest', 0.14, 0], ['chest', 'neck', 0.16, 1], ['head', '', 0.11, 2],
  ['armL', 'foreL', 0.055, 2], ['foreL', 'handL', 0.05, 4], ['armR', 'foreR', 0.055, 2], ['foreR', 'handR', 0.05, 6],
  ['thighL', 'shinL', 0.075, 0], ['shinL', 'footL', 0.06, 8], ['thighR', 'shinR', 0.075, 0], ['shinR', 'footR', 0.06, 10],
];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);

export class Ragdolls {
  dolls: Doll[] = [];
  private frozenRigs = new WeakSet<Rig>();
  constructor(public game: Game) {}

  /** Does this rig have a ragdoll (active or frozen)? Its animator must leave it alone. */
  owns(rig: Rig) { return this.frozenRigs.has(rig) || this.dolls.some((d) => d.rig === rig); }

  spawn(rig: Rig, push: THREE.Vector3) {
    const g = this.game, w = g.physics.world;
    if (!rig.byName.hips || this.owns(rig)) return;
    // keep the number simulated small: freeze the oldest
    while (this.dolls.length >= 12) this.freeze(this.dolls[0]);
    rig.root.updateMatrixWorld(true);
    const scale = rig.root.scale.x;
    const parts: Part[] = [], joints: RAPIER.ImpulseJoint[] = [];
    const heads: THREE.Vector3[] = [];
    for (const [bn, en, r0] of SEGS) {
      const bone = rig.byName[bn];
      if (!bone) return;
      bone.getWorldPosition(_a);
      if (en && rig.byName[en]) rig.byName[en].getWorldPosition(_b);
      else _b.copy(_a).add(_up.clone().applyQuaternion(bone.getWorldQuaternion(_q)).multiplyScalar(0.24 * scale));
      const r = r0 * scale, len = Math.max(0.05, _a.distanceTo(_b));
      const c = _a.clone().add(_b).multiplyScalar(0.5);
      const dq = new THREE.Quaternion().setFromUnitVectors(_up, _b.clone().sub(_a).normalize());
      const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setRotation(dq).setLinearDamping(0.15).setAngularDamping(1.6).setCanSleep(true).setCcdEnabled(false));
      w.createCollider(RAPIER.ColliderDesc.capsule(Math.max(0.01, len / 2 - r * 0.5), r).setDensity(985).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups(G_DEBRIS, G_STATIC)), body);
      // the blow: a shove and a twist, more for the upper body
      const k = bn === 'chest' || bn === 'head' || bn === 'spine' ? 1 : 0.6;
      body.setLinvel({ x: push.x * k, y: push.y * k + 0.6, z: push.z * k }, true);
      body.setAngvel({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, true);
      const offset = dq.clone().invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      const local = _a.clone().sub(c).applyQuaternion(dq.clone().invert());
      parts.push({ bone, body, offset, local });
      heads.push(_a.clone());
    }
    // ball joints at the head of each segment, to its parent
    SEGS.forEach(([, , , pi], i) => {
      if (pi < 0) return;
      const pa = parts[pi].body, ch = parts[i].body, at = heads[i];
      const toLocal = (b: RAPIER.RigidBody) => { const t = b.translation(), r = b.rotation(); return at.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert()); };
      const a1 = toLocal(pa), a2 = toLocal(ch);
      joints.push(w.createImpulseJoint(RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z }), pa, ch, true));
    });
    this.dolls.push({ rig, parts, joints, t: 0, frozen: false, scale });
  }

  /** Copy the bodies onto the bones (parents first, so each bone's parent frame is already current). */
  private pose(d: Doll) {
    const root = d.rig.root;
    const hips = d.parts[0];
    // the root follows the pelvis: keep its yaw, move it so the hips bone lands where the pelvis body is
    {
      const t = hips.body.translation(), r = hips.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const hipW = hips.local.clone().applyQuaternion(_q).add(_a.set(t.x, t.y, t.z));
      root.rotation.x = 0; root.rotation.z = 0;
      root.updateMatrixWorld(true);
      const cur = hips.bone.getWorldPosition(_b);
      root.position.add(hipW.sub(cur));
      root.updateMatrixWorld(true);
    }
    for (const p of d.parts) {
      const r = p.body.rotation();
      _q.set(r.x, r.y, r.z, r.w).multiply(p.offset);              // wanted world rotation of the bone
      p.bone.parent!.getWorldQuaternion(_pq);
      p.bone.quaternion.copy(_pq.invert().multiply(_q));
      p.bone.updateMatrixWorld(true);
    }
  }

  private freeze(d: Doll) {
    const w = this.game.physics.world;
    this.pose(d);
    for (const j of d.joints) w.removeImpulseJoint(j, true);
    for (const p of d.parts) this.game.physics.removeBody(p.body);
    d.frozen = true;
    this.frozenRigs.add(d.rig);
    this.dolls.splice(this.dolls.indexOf(d), 1);
  }

  update(dt: number) {
    for (const d of [...this.dolls]) {
      // the corpse was cleared away
      if (!d.rig.root.parent) { for (const j of d.joints) this.game.physics.world.removeImpulseJoint(j, true); for (const p of d.parts) this.game.physics.removeBody(p.body); this.dolls.splice(this.dolls.indexOf(d), 1); continue; }
      d.t += dt;
      this.pose(d);
      if (d.t > 7 || (d.t > 1.5 && d.parts.every((p) => p.body.isSleeping() || p.body.linvel().y ** 2 + p.body.linvel().x ** 2 + p.body.linvel().z ** 2 < 0.01))) this.freeze(d);
    }
  }
}
