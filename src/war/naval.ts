// The war at sea. Warships of Vanguardia and Ironreach carry crews (sailors at the rails and in the waist,
// soldiers in armour on the quarterdeck and forecastle). When enemy ships meet, they weigh anchor, set
// sail, close the range and turn to bring a broadside to bear; round shot that strikes a hull smashes
// splinters out of it, kills men on deck and, hit after hit, opens her seams until she settles and sinks.
// Squadrons put to sea every so often within sight of the coast you are on; spawn.fleet() starts one.
import * as THREE from 'three';
import type { Game } from '../game';
import { Ship } from '../vehicles/ship';
import { BipedAnimator, type MoveState } from '../creature/anim';
import { SKIN_TONES, HAIR_COLORS, releaseRig, type Rig } from '../creature/rig';

type Side = 'vanguardia' | 'ironreach';

interface Hand { rig: Rig; anim: BipedAnimator; holder: THREE.Group; st: MoveState & { armed?: boolean }; local: THREE.Vector3; soldier: boolean; alive: boolean; ship: Ship; cheer: number }

export class Naval {
  crews = new Map<Ship, Hand[]>();
  battleT = 240 + Math.random() * 300;
  /** ships spawned for a battle (removed when they sink or the battle is long over and out of sight) */
  spawned = new Set<Ship>();
  private t = 0;
  constructor(public game: Game) {}

  hpMax(s: Ship) { return s.cls === 'manowar' ? 160 : s.cls === 'frigate' ? 80 : 32; }

  /** Men on deck: sailors in the waist and aloft-ready at the rails, soldiers on the quarterdeck. */
  manShip(s: Ship) {
    if (!s.plan || this.crews.has(s)) return;
    const g = this.game, plan = s.plan, S = plan.spec, H = S.L / 2;
    const hands: Hand[] = [];
    const nSail = s.cls === 'manowar' ? 10 : s.cls === 'frigate' ? 7 : 4;
    const nSold = s.cls === 'manowar' ? 8 : s.cls === 'frigate' ? 5 : 3;
    const fac = s.side ?? 'vanguardia';
    for (let i = 0; i < nSail + nSold; i++) {
      const soldier = i >= nSail;
      const x = soldier ? (i % 2 ? -H * 0.75 + (i - nSail) * 1.6 : H * 0.7 + (i - nSail) * 0.4) : -H * 0.25 + (i / nSail) * H * 0.75;
      const z = (i % 2 ? 1 : -1) * Math.max(0.8, plan.hb(x, plan.weatherY(x) + 0.5) - 0.9 - (i % 3) * 0.6);
      const coat = soldier
        ? { coat: 0, cloth1: fac === 'ironreach' ? 0x5a1a14 : 0x22407a, cloth2: 0x3a3a3c, boots: 0x2a1c12, skin: SKIN_TONES[i % 4], hair: HAIR_COLORS[i % 7], belt: 0x2a1a0a }
        : { coat: 0, cloth1: [0xd8d0c0, 0x6a7a8a, 0x8a5a3a, 0x3a4a5a][i % 4], cloth2: [0x3a4a6a, 0x5a4a3a, 0x2a2a2a][i % 3], boots: 0x2a1c12, skin: SKIN_TONES[(i * 3) % 6], hair: HAIR_COLORS[(i * 5) % 7], belt: 0x2a1a0a };
      const rig = g.creatures.instance(soldier ? 'human4' : ['human0', 'human1', 'human5'][i % 3], coat);
      const holder = new THREE.Group();
      holder.add(rig.root);
      s.model.add(holder);
      const anim = new BipedAnimator(rig, (lx) => plan.weatherY(lx));
      const local = new THREE.Vector3(x, plan.weatherY(x), z);
      const st: MoveState = { pos: local.clone(), yaw: z > 0 ? -Math.PI / 2 + (Math.random() - 0.5) : Math.PI / 2 + (Math.random() - 0.5), speed: 0, turn: 0, vel: new THREE.Vector3(), action: 'idle', look: null };
      hands.push({ rig, anim, holder, st, local, soldier, alive: true, ship: s, cheer: 0 });
    }
    this.crews.set(s, hands);
  }
  disband(s: Ship) {
    const hs = this.crews.get(s);
    if (!hs) return;
    for (const h of hs) { h.holder.removeFromParent(); releaseRig(h.rig); }
    this.crews.delete(s);
  }

