// Farm wagons: a real rigid-body chassis on four suspended, spoked wheels (ray-cast vehicle). Hitch a
// horse or donkey to the shafts and drive from the bench, or pull it by hand. The bed has walls, so
// crates, sacks and baskets ride along; you can climb or leap onto it while it moves.
import * as THREE from 'three';
import { RAPIER, groups, G_VEHICLE, G_STATIC, G_PROP, G_CHAR, ALL, v3, q4 } from '../physics/physics';
import type { Game } from '../game';
import { GeoBuilder } from '../build/geom';
import { meshesFrom } from '../props/palette';
import type { Action, Interactable } from '../player/interact';
import type { Seat, Player } from '../player/player';
import type { Animal } from '../creature/animals';
import type { Input } from '../core/input';
import type { Prop } from '../props/props';

const L = 3.2, W = 1.5, BED_Y = 0.85, WHEEL_R = 0.46;

function cartModel(seed: number) {
  const g = new GeoBuilder();
  const wood = seed % 2 ? 'wood:weathered|stain:honey|fin:raw' : 'wood:worn|stain:walnut|fin:raw';
  // bed floor and side boards (local +z is forward)
  for (let i = 0; i < 7; i++) g.box(wood, -W / 2 + (i + 0.5) * W / 7, BED_Y, 0, W / 7 - 0.01, 0.05, L, 1.5);
  for (const s of [-1, 1]) { g.box(wood, s * W / 2, BED_Y + 0.25, 0, 0.05, 0.45, L, 1.5); for (let i = 0; i < 5; i++) g.box('wood:dark|stain:ebony|fin:raw', s * (W / 2 + 0.03), BED_Y + 0.22, -L / 2 + 0.2 + i * (L - 0.4) / 4, 0.05, 0.5, 0.07, 2); }
  g.box(wood, 0, BED_Y + 0.25, -L / 2, W, 0.45, 0.05, 1.5);
  g.box(wood, 0, BED_Y + 0.2, L / 2, W, 0.35, 0.05, 1.5);
  // driver's bench raised at the front
  g.box(wood, 0, BED_Y + 0.75, L / 2 - 0.35, W - 0.1, 0.06, 0.38, 1.5);
  for (const s of [-1, 1]) g.box(wood, s * (W / 2 - 0.15), BED_Y + 0.4, L / 2 - 0.35, 0.06, 0.7, 0.06, 2);
  // frame, axles, shafts
  for (const s of [-1, 1]) g.box('wood:dark|stain:ebony|fin:raw', s * 0.45, BED_Y - 0.12, 0, 0.12, 0.14, L + 0.1, 2);
  for (const z of [-L / 2 + 0.55, L / 2 - 0.55]) { g.push().translate(0, WHEEL_R, z).rotateZ(Math.PI / 2); g.cyl('iron', 0, -W / 2 - 0.1, 0, 0.04, 0.04, W + 0.2, 8); g.pop(); }
  for (const s of [-1, 1]) { g.push().translate(s * 0.55, BED_Y - 0.15, L / 2 + 1.2).rotateX(0.08); g.box('wood:planks|stain:honey|fin:raw', 0, 0, 0, 0.07, 0.08, 2.6, 2); g.pop(); }
  g.box('wood:planks|stain:honey|fin:raw', 0, BED_Y - 0.2, L / 2 + 2.3, 1.2, 0.07, 0.07, 2);
  return g;
}
function wheelModel() {
  const g = new GeoBuilder();
  const wood = 'wood:worn|stain:walnut|fin:raw';
  // rim of segments, iron tyre, hub and twelve spokes; local x is the axle
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.push().rotateX(a).translate(0, WHEEL_R - 0.05, 0);
    g.box(wood, 0, 0, 0, 0.08, 0.09, 2 * Math.PI * (WHEEL_R - 0.05) / n + 0.01, 2);
    g.box('iron', 0, 0.05, 0, 0.085, 0.015, 2 * Math.PI * WHEEL_R / n + 0.01, 2);
    g.pop();
  }
  g.push().rotateZ(Math.PI / 2); g.cyl(wood, 0, -0.1, 0, 0.09, 0.09, 0.2, 12); g.pop();
  for (let i = 0; i < 12; i++) { g.push().rotateX((i / 12) * Math.PI * 2); g.box(wood, 0, (WHEEL_R - 0.05) / 2, 0, 0.035, WHEEL_R - 0.1, 0.035, 2); g.pop(); }
  return g;
}
let wheelGeos: Map<string, THREE.BufferGeometry> | null = null;

