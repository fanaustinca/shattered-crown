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
import { instanceModel } from '../props/models';

type Side = 'vanguardia' | 'ironreach';
type Role = 'sailor' | 'gunner' | 'soldier';

export interface Hand {
  rig: Rig; anim: BipedAnimator; holder: THREE.Group; st: MoveState & { armed?: boolean; sitting?: boolean };
  role: Role; side: Side; alive: boolean; ship: Ship; hp: number;
  /** belongs to the player's own ship (never hostile to the player) */
  pc: boolean;
  /** surrendered: sits on the deck, hands empty */
  prisoner: boolean;
  path: THREE.Vector3[]; wait: number; speed: number; face: number | null;
  task: 'idle' | 'station' | 'board' | 'fight';
  foe: Hand | null; foePlayer: boolean; cd: number; strikeT: number;
  jump: { to: Ship; from: THREE.Vector3; land: THREE.Vector3; t: number } | null;
  sword: THREE.Object3D | null;
}
interface Grapple { a: Ship; b: Ship; t: number; readyT: number; ready: boolean; side: number; line: THREE.LineSegments; waves: number; abstract: number; byPlayer: boolean }

export class Naval {
  crews = new Map<Ship, Hand[]>();
  /** who is still alive aboard ships out of sight (re-manned the same way when you come back) */
  roster = new Map<Ship, { side: Side; role: Role; pc: boolean; prisoner: boolean }[]>();
  grapples: Grapple[] = [];
  /** captains who mean to board rather than trade broadsides */
  boardIntent = new Map<Ship, boolean>();
  /** the enemy ship each captain is engaging (crews go to quarters) */
  foeOf = new Map<Ship, Ship>();
  /** crews that have turned on the player (you struck one of them) */
  angry = new Set<Ship>();
  battleT = 240 + Math.random() * 300;
  /** ships spawned for a battle (removed when they sink or the battle is long over and out of sight) */
  spawned = new Set<Ship>();
  private t = 0;
  constructor(public game: Game) {}

  hpMax(s: Ship) { return s.cls === 'leviathan' ? 900 : s.cls === 'manowar' ? 160 : s.cls === 'frigate' ? 80 : 32; }

  /** Deck height in ship space at (x, z): the weather decks, and the companion stairs between them. */
  deckH(s: Ship, x: number, z: number) {
    const P = s.plan!;
    for (const st of P.stairs) {
      const lo = Math.min(st.xLow, st.xHigh), hi = Math.max(st.xLow, st.xHigh);
      if (Math.abs(z - st.z) < 0.5 && x >= lo - 0.05 && x <= hi + 0.05) return st.y0 + (st.y1 - st.y0) * THREE.MathUtils.clamp((x - st.xLow) / (st.xHigh - st.xLow), 0, 1);
    }
    return P.weatherY(x);
  }
  private level(s: Ship, x: number) { const P = s.plan!; return x < P.qdX ? 0 : x > P.fcX ? 2 : 1; }
  /** a free spot on a deck level (0 quarterdeck, 1 waist, 2 forecastle), clear of masts, hatches and guns */
  private spot(s: Ship, lvl: number, sideZ = 0, rail = false) {
    const P = s.plan!, H = P.spec.L / 2;
    const [x0, x1] = lvl === 0 ? [-H + 1.6, P.qdX - 0.8] : lvl === 2 ? [P.fcX + 0.8, H - 2.2] : [P.qdX + P.spec.qdH * 1.15 + 0.8, P.fcX - P.spec.fcH * 1.15 - 0.6];
    for (let k = 0; k < 30; k++) {
      const x = x0 + Math.random() * Math.max(0.2, x1 - x0);
      const w = P.hb(x, P.weatherY(x) + 0.5) - (lvl === 1 ? 1.7 : 1.0);
      if (w < 0.6) continue;
      const sgn = sideZ || (Math.random() < 0.5 ? -1 : 1);
      const z = rail ? sgn * w : sgn * (0.9 + Math.random() * Math.max(0, w - 0.9));
      if (P.hatches.some((h) => Math.abs(x - h.x) < h.hx + 0.5 && Math.abs(z) < h.hz + 0.5)) continue;
      if (P.spec.masts.some((m) => Math.hypot(x - m.at * H, z) < 1.1)) continue;
      return new THREE.Vector3(x, this.deckH(s, x, z), z);
    }
    return new THREE.Vector3((x0 + x1) / 2, P.weatherY((x0 + x1) / 2), sideZ * 1.2);
  }
  /** Waypoints across the deck: down/up the companion stairs between levels, round the hatches. */
  route(s: Ship, from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const P = s.plan!;
    const out: THREE.Vector3[] = [];
    const la = this.level(s, from.x), lb = this.level(s, to.x);
    const stair = (lvl: number, z: number) => {
      const c = P.stairs.filter((st) => (lvl === 0 ? st.xHigh <= P.qdX + 0.01 : st.xHigh >= P.fcX - 0.01)).sort((a, b) => Math.abs(a.z - z) - Math.abs(b.z - z))[0];
      return c;
    };
    let cur = from.clone();
    const via = (lvl: number, down: boolean) => {
      const st = stair(lvl, cur.z);
      if (!st) return;
      const dirOut = Math.sign(st.xHigh - st.xLow);   // + toward the forecastle end
      const bottom = new THREE.Vector3(st.xLow + dirOut * 0.45, st.y0, st.z), top = new THREE.Vector3(st.xHigh + dirOut * 0.5, st.y1, st.z);
      if (down) { out.push(top, bottom); cur = bottom; } else { out.push(bottom, top); cur = top; }
    };
    if (la !== lb) {
      if (la !== 1) via(la, true);
      if (lb !== 1) via(lb, false);
    }
    // step round any hatch between here and there (waist)
    for (const h of P.hatches) {
      const a = cur, b = to;
      if ((a.x - h.x) * (b.x - h.x) < 0 || Math.abs(b.x - h.x) < h.hx + 0.4) {
        const t = (h.x - a.x) / ((b.x - a.x) || 1e-3), zc = a.z + (b.z - a.z) * THREE.MathUtils.clamp(t, 0, 1);
        if (Math.abs(zc) < h.hz + 0.45 && this.level(s, h.x) === 1 && this.level(s, a.x) === 1) { const zs = (zc >= 0 ? 1 : -1) * (h.hz + 0.7); out.push(new THREE.Vector3(h.x - Math.sign(b.x - a.x) * (h.hx + 0.6), 0, zs), new THREE.Vector3(h.x + Math.sign(b.x - a.x) * (h.hx + 0.6), 0, zs)); }
      }
    }
    out.push(to.clone());
    for (const w of out) w.y = this.deckH(s, w.x, w.z);
    return out;
  }