  /** A cannonball came to rest at `at`: did it strike a ship? */
  hit(at: THREE.Vector3, from: Ship | null, byPlayer: boolean) {
    const g = this.game;
    for (const s of g.ships) {
      if (!s.plan || s === from || s.hp <= 0) continue;
      const l = at.clone().sub(s.root.position).applyQuaternion(s.root.quaternion.clone().invert());
      if (Math.abs(l.x) > s.length / 2 + 1.5 || l.y < -0.5 || l.y > s.plan.top(l.x) + 2.5) continue;
      if (Math.abs(l.z) > s.plan.hb(l.x, Math.max(0, Math.min(l.y, s.plan.deckY))) + 1.8) continue;
      // splinters and smoke out of the planking, the crash of timber
      g.particles.emit('dust', at, 18); g.particles.emit('spark', at, 8); g.particles.emit('smoke', at, 6);
      g.sound?.('impact:wood', at, 1.6);
      s.hp -= 1 / this.hpMax(s) * (l.y < s.waterline + 0.5 ? 1.6 : 1);   // shot between wind and water lets the sea in
      // men near the strike
      for (const h of this.crews.get(s) ?? []) if (h.alive && h.local.distanceTo(l) < 3.5 && Math.random() < 0.7) this.kill(h);
      if (g.player.pos.distanceTo(at) < 3) g.player.hurt('torso', 35, 'cannon', 0.5);
      if (byPlayer && s.side && s.side !== g.war.enlisted) g.law.crime?.('assault', at, s.side, 0.2, false);
      if (s.hp <= 0) this.sink(s);
      return true;
    }
    return false;
  }
  private kill(h: Hand) {
    h.alive = false;
    h.st.action = 'dead';
  }
  sink(s: Ship) {
    const g = this.game;
    s.hp = 0;
    (s as Ship & { sinkT?: number }).sinkT = 0;
    s.anchored = false;
    for (const sl of s.sails) sl.target = 0;
    const d = s.pos.distanceTo(g.player.pos);
    if (d < 2500) g.hud.toast(`${s.name_} is sinking!`);
  }

  /** Begin a sea battle: two squadrons appear a few kilometres offshore and close with each other. */
  startBattle(near = this.game.player.pos, quiet = false) {
    const g = this.game;
    // find open sea in front of the nearest coast
    const dir = new THREE.Vector3(near.x, 0, near.z).normalize();
    const center = dir.clone().multiplyScalar(Math.max(3100, Math.hypot(near.x, near.z) + 700));
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    const mk = (side: Side, cls: 'brigantine' | 'frigate' | 'manowar', off: number, name: string) => {
      const p = center.clone().addScaledVector(across, off * (side === 'vanguardia' ? -1 : 1) + (side === 'vanguardia' ? -280 : 280)).addScaledVector(dir, (Math.random() - 0.5) * 80);
      if (g.world.heightAt(p.x, p.z) > -cls.length) p.addScaledVector(dir, 300);
      const yaw = Math.atan2(-(side === 'vanguardia' ? across.z : -across.z), side === 'vanguardia' ? across.x : -across.x);
      const sh = new Ship(g, p.setY(0), yaw, cls, name);
      sh.side = side; sh.anchored = false;
      for (const sl of sh.sails) { sl.target = 1; sl.set = 0.8; }
      // already under way when they come over the horizon
      const f = sh.forward().setY(0).normalize().multiplyScalar(cls === 'manowar' ? 2.2 : 3);
      sh.body.setLinvel({ x: f.x, y: 0, z: f.z }, true);
      g.ships.push(sh);
      this.spawned.add(sh);
      this.manShip(sh);
      return sh;
    };
    const V = ['Valiant', 'Dauntless', 'Queen Ada', 'Lion of Aurel', 'Swiftsure'], I = ['Iron Wrath', 'Black Hammer', 'Varr\'s Fist', 'Grim Tide', 'Mountain Wolf'];
    const k = Math.floor(Math.random() * 5);
    mk('vanguardia', 'frigate', 0, V[k]); mk('vanguardia', 'brigantine', 90, V[(k + 1) % 5]);
    mk('ironreach', 'frigate', 0, I[k]); mk('ironreach', 'brigantine', -90, I[(k + 2) % 5]);
    if (Math.random() < 0.5) { mk('vanguardia', 'manowar', -140, 'Sovereign'); mk('ironreach', 'manowar', 140, 'Iron Throne'); }
    if (!quiet) g.hud.toast('Sails on the horizon: the fleets of Vanguardia and Ironreach are engaging at sea!');
    return center;
  }

