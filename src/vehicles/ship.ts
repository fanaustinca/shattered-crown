// Sailing ships and rowing boats. Hulls float on the Gerstner sea / river by sampling buoyancy points;
// sails (each split into its own cloth) billow, flutter when luffing, can be raised and lowered and
// their yards trimmed to the wind. Steer with the wheel (rudder torque grows with speed). Walk the
// rolling deck, go down the hatch to the hold where hammocks swing with the sea.
import * as THREE from 'three';
import { RAPIER, groups, G_VEHICLE, ALL, v3, q4 } from '../physics/physics';
import type { Game } from '../game';
import { instanceModel } from '../props/models';
import { planShip, type ShipClass, type ShipPlan } from './shipyard';
import { seaHeight, riverChop, waterUniforms } from '../render/water';
import { sharedUniforms } from '../render/pipeline';
import { GeoBuilder } from '../build/geom';
import { meshesFrom, material } from '../props/palette';
import type { Action, Interactable } from '../player/interact';
import type { Seat } from '../player/player';
import type { Input } from '../core/input';
import { makeFurniture, modsFor } from '../props/furniture';
import { FurnitureNode } from '../props/furnish';
import type { Prop } from '../props/props';

interface Sail { mesh: THREE.Mesh; u: Record<string, { value: number | THREE.Vector3 }>; top: number; bottom: number; area: number; set: number; target: number; pin: THREE.Vector3 }

const SAIL_PARS = /* glsl */ `
  uniform float uFurl, uBillow, uFlutter, uTrim, uTime, uTop, uBottom, uZ0, uZ1;
  uniform vec3 uPivot;
`;
const SAIL_VERT = /* glsl */ `
  vec3 p0 = transformed;
  float sv = clamp((uTop - p0.y) / max(0.01, uTop - uBottom), 0.0, 1.0);
  float su = clamp((p0.z - uZ0) / max(0.01, uZ1 - uZ0), 0.0, 1.0);
  // furl: the cloth gathers up toward the yard
  transformed.y = uTop - (uTop - p0.y) * (1.0 - uFurl * 0.93);
  float shape = sin(3.14159 * sv) * sin(3.14159 * su);
  float flutter = sin(uTime * 17.0 + sv * 11.0 + su * 7.0) * sin(uTime * 5.3 + su * 3.0) * uFlutter;
  transformed.x += (uBillow * shape + flutter * shape * 0.6) * (1.0 - uFurl);
  // trim: swing about the mast
  vec2 d = transformed.xz - uPivot.xz;
  float c = cos(uTrim), s = sin(uTrim);
  transformed.xz = uPivot.xz + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
`;

export type ShipKind = ShipClass | 'boat';

/** A hinged door on a ship: its collider rides on the hull's rigid body and swings with the door. */
export class ShipDoor {
  node = new THREE.Group();
  panel: THREE.Group;
  open = 0; target = 0; locked = false; exterior = true; owner: string | null = null; autoClose = 0;
  collider: RAPIER.Collider;
  constructor(public ship: Ship, parent: THREE.Object3D, public pos: THREE.Vector3, public yaw: number, public w: number, public h: number, public hinge: 1 | -1) {
    const g = new GeoBuilder();
    const cx = -hinge * w / 2;
    g.box('wood:planks|stain:chestnut|fin:varnished', cx, h / 2, 0, w - 0.02, h - 0.02, 0.06, 1.2);
    for (const y of [0.3, h - 0.3]) g.box('wood:dark|stain:ebony|fin:raw', cx, y, -0.045, w - 0.1, 0.1, 0.03, 2);
    g.box('brass', cx - hinge * (w / 2 - 0.12), 1.0, 0.05, 0.03, 0.12, 0.03, 3);
    this.panel = new THREE.Group();
    for (const m of meshesFrom(g.build())) this.panel.add(m);
    this.node.add(this.panel);
    this.node.position.copy(pos);
    this.node.rotation.y = yaw;
    this.node.translateX(hinge * w / 2);
    parent.add(this.node);
    const c = ship.game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2 - 0.02, h / 2, 0.04).setCollisionGroups(groups(G_VEHICLE, ALL)).setMass(1), ship.body);
    ship.game.physics.owners.set(c.handle, { kind: 'door', door: this });
    this.collider = c;
    this.place();
  }
  toggle() { if (this.locked) return false; this.target = this.target > 0.5 ? 0 : 1; return true; }
  private place() {
    // collider pose relative to the hull body
    const ang = this.open * this.open * (3 - 2 * this.open) * 1.7 * -this.hinge;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw + ang, 0));
    const hingeP = this.node.position;
    const c = new THREE.Vector3(-this.hinge * this.w / 2, this.h / 2, 0).applyQuaternion(q).add(hingeP);
    this.collider.setTranslationWrtParent({ x: c.x, y: c.y, z: c.z });
    this.collider.setRotationWrtParent({ x: q.x, y: q.y, z: q.z, w: q.w });
    this.panel.rotation.y = ang;
  }
  update(dt: number) {
    if (Math.abs(this.target - this.open) < 1e-3) return;
    this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * 1.6);
    this.place();
  }
}

