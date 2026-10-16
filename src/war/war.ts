// The river war: camps on both banks at every bridge, cannon batteries that duel across the water
// (smoke, recoil, crew reloading), skirmish waves that clash on the bridges, and — once you enlist —
// a squad that follows your orders. Cannons can be manned by the player.
import * as THREE from 'three';
import { material } from '../props/palette';
import { ROADS, riverX } from '../world/layout';
import { RAPIER, groups, G_STATIC, G_PROP, ALL, v3 } from '../physics/physics';
import type { Game } from '../game';
import { NPC } from '../npc/npc';
import type { Person } from '../world/towns';
import type { Bridge, Kingdom } from '../world/layout';
import { instanceModel } from '../props/models';
import { GeoBuilder } from '../build/geom';
import { meshesFrom } from '../props/palette';
import type { Action, Interactable } from '../player/interact';
import type { Seat } from '../player/player';
import type { Animal } from '../creature/animals';
import { Fronts } from './front';

type Side = 'vanguardia' | 'ironreach';
let SID = 1;

export class Soldier extends NPC {
  side: Side;
  order: 'advance' | 'follow' | 'hold' | 'charge' | 'line' = 'advance';
  squad = false;
  /** part of a column on the march (keeps its road path instead of the camp AI) */
  marching = false;
  standard = false;
  /** in a pitched battle: its place in the line, and what the line is doing */
  battle: { slot: THREE.Vector3; face: number; phase: 'form' | 'advance' | 'charge'; enemy: THREE.Vector3; id: number } | null = null;
  /** running flat out (charging, fleeing, catching up with the column) */
  sprint = false;
  /** cavalry: the horse under this soldier */
  horse: Animal | null = null;
  /** an archer: holds back behind the line and looses volleys */
  archer = false;
  /** marching to the front with a battalion (it joins the front's strength when it arrives) */
  battalion = false;
  /** leads the army in a pitched battle: while he lives, a beaten side surrenders rather than routs */
  commander = false;
  /** has thrown down his arms: kneels, and is not to be attacked */
  surrendered = false;
  /** seconds left during which he remembers seeing the player */
  alertT = 0;
  lookT = Math.random() * 0.5;
  /** a musketeer (an archer's place in the line, with a matchlock) */
  musket = false;
  volleyT = 0;
  constructor(game: Game, side: Side, pos: THREE.Vector3) {
    const person: Person = {
      id: 'soldier-' + SID++, name: side === 'vanguardia' ? ['Sir Aldo', 'Pikeman Bram', 'Archer Joss', 'Sergeant Wynne', 'Footman Cael', 'Hal of Millbrook'][SID % 6] : ['Varr Grunt', 'Iron Bjorn', 'Kael Ashhand', 'Ulf the Grim', 'Dagny', 'Thorvald'][SID % 6],
      age: 25, female: SID % 5 === 0, role: 'guard', home: 'camp', work: null, variant: 4, skin: SID % 5, hair: SID % 7, cloth1: SID * 999, cloth2: SID * 77, bed: -1, faction: side, temperament: 0.9,
    };
    super(game, person, pos);
    this.side = side;
    this.activity = 'patrol';
  }
}

interface Cannon {
  obj: THREE.Object3D; barrel: THREE.Object3D | null; pos: THREE.Vector3; yaw: number; pitch: number; side: Side;
  reload: number; recoil: number; loaded: boolean; manned: boolean; target: THREE.Vector3;
  /** field guns in a battle aim at the enemy army instead of the camp across the river */
  aim?: () => THREE.Vector3 | null;
  body?: RAPIER.RigidBody;
}

class CannonSeat implements Seat, Interactable {
  label = 'Cannon'; eye = 1.5; freeLook = true; dismountLabel = 'Leave the cannon';
  constructor(public war: War, public c: Cannon) {}
  getTransform(pos: THREE.Vector3, q: THREE.Quaternion) { pos.copy(this.c.pos).add(new THREE.Vector3(-Math.sin(this.c.yaw) * 1.6, 0, -Math.cos(this.c.yaw) * 1.6)); q.setFromEuler(new THREE.Euler(0, this.c.yaw, 0)); }
  drive(_i: unknown, dt: number) {
    const g = this.war.game, inp = g.input;
    // the player's look direction aims the barrel
    this.c.yaw = g.player.yaw + Math.PI;
    this.c.pitch = THREE.MathUtils.clamp(g.player.pitch + 0.1, -0.1, 0.5);
    if (inp.btnHit(0)) this.war.fire(this.c, true);
    if (inp.hit('KeyR') && !this.c.loaded && this.c.reload <= 0) { this.c.reload = 4; g.hud.toast('Reloading — swabbing, powder, wadding, shot…'); }
    void dt;
  }
  leave() { this.c.manned = false; }
  name() { return `Cannon (${this.c.side})${this.c.loaded ? ' · loaded' : ' · empty'}`; }
  actions(g: Game): Action[] { return [{ key: 'E', label: 'Man the cannon', run: () => { this.c.manned = true; g.player.sitIn(this); } }]; }
}

