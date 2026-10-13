// The river war: camps on both banks at every bridge, cannon batteries that duel across the water
// (smoke, recoil, crew reloading), skirmish waves that clash on the bridges, and — once you enlist —
// a squad that follows your orders. Cannons can be manned by the player.
import * as THREE from 'three';
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

type Side = 'vanguardia' | 'ironreach';
let SID = 1;

export class Soldier extends NPC {
  side: Side;
  order: 'advance' | 'follow' | 'hold' | 'charge' | 'line' = 'advance';
  squad = false;
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
  balls: { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number; side: Side; byPlayer: boolean }[] = [];
  camps: { bridge: Bridge; side: Side; pos: THREE.Vector3 }[] = [];
  enlisted: Side | null = null;
  waveT = 30;
  battles = { vanguardia: 0, ironreach: 0 };
  group = new THREE.Group();
  constructor(public game: Game) { game.scene.add(this.group); }

  build() {
    const g = this.game;
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
    g.box(`cloth:velvet|dye:${side === 'vanguardia' ? 'woad' : 'madder'}`, 3.6, 5.2, 4, 1.2, 1.6, 0.02, 1);
    // campfire ring
    for (let i = 0; i < 9; i++) { const a = i * 0.7; g.ellipsoid('stone:stacked_stone_wall', Math.cos(a) * 0.7, 0.08, 4 + Math.sin(a) * 0.7 - 4, 0.14, 0.1, 0.12, 6); }
    for (const m of meshesFrom(g.build())) this.group.add(m);
    this.game.particles.emitters.push({ pos: pos.clone().add(new THREE.Vector3(0, 0.25, 0)), kind: 'campfire', acc: 0 });
    this.game.campfires.push(pos.clone().add(new THREE.Vector3(0, 0.4, 0)));
  }
  private addCannon(pos: THREE.Vector3, yaw: number, side: Side) {
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
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(muzzle.x, muzzle.y, muzzle.z).setLinvel(dir.x * 110, dir.y * 110, dir.z * 110).setCcdEnabled(true));
    g.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.06).setMass(6).setCollisionGroups(groups(G_PROP, ALL)), body);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5 }));
    this.group.add(mesh);
    this.balls.push({ body, mesh, t: 0, side: c.side, byPlayer });
  }

  enlist(side: Kingdom) {
    if (side !== 'vanguardia' && side !== 'ironreach') return;
    this.enlisted = side;
    this.game.hud.toast(`You have enlisted with ${side === 'vanguardia' ? 'Vanguardia' : 'Ironreach'}. Find the camp by the bridges.`);
  }
  status() {
    return `Vanguardia holds ${this.battles.vanguardia} skirmish victories, Ironreach ${this.battles.ironreach}. ${this.enlisted ? `You fight for ${this.enlisted === 'vanguardia' ? 'Vanguardia' : 'Ironreach'}.` : 'You are not sworn to either crown.'}`;
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
        const enemy = this.camps.filter((k) => k.side !== c.side).sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos))[0];
        if (enemy) {
          const d = enemy.pos.distanceTo(c.pos);
          c.yaw = Math.atan2(enemy.pos.x - c.pos.x, enemy.pos.z - c.pos.z) + (Math.random() - 0.5) * 0.08;
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
        if (b.t < 12) {
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
    // skirmish waves near the player
    const nearCamp = this.camps.filter((c) => c.pos.distanceTo(p) < 700);
    this.waveT -= dt;
    if (nearCamp.length && this.waveT <= 0 && this.soldiers.filter((s) => s.alive).length < 20) {
      this.waveT = 70 + Math.random() * 60;
      const br = nearCamp[0].bridge;
      for (const c of this.camps.filter((k) => k.bridge === br)) for (let i = 0; i < 4; i++) {
        const sp = c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 0, (Math.random() - 0.5) * 8));
        sp.y = g.world.heightAt(sp.x, sp.z);
        const s = new Soldier(g, c.side, sp);
        g.physics.owners.set(s.collider.handle, { kind: 'soldier', soldier: s, npc: s });
        this.soldiers.push(s);
      }
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
    // soldier AI: pick the nearest enemy, else advance to the bridge or follow orders
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const enemies = this.soldiers.filter((o) => o.alive && o.side !== s.side);
      let best: Soldier | null = null, bd = s.squad && s.order === 'follow' ? 18 : 60;
      for (const e of enemies) { const d = e.st.pos.distanceTo(s.st.pos); if (d < bd) { bd = d; best = e; } }
      if (s.order === 'hold' && best && bd > 8) best = null;
      s.fightTarget = best;
      // enemies of the player's side fight the player too
      s.hostile = !!this.enlisted && this.enlisted !== s.side && s.st.pos.distanceTo(p) < 25;
      if (!best && !s.hostile) {
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
      if (!s.alive) { (s as Soldier & { deadT?: number }).deadT = ((s as Soldier & { deadT?: number }).deadT ?? 0) + dt; if ((s as Soldier & { deadT?: number }).deadT! > 120) { s.dispose(); this.soldiers.splice(i, 1); } }
      else if (s.st.pos.distanceTo(p) > 1000) { s.dispose(); this.soldiers.splice(i, 1); }
    }
    const alive = (side: Side) => this.soldiers.some((s) => s.alive && s.side === side && !s.squad);
    if (this.soldiers.length && !alive('vanguardia') && alive('ironreach')) { this.battles.ironreach++; this.waveT = Math.min(this.waveT, 40); }
  }
  step(dt: number) { for (const s of this.soldiers) s.step(dt); }
  animate(dt: number) {
    const cam = this.game.camera.position;
    for (const s of this.soldiers) { const a = s.lod.step(s.rig, s.st.pos.distanceTo(cam), dt); if (a > 0) s.animate(a); }
  }
}