export class Ship implements Interactable {
  body: RAPIER.RigidBody;
  root = new THREE.Group();
  model: THREE.Object3D;
  sails: Sail[] = [];
  rudder = 0;           // -1..1 (wheel)
  wheel: THREE.Object3D;
  anchored = true;
  trim = 0;             // yard angle
  helmsman = false;
  deckY = 5;
  waterline = 2;
  length = 22; beam = 5;
  draft = 1;
  buoy: THREE.Vector3[] = [];
  mass: number;
  hammocks: { node: THREE.Object3D; phase: number; ang: number; vel: number }[] = [];
  hold = new THREE.Group();
  holdCargo: { contents: Prop[] } = { contents: [] };
  roll = 0; pitch = 0;
  name_: string;
  river = false;
  row = 0;
  plan: ShipPlan | null = null;
  doors: ShipDoor[] = [];
  /** lantern positions in ship space (lit at night, inside always) */
  lamps: THREE.Vector3[] = [];
  /** broadside guns: ship-space muzzle positions; reload timers per side (+z starboard, -z larboard) */
  reload = { 1: 0, [-1]: 0 } as Record<number, number>;
  side: 'vanguardia' | 'ironreach' | null = null;
  hp = 1;
  /** fraction of normal buoyancy (falls as a holed ship fills) */
  buoyScale = 1;
  dispose() {
    this.root.removeFromParent();
    this.game.physics.removeBody(this.body);
    const vi = this.game.props.volumes.findIndex((v) => v.obj === this.hold);
    if (vi >= 0) this.game.props.volumes.splice(vi, 1);
  }
  get kind(): 'ship' | 'boat' { return this.cls === 'boat' ? 'boat' : 'ship'; }
  constructor(public game: Game, pos: THREE.Vector3, yaw: number, public cls: ShipKind, name: string) {
    this.name_ = name;
    const ph = game.physics;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const owner = { kind: 'ship', interact: this, ship: this };
    if (cls !== 'boat') {
      const plan = planShip(cls);
      this.plan = plan;
      this.model = new THREE.Group();
      const outside = new THREE.Group(); outside.name = 'hull';
      for (const m of meshesFrom(plan.hull.build())) outside.add(m);
      this.model.add(outside);
      for (const m of meshesFrom(plan.inside.build(), true)) this.hold.add(m);
      this.model.add(this.hold);
      this.root.add(this.model);
      game.scene.add(this.root);
      this.mass = plan.spec.mass;
      this.length = plan.spec.L; this.beam = plan.spec.B; this.draft = plan.spec.draft;
      this.deckY = plan.deckY; this.waterline = plan.waterline;
      this.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y - this.waterline, pos.z).setRotation(q).setLinearDamping(0.0).setAngularDamping(0.6));
      const n = plan.colliders.length;
      plan.colliders.forEach((c, i) => {
        // ballast: most of the weight low in the keel collider (the first one added is not the keel; find it by size)
        const d = RAPIER.ColliderDesc.cuboid(c.h.x, c.h.y, c.h.z).setTranslation(c.c.x, c.c.y, c.c.z).setFriction(0.9).setCollisionGroups(groups(G_VEHICLE, ALL));
        if (c.q) d.setRotation(c.q);
        d.setMass(this.mass * 0.04 / n);
        const col = ph.world.createCollider(d, this.body);
        ph.owners.set(col.handle, owner);
        void i;
      });
      // ballast and frames low and on the centreline
      const kd = RAPIER.ColliderDesc.cuboid(this.length * 0.35, 0.3, 0.6).setTranslation(0, this.plan.spec.decks[0] * 0.5, 0).setMass(this.mass * 0.96).setCollisionGroups(groups(G_VEHICLE, ALL));
      ph.owners.set(ph.world.createCollider(kd, this.body).handle, owner);
      this.buoy = plan.buoy;
      this.wheel = shipWheel();
      this.wheel.position.copy(plan.helm).add(new THREE.Vector3(0, 1.05, 0));
      this.root.add(this.wheel);
      const wc = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 0.6, 0.7).setTranslation(plan.helm.x, plan.helm.y + 0.9, 0).setSensor(true).setCollisionGroups(groups(32, ALL)), this.body);
      ph.owners.set(wc.handle, { kind: 'movable_ship_wheel', interact: { name: () => `${this.name_} — ship's wheel`, actions: (g: Game) => this.helmActions(g) } });
      for (const sd of plan.sails) this.buildSail(sd);
      for (const d of plan.doors) this.doors.push(new ShipDoor(this, this.model, d.pos, d.yaw, d.w, d.h, d.hinge));
      this.lamps = plan.lights;
      for (let i = 0; i < plan.hammocks.length; i++) {
        const hp = plan.hammocks[i];
        const fm = makeFurniture('hammock', i % 2 ? 'net' : 'canvas', modsFor(i * 31 + 7));
        const node = new FurnitureNode(fm);
        node.group.position.copy(hp);
        node.group.rotation.y = Math.PI / 2;
        this.hold.add(node.group);
        for (const mv of node.movables) this.hammocks.push({ node: mv.node, phase: Math.random() * 6, ang: 0, vel: 0 });
      }
      // sea chests and barrels down in the hold, ship's stores
      const hy = plan.spec.decks[0];
      for (let i = 0; i < 4; i++) {
        const bs = new FurnitureNode(makeFurniture('misc', 'barrel_stack', modsFor(5 + i)));
        bs.group.position.set(-this.length * 0.25 + i * this.length * 0.14, hy, (i % 2 ? 1 : -1) * Math.min(1.6, plan.hb(0, hy + 0.5) - 1.2)); bs.group.rotation.y = Math.PI / 2;
        this.hold.add(bs.group);
      }
      for (let i = 0; i < 3; i++) {
        const ch = new FurnitureNode(makeFurniture('chest', 'sea', modsFor(i * 13 + 1)));
        ch.group.position.set(this.length * 0.05 + i * 1.6, hy, -Math.min(1.2, plan.hb(0, hy + 0.5) - 1.0)); ch.group.rotation.y = 0;
        this.hold.add(ch.group);
      }
      const hw = plan.hb(0, hy + 0.5) - 0.4;
      this.game.props.volumes.push({ obj: this.hold, box: new THREE.Box3(new THREE.Vector3(-this.length * 0.35, hy, -hw), new THREE.Vector3(this.length * 0.35, plan.spec.decks[1] - 0.2, hw)), carrier: this.holdCargo, moving: () => true });
      return;
    }
    // ---- a rowing boat ----
    this.model = rowboatModel();
    this.mass = 300;
    this.root.add(this.model);
    game.scene.add(this.root);
    const hb = new THREE.Box3().setFromObject(this.model, true);
    this.length = hb.max.x - hb.min.x; this.beam = hb.max.z - hb.min.z;
    this.deckY = 0.15; this.waterline = 0.25; this.draft = 0.4;
    this.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y - this.waterline, pos.z).setRotation(q).setLinearDamping(0.15).setAngularDamping(0.9).setCcdEnabled(true));
    const C = (hx: number, hy: number, hz: number, x: number, y: number, z: number, m: number) => { const c = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setMass(m).setFriction(0.9).setCollisionGroups(groups(G_VEHICLE, ALL)), this.body); ph.owners.set(c.handle, owner); return c; };
    C(this.length * 0.42, 0.12, this.beam * 0.32, 0, 0.12, 0, this.mass * 0.9);
    C(this.length * 0.45, 0.04, this.beam * 0.4, 0, 0.2, 0, this.mass * 0.05);
    for (const s of [-1, 1]) C(this.length * 0.45, 0.2, 0.05, 0, 0.35, s * this.beam * 0.42, 5);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) this.buoy.push(new THREE.Vector3(hb.min.x + (i + 0.5) / 4 * this.length, this.waterline - 0.6, s * this.beam * 0.3));
    this.wheel = new THREE.Object3D();
    this.wheel.position.set(-0.5, 0.15 + 1.05, 0);
    this.root.add(this.wheel);
    const wc = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.5).setTranslation(-0.4, 0.4, 0).setSensor(true).setCollisionGroups(groups(32, ALL)), this.body);
    ph.owners.set(wc.handle, { kind: 'movable_ship_wheel', interact: { name: () => `${this.name_} — oars`, actions: (g: Game) => this.helmActions(g) } });
  }

  // ---------- sails ----------
  private buildSail(sd: ShipPlan['sails'][number]) {
    const segU = 10, segV = 8;
    const g = new THREE.BufferGeometry();
    const P: number[] = [], U: number[] = [], I: number[] = [];
    const jib = sd as typeof sd & { jibFrom?: THREE.Vector3; jibTo?: THREE.Vector3 };
    for (let j = 0; j <= segV; j++) for (let i = 0; i <= segU; i++) {
      const u = i / segU, vv = j / segV;
      if (sd.jib && jib.jibFrom && jib.jibTo) {
        // a triangle: luff along the stay, foot along the bowsprit back toward the foremast
        const luff = jib.jibFrom.clone().lerp(jib.jibTo, vv);
        const foot = jib.jibFrom.clone().lerp(new THREE.Vector3(jib.jibTo.x + 0.8, jib.jibFrom.y + 0.4, 0), u * (1 - vv));
        const p = foot.clone().add(luff.clone().sub(jib.jibFrom));
        P.push(p.x, p.y, (u - 0.5) * 0.02);
      } else P.push(sd.x, sd.top - vv * (sd.top - sd.bottom), sd.z0 + u * (sd.z1 - sd.z0));
      U.push(u, 1 - vv);
    }
    for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) { const a = j * (segU + 1) + i; I.push(a, a + 1, a + segU + 1, a + 1, a + segU + 2, a + segU + 1); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I); g.computeVertexNormals(); g.computeBoundingBox();
    const bb = g.boundingBox!;
    const u = {
      uFurl: { value: 0 }, uBillow: { value: 0 }, uFlutter: { value: 0 }, uTrim: { value: 0 }, uTime: sharedUniforms.uTime as { value: number },
      uTop: { value: bb.max.y }, uBottom: { value: bb.min.y }, uZ0: { value: bb.min.z }, uZ1: { value: bb.max.z },
      uPivot: { value: new THREE.Vector3(sd.x - 0.55, 0, 0) },
    };
    const base = material('cloth:canvas|dye:cream') as THREE.MeshStandardMaterial;
    const m = base.clone();
    m.side = THREE.DoubleSide;
    if (!sd.jib) {
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + SAIL_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SAIL_VERT);
      };
      m.customProgramCacheKey = () => 'sail2';
    }
    this.game.lighting.prep(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.model.add(mesh);
    const area = (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z) * (sd.jib ? 0.5 : 1);
    this.sails.push({ mesh, u: u as never, top: bb.max.y, bottom: bb.min.y, area: sd.jib ? (bb.max.y - bb.min.y) * (bb.max.x - bb.min.x) * 0.5 : area, set: 0, target: 0, pin: new THREE.Vector3(sd.x, this.deckY + 1, this.beam * 0.42) });
    if (sd.jib) mesh.userData.jib = true;
  }
  get sailSet() { return this.sails.length ? this.sails.reduce((a, s) => a + s.set, 0) / this.sails.length : 0; }

  /** Is a world point inside this hull (below the weather deck, within the planking)? Water does not reach there. */
  contains(w: THREE.Vector3) {
    if (!this.plan) return false;
    const dx = w.x - this.root.position.x, dz = w.z - this.root.position.z;
    if (dx * dx + dz * dz > (this.length * 0.6) ** 2) return false;
    const l = w.clone().sub(this.root.position).applyQuaternion(this.root.quaternion.clone().invert());
    if (Math.abs(l.x) > this.length / 2 || l.y < 0.2 || l.y > this.plan.top(l.x)) return false;
    return Math.abs(l.z) < this.plan.hb(l.x, Math.min(l.y, this.plan.deckY)) - 0.05;
  }

  /** Fire every loaded gun on one side (+1 starboard, -1 larboard) in a rolling broadside. */
  broadside(side: 1 | -1, byPlayer = false) {
    if (!this.plan || this.reload[side] > 0) { if (byPlayer) this.game.hud.toast(this.reload[side] > 0 ? `${side > 0 ? 'Starboard' : 'Larboard'} guns reloading… ${Math.ceil(this.reload[side])}s` : 'No guns.'); return; }
    const guns = this.plan.guns.filter((gn) => gn.side === side);
    this.reload[side] = 20 + this.plan.guns.length * 0.05;
    const q = this.quat, p = this.pos;
    guns.forEach((gn, i) => setTimeout(() => {
      const muzzle = gn.pos.clone().applyQuaternion(this.quat).add(this.pos);
      const dir = new THREE.Vector3(0, 0.06 + Math.random() * 0.03, side).applyQuaternion(this.quat).normalize();
      dir.x += (Math.random() - 0.5) * 0.03; dir.z += (Math.random() - 0.5) * 0.03;
      this.game.war.fireBall(muzzle, dir, 120, this.side ?? 'vanguardia', byPlayer, this);
      // recoil: the hull heels away from the broadside
      this.body.applyImpulseAtPoint(dir.clone().multiplyScalar(-this.mass * 0.0015), muzzle, true);
    }, i * 90 + Math.random() * 60));
    void q; void p;
  }
  lanternLight: THREE.Object3D | null = null;

  get pos() { return v3(this.body.translation()); }
  get quat() { return q4(this.body.rotation()); }
  get yaw() { return new THREE.Euler().setFromQuaternion(this.quat, 'YXZ').y; }
  forward() { return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat); }

  name() { return this.name_; }
  actions(g: Game): Action[] { return this.helmActions(g).slice(0, 1); }
  helmActions(g: Game): Action[] {
    const acts: Action[] = [{ key: 'E', label: 'Take the helm', run: () => this.takeHelm() }];
    if (this.sails.length) acts.push({ key: 'F', label: this.sailSet > 0.5 ? 'Furl the sails' : 'Set the sails', run: () => { const t = this.sailSet > 0.5 ? 0 : 1; for (const s of this.sails) s.target = t; g.sound?.('sail', this.pos, 0.8); } });
    acts.push({ key: 'X', label: this.anchored ? 'Weigh anchor' : 'Drop anchor', run: () => { this.anchored = !this.anchored; g.hud.toast(this.anchored ? 'Anchor dropped.' : 'Anchor aweigh!'); } });
    return acts;
  }
  takeHelm() {
    const g = this.game, p = g.player;
    const seat: Seat & { dismountLabel: string } = {
      label: 'Helm', eye: 1.62, freeLook: true, dismountLabel: 'Leave the helm',
      getTransform: (pos, q) => { pos.copy(this.wheel.position.clone().add(new THREE.Vector3(-0.8, -1.05, 0)).applyQuaternion(this.quat).add(this.pos)); q.copy(this.quat); },
      drive: (inp: Input) => this.drive(inp),
      leave: () => { this.helmsman = false; },
    };
    this.helmsman = true;
    p.sitIn(seat);
    p.yaw = this.yaw - Math.PI / 2;
    g.hud.toast('At the helm: A/D wheel · W/S sails · Z/C trim yards · X anchor · E leave');
  }
  drive(inp: Input) {
    const dt = 1 / 60;
    if (!this.sails.length) this.row = (inp.key('KeyW') ? 1 : 0) - (inp.key('KeyS') ? 0.6 : 0);
    const turn = (inp.key('KeyA') ? 1 : 0) - (inp.key('KeyD') ? 1 : 0);
    this.rudder = THREE.MathUtils.clamp(this.rudder + turn * dt * 0.8, -1, 1);
    if (!turn) this.rudder *= 0.995;
    if (inp.hit('KeyW')) { for (const s of this.sails) s.target = Math.min(1, s.target + 0.34); this.game.sound?.('sail', this.pos, 0.6); }
    if (inp.hit('KeyS')) { for (const s of this.sails) s.target = Math.max(0, s.target - 0.34); this.game.sound?.('sail', this.pos, 0.6); }
    if (inp.key('KeyZ')) this.trim = Math.max(-0.7, this.trim - dt * 0.5);
    if (inp.key('KeyC')) this.trim = Math.min(0.7, this.trim + dt * 0.5);
    if (inp.hit('KeyX')) this.anchored = !this.anchored;
    // broadsides: Q larboard (left), R starboard (right)
    if (inp.hit('KeyQ')) this.broadside(-1, true);
    if (inp.hit('KeyR')) this.broadside(1, true);
  }

  /** Buoyancy, wind on the sails, keel resistance, rudder, anchor. */
  step(dt: number) {
    const g = this.game, b = this.body;
    this.reload[1] = Math.max(0, this.reload[1] - dt); this.reload[-1] = Math.max(0, this.reload[-1] - dt);
    const t = g.time, amp = waterUniforms.uWaveAmp.value;
    const q = this.quat, p = this.pos;
    const m = this.mass;
    let submergedPts = 0;
    for (const lp of this.buoy) {
      const wp = lp.clone().applyQuaternion(q).add(p);
      let wl = g.world.waterLevelAt(wp.x, wp.z);
      if (wl === 0) wl = seaHeight(wp.x, wp.z, t, amp);
      else wl += riverChop(wp.x, wp.z, t, amp);
      const depth = wl - wp.y;
      if (depth > 0) {
        submergedPts++;
        const f = Math.min(depth, 2.5) * m * 9.81 / this.buoy.length * 1.05 * this.buoyScale;
        b.applyImpulseAtPoint({ x: 0, y: f * dt, z: 0 }, wp, true);
        // water drag at that point
        const lv0 = b.linvel(), av0 = b.angvel();
        const r = wp.clone().sub(p);
        const v = new THREE.Vector3(av0.x, av0.y, av0.z).cross(r).add(new THREE.Vector3(lv0.x, lv0.y, lv0.z));
        // heave/roll damping at the hull (the water resists the hull moving up and down through it)
        b.applyImpulseAtPoint({ x: 0, y: -v.y * m * 1.1 * dt / this.buoy.length, z: 0 }, wp, true);
      }
    }
    // too deep a draught for the river: she grounds on the bed and drags to a halt
    const rl = g.world.waterLevelAt(p.x, p.z);
    if (rl !== 0) {
      const depthHere = rl - g.world.heightAt(p.x, p.z);
      if (depthHere < this.draft + 0.4) {
        const lv1 = b.linvel();
        b.setLinvel({ x: lv1.x * (1 - Math.min(1, dt * 2.5)), y: lv1.y, z: lv1.z * (1 - Math.min(1, dt * 2.5)) }, true);
        if (this.helmsman && (this.groundT -= dt) < 0) { this.groundT = 6; g.hud.toast(`${this.name_} draws ${this.draft.toFixed(1)} m — far too much water for the river. Put about!`); }
      }
    }
    // the river carries boats downstream
    const cur = g.world.currentAt(p.x, p.z);
    if (cur[0] || cur[1]) b.applyImpulse({ x: cur[0] * m * 0.15 * dt, y: 0, z: cur[1] * m * 0.15 * dt }, true);
    const fwd = this.forward().setY(0).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const lv = v3(b.linvel());
    const vf = lv.dot(fwd), vs = lv.dot(side);
    // keel: strong resistance to sideways slip
    b.applyImpulse(side.clone().multiplyScalar(-vs * m * (this.sails.length ? 1.6 : 2.5) * dt), true);
    // hull resistance through the water grows with the square of speed (wetted area x friction)
    const wetted = this.length * (this.beam + 2 * this.draft) * 0.7;
    const kf = 0.5 * 1000 * (this.sails.length ? 0.006 : 0.03) * wetted;
    b.applyImpulse(fwd.clone().multiplyScalar(-vf * Math.abs(vf) * kf * dt - vf * m * 0.004 * dt), true);
    // sails animate toward their set; wind force depends on the angle to the wind and the yard trim
    const wind = sharedUniforms.uWind.value;
    const wv = new THREE.Vector3(wind.x, 0, wind.y);
    const ws = wv.length() * 7 + 2;
    const wdir = wv.clone().normalize();
    // apparent wind across the sail; best when the sail is ~ perpendicular to the wind
    const sailNormal = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.trim);
    const across = Math.max(0, wdir.dot(sailNormal));
    const luff = 1 - across;
    let thrust = 0;
    for (const s of this.sails) {
      s.set += Math.sign(s.target - s.set) * Math.min(Math.abs(s.target - s.set), dt * 0.25);
      const set = s.set;
      (s.u.uFurl.value as number) = 1 - set;
      if (s.mesh.userData.jib) { s.mesh.visible = set > 0.03; s.mesh.scale.set(1, 1, 1); s.mesh.morphTargetInfluences = undefined; (s.mesh.material as THREE.Material).opacity = 1; s.mesh.scale.y = 1; s.mesh.userData.set = set; }
      (s.u.uBillow as { value: number }).value = THREE.MathUtils.lerp((s.u.uBillow as { value: number }).value, set * (0.25 + across * 1.1) * Math.sign(wdir.dot(fwd) + 0.2), dt * 2);
      (s.u.uFlutter as { value: number }).value = set * (0.05 + luff * 0.35);
      (s.u.uTrim as { value: number }).value = this.trim;
      // dynamic pressure of the wind on the canvas (air density x drag coefficient ~ 0.72)
      thrust += set * s.area * across * ws * ws * 1.0;
    }
    if (this.sails.length) b.applyImpulse(fwd.clone().multiplyScalar(Math.min(thrust, m * 2.2) * dt), true);
    this.dbg = { thrust, across, ws, vf, vs, kf, dt };
    // a small boat rows
    if (!this.sails.length && this.row) b.applyImpulse(fwd.clone().multiplyScalar(this.row * 700 * dt), true);
    // rudder: turning torque scales with speed through the water
    const turn = -this.rudder * vf * m * (this.sails.length ? 6 : 0.8);
    b.applyTorqueImpulse({ x: 0, y: turn * dt, z: 0 }, true);
    // the anchor holds the ship (with a little swing)
    if (this.anchored) b.applyImpulse({ x: -lv.x * m * 0.8 * dt, y: 0, z: -lv.z * m * 0.8 * dt }, true);
    if (submergedPts === 0) { /* airborne off a wave: gravity handles it */ }
    // record roll/pitch for hammocks
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    this.roll = e.x; this.pitch = e.z;
  }
  private groundT = 0;
  dbg: Record<string, number> = {};
  sync(dt: number) {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    for (const d of this.doors) d.update(dt);
    // the decks below and everything on them are only drawn when you could see them
    if (this.plan) { const dc = this.root.position.distanceTo(this.game.camera.position); this.hold.visible = dc < this.length * 1.6 + 40; }
    this.wheel.rotation.x = this.rudder * 4;
    // hammocks and the lantern: pendulums driven by the ship's roll
    for (const h of this.hammocks) {
      const target = -this.roll * 1.4 + Math.sin(this.game.time * 0.6 + h.phase) * 0.02;
      h.vel += (target - h.ang) * dt * 9 - h.vel * dt * 0.8;
      h.ang += h.vel * dt;
      h.node.rotation.x = h.ang;
    }
  }
}

