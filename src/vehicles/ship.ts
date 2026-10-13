// Sailing ships and rowing boats. Hulls float on the Gerstner sea / river by sampling buoyancy points;
// sails (each split into its own cloth) billow, flutter when luffing, can be raised and lowered and
// their yards trimmed to the wind. Steer with the wheel (rudder torque grows with speed). Walk the
// rolling deck, go down the hatch to the hold where hammocks swing with the sea.
import * as THREE from 'three';
import { RAPIER, groups, G_VEHICLE, ALL, v3, q4 } from '../physics/physics';
import type { Game } from '../game';
import { instanceModel } from '../props/models';
import { seaHeight, waterUniforms } from '../render/water';
import { sharedUniforms } from '../render/pipeline';
import { GeoBuilder } from '../build/geom';
import { meshesFrom } from '../props/palette';
import type { Action, Interactable } from '../player/interact';
import type { Seat } from '../player/player';
import type { Input } from '../core/input';
import { makeFurniture, modsFor } from '../props/furniture';
import { FurnitureNode } from '../props/furnish';
import type { Prop } from '../props/props';

interface Sail { mesh: THREE.Mesh; u: Record<string, { value: number | THREE.Vector3 }>; top: number; bottom: number; area: number; set: number; target: number; pin: THREE.Vector3 }