  private makeHand(s: Ship, role: Role, side: Side, pos: THREE.Vector3, i: number, pc: boolean): Hand {
    const g = this.game;
    const soldier = role === 'soldier';
    const coat = soldier
      ? { coat: 0, cloth1: side === 'ironreach' ? 0x5a1a14 : 0x22407a, cloth2: 0x3a3a3c, boots: 0x2a1c12, skin: SKIN_TONES[i % 4], hair: HAIR_COLORS[i % 7], belt: 0x2a1a0a }
      : { coat: 0, cloth1: [0xd8d0c0, 0x6a7a8a, 0x8a5a3a, 0x3a4a5a][i % 4], cloth2: [0x3a4a6a, 0x5a4a3a, 0x2a2a2a][i % 3], boots: 0x2a1c12, skin: SKIN_TONES[(i * 3) % 6], hair: HAIR_COLORS[(i * 5) % 7], belt: 0x2a1a0a };
    const rig = g.creatures.instance(soldier ? 'human4' : ['human0', 'human1', 'human5'][i % 3], coat);
    const holder = new THREE.Group();
    holder.add(rig.root);
    s.model.add(holder);
    const h = {} as Hand;
    const anim = new BipedAnimator(rig, (x, z) => this.deckH(h.ship, x, z));
    const st: Hand['st'] = { pos: pos.clone(), yaw: Math.random() * Math.PI * 2, speed: 0, turn: 0, vel: new THREE.Vector3(), action: 'idle', look: null };
    Object.assign(h, { rig, anim, holder, st, role, side, alive: true, ship: s, hp: soldier ? 3 : 2, pc, prisoner: false, path: [], wait: Math.random() * 4, speed: 0, face: null, task: 'idle', foe: null, foePlayer: false, cd: 0, strikeT: -1, jump: null, sword: null });
    if (soldier) this.arm(h);
    return h;
  }
  private arm(h: Hand) {
    if (h.sword) return;
    const sw = instanceModel(h.role === 'soldier' ? 'antique_estoc' : 'antique_estoc');
    if (!sw) return;
    sw.rotation.set(Math.PI, 0, 0); sw.position.set(0, -0.06, 0.03);
    h.rig.byName.handR.add(sw);
    h.sword = sw;
  }