function shipWheel() {
  const g = new GeoBuilder();
  const k = 'wood:dark|stain:chestnut|fin:varnished';
  const R = 0.55;
  for (let i = 0; i < 20; i++) { g.push().rotateX((i / 20) * Math.PI * 2).translate(0, R, 0); g.box(k, 0, 0, 0, 0.06, 0.07, 2 * Math.PI * R / 20 + 0.01, 2); g.pop(); }
  for (let i = 0; i < 8; i++) { g.push().rotateX((i / 8) * Math.PI * 2); g.box(k, 0, R * 0.65, 0, 0.04, R * 1.3, 0.04, 2); g.cyl(k, 0, R + 0.02, 0, 0.025, 0.02, 0.18, 8); g.pop(); }
  g.push().rotateZ(Math.PI / 2); g.cyl('brass', 0, -0.08, 0, 0.08, 0.08, 0.16, 12); g.pop();
  const grp = new THREE.Group();
  for (const m of meshesFrom(g.build())) grp.add(m);
  // pedestal
  const ped = new GeoBuilder();
  ped.box(k, -0.05, -0.55, 0, 0.18, 1.1, 0.25, 2);
  for (const m of meshesFrom(ped.build())) grp.add(m);
  return grp;
}

function rowboatModel() {
  const g = new GeoBuilder();
  const k = 'wood:weathered|stain:honey|fin:raw';
  const L = 4.2, B = 1.4;
  // lofted planks: each strake follows the hull curve
  for (let s = 0; s < 6; s++) {
    for (const side of [-1, 1]) for (let i = 0; i < 12; i++) {
      const t0 = i / 12, t1 = (i + 1) / 12;
      const x0 = -L / 2 + t0 * L, x1 = -L / 2 + t1 * L;
      const w = (t: number) => Math.sin(Math.PI * (0.08 + t * 0.84)) * (0.25 + s * 0.09) * B;
      const y = 0.08 + s * 0.11;
      const z0 = side * w(t0) * 0.5, z1 = side * w(t1) * 0.5;
      g.quad(k, new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x1, y + 0.12, z1 * 1.08), new THREE.Vector3(x0, y + 0.12, z0 * 1.08), [[0, 0], [1, 0], [1, 0.2], [0, 0.2]]);
      g.quad(k, new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z0), new THREE.Vector3(x0, y + 0.12, z0 * 1.08), new THREE.Vector3(x1, y + 0.12, z1 * 1.08), [[0, 0], [1, 0], [1, 0.2], [0, 0.2]]);
    }
  }
  g.box(k, 0, 0.1, 0, L * 0.8, 0.04, B * 0.35, 1.5);
  for (const x of [-0.8, 0.4]) g.box(k, x, 0.45, 0, 0.25, 0.04, B * 0.85, 1.5);
  for (const s of [-1, 1]) { g.push().translate(0.1, 0.62, s * 0.62).rotateZ(-0.25).rotateY(s * 0.3); g.cyl('wood:planks|stain:honey|fin:raw', 0, -1.2, 0, 0.025, 0.025, 2.4, 6); g.pop(); }
  const grp = new THREE.Group();
  const hull = new THREE.Group(); hull.name = 'hull';
  for (const m of meshesFrom(g.build())) { m.name = 'hull'; hull.add(m); }
  grp.add(hull);
  return grp;
}