const SAIL_VERT = /* glsl */ `
  uniform float uFurl, uBillow, uFlutter, uTrim, uTime, uTop, uBottom, uZ0, uZ1;
  uniform vec3 uPivot;
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
  buoy: THREE.Vector3[] = [];
  mass: number;
  hammocks: { node: THREE.Object3D; phase: number; ang: number; vel: number }[] = [];
  hold = new THREE.Group();
  holdCargo: { contents: Prop[] } = { contents: [] };
  roll = 0; pitch = 0;
  name_: string;
  river = false;
  row = 0;
  constructor(public game: Game, pos: THREE.Vector3, yaw: number, public kind: 'ship' | 'boat', name: string) {
    this.name_ = name;
    const ph = game.physics;
    if (kind === 'ship') {
      this.model = instanceModel('dutch_ship_medium') ?? new THREE.Group();
      this.mass = 140000;
    } else {
      this.model = rowboatModel();
      this.mass = 300;
    }
    this.root.add(this.model);
    game.scene.add(this.root);
    // measure the hull: bounds and the deck height profile (ray-cast the hull mesh from above)
    let hull: THREE.Mesh | null = null, sailMesh: THREE.Mesh | null = null;
    this.model.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (o.name.includes('hull') || kind === 'boat') hull = hull ?? m; if (o.name.includes('sail')) sailMesh = m; });
    this.root.updateMatrixWorld(true);
    const hb = new THREE.Box3().setFromObject(hull ?? this.model, true);
    this.length = hb.max.x - hb.min.x; this.beam = hb.max.z - hb.min.z;
    const rc = new THREE.Raycaster();
    const deck: { x: number; y: number; hw: number }[] = [];
    const slices = kind === 'ship' ? 18 : 6;
    for (let i = 0; i < slices; i++) {
      const x = hb.min.x + 0.8 + (i / (slices - 1)) * (this.length - 1.6);
      let top = -1e9, hw = 0;
      for (let k = -4; k <= 4; k++) {
        const z = (k / 4) * this.beam * 0.45;
        rc.set(new THREE.Vector3(x, hb.max.y + 5, z), new THREE.Vector3(0, -1, 0));
        const hit = hull ? rc.intersectObject(hull, false)[0] : null;
        if (hit) { top = Math.max(top, k === 0 ? hit.point.y : top); if (Math.abs(z) > hw) hw = Math.abs(z); if (k === 0) top = hit.point.y; }
      }
      if (top > -1e8) deck.push({ x, y: top, hw: Math.max(0.6, hw) });
    }
    const mid = deck[Math.floor(deck.length / 2)];
    this.deckY = Number.isFinite(mid?.y) ? mid!.y : (Number.isFinite(hb.max.y) ? hb.max.y - 1 : 4);
    if (!Number.isFinite(this.length) || this.length <= 0) { this.length = 22; this.beam = 5; }
    this.waterline = hb.min.y + (this.deckY - hb.min.y) * (kind === 'ship' ? 0.42 : 0.35);
    // physics body: a keel volume + deck slabs following the sheer, railings, all one compound
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y - this.waterline, pos.z).setRotation(q).setLinearDamping(0.15).setAngularDamping(0.9).setCcdEnabled(kind === 'boat'));
    const owner = { kind: 'ship', interact: this, ship: this };
    const C = (hx: number, hy: number, hz: number, x: number, y: number, z: number, m: number) => { const c = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setMass(m).setFriction(0.9).setCollisionGroups(groups(G_VEHICLE, ALL)), this.body); ph.owners.set(c.handle, owner); return c; };
    const keelH = (this.deckY - hb.min.y) / 2;
    C(this.length * 0.42, keelH * 0.7, this.beam * 0.32, (hb.min.x + hb.max.x) / 2, hb.min.y + keelH * 0.7, 0, this.mass * 0.9);
    // the hatch to the hold is left open in the deck slabs
    const hatchX = (hb.min.x + hb.max.x) / 2 - 1, hatchHalf = 0.55;
    for (let i = 0; i < deck.length; i++) {
      const d = deck[i], dx = this.length / slices;
      if (kind === 'ship' && Math.abs(d.x - hatchX) < hatchHalf + dx / 2) {
        // split this slab around the hatch
        C(dx / 2 + 0.02, 0.1, (d.hw - hatchHalf) / 2, d.x, d.y - 0.1, hatchHalf + (d.hw - hatchHalf) / 2, this.mass * 0.005);
        C(dx / 2 + 0.02, 0.1, (d.hw - hatchHalf) / 2, d.x, d.y - 0.1, -hatchHalf - (d.hw - hatchHalf) / 2, this.mass * 0.005);
      } else C(dx / 2 + 0.02, 0.1, d.hw, d.x, d.y - 0.1, 0, this.mass * 0.01 / deck.length);
      // railings so nobody slides off in a swell
      for (const s of [-1, 1]) C(dx / 2 + 0.02, kind === 'ship' ? 0.55 : 0.2, 0.06, d.x, d.y + (kind === 'ship' ? 0.5 : 0.15), s * (d.hw + 0.05), 10);
    }
    // buoyancy sample points around the waterline
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) this.buoy.push(new THREE.Vector3(hb.min.x + (i + 0.5) / 6 * this.length, this.waterline - 0.6, s * this.beam * 0.32));
    // wheel at the stern
    this.wheel = shipWheel();
    const aft = deck[Math.min(deck.length - 1, 2)] ?? { x: hb.min.x + 3, y: this.deckY };
    this.wheel.position.set(aft.x + 0.8, aft.y + 1.05, 0);
    this.root.add(this.wheel);
    const wc = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, 0.6, 0.6).setTranslation(aft.x + 0.8, aft.y + 0.9, 0).setSensor(true).setCollisionGroups(groups(32, ALL)), this.body);
    ph.owners.set(wc.handle, { kind: 'movable_ship_wheel', interact: { name: () => `${this.name_} — ship's wheel`, actions: (g: Game) => this.helmActions(g) } });
    if (kind === 'ship' && sailMesh) this.splitSails(sailMesh);
    if (kind === 'ship') this.buildHold(hatchX, hatchHalf);
  }

  // ---------- sails ----------
  private splitSails(src: THREE.Mesh) {
    const geo = src.geometry.index ? src.geometry : src.geometry;
    const idx = geo.index!.array as ArrayLike<number>;
    const pos = geo.getAttribute('position');
    const n = pos.count;
    const parent = new Int32Array(n).map((_, i) => i);
    const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    for (let i = 0; i < idx.length; i += 3) { const a = find(idx[i]), b = find(idx[i + 1]), c = find(idx[i + 2]); parent[b] = a; parent[c] = a; }
    // also join components whose vertices coincide (sails are often split at seams)
    const groupsMap = new Map<number, number[]>();
    for (let i = 0; i < idx.length; i += 3) { const r = find(idx[i]); let arr = groupsMap.get(r); if (!arr) { arr = []; groupsMap.set(r, arr); } arr.push(idx[i], idx[i + 1], idx[i + 2]); }
    const mat = src.material as THREE.MeshStandardMaterial;
    src.visible = false;
    const m4 = new THREE.Matrix4().copy(src.matrix);
    const v = new THREE.Vector3();
    for (const tri of groupsMap.values()) {
      if (tri.length < 30) continue;
      const g = new THREE.BufferGeometry();
      const remap = new Map<number, number>();
      const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = [];
      const nrm = geo.getAttribute('normal'), uv = geo.getAttribute('uv');
      for (const vi of tri) {
        let ni = remap.get(vi);
        if (ni === undefined) {
          ni = P.length / 3; remap.set(vi, ni);
          v.fromBufferAttribute(pos, vi).applyMatrix4(m4); P.push(v.x, v.y, v.z);
          v.fromBufferAttribute(nrm, vi).transformDirection(m4); N.push(v.x, v.y, v.z);
          if (uv) U.push(uv.getX(vi), uv.getY(vi)); else U.push(0, 0);
        }
        I.push(ni);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(I);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const u = {
        uFurl: { value: 0 }, uBillow: { value: 0 }, uFlutter: { value: 0 }, uTrim: { value: 0 }, uTime: sharedUniforms.uTime as { value: number },
        uTop: { value: bb.max.y }, uBottom: { value: bb.min.y }, uZ0: { value: bb.min.z }, uZ1: { value: bb.max.z },
        uPivot: { value: new THREE.Vector3((bb.min.x + bb.max.x) / 2, 0, 0) },
      };
      const m = mat.clone();
      m.side = THREE.DoubleSide;
      const prev = mat.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SAIL_VERT);
      };
      m.customProgramCacheKey = () => 'sail';
      this.game.lighting.prep(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      src.parent!.add(mesh);
      const area = (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z);
      this.sails.push({ mesh, u: u as never, top: bb.max.y, bottom: bb.min.y, area, set: 0, target: 0, pin: new THREE.Vector3((bb.min.x + bb.max.x) / 2, this.deckY + 1, this.beam * 0.42) });
    }
    // start furled while moored
    for (const s of this.sails) { s.set = 0; s.target = 0; }
  }
  get sailSet() { return this.sails.length ? this.sails.reduce((a, s) => a + s.set, 0) / this.sails.length : 0; }

  // ---------- hold below deck ----------
  private buildHold(hatchX: number, hatchHalf: number) {
    const g = new GeoBuilder();
    const floorY = this.deckY - 2.4, x0 = hatchX - 4.5, x1 = hatchX + 4.5, hz = this.beam * 0.36;
    const plank = 'wood:weathered|stain:walnut|fin:raw|in:1';
    g.box(plank, (x0 + x1) / 2, floorY, 0, x1 - x0, 0.08, hz * 2, 1.2);
    for (const s of [-1, 1]) g.box(plank, (x0 + x1) / 2, floorY + 1.2, s * hz, x1 - x0, 2.4, 0.06, 1.2);
    for (const x of [x0, x1]) g.box(plank, x, floorY + 1.2, 0, 0.06, 2.4, hz * 2, 1.2);
    // ceiling planks with the hatch opening; deck beams
    g.box(plank, (x0 + hatchX - hatchHalf) / 2, this.deckY - 0.25, 0, hatchX - hatchHalf - x0, 0.05, hz * 2, 1.2);
    g.box(plank, (hatchX + hatchHalf + x1) / 2, this.deckY - 0.25, 0, x1 - hatchX - hatchHalf, 0.05, hz * 2, 1.2);
    for (const s of [-1, 1]) g.box(plank, hatchX, this.deckY - 0.25, s * (hatchHalf + (hz - hatchHalf) / 2), hatchHalf * 2, 0.05, hz - hatchHalf, 1.2);
    for (let i = 0; i < 8; i++) g.box('wood:dark|stain:ebony|fin:raw|in:1', x0 + 0.5 + i * (x1 - x0 - 1) / 7, this.deckY - 0.38, 0, 0.18, 0.2, hz * 2, 2);
    // ladder down the hatch
    for (let i = 0; i < 8; i++) g.box('wood:planks|stain:honey|fin:raw|in:1', hatchX + 0.3 - i * 0.07, floorY + 0.3 + i * 0.28, 0, 0.08, 0.04, 0.7, 2);
    for (const s of [-1, 1]) { g.push().translate(hatchX + 0.05, floorY + 1.2, s * 0.36).rotateZ(0.25); g.box('wood:planks|stain:honey|fin:raw|in:1', 0, 0, 0, 0.07, 2.6, 0.07, 2); g.pop(); }
    // hatch coaming on deck + a dark opening so it reads from above
    g.box('wood:dark|stain:ebony|fin:raw', hatchX, this.deckY + 0.06, 0, hatchHalf * 2 + 0.2, 0.12, hatchHalf * 2 + 0.2, 2);
    for (const m of meshesFrom(g.build())) this.hold.add(m);
    this.root.add(this.hold);
    const ph = this.game.physics;
    const C = (hx: number, hy: number, hz2: number, x: number, y: number, z: number) => { const c = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz2).setTranslation(x, y, z).setMass(1).setCollisionGroups(groups(G_VEHICLE, ALL)), this.body); ph.owners.set(c.handle, { kind: 'ship', interact: this, ship: this }); };
    C((x1 - x0) / 2, 0.05, hz, (x0 + x1) / 2, floorY, 0);
    for (const s of [-1, 1]) C((x1 - x0) / 2, 1.2, 0.05, (x0 + x1) / 2, floorY + 1.2, s * hz);
    for (const x of [x0, x1]) C(0.05, 1.2, hz, x, floorY + 1.2, 0);
    // a ramp collider along the ladder so you can climb it
    const ang = Math.atan2(2.3, 0.6);
    const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang + Math.PI / 2);
    const lc = ph.world.createCollider(RAPIER.ColliderDesc.cuboid(1.2, 0.05, 0.35).setTranslation(hatchX + 0.05, floorY + 1.2, 0).setRotation(qq).setCollisionGroups(groups(G_VEHICLE, ALL)), this.body);
    ph.owners.set(lc.handle, { kind: 'ship', interact: this, ship: this });
    // hammocks slung between the beams, sea chests, barrels, a swinging lantern
    for (let i = 0; i < 6; i++) {
      const mods = modsFor(i * 31 + 7);
      const fm = makeFurniture('hammock', i % 2 ? 'net' : 'canvas', mods);
      const node = new FurnitureNode(fm);
      node.group.position.set(x0 + 1.2 + (i >> 1) * 2.6, this.deckY - 0.55, (i % 2 ? 1 : -1) * hz * 0.5);
      node.group.rotation.y = 0;
      this.hold.add(node.group);
      for (const mv of node.movables) this.hammocks.push({ node: mv.node, phase: Math.random() * 6, ang: 0, vel: 0 });
    }
    for (let i = 0; i < 3; i++) {
      const ch = new FurnitureNode(makeFurniture('chest', 'sea', modsFor(i * 13 + 1)));
      ch.group.position.set(x0 + 1 + i * 2.8, floorY + 0.04, -hz + 0.35); ch.group.rotation.y = 0;
      this.hold.add(ch.group);
    }
    const bs = new FurnitureNode(makeFurniture('misc', 'barrel_stack', modsFor(5)));
    bs.group.position.set(x1 - 1.2, floorY + 0.04, hz - 0.6); bs.group.rotation.y = Math.PI / 2;
    this.hold.add(bs.group);
    const lantern = instanceModel('Lantern_01');
    if (lantern) { lantern.position.set(hatchX - 2, this.deckY - 0.75, 0); this.hold.add(lantern); this.hammocks.push({ node: lantern, phase: 0, ang: 0, vel: 0 }); this.lanternLight = lantern; }
    this.game.props.volumes.push({ obj: this.hold, box: new THREE.Box3(new THREE.Vector3(x0, floorY, -hz), new THREE.Vector3(x1, this.deckY - 0.3, hz)), carrier: this.holdCargo, moving: () => true });
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
  }

  /** Buoyancy, wind on the sails, keel resistance, rudder, anchor. */
  step(dt: number) {
    const g = this.game, b = this.body;
    const t = g.time, amp = waterUniforms.uWaveAmp.value;
    const q = this.quat, p = this.pos;
    const m = this.mass;
    let submergedPts = 0;
    for (const lp of this.buoy) {
      const wp = lp.clone().applyQuaternion(q).add(p);
      let wl = g.world.waterLevelAt(wp.x, wp.z);
      if (wl === 0) wl = seaHeight(wp.x, wp.z, t, amp);
      const depth = wl - wp.y;
      if (depth > 0) {
        submergedPts++;
        const f = Math.min(depth, 2.5) * m * 9.81 / this.buoy.length * 1.05;
        b.applyImpulseAtPoint({ x: 0, y: f * dt, z: 0 }, wp, true);
        // water drag at that point
        const lv0 = b.linvel(), av0 = b.angvel();
        const r = wp.clone().sub(p);
        const v = new THREE.Vector3(av0.x, av0.y, av0.z).cross(r).add(new THREE.Vector3(lv0.x, lv0.y, lv0.z));
        b.applyImpulseAtPoint({ x: -v.x * m * 0.02 * dt, y: -v.y * m * 0.6 * dt / this.buoy.length, z: -v.z * m * 0.02 * dt }, wp, true);
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
      (s.u.uBillow as { value: number }).value = THREE.MathUtils.lerp((s.u.uBillow as { value: number }).value, set * (0.25 + across * 1.1) * Math.sign(wdir.dot(fwd) + 0.2), dt * 2);
      (s.u.uFlutter as { value: number }).value = set * (0.05 + luff * 0.35);
      (s.u.uTrim as { value: number }).value = this.trim;
      thrust += set * s.area * across * ws * ws * 0.6;
    }
    if (this.sails.length) b.applyImpulse(fwd.clone().multiplyScalar(Math.min(thrust, m * 2.2) * dt), true);
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
  sync(dt: number) {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
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