export class War {
  soldiers: Soldier[] = [];
  cannons: Cannon[] = [];
  balls: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number; side: Side; byPlayer: boolean; ship?: unknown; prev?: THREE.Vector3 }[] = [];
  camps: { bridge: Bridge; side: Side; pos: THREE.Vector3 }[] = [];
  enlisted: Side | null = null;
  private alarmT = 0;
  waveT = 30;
  battles = { vanguardia: 0, ironreach: 0 };
  group = new THREE.Group();
  fronts: Fronts;
  constructor(public game: Game) { game.scene.add(this.group); this.fronts = new Fronts(game, this); }

  /** Marching routes: roads that end at a bridge, oriented toward the river, per side. */
  routes: { side: Side; pts: THREE.Vector3[] }[] = [];
  columnT = 25;
  private buildRoutes() {
    const g = this.game;
    ROADS.forEach((rd, i) => {
      const first = rd.pts[0], last = rd.pts[rd.pts.length - 1];
      const end = typeof last === 'string' && last.startsWith('B') ? last : typeof first === 'string' && first.startsWith('B') ? first : null;
      const path = g.world.roads[i];
      if (!end || !path) return;
      const side: Side = end.endsWith('w') ? 'vanguardia' : 'ironreach';
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < path.pts.length; k += 9) pts.push(new THREE.Vector3(path.pts[k], path.pts[k + 2], path.pts[k + 1]));
      if (end === first) pts.reverse();
      this.routes.push({ side, pts });
    });
  }
  /** A pole in the right hand with the kingdom's banner streaming from its top. */
  carryStandard(s: Soldier) {
    const hand = s.rig.byName.handR;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 3.2, 8), material('wood:dark|stain:ebony|fin:oiled'));
    pole.castShadow = true;
    // the rig's bones are in its bind frame: place the pole upright in model space at the hand
    pole.position.set(0, 1.2, 0.05);
    hand.add(pole);
    const top = new THREE.Object3D(); top.position.set(0, 1.55, 0); pole.add(top);
    this.game.cloth.banner(top, 0.9, 1.2, s.side === 'vanguardia' ? 0x22407a : 0x7a1612, s);
  }
  spawnSoldier(side: Side, pos: THREE.Vector3, keepY = false) {
    const s = new Soldier(this.game, side, keepY ? pos.clone() : pos.clone().setY(this.game.world.heightAt(pos.x, pos.z)));
    this.game.physics.owners.set(s.collider.handle, { kind: 'soldier', soldier: s, npc: s });
    this.soldiers.push(s);
    return s;
  }
  /** A mounted soldier: a horse with a rider in armour (lance and sword), who charges at a gallop. */
  spawnCavalry(side: Side, pos: THREE.Vector3) {
    const g = this.game;
    const s = this.spawnSoldier(side, pos);
    const horse = g.spawnAnimal('horse', pos.clone().add(new THREE.Vector3(0.5, 0, 0)));
    s.horse = horse;
    horse.mode = 'cavalry';
    horse.owner = side;
    horse.npcRider = s.collider.handle;
    s.collider.setCollisionGroups(groups(16, ALL & ~16));   // the rider rides; the horse does the colliding
    return s;
  }
  /** A column of soldiers marching down a road to the war, in ranks behind a standard-bearer. */
  spawnColumn(side?: Side, n = 16, near = this.game.player.pos, from?: THREE.Vector3) {
    const g = this.game;
    if (!this.routes.length) this.buildRoutes();
    // a road of that side passing 150-500 m from `near`, joined at that point (or, marching out of a
    // barracks, the road to the front nearest its door)
    const cands: { r: { side: Side; pts: THREE.Vector3[] }; i: number }[] = [];
    if (from) {
      let best: { r: { side: Side; pts: THREE.Vector3[] }; i: number } | null = null, bd = 1e9;
      for (const r of this.routes) { if (side && r.side !== side) continue; for (let i = 0; i < r.pts.length - 8; i += 2) { const d = r.pts[i].distanceTo(from); if (d < bd) { bd = d; best = { r, i }; } } }
      if (best && bd < 700) cands.push(best);
    } else for (const r of this.routes) {
      if (side && r.side !== side) continue;
      for (let i = 0; i < r.pts.length - 8; i += 4) { const d = r.pts[i].distanceTo(near); if (d > 150 && d < 520) cands.push({ r, i }); }
    }
    if (!cands.length) for (const r of this.routes) if (!side || r.side === side) cands.push({ r, i: Math.max(0, r.pts.length - 60) });
    if (!cands.length) return 0;
    const { r, i } = cands[Math.floor(Math.random() * cands.length)];
    const route = r.pts.slice(i);
    const ranks = Math.ceil(n / 3);
    let made = 0;
    for (let k = 0; k < n; k++) {
      const rank = Math.floor(k / 3), file = (k % 3) - 1;
      // each soldier walks the road offset into its file, the rank trailing behind
      const path: THREE.Vector3[] = [];
      for (let j = 0; j < route.length; j++) {
        const a = route[Math.max(0, j - 1)], b = route[Math.min(route.length - 1, j + 1)];
        const dir = b.clone().sub(a).setY(0).normalize();
        const side3 = new THREE.Vector3(-dir.z, 0, dir.x);
        const q = route[j].clone().addScaledVector(side3, file * 1.3);
        q.y = g.world.heightAt(q.x, q.z);
        path.push(q);
      }
      const d0 = route[1].clone().sub(route[0]).setY(0).normalize();
      let start = path[0].clone().addScaledVector(d0, -rank * 1.9 - (ranks - rank) * 0);
      if (from) {
        // form up in front of the barracks, then march out onto the road
        const dOut = path[0].clone().sub(from).setY(0).normalize(), sd = new THREE.Vector3(-dOut.z, 0, dOut.x);
        start = from.clone().addScaledVector(dOut, -rank * 1.9).addScaledVector(sd, file * 1.3);
        path.unshift(from.clone().addScaledVector(sd, file * 1.3));
      }
      start.y = g.world.heightAt(start.x, start.z);
      const s = new Soldier(g, r.side, start);
      g.physics.owners.set(s.collider.handle, { kind: 'soldier', soldier: s, npc: s });
      s.battalion = true;
      s.path = from ? path : path.slice(1);
      s.st.yaw = Math.atan2(d0.x, d0.z);
      s.marching = true;
      if (k === 1) { s.standard = true; this.carryStandard(s); }
      this.soldiers.push(s);
      made++;
    }
    return made;
  }

  build() {
    const g = this.game;
    this.buildRoutes();
    this.fronts.build();
    for (const b of g.world.bridges) {
      const ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
      for (const [side, sgn] of [['vanguardia', -1], ['ironreach', 1]] as [Side, number][]) {
        const e = (b.len / 2 + 45) * sgn * (ax >= 0 ? 1 : -1);
        const pos = new THREE.Vector3(b.x + ax * e, 0, b.z + az * e);
        pos.y = g.world.heightAt(pos.x, pos.z);
        this.camps.push({ bridge: b, side, pos });
        this.buildCamp(pos, side, Math.atan2(-ax * sgn, -az * sgn));
        // two guns per bank, aimed across the river at the other camp
        for (const off of [-9, 9]) {
          const cp = pos.clone().add(new THREE.Vector3(az * off, 0, -ax * off)).add(new THREE.Vector3(-ax * sgn * 14, 0, -az * sgn * 14));
          cp.y = g.world.heightAt(cp.x, cp.z);
          const yaw = Math.atan2(-ax * sgn, -az * sgn);
          this.addCannon(cp, yaw, side);
        }
      }
    }
  }
  private buildCamp(pos: THREE.Vector3, side: Side, yaw: number) {
    const g = new GeoBuilder();
    const cloth = side === 'vanguardia' ? 'cloth:canvas|dye:cream' : 'cloth:canvas|dye:soot';
    g.translate(pos.x, pos.y, pos.z).rotateY(yaw);
    // tents: ridge tents of stretched canvas on poles
    for (let i = 0; i < 4; i++) {
      const tx = -9 + i * 6, tz = -6;
      g.push().translate(tx, 0, tz);
      for (const s of [-1, 1]) { g.push().translate(s * 0.9, 1.0, 0).rotateZ(s * 0.75); g.box(cloth, 0, 0, 0, 0.02, 2.6, 3.2, 0.5); g.pop(); }
      g.cyl('wood:planks|stain:walnut|fin:raw', 0, 0, -1.6, 0.04, 0.04, 1.95, 6); g.cyl('wood:planks|stain:walnut|fin:raw', 0, 0, 1.6, 0.04, 0.04, 1.95, 6);
      g.pop();
    }
    // banner
    g.cyl('wood:dark|stain:ebony|fin:oiled', 3, 0, 4, 0.05, 0.05, 6, 8);

    // campfire ring
    for (let i = 0; i < 9; i++) { const a = i * 0.7; g.ellipsoid('stone:stacked_stone_wall', Math.cos(a) * 0.7, 0.08, 4 + Math.sin(a) * 0.7 - 4, 0.14, 0.1, 0.12, 6); }
    for (const m of meshesFrom(g.build())) this.group.add(m);
    const pole = new THREE.Object3D();
    pole.position.set(3, 5.9, 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(pos);
    pole.rotation.y = yaw;
    this.game.scene.add(pole); pole.updateMatrixWorld(true);
    this.game.cloth.banner(pole, 1.3, 1.7, side === 'vanguardia' ? 0x22407a : 0x7a1612, pole);
    this.game.particles.emitters.push({ pos: pos.clone().add(new THREE.Vector3(0, 0.25, 0)), kind: 'campfire', acc: 0 });
    this.game.campfires.push(pos.clone().add(new THREE.Vector3(0, 0.4, 0)));
  }
  addCannon(pos: THREE.Vector3, yaw: number, side: Side) {
    const obj = instanceModel('cannon_01') ?? new THREE.Group();
    obj.position.copy(pos);
    obj.rotation.y = yaw;
    this.group.add(obj);
    let barrel: THREE.Object3D | null = null;
    obj.traverse((o) => { if (o.name.includes('barrel')) barrel = o; });
    const c: Cannon = { obj, barrel, pos: pos.clone(), yaw, pitch: 0.12, side, reload: Math.random() * 20, recoil: 0, loaded: true, manned: false, target: new THREE.Vector3() };
    this.cannons.push(c);
    const body = this.game.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y + 0.6, pos.z));
    const col = this.game.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.7, 0.6, 1.0).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).setCollisionGroups(groups(G_STATIC, ALL)), body);
    const seat = new CannonSeat(this, c);
    this.game.physics.owners.set(col.handle, { kind: 'cannon', interact: seat });
    c.body = body;
    return c;
  }
  removeCannon(c: Cannon) {
    c.obj.removeFromParent();
    if (c.body) this.game.physics.removeBody(c.body);
    const i = this.cannons.indexOf(c); if (i >= 0) this.cannons.splice(i, 1);
  }

  /** Fire: a real iron ball, a blast of smoke, and the gun leaps back on its carriage. */
  fire(c: Cannon, byPlayer = false) {
    const g = this.game;
    if (!c.loaded) { if (byPlayer) g.hud.toast('Not loaded — press R to reload.'); return; }
    c.loaded = false; c.recoil = 1; c.reload = byPlayer ? 0 : 18 + Math.random() * 14;
    const dir = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch));
    const muzzle = c.pos.clone().add(new THREE.Vector3(0, 1.0, 0)).addScaledVector(dir, 1.6);
    g.particles.emit('cannon', muzzle, 40, dir);
    g.particles.emit('spark', muzzle, 30);
    g.sound?.('cannon', muzzle, 2);
    if (c.pos.distanceTo(g.camera.position) < 60) g.shake = Math.max(g.shake, 0.6 * (1 - c.pos.distanceTo(g.camera.position) / 60));
    this.fireBall(muzzle, dir, 110, c.side, byPlayer, null, true);
  }
  private ballGeo = new THREE.SphereGeometry(0.075, 10, 8);
  private ballMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5 });
  /** A round shot from any gun (field pieces, ships' broadsides). */
  fireBall(muzzle: THREE.Vector3, dir: THREE.Vector3, speed: number, side: Side, byPlayer: boolean, ship: unknown = null, quiet = false) {
    const g = this.game;
    if (!quiet) {
      g.particles.emit('cannon', muzzle, 26, dir);
      g.particles.emit('spark', muzzle, 14);
      g.sound?.('cannon', muzzle, 1.6);
      const dc = muzzle.distanceTo(g.camera.position);
      if (dc < 80) g.shake = Math.max(g.shake, 0.45 * (1 - dc / 80));
    }
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(muzzle.x, muzzle.y, muzzle.z).setLinvel(dir.x * speed, dir.y * speed, dir.z * speed).setCcdEnabled(true));
    g.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.075).setMass(6).setCollisionGroups(groups(G_PROP, ALL)), body);
    const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
    this.group.add(mesh);
    this.balls.push({ body, mesh, t: 0, side, byPlayer, ship, prev: muzzle.clone() });
  }

  enlist(side: Kingdom) {
    if (side !== 'vanguardia' && side !== 'ironreach') return;
    this.enlisted = side;
    this.game.hud.toast(`You have enlisted with ${side === 'vanguardia' ? 'Vanguardia' : 'Ironreach'}. Find the camp by the bridges.`);
  }
  status() {
    return `${this.fronts.fronts.map((f) => this.fronts.status(f)).join('. ')}. Battles won: Vanguardia ${this.battles.vanguardia}, Ironreach ${this.battles.ironreach}. ${this.enlisted ? `You fight for ${this.enlisted === 'vanguardia' ? 'Vanguardia' : 'Ironreach'}.` : 'You are not sworn to either crown.'}`;
  }
  rumour(k: Kingdom) {
    const lines = [
      'They say the Bridgewatch garrison changed hands twice this month.',
      `Ironreach guns killed three on the King's Crossing last week.`,
      'Grain prices doubled since the barges stopped running.',
      'A Vanguardian patrol found an Ironreach scout in the reeds by Eastford.',
      'The North Span is the quietest crossing. For now.',
      'Deserters are hiding out on the Isle of Thorns, I hear.',
    ];
    return (k === 'ironreach' ? 'The southerners grow fat while we bleed for the river. ' : k === 'vanguardia' ? 'Those mountain savages want our fields. ' : '') + lines[Math.floor(Math.random() * lines.length)];
  }
  command(order: Soldier['order']) {
    const sq = this.soldiers.filter((s) => s.squad && s.alive);
    if (!sq.length) { this.game.hud.toast('You have no squad.'); return; }
    for (const s of sq) { s.order = order; s.holdAt = order === 'hold' ? s.st.pos.clone() : null; }
    this.game.hud.toast({ follow: 'Squad: on me!', hold: 'Squad: hold here!', charge: 'Squad: CHARGE!', line: 'Squad: form a line!', advance: '' }[order]);
    this.game.sound?.('shout', this.game.player.pos, 0.7);
  }

  update(dt: number) {
    const g = this.game, p = g.player.pos;
    // squad orders
    if (g.input.hit('Digit2')) this.command('follow');
    if (g.input.hit('Digit3')) this.command('hold');
    if (g.input.hit('Digit4')) this.command('charge');
    if (g.input.hit('Digit5')) this.command('line');
    // cannon animation + AI fire
    for (const c of this.cannons) {
      c.recoil = Math.max(0, c.recoil - dt * 1.2);
      const back = Math.sin(Math.min(1, c.recoil) * Math.PI) * 0.9 * c.recoil;
      c.obj.position.copy(c.pos).add(new THREE.Vector3(-Math.sin(c.yaw) * back, 0, -Math.cos(c.yaw) * back));
      c.obj.rotation.y = c.yaw;
      if (c.barrel) (c.barrel as THREE.Object3D).rotation.x = -c.pitch;
      if (!c.loaded) { c.reload -= dt; if (c.reload <= 0 && !c.manned) c.loaded = true; else if (c.reload <= 0 && c.manned && c.reload > -dt) { c.loaded = true; g.hud.toast('Loaded!'); } }
      if (!c.manned && c.loaded && c.pos.distanceTo(p) < 900 && c.reload <= 0) {
        // aim at the other bank's camp with some error, lob a shot
        const aimAt = c.aim ? c.aim() : this.camps.filter((k) => k.side !== c.side).sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos))[0]?.pos;
        const enemy = aimAt ? { pos: aimAt } : null;
        if (enemy) {
          const d = enemy.pos.distanceTo(c.pos);
          c.yaw = Math.atan2(enemy.pos.x - c.pos.x, enemy.pos.z - c.pos.z) + (Math.random() - 0.5) * (c.aim ? 0.04 : 0.08);
          c.pitch = 0.5 * Math.asin(Math.min(1, d * 9.81 / (110 * 110))) + (Math.random() - 0.5) * 0.02;
          this.fire(c);
        }
      }
    }
    // cannonballs: on impact, dirt and smoke and damage
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.t += dt;
      const pos = v3(b.body.translation());
      b.mesh.position.copy(pos);
      const v = b.body.linvel();
      const slow = Math.hypot(v.x, v.y, v.z) < 25 && b.t > 0.2;
      const water = pos.y < g.world.waterLevelAt(pos.x, pos.z);
      if (slow || water || b.t > 12) {
        const onShip = b.t < 12 && g.naval.hit(pos, (b.ship as never) ?? null, b.byPlayer);
        if (b.t < 12 && !onShip) {
          // walls take the blow (and crack, and fall); open ground gets a crater; kegs nearby go up
          g.destruct.impact(pos, 1, !water && pos.y - g.world.heightAt(pos.x, pos.z) < 1.2);
          g.residents.alarm(pos, 60);
          for (const pr of g.props.props) if (pr.def.id === 'powder' && pr.obj.position.distanceTo(pos) < 1.6) g.destruct.detonate(pr);
          g.particles.emit(water ? 'splash' : 'dust', pos, water ? 40 : 30);
          if (!water) { g.particles.emit('smoke', pos, 12); g.particles.emit('mud', pos, 20); }
          g.sound?.(water ? 'splash' : 'impact:wood', pos, 1.5);
          for (const s of this.soldiers) if (s.alive && s.st.pos.distanceTo(pos) < 4) s.hurt('torso', 70 * (1 - s.st.pos.distanceTo(pos) / 4), b.byPlayer ? 'player' : s);
          if (g.player.pos.distanceTo(pos) < 4) g.player.hurt('torso', 60 * (1 - g.player.pos.distanceTo(pos) / 4), 'cannon', 0.5);
          for (const pr of g.props.props) if (pr.obj.position.distanceTo(pos) < 5 && !pr.stowedIn) { g.props.wake(pr); pr.body?.applyImpulse(pr.obj.position.clone().sub(pos).normalize().multiplyScalar(30), true); }
        }
        g.physics.world.removeRigidBody(b.body); b.mesh.removeFromParent(); this.balls.splice(i, 1);
      }
    }
    // columns marching to the front along the roads, whichever kingdom you're in
    // grudges and favours fade
    for (const k of Object.keys(this.betrayT) as Side[]) this.betrayT[k] = Math.max(0, (this.betrayT[k] ?? 0) - dt);
    for (const k of Object.keys(this.favourT) as Side[]) this.favourT[k] = Math.max(0, (this.favourT[k] ?? 0) - dt);
    // the barracks train battalions without end and march them to the front; you meet them on the roads
    this.columnT -= dt;
    if (this.columnT <= 0) {
      this.columnT = 70 + Math.random() * 70;
      if (this.soldiers.filter((x) => x.alive).length < 150) {
        const bk = g.towns.plans.flatMap((pl) => pl.buildings.filter((b) => b.spec.type === 'barracks' && (pl.site.kingdom === 'vanguardia' || pl.site.kingdom === 'ironreach')).map((b) => ({ b, pl })))
          .filter(({ b }) => Math.hypot(b.x - p.x, b.z - p.z) < 1400).sort(() => Math.random() - 0.5)[0];
        const n = 18 + Math.floor(Math.random() * 5) * 3;
        if (bk) {
          const door = new THREE.Vector3(bk.b.x + Math.sin(bk.b.yaw) * (bk.b.spec.d / 2 + 6), 0, bk.b.z + Math.cos(bk.b.yaw) * (bk.b.spec.d / 2 + 6));
          const made = this.spawnColumn(bk.pl.site.kingdom as Side, n, p, door);
          if (made && door.distanceTo(p) < 700) { g.hud.toast(`Drums: a fresh battalion of ${made} marches out of the ${bk.pl.site.name} barracks for the front.`); g.sound?.('drums', door, 1); }
        } else this.spawnColumn(undefined, n);
      }
    }
    // battalions that reach the front join it (and leave the road) once you're not watching
    for (const s of this.soldiers) {
      if (!s.alive || !s.battalion || s.marching || s.battle || s.path.length || s.fightTarget) continue;
      if (s.st.pos.distanceTo(p) < 220) continue;
      const f = [...this.fronts.fronts].sort((a, b) => this.fronts.posAt(a, a.line).p.distanceTo(s.st.pos) - this.fronts.posAt(b, b.line).p.distanceTo(s.st.pos))[0];
      if (f) f.str[s.side] += 8;
      s.battalion = false; (s as Soldier & { joined?: boolean }).joined = true;
    }
    // skirmish waves near the player
    const nearCamp = this.camps.filter((c) => c.pos.distanceTo(p) < 700);
    this.waveT -= dt;
    this.fronts.update(dt);
    if (nearCamp.length && this.waveT <= 0 && this.soldiers.filter((s) => s.alive).length < 50) {
      this.waveT = 70 + Math.random() * 60;
      // enlisted players get a squad of their own
      if (this.enlisted && !this.soldiers.some((s) => s.squad && s.alive)) {
        for (let i = 0; i < 4; i++) {
          const sp = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5));
          sp.y = g.world.heightAt(sp.x, sp.z);
          const s = new Soldier(g, this.enlisted, sp); s.squad = true; s.order = 'follow';
          g.physics.owners.set(s.collider.handle, { kind: 'soldier', soldier: s, npc: s });
          this.soldiers.push(s);
        }
        g.hud.toast('Four soldiers fall in behind you. (2 follow · 3 hold · 4 charge · 5 line)');
      }
    }
    // a fight in the street sends townsfolk running
    this.alarmT -= dt;
    if (this.alarmT <= 0) { this.alarmT = 1; for (const s of this.soldiers) if (s.alive && s.fightTarget && s.st.pos.distanceTo(p) < 250) g.residents.alarm(s.st.pos, 28, false); }
    // soldier AI: pick the nearest enemy, else advance to the bridge or follow orders
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      if (s.surrendered) { s.fightTarget = null; s.hostile = false; continue; }
      const enemies = this.soldiers.filter((o) => o.alive && o.side !== s.side && !o.surrendered);
      let best: Soldier | null = null, bd = s.squad && s.order === 'follow' ? 18 : 60;
      for (const e of enemies) { const d = e.st.pos.distanceTo(s.st.pos); if (d < bd) { bd = d; best = e; } }
      if (s.order === 'hold' && best && bd > 8) best = null;
      if (s.battle && s.battle.phase !== 'charge' && bd > 14) best = null;
      // in a pitched battle each man fights whoever is in front of his own place in the line
      if (s.battle && s.battle.phase === 'charge') best = this.fronts.foeFor(s, s.horse ? 30 : 22);
      // never charge straight at a foe across the river: the line routes over the bridge instead
      if (best && bd > 6 && Math.sign(best.st.pos.x - riverX(best.st.pos.z)) !== Math.sign(s.st.pos.x - riverX(s.st.pos.z)) && !g.world.bridges.some((b) => Math.hypot(s.st.pos.x - b.x, s.st.pos.z - b.z) < b.len / 2 + 4)) best = null;
      if (s.marching) { if (best && bd < 25) s.marching = false; else best = null; if (s.marching && !s.path.length) s.marching = false; }
      s.fightTarget = best;
      // the player as an enemy: only once he has actually been seen (eyes with a field of view, range that falls
      // at night, walls and hills in the way), or heard right behind; remembered for a while after
      const dP = s.st.pos.distanceTo(p);
      const enemyOfPlayer = (!!this.enlisted && this.enlisted !== s.side && (this.favourT[s.side] ?? 0) <= 0) || (this.betrayT[s.side] ?? 0) > 0;
      s.lookT -= dt; s.alertT = Math.max(0, s.alertT - dt);
      if (enemyOfPlayer && dP < 75 && s.lookT <= 0) { s.lookT = 0.4 + Math.random() * 0.3; if (this.seesPlayer(s, dP)) s.alertT = 20; }
      s.hostile = enemyOfPlayer && s.alertT > 0 && dP < 45;
      if (!best && !s.hostile && !s.marching && !s.battle) {
        if (s.squad && (s.order === 'follow' || s.order === 'line')) {
          const idx = this.soldiers.filter((x) => x.squad).indexOf(s);
          const right = new THREE.Vector3(Math.cos(g.player.yaw), 0, -Math.sin(g.player.yaw));
          const back = new THREE.Vector3(Math.sin(g.player.yaw), 0, Math.cos(g.player.yaw));
          const slot = s.order === 'line' ? p.clone().addScaledVector(right, (idx - 1.5) * 1.6).addScaledVector(back, -1) : p.clone().addScaledVector(back, 2 + (idx >> 1) * 1.5).addScaledVector(right, (idx % 2 ? 1 : -1) * 1.2);
          s.path = [slot];
        } else if (s.order === 'charge' || s.order === 'advance') {
          const bridge = this.camps.find((c) => c.side === s.side && c.pos.distanceTo(s.st.pos) < 900)?.bridge;
          if (bridge && !s.path.length) s.path = [new THREE.Vector3(bridge.x + (Math.random() - 0.5) * 6, bridge.deck, bridge.z + (Math.random() - 0.5) * 3)];
        }
      }
    }
    // bodies are cleaned up after a while; victories counted per bridge
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i];
      const drop = () => { if (s.horse) { const h = s.horse; s.horse = null; const k = g.fauna.extra.indexOf(h); if (k >= 0) g.fauna.extra.splice(k, 1); h.dispose(); } s.dispose(); this.soldiers.splice(i, 1); };
      if (!s.alive) { (s as Soldier & { deadT?: number }).deadT = ((s as Soldier & { deadT?: number }).deadT ?? 0) + dt; if ((s as Soldier & { deadT?: number }).deadT! > 120) drop(); }
      else if ((s.st.pos.distanceTo(p) > 1000 || (s as Soldier & { joined?: boolean }).joined) && !this.fronts.fronts.some((f) => f.live?.ids.has(s)) && !this.fronts.fields.some((f) => f.live?.ids.has(s))) drop();
    }

  }
  /** grudges and favours toward the player, per side (seconds left) */
  betrayT: Partial<Record<Side, number>> = {};
  favourT: Partial<Record<Side, number>> = {};
  /** Can this soldier see the player? A ~150° field of view, 70 m by day (less at night, more if you're
   *  sprinting), and a clear line of sight. */
  seesPlayer(s: Soldier, d: number) {
    const g = this.game, P = g.player;
    if (d < 3.5) return true;
    const night = 1 - g.lighting.dayFactor;
    const range = 70 * (1 - night * 0.6) * (P.crouch ? 0.6 : 1) + (P.noise ?? 0) * 20;
    if (d > range) return false;
    const eye = s.st.pos.clone().add(new THREE.Vector3(0, 1.62, 0)), to = P.eyePos().sub(eye);
    const fwd = new THREE.Vector3(Math.sin(s.st.yaw), 0, Math.cos(s.st.yaw));
    if (fwd.dot(to.clone().setY(0).normalize()) < -0.26) return false;
    const hit = g.physics.ray(eye, to.clone().normalize(), Math.max(0.1, to.length() - 0.6), groups(ALL, G_STATIC), s.collider);
    return !hit;
  }
  /** The player struck (or killed) a soldier. Strike your own side and they turn on you — and the enemy,
   *  seeing it, cheers you on and holds its fire for a while. Strike a side you don't serve and that side
   *  hunts you. */
  playerStruck(s: Soldier, killed: boolean) {
    const g = this.game;
    const other: Side = s.side === 'vanguardia' ? 'ironreach' : 'vanguardia';
    this.betrayT[s.side] = Math.max(this.betrayT[s.side] ?? 0, this.enlisted === s.side ? 240 : 150);
    for (const o of this.soldiers) if (o.alive && o.side === s.side && o.st.pos.distanceTo(s.st.pos) < 60) o.alertT = 25;
    if (this.enlisted === s.side) {
      g.hud.toast(killed ? `You cut down one of your own! The ${s.side === 'vanguardia' ? 'Vanguardian' : 'Ironreach'} ranks turn on you, traitor.` : 'You struck one of your own men!');
      if (killed) {
        this.favourT[other] = 150;
        const cheer = ['Ha! Look — he\'s killing his own!', 'Well struck, turncoat! Keep at it!', 'Their own man did it for us!', 'Hah! One less for us to kill!'];
        let n = 0;
        for (const o of this.soldiers) if (o.alive && o.side === other && o.st.pos.distanceTo(g.player.pos) < 90 && n < 4) { o.say(cheer[n % cheer.length], true); o.fightTarget = null; o.hostile = false; n++; }
      }
    }
  }
  /** One shot from an archer or musketeer at a point: a lobbed arrow, or a flat musket ball with smoke. */
  volley(s: Soldier, target: THREE.Vector3) {
    const g = this.game;
    if (s.musket) {
      s.volleyT = 13 + Math.random() * 6;
      const from = s.st.pos.clone().add(new THREE.Vector3(0, 1.45, 0)), to = target.clone().add(new THREE.Vector3(0, 1.1, 0));
      const dir = to.sub(from).normalize();
      dir.x += (Math.random() - 0.5) * 0.05; dir.y += (Math.random() - 0.5) * 0.03 + 0.004; dir.z += (Math.random() - 0.5) * 0.05;
      dir.normalize();
      from.addScaledVector(dir, 1.1);
      g.combat.shoot(from, dir.multiplyScalar(260), 70, false);
      g.particles.emit('smoke', from, 10); g.particles.emit('spark', from, 6);
      g.sound?.('musket', from, 1.2);
      g.residents.alarm(from, 35, false);
      return;
    }
    s.volleyT = 4 + Math.random() * 2.5;
    const from = s.st.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), to = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 5, 1.0, (Math.random() - 0.5) * 5));
    const flat = Math.hypot(to.x - from.x, to.z - from.z), V = 48;
    const disc = V ** 4 - 9.81 * (9.81 * flat * flat + 2 * (to.y - from.y) * V * V);
    const ang = disc > 0 ? Math.atan((V * V - Math.sqrt(disc)) / (9.81 * flat)) : Math.PI / 4;
    const hd = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
    const vel = hd.multiplyScalar(V * Math.cos(ang)).setY(V * Math.sin(ang));
    from.addScaledVector(vel.clone().normalize(), 0.9);
    g.combat.shoot(from, vel, 30, false);
    g.sound?.('swing', from, 0.25);
  }
  step(dt: number) { for (const s of this.soldiers) s.step(dt); }
  animate(dt: number) {
    const cam = this.game.camera.position;
    for (const s of this.soldiers) { const a = s.lod.step(s.rig, s.st.pos.distanceTo(cam), dt); if (a > 0) s.animate(a); }
  }
}