  update(dt: number) {
    const g = this.game, P = g.player.pos;
    this.t += dt;
    // squadrons put to sea now and then, when you're near the coast
    this.battleT -= dt;
    if (this.battleT <= 0) {
      this.battleT = 420 + Math.random() * 480;
      if (Math.hypot(P.x, P.z) > 2100 && [...this.spawned].length < 4) this.startBattle();
    }
    for (const s of g.ships) {
      if (!s.plan) continue;
      // crews appear on warships near you
      const dP = s.pos.distanceTo(P);
      if (dP < 400 && !this.crews.has(s)) this.manShip(s);
      else if (dP > 600 && this.crews.has(s)) this.disband(s);
      // sinking: the sea pours in, she lists and settles, then goes down
      const st = s as Ship & { sinkT?: number };
      if (st.sinkT !== undefined) {
        st.sinkT += dt;
        s.buoyScale = Math.max(0.0, 1 - st.sinkT / 70);
        s.body.applyTorqueImpulse({ x: s.mass * 0.6 * dt, y: 0, z: s.mass * 0.15 * dt }, true);
        if (st.sinkT > 5 && Math.random() < dt * 2) g.particles.emit('splash', s.pos.clone().setY(0.3).add(new THREE.Vector3((Math.random() - 0.5) * s.length * 0.5, 0, (Math.random() - 0.5) * 6)), 10);
        if (st.sinkT > 140) { this.remove(s); continue; }
      }
      if (s.helmsman || !s.side || s.hp <= 0) continue;
      this.steer(s, dt);
    }
    // spawned ships that have drifted far away are taken off the board
    for (const s of this.spawned) if (s.pos.distanceTo(P) > 4500) this.remove(s);
    this.animateCrews(dt);
  }

  private remove(s: Ship) {
    const g = this.game;
    this.disband(s);
    this.spawned.delete(s);
    const i = g.ships.indexOf(s);
    if (i >= 0) g.ships.splice(i, 1);
    s.dispose();
  }

  /** Captain's AI: find the nearest enemy, close to fighting range, turn broadside on and fire. */
  private steer(s: Ship, dt: number) {
    const g = this.game;
    let foe: Ship | null = null, fd = 1e9;
    for (const o of g.ships) if (o !== s && o.plan && o.side && o.side !== s.side && o.hp > 0) { const d = o.pos.distanceTo(s.pos); if (d < fd) { fd = d; foe = o; } }
    if (!foe || fd > 2200) {
      // nothing in sight: ride at anchor (moored ships) or wander back toward home waters
      if (!this.spawned.has(s)) return;
      for (const sl of s.sails) sl.target = 0.5;
      return;
    }
    if (s.anchored) { s.anchored = false; for (const sl of s.sails) sl.target = 1; }
    const fwd = s.forward().setY(0).normalize();
    const to = foe.pos.clone().sub(s.pos).setY(0);
    const dist = to.length(); to.normalize();
    // which way is the wind? sailing straight into it is impossible: tack across it
    const w = g.weather.windDir, wdir = new THREE.Vector3(Math.cos(w), 0, Math.sin(w));
    let want: THREE.Vector3;
    if (dist > 260) want = to.clone();                                        // close the range
    else {
      // fighting range: steer perpendicular to the bearing (broadside on), the side nearer the wind
      const a = new THREE.Vector3(-to.z, 0, to.x), b = a.clone().negate();
      want = a.dot(fwd) > b.dot(fwd) ? a : b;
      if (dist < 110) want.addScaledVector(to, -0.6).normalize();            // too close: open the range
    }
    if (want.dot(wdir) < -0.75) want.addScaledVector(new THREE.Vector3(-wdir.z, 0, wdir.x), 0.9).normalize();   // tack
    const err = Math.atan2(fwd.x * want.z - fwd.z * want.x, fwd.dot(want));
    s.rudder = THREE.MathUtils.clamp(err * 2.2, -1, 1);
    // trim the yards to the wind
    s.trim = THREE.MathUtils.clamp(Math.atan2(fwd.x * wdir.z - fwd.z * wdir.x, fwd.dot(wdir)) * 0.4, -0.7, 0.7);
    // fire when the enemy is abeam on one side and within range
    if (dist < 420) {
      const right = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat).setY(0).normalize();
      const side = right.dot(to) > 0 ? 1 : -1;
      if (Math.abs(right.dot(to)) > 0.82 && s.reload[side] <= 0) s.broadside(side as 1 | -1);
    }
    void dt;
  }

  private animateCrews(dt: number) {
    const g = this.game;
    const near = g.camera.position;
    for (const [s, hands] of this.crews) {
      const inBattle = s.reload[1] > 0 || s.reload[-1] > 0;
      const far = s.root.position.distanceTo(near) > 160;
      for (const h of hands) {
        h.st.pos.copy(h.local);
        h.st.action = h.alive ? 'idle' : 'dead';
        h.anim.talking = h.alive && inBattle ? Math.max(0, Math.sin(this.t * 3 + h.local.x)) : h.alive && h.soldier ? 0 : 0.1;
        h.st.armed = h.soldier && h.alive;
        if (far && Math.random() < 0.5) continue;
        // pose in deck space (the holder's world matrix is the ship's; the animator works locally)
        h.holder.matrixWorld.identity();
        h.anim.update(dt, h.st as MoveState & { armed?: boolean });
      }
    }
  }
}