  /** Men on deck: sailors about their work, gunners at the weather-deck guns, soldiers on the quarterdeck. */
  manShip(s: Ship) {
    if (!s.plan || this.crews.has(s)) return;
    const P = s.plan;
    const pc = s.owner === 'player';
    const side: Side = s.side ?? this.game.war.enlisted ?? 'vanguardia';
    let list = this.roster.get(s);
    if (!list) {
      const nSail = s.cls === 'leviathan' ? 16 : s.cls === 'manowar' ? 10 : s.cls === 'frigate' ? 7 : 4;
      const nGun = s.cls === 'leviathan' ? 14 : s.cls === 'manowar' ? 8 : s.cls === 'frigate' ? 6 : 4;
      const nSold = s.cls === 'leviathan' ? 18 : s.cls === 'manowar' ? 10 : s.cls === 'frigate' ? 6 : 3;
      list = [];
      for (let i = 0; i < nSail; i++) list.push({ side, role: 'sailor', pc, prisoner: false });
      for (let i = 0; i < nGun; i++) list.push({ side, role: 'gunner', pc, prisoner: false });
      for (let i = 0; i < nSold; i++) list.push({ side, role: 'soldier', pc, prisoner: false });
    }
    const hands: Hand[] = [];
    list.forEach((m, i) => {
      const lvl = m.role === 'soldier' ? (i % 3 === 0 ? 2 : 0) : m.role === 'gunner' ? 1 : [1, 1, 2][i % 3];
      const h = this.makeHand(s, m.role, m.side, this.spot(s, lvl), i, m.pc);
      h.prisoner = m.prisoner;
      hands.push(h);
    });
    void P;
    this.crews.set(s, hands);
  }
  disband(s: Ship) {
    const hs = this.crews.get(s);
    if (!hs) return;
    this.roster.set(s, hs.filter((h) => h.alive && !h.jump).map((h) => ({ side: h.side, role: h.role, pc: h.pc, prisoner: h.prisoner })));
    for (const h of hs) { h.holder.removeFromParent(); releaseRig(h.rig); }
    this.crews.delete(s);
  }
  /** fighting men aboard a ship, per side (live crews, or the roster for ships out of sight) */
  count(s: Ship, side?: Side) {
    const hs = this.crews.get(s);
    if (hs) return hs.filter((h) => h.alive && !h.prisoner && !h.jump && (!side || h.side === side)).length;
    const r = this.roster.get(s);
    if (r) return r.filter((m) => !m.prisoner && (!side || m.side === side)).length;
    return s.cls === 'leviathan' ? 48 : s.cls === 'manowar' ? 28 : s.cls === 'frigate' ? 19 : 11;
  }
  /** world position of a hand */
  world(h: Hand, out = new THREE.Vector3()) { return h.ship.model.localToWorld(out.copy(h.st.pos)); }
  /** all hands within r of a world point (for the player's blows) */
  handsNear(p: THREE.Vector3, r: number) {
    const out: { h: Hand; pos: THREE.Vector3; facing: THREE.Vector3 }[] = [];
    for (const [s, hs] of this.crews) {
      if (s.pos.distanceTo(p) > s.length + r) continue;
      for (const h of hs) {
        if (!h.alive || h.jump) continue;
        const w = this.world(h);
        if (w.distanceTo(p) > r) continue;
        out.push({ h, pos: w, facing: new THREE.Vector3(Math.sin(h.st.yaw), 0, Math.cos(h.st.yaw)).applyQuaternion(s.quat) });
      }
    }
    return out;
  }
  /** the player struck a hand */
  hurtHand(h: Hand, dmg: number) {
    const g = this.game;
    if (!h.alive) return;
    h.hp -= dmg / 22;
    g.sound?.('hit:flesh', this.world(h), 0.9);
    if (!h.pc) this.angry.add(h.ship);
    if (h.prisoner) { h.prisoner = false; }
    if (h.hp <= 0) this.kill(h);
    else { h.foePlayer = !h.pc; h.task = 'fight'; }
    if (h.side && h.side !== g.war.enlisted && !this.grapples.some((gp) => gp.a.owner === 'player' || gp.b.owner === 'player')) g.law.crime?.('assault', g.player.pos, h.side, 0.2, false);
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
      for (const h of this.crews.get(s) ?? []) if (h.alive && !h.jump && h.st.pos.distanceTo(l) < 3.5 && Math.random() < 0.7) this.kill(h);
      if (g.player.pos.distanceTo(at) < 3) g.player.hurt('torso', 35, 'cannon', 0.5);
      if (byPlayer && s.side && s.side !== g.war.enlisted) g.law.crime?.('assault', at, s.side, 0.2, false);
      if (s.hp <= 0) this.sink(s);
      return true;
    }
    return false;
  }
  private kill(h: Hand) {
    h.alive = false;
    h.st.action = 'dead'; h.st.speed = 0; h.path.length = 0; h.foe = null;
    this.game.blood(this.world(h).setY(this.world(h).y + 1.1), 6);
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
    this.updateGrapples(dt);
    this.animateCrews(dt);
  }

  private remove(s: Ship) {
    const g = this.game;
    for (const gp of this.grapples.filter((x) => x.a === s || x.b === s)) this.release(gp);
    this.disband(s);
    this.roster.delete(s); this.foeOf.delete(s); this.boardIntent.delete(s); this.angry.delete(s);
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
    if (foe && fd < 900) this.foeOf.set(s, foe); else this.foeOf.delete(s);
    if (this.grapples.some((gp) => gp.a === s || gp.b === s)) { for (const sl of s.sails) sl.target = 0; return; }
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
    let want!: THREE.Vector3;
    // some captains mean to board: once she's battered, or when they carry more men, they run in alongside
    if (dist < 320 && !this.boardIntent.has(s)) this.boardIntent.set(s, Math.random() < 0.45);
    if (this.boardIntent.get(s) && (foe.hp < 0.6 || this.count(s) > this.count(foe) * 1.25 || Math.random() < 0.0005)) this.boardIntent.set(s, true); else if (this.boardIntent.get(s) && foe.hp >= 0.6 && this.count(s) <= this.count(foe)) this.boardIntent.set(s, foe.hp < 0.85);
    const boarding = this.boardIntent.get(s) && foe.hp < 0.85;
    const gapB = (s.plan!.spec.B + foe.plan!.spec.B) / 2;
    if (boarding && dist < gapB + 16 && !this.grapples.some((gp) => gp.a === foe || gp.b === foe)) { this.grapple(s, foe); return; }
    if (boarding && dist < 300) {
      // aim for a berth alongside her, then match her heading
      const ff = foe.forward().setY(0).normalize(), fr = new THREE.Vector3(0, 0, 1).applyQuaternion(foe.quat).setY(0).normalize();
      const sideSign = Math.sign(s.pos.clone().sub(foe.pos).dot(fr)) || 1;
      const berth = foe.pos.clone().addScaledVector(fr, sideSign * (gapB + 2));
      want = berth.sub(s.pos).setY(0);
      if (want.length() < 25) want.lerp(ff.clone().multiplyScalar(want.length()), 0.6);
      want.normalize();
    } else if (dist > 260) want = to.clone();                                        // close the range
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
    // each battery fires on any enemy in its arc: the closer to abeam (and the longer the ship, the wider the
    // arc her guns can cover), the better
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quat).setY(0).normalize();
    const arc = s.length > 80 ? 0.5 : s.length > 40 ? 0.72 : 0.82;
    for (const side of [1, -1] as const) {
      if (s.reload[side] > 0) continue;
      for (const o of g.ships) {
        if (o === s || !o.plan || !o.side || o.side === s.side || o.hp <= 0) continue;
        const v = o.pos.clone().sub(s.pos).setY(0), d = v.length();
        if (d > 450) continue;
        if (right.dot(v) * side / d > arc) { s.broadside(side); break; }
      }
    }
    void dt;
  }

  // ---------------------------------------------------------------- boarding
  /** Lash two ships together side by side and send boarders across. */
  grapple(a: Ship, b: Ship, byPlayer = false) {
    if (this.grapples.some((gp) => gp.a === a || gp.b === a || gp.a === b || gp.b === b)) return null;
    const line = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 3 * 2), 3)), new THREE.LineBasicMaterial({ color: 0x2a2014 }));
    line.frustumCulled = false;
    this.game.scene.add(line);
    const right = new THREE.Vector3(0, 0, 1).applyQuaternion(b.quat);
    const gp: Grapple = { a, b, t: 0, readyT: 0, ready: false, side: Math.sign(a.pos.clone().sub(b.pos).dot(right)) || 1, line, waves: 0, abstract: 0, byPlayer };
    this.grapples.push(gp);
    for (const s of [a, b]) { for (const sl of s.sails) sl.target = 0; }
    if (a.pos.distanceTo(this.game.player.pos) < 1500) this.game.hud.toast(`Grappling hooks fly — the ${a.name_} is laying alongside the ${b.name_} to board!`);
    this.game.sound?.('impact:wood', a.pos, 1.2);
    return gp;
  }
  /** The player at the helm presses G: grapple the nearest enemy within reach. */
  playerGrapple(s: Ship) {
    const g = this.game;
    if (!s.plan) { g.hud.toast('A boat can\'t board a ship.'); return; }
    if (this.grapples.some((gp) => gp.a === s || gp.b === s)) { this.release(this.grapples.find((gp) => gp.a === s || gp.b === s)!); g.hud.toast('Cut the grapples — cast off!'); return; }
    const mine = s.side ?? g.war.enlisted;
    let best: Ship | null = null, bd = 1e9;
    for (const o of g.ships) {
      if (o === s || !o.plan || o.hp <= 0 || o.owner === 'player') continue;
      if (mine && o.side === mine) continue;
      const d = o.pos.distanceTo(s.pos) - (o.plan.spec.B + s.plan.spec.B) / 2;
      if (d < bd) { bd = d; best = o; }
    }
    if (!best || bd > 30) { g.hud.toast('No enemy close enough to grapple — lay her alongside within 30 m.'); return; }
    if (!best.side || best.side !== g.war.enlisted) g.law.crime?.('assault', s.pos, best.side ?? 'isles', 0.5, false);
    this.manShip(s); this.manShip(best);
    this.angry.add(best);
    this.grapple(s, best, true);
  }
  private release(gp: Grapple) {
    gp.line.removeFromParent(); gp.line.geometry.dispose();
    this.grapples.splice(this.grapples.indexOf(gp), 1);
    for (const s of [gp.a, gp.b]) for (const h of this.crews.get(s) ?? []) if (h.task === 'board') { h.task = 'idle'; h.path.length = 0; }
  }
  /** The defenders are beaten: she strikes her colours and the boarders' side takes her as a prize. */
  private capture(gp: Grapple) {
    const g = this.game, s = gp.b, a = gp.a;
    const winner = (this.crews.get(s) ?? []).find((h) => h.alive && h.side !== (s.side ?? h.side) && !h.prisoner);
    const newSide = a.owner === 'player' ? null : a.side;
    for (const h of this.crews.get(s) ?? []) if (h.alive && h.side !== (winner?.side ?? a.side)) { h.prisoner = true; h.task = 'idle'; h.foe = null; h.path.length = 0; }
    for (const h of this.crews.get(s) ?? []) if (h.alive && !h.prisoner) { h.pc = a.owner === 'player'; h.task = 'idle'; }
    const r = this.roster.get(s);
    if (r) for (const m of r) m.prisoner = m.side !== (winner?.side ?? a.side ?? m.side);
    s.side = newSide; if (a.owner === 'player') s.owner = 'player';
    s.anchored = false;
    this.angry.delete(s);
    this.boardIntent.delete(a);
    if (s.pos.distanceTo(g.player.pos) < 2500) g.hud.toast(`The ${s.name_} strikes her colours — taken as a prize by the ${a.name_}!`);
    this.release(gp);
  }
  private updateGrapples(dt: number) {
    const g = this.game;
    for (const gp of [...this.grapples]) {
      const { a, b } = gp;
      if (a.hp <= 0 || b.hp <= 0 || !g.ships.includes(a) || !g.ships.includes(b)) { this.release(gp); continue; }
      gp.t += dt;
      // haul in on the grapples: bring her alongside, parallel, a fathom between the hulls
      const bf = b.forward().setY(0).normalize(), br = new THREE.Vector3(-bf.z, 0, bf.x).negate();
      const right = new THREE.Vector3(0, 0, 1).applyQuaternion(b.quat).setY(0).normalize();
      void br;
      const gap = (a.plan!.spec.B + b.plan!.spec.B) / 2 + 1.0;
      const along = THREE.MathUtils.clamp(a.pos.clone().sub(b.pos).dot(bf), -(b.length - a.length) / 2 - 4, (b.length - a.length) / 2 + 4);
      const target = b.pos.clone().addScaledVector(bf, along).addScaledVector(right, gp.side * gap);
      const err = target.sub(a.pos).setY(0);
      const la = a.body.linvel(), lb = b.body.linvel();
      const rel = new THREE.Vector3(la.x - lb.x, 0, la.z - lb.z);
      const want = err.clone().multiplyScalar(0.3); if (want.length() > 2.2) want.setLength(2.2);
      const mu = a.mass * b.mass / (a.mass + b.mass);
      const J = want.sub(rel).multiplyScalar(mu * Math.min(1, dt * 3));
      a.body.applyImpulse({ x: J.x, y: 0, z: J.z }, true); b.body.applyImpulse({ x: -J.x, y: 0, z: -J.z }, true);
      // swing parallel (bow to bow or bow to stern, whichever is nearer)
      const af = a.forward().setY(0).normalize();
      const par = af.dot(bf) >= 0 ? bf : bf.clone().negate();
      const ang = Math.atan2(af.x * par.z - af.z * par.x, af.dot(par));
      for (const [s, sg] of [[a, 1], [b, -0.4]] as const) {
        const av = s.body.angvel();
        const wy = -ang * 0.12 * sg;
        s.body.setAngvel({ x: av.x, y: av.y + (wy - av.y) * Math.min(1, dt * 0.8), z: av.z }, true);
      }
      if (!gp.ready && err.length() < 3 && Math.abs(ang) < 0.25) { gp.ready = true; gp.readyT = gp.t; if (a.pos.distanceTo(g.player.pos) < 1500) g.hud.toast(`Boarders away! The ${a.name_}'s men swarm over the rail.`); }
      // the lines between the rails
      const pos = gp.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < 6; k++) {
        const x = (k / 5 - 0.5) * Math.min(a.length, b.length) * 0.6;
        const pa = a.model.localToWorld(new THREE.Vector3(x, a.plan!.top(x), -gp.side * (a.plan!.hb(x, a.plan!.top(x) - 0.5) - 0.1)));
        const xb = b.model.worldToLocal(pa.clone()).x;
        const pb = b.model.localToWorld(new THREE.Vector3(xb, b.plan!.top(xb), gp.side * (b.plan!.hb(xb, b.plan!.top(xb) - 0.5) - 0.1)));
        pos.setXYZ(k * 2, pa.x, pa.y, pa.z); pos.setXYZ(k * 2 + 1, pb.x, pb.y, pb.z);
      }
      pos.needsUpdate = true;
      // out of sight the fight is reckoned rather than watched
      if (!this.crews.has(a) || !this.crews.has(b)) {
        if (!gp.ready) continue;
        gp.abstract += dt;
        if (gp.abstract > 45) {
          const att = this.count(a), def = this.count(b, (b.side ?? undefined) as Side | undefined);
          if (Math.random() < att / (att + def * 1.3)) { const r = this.roster.get(b) ?? []; for (const m of r) m.prisoner = true; this.capture(gp); }
          else this.release(gp);
        }
        continue;
      }
      // the fight on deck decides it: once no defender is left standing she is taken; if the boarders
      // are all down, the attack has failed
      if (gp.ready) {
        const defSide = (b.side ?? (b.owner === 'player' ? (this.crews.get(b)?.find((h) => h.pc)?.side) : undefined)) as Side | undefined;
        const attSide = this.crews.get(a)?.find((h) => h.alive)?.side ?? (a.side as Side);
        const defenders = (this.crews.get(b) ?? []).filter((h) => h.alive && !h.prisoner && h.side !== attSide && (!defSide || h.side === defSide)).length;
        const boarders = (this.crews.get(b) ?? []).filter((h) => h.alive && h.side === attSide).length + (this.crews.get(a) ?? []).filter((h) => h.alive && h.task === 'board').length;
        const playerAboard = gp.byPlayer && b.contains(g.player.pos.clone().setY(g.player.pos.y - 1));
        if (defenders === 0 && (boarders > 0 || playerAboard)) this.capture(gp);
        else if (boarders === 0 && !playerAboard && gp.t - gp.readyT > 30) { if (a.pos.distanceTo(g.player.pos) < 1500) g.hud.toast(`The ${b.name_} beats off her boarders!`); this.release(gp); }
      }
    }
  }

  // ---------------------------------------------------------------- crews at work and at war
  private go(h: Hand, to: THREE.Vector3, speed: number) {
    h.path = this.route(h.ship, h.st.pos, to);
    h.speed = speed;
  }
  /** Per-hand behaviour: in peace they go about the ship, in action they take their stations; when boarders
   *  come over the rail every man takes up a blade. */
  private think(s: Ship, h: Hand, foe: Ship | null, gp: Grapple | undefined, enemiesAboard: Hand[], dt: number) {
    const g = this.game, P = s.plan!;
    h.st.armed = !!h.sword && h.alive && !h.prisoner && (h.role === 'soldier' || enemiesAboard.length > 0 || h.task === 'board');
    if (h.prisoner) { h.st.sitting = true; h.path.length = 0; h.st.speed = 0; return; }
    h.st.sitting = false;
    // the player as an enemy aboard this deck?
    const pw = g.player.pos, pl = s.model.worldToLocal(pw.clone());
    const playerHere = g.player.alive && Math.abs(pl.x) < P.spec.L / 2 + 1 && Math.abs(pl.z) < P.spec.B / 2 + 1 && pl.y > P.deckY - 1.5 && pl.y < P.topY + 6;
    const hostileToPlayer = !h.pc && playerHere && (this.angry.has(s) || (g.war.enlisted && h.side !== g.war.enlisted && (!!foe || !!gp)));
    // fighting: nearest enemy man on this deck (or the player)
    if (enemiesAboard.length || hostileToPlayer) {
      if (!h.sword) this.arm(h);
      let best: Hand | null = null, bd = 1e9;
      for (const e of enemiesAboard) { if (e.side === h.side) continue; const d = e.st.pos.distanceTo(h.st.pos); if (d < bd) { bd = d; best = e; } }
      const pd = hostileToPlayer ? pl.distanceTo(h.st.pos) : 1e9;
      const tgt = pd < bd ? pl : best ? best.st.pos : null;
      h.foe = pd < bd ? null : best; h.foePlayer = pd < bd;
      if (tgt) {
        h.task = 'fight';
        const d = Math.min(bd, pd);
        h.face = Math.atan2(tgt.x - h.st.pos.x, tgt.z - h.st.pos.z);
        if (d > 1.15) { if (!h.path.length || h.path[h.path.length - 1].distanceTo(tgt) > 1) this.go(h, tgt.clone(), 3.4); }
        else {
          h.path.length = 0;
          h.cd -= dt;
          if (h.cd <= 0) {
            h.cd = 1.1 + Math.random() * 0.9;
            h.anim.attack((['left', 'right', 'over', 'thrust'] as const)[Math.floor(Math.random() * 4)]);
            h.strikeT = 0.3;
            g.sound?.('swing', this.world(h), 0.5);
          }
        }
        if (h.strikeT >= 0) {
          h.strikeT -= dt;
          if (h.strikeT < 0) {
            if (h.foePlayer) g.combat.npcStrike({ st: { pos: this.world(h), yaw: Math.atan2(...((): [number, number] => { const f = new THREE.Vector3(Math.sin(h.st.yaw), 0, Math.cos(h.st.yaw)).applyQuaternion(s.quat); return [f.x, f.z]; })()) }, anim: h.anim });
            else if (h.foe && h.foe.alive && h.foe.st.pos.distanceTo(h.st.pos) < 1.6) {
              const p = (h.role === 'soldier' ? 0.42 : 0.3) * (h.foe.role === 'soldier' ? 0.65 : 1);
              if (Math.random() < p) { h.foe.hp -= 1; g.sound?.('hit:flesh', this.world(h.foe), 0.8); if (h.foe.hp <= 0) this.kill(h.foe); }
              else g.sound?.('hit:block', this.world(h.foe), 0.6);
            }
          }
        }
        return;
      }
    }
    if (h.task === 'fight') { h.task = 'idle'; h.path.length = 0; }
    // boarding: to the rail facing the enemy, then over
    if (gp && gp.a === s && gp.ready && (h.role === 'soldier' || (h.role === 'sailor' && h.st.pos.x % 2 > 0.6))) {
      if (h.task !== 'board') {
        h.task = 'board';
        const sideZ = -gp.side;
        const x = THREE.MathUtils.clamp(s.model.worldToLocal(gp.b.pos.clone()).x + (Math.random() - 0.5) * 8, P.qdX + 2, P.fcX - 2);
        const w = P.hb(x, P.weatherY(x) + 0.5) - 0.45;
        this.go(h, new THREE.Vector3(x, 0, sideZ * w), 3.6);
        return;
      }
      if (!h.path.length && !h.jump) {
        // over the rail: a leap across the gap onto her deck
        const b = gp.b, PB = b.plan!;
        const from = this.world(h);
        const lx = THREE.MathUtils.clamp(b.model.worldToLocal(from.clone()).x, PB.qdX + 1.5, PB.fcX - 1.5);
        const lz = gp.side * (PB.hb(lx, PB.weatherY(lx) + 0.5) - 1.8 - Math.random() * 1.5);
        h.jump = { to: b, from, land: new THREE.Vector3(lx, PB.weatherY(lx), lz), t: 0 };
        g.sound?.('swing', from, 0.4);
      }
      return;
    }
    if (h.task === 'board') { h.task = 'idle'; h.path.length = 0; }
    // at quarters: gunners at the guns on the engaged side, soldiers lining the rail, sailors to the masts
    if (foe) {
      const toFoe = s.model.worldToLocal(foe.pos.clone());
      const sideZ = toFoe.z > 0 ? 1 : -1;
      if (h.task !== 'station' || (h.st.pos.z * sideZ < 0 && h.role !== 'sailor')) {
        h.task = 'station';
        let at: THREE.Vector3;
        if (h.role === 'gunner') {
          const gs = P.guns.filter((gn) => gn.side === sideZ && Math.abs(gn.pos.y - 0.62 - P.weatherY(gn.pos.x)) < 0.3);
          const gn = gs.length ? gs[Math.floor(Math.random() * gs.length)] : null;
          at = gn ? new THREE.Vector3(gn.pos.x - 0.6, 0, sideZ * (P.hb(gn.pos.x, P.weatherY(gn.pos.x) + 0.5) - 1.9)) : this.spot(s, 1, sideZ);
        } else if (h.role === 'soldier') at = this.spot(s, Math.random() < 0.6 ? 0 : 2, sideZ, true);
        else at = this.spot(s, 1, Math.random() < 0.5 ? sideZ : -sideZ);
        this.go(h, at, 3.2);
        h.face = sideZ > 0 ? 0 : Math.PI;
      }
      return;
    }
    if (h.task === 'station') { h.task = 'idle'; h.path.length = 0; h.wait = Math.random() * 3; }
    // peace: wander between jobs about the deck
    if (!h.path.length) {
      h.wait -= dt;
      if (h.wait <= 0) {
        h.wait = 4 + Math.random() * 14;
        const lvl = h.role === 'soldier' ? (Math.random() < 0.7 ? 0 : 2) : h.role === 'gunner' ? (Math.random() < 0.8 ? 1 : 2) : [1, 1, 2, 0][Math.floor(Math.random() * 4)];
        const rail = Math.random() < 0.4;
        this.go(h, this.spot(s, lvl, 0, rail), 1.25 + Math.random() * 0.3);
        h.face = null;
      }
    }
  }

  private animateCrews(dt: number) {
    const g = this.game;
    const near = g.camera.position;
    for (const [s, hands] of [...this.crews]) {
      const gp = this.grapples.find((x) => x.a === s || x.b === s);
      const foe = this.foeOf.get(s) ?? (gp ? (gp.a === s ? gp.b : gp.a) : null);
      const far = s.root.position.distanceTo(near) > 160;
      const sides = new Set(hands.filter((h) => h.alive && !h.prisoner && !h.jump).map((h) => h.side));
      const enemiesAboard = sides.size > 1 ? hands.filter((h) => h.alive && !h.prisoner && !h.jump) : [];
      for (const h of [...hands]) {
        if (h.alive) this.think(s, h, foe, gp, enemiesAboard, dt);
        // a leap between the ships: fly in world space, land on the other deck and join her crew there
        if (h.jump) {
          const j = h.jump;
          j.t += dt / 0.85;
          const to = j.to.model.localToWorld(j.land.clone());
          const w = j.from.clone().lerp(to, Math.min(1, j.t)); w.y += Math.sin(Math.min(1, j.t) * Math.PI) * 1.3;
          h.st.pos.copy(s.model.worldToLocal(w));
          h.st.speed = 3; h.st.yaw = Math.atan2(to.x - j.from.x, to.z - j.from.z) - new THREE.Euler().setFromQuaternion(s.quat, 'YXZ').y;
          if (j.t >= 1) {
            hands.splice(hands.indexOf(h), 1);
            const other = this.crews.get(j.to);
            if (other) {
              j.to.model.add(h.holder); h.ship = j.to; h.st.pos.copy(j.land); h.jump = null; h.anim.init = true; h.path.length = 0; h.task = 'fight';
              other.push(h);
            } else { h.holder.removeFromParent(); releaseRig(h.rig); }
            continue;
          }
        } else if (h.alive && h.path.length) {
          // walk the waypoints in deck space
          const tgt = h.path[0];
          const d = Math.hypot(tgt.x - h.st.pos.x, tgt.z - h.st.pos.z);
          const step = h.speed * dt;
          if (d <= step + 0.02) { h.st.pos.x = tgt.x; h.st.pos.z = tgt.z; h.path.shift(); }
          else { h.st.pos.x += (tgt.x - h.st.pos.x) / d * step; h.st.pos.z += (tgt.z - h.st.pos.z) / d * step; }
          const want = Math.atan2(tgt.x - h.st.pos.x, tgt.z - h.st.pos.z);
          let dy = want - h.st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          h.st.yaw += dy * Math.min(1, dt * 8);
          h.st.speed = d > 0.05 ? h.speed : 0;
        } else {
          h.st.speed = 0;
          if (h.face !== null && h.alive) { let dy = h.face - h.st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); h.st.yaw += dy * Math.min(1, dt * 5); }
        }
        if (!h.jump) h.st.pos.y = this.deckH(h.ship, h.st.pos.x, h.st.pos.z);
        h.st.action = h.alive ? 'idle' : 'dead';
        // gunners and hands at work: hauling, ramming, sponging (busy hands); idle talk in peace
        h.anim.talking = !h.alive ? 0 : h.task === 'station' && !h.path.length ? (h.role === 'gunner' ? Math.max(0, Math.sin(this.t * 3 + h.st.pos.x)) : 0) : h.role === 'sailor' && !h.path.length && !foe ? 0.15 : 0;
        if (far && Math.random() < 0.5) continue;
        // pose in deck space (the holder's world matrix is the ship's; the animator works locally)
        h.holder.matrixWorld.identity();
        h.anim.update(dt, h.st);
      }
    }
  }
}