export class Cart implements Interactable {
  body: RAPIER.RigidBody;
  vc: RAPIER.DynamicRayCastVehicleController;
  root = new THREE.Group();
  wheels: THREE.Object3D[] = [];
  bed = new THREE.Object3D();
  animal: Animal | null = null;
  driver: Player | null = null;
  reins = 0;            // throttle 0..3 / -1 reverse
  steer = 0;
  braking = false;
  pulledByHand = false;
  cargo: { contents: Prop[] } = { contents: [] };
  owner: string | null = null;
  constructor(public game: Game, pos: THREE.Vector3, yaw: number, seed = 1) {
    const ph = game.physics;
    for (const m of meshesFrom(cartModel(seed).build())) this.root.add(m);
    if (!wheelGeos) wheelGeos = wheelModel().build();
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Group();
      for (const m of meshesFrom(wheelGeos)) w.add(m);
      this.root.add(w); this.wheels.push(w);
    }
    this.root.add(this.bed);
    game.scene.add(this.root);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y + 0.3, pos.z).setRotation(q).setLinearDamping(0.1).setAngularDamping(0.8).setCcdEnabled(true));
    const C = (hx: number, hy: number, hz: number, x: number, y: number, z: number, m: number) => {
      const c = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setMass(m).setFriction(0.9).setCollisionGroups(groups(G_VEHICLE, ALL)), this.body);
      ph.owners.set(c.handle, { kind: 'cart', interact: this, cart: this });
      return c;
    };
    C(W / 2, 0.05, L / 2, 0, BED_Y, 0, 160);                 // bed floor (rideable deck)
    C(0.03, 0.22, L / 2, -W / 2, BED_Y + 0.25, 0, 20); C(0.03, 0.22, L / 2, W / 2, BED_Y + 0.25, 0, 20);
    C(W / 2, 0.22, 0.03, 0, BED_Y + 0.25, -L / 2, 10); C(W / 2, 0.17, 0.03, 0, BED_Y + 0.2, L / 2, 10);
    C(W / 2 - 0.05, 0.05, 0.2, 0, BED_Y + 0.75, L / 2 - 0.35, 10);
    C(0.6, 0.06, 1.2, 0, BED_Y - 0.15, L / 2 + 1.2, 15);    // shafts
    this.vc = ph.world.createVehicleController(this.body);
    (this.vc as unknown as { setIndexForwardAxis: number }).setIndexForwardAxis = 2;
    for (const [x, z] of [[-W / 2 - 0.05, L / 2 - 0.55], [W / 2 + 0.05, L / 2 - 0.55], [-W / 2 - 0.05, -L / 2 + 0.55], [W / 2 + 0.05, -L / 2 + 0.55]]) {
      this.vc.addWheel({ x, y: WHEEL_R + 0.15, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.25, WHEEL_R);
      const i = this.vc.numWheels() - 1;
      this.vc.setWheelSuspensionStiffness(i, 28); this.vc.setWheelFrictionSlip(i, 1.6); this.vc.setWheelSideFrictionStiffness(i, 1.2);
      this.vc.setWheelSuspensionCompression(i, 2.5); this.vc.setWheelSuspensionRelaxation(i, 3.0); this.vc.setWheelMaxSuspensionForce(i, 20000);
    }
    // cargo bed volume for props
    game.props.volumes.push({ obj: this.bed, box: new THREE.Box3(new THREE.Vector3(-W / 2 + 0.05, BED_Y, -L / 2 + 0.05), new THREE.Vector3(W / 2 - 0.05, BED_Y + 0.9, L / 2 - 0.6)), carrier: this.cargo, moving: () => this.speed > 0.3 });
  }
  get speed() { return Math.abs(this.vc.currentVehicleSpeed()); }
  get pos() { return v3(this.body.translation()); }
  get quat() { return q4(this.body.rotation()); }
  get yaw() { const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ'); return e.y; }
  shaftTip() { return new THREE.Vector3(0, 0, L / 2 + 2.0).applyQuaternion(this.quat).add(this.pos); }

  name() { return `Wagon${this.animal ? ` (${this.animal.name} in harness)` : ''}${this.cargo.contents.length ? ` · ${this.cargo.contents.length} in the bed` : ''}`; }
  actions(g: Game): Action[] {
    const out: Action[] = [];
    const p = g.player;
    out.push({ key: 'E', label: this.animal ? 'Take the reins' : 'Sit on the bench', run: () => this.board(p) });
    const led = g.fauna.all().find((a) => a.leader === p && (a.species === 'horse' || a.species === 'donkey'));
    if (led && !this.animal) out.push({ key: 'X', label: `Hitch ${led.name} to the wagon`, run: () => this.hitch(led) });
    if (this.animal) out.push({ key: 'X', label: `Unhitch ${this.animal.name}`, run: () => this.unhitch() });
    if (!this.animal) out.push({ key: 'F', label: this.pulledByHand ? 'Let go of the shafts' : 'Pull by the shafts', run: () => { this.pulledByHand = !this.pulledByHand; } });
    return out;
  }
  hitch(a: Animal) {
    this.animal = a; a.mode = 'hitched'; a.leader = null;
    this.game.hud.toast(`${a.name} is in harness.`);
  }
  unhitch() { if (!this.animal) return; this.animal.mode = 'idle'; this.animal.hitch = null; this.animal = null; }
  board(p: Player) {
    const seat: Seat & { dismountLabel: string } = {
      label: 'Wagon bench', eye: 0.8, freeLook: true, dismountLabel: 'Climb down',
      getTransform: (pos, q) => { pos.copy(new THREE.Vector3(-0.3, BED_Y + 0.35, L / 2 - 0.35).applyQuaternion(this.quat).add(this.pos)); q.copy(this.quat); },
      drive: (inp: Input) => this.drive(inp),
      leave: () => { this.driver = null; this.reins = 0; this.game.playerBody?.setPose('idle'); },
    };
    this.driver = p;
    p.sitIn(seat);
    p.yaw = this.yaw + Math.PI;
    this.game.playerBody?.setPose('sit');
  }
  drive(inp: Input) {
    if (inp.hit('KeyW')) this.reins = Math.min(3, this.reins + 1);
    if (inp.hit('KeyS')) this.reins = Math.max(-1, this.reins - 1);
    this.steer = ((inp.key('KeyA') ? 1 : 0) - (inp.key('KeyD') ? 1 : 0)) * 0.5;
    this.braking = inp.key('Space');
  }

  step(dt: number) {
    const v = this.vc.currentVehicleSpeed();
    let engine = 0;
    if (this.animal && this.animal.mode === 'hitched') {
      const want = [0, 1.4, 3.0, 5.5][Math.max(0, this.reins)] * (this.reins < 0 ? -0.6 : 1) || (this.reins < 0 ? -0.8 : 0);
      engine = THREE.MathUtils.clamp((want - v) * 900, -1800, 2600);
    } else if (this.pulledByHand) {
      const to = this.game.player.pos.clone().sub(this.shaftTip()); to.y = 0;
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
      const d = to.length();
      if (d > 0.5) { engine = THREE.MathUtils.clamp(to.dot(fwd) * 500, -900, 900); this.steer = THREE.MathUtils.clamp(new THREE.Vector3().crossVectors(fwd, to.normalize()).y * 1.2, -0.5, 0.5); }
      if (d > 3.5) this.pulledByHand = false;
    }
    for (let i = 0; i < 4; i++) {
      this.vc.setWheelEngineForce(i, i >= 2 ? engine : 0);
      this.vc.setWheelSteering(i, i < 2 ? this.steer : 0);
      this.vc.setWheelBrake(i, this.braking || (!this.animal && !this.pulledByHand) ? 30 : this.reins === 0 && this.animal ? 8 : 0.2);
    }
    this.vc.updateVehicle(dt, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G_VEHICLE, G_STATIC | G_PROP), (c) => c.parent()?.handle !== this.body.handle);
    // the horse walks between the shafts
    if (this.animal && this.animal.mode === 'hitched') {
      const tip = this.shaftTip();
      this.animal.hitch = { pos: new THREE.Vector3(0, 0, L / 2 + 1.25).applyQuaternion(this.quat).add(this.pos).setY(tip.y), yaw: this.yaw };
      this.animal.st.speed = Math.abs(v);
    }
    // wheel the player bumps into rolls a little
    void G_CHAR;
  }
  sync() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const cp = this.vc.wheelChassisConnectionPointCs(i)!;
      const susp = this.vc.wheelSuspensionLength(i) ?? 0.25;
      w.position.set(cp.x, cp.y - susp, cp.z);
      w.rotation.set(-(this.vc.wheelRotation(i) ?? 0), this.vc.wheelSteering(i) ?? 0, 0, 'YXZ');
    }
  }
}
