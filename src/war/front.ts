// The front lines. Each bridge is a front: a line along the war road from a Vanguardian town, over the
// bridge, to an Ironreach town. Every few minutes the armies meet at the front. Near you the battle is
// fought for real: both armies form up in ranks with a standard and cavalry on the wings, advance, then
// charge and close; the side that breaks loses ground. Far away the outcome is decided by numbers and luck.
// Winning pushes the front over the river and up the road toward the enemy's towns — and losing near
// your own capital stiffens the defence.
import * as THREE from 'three';
import type { Game } from '../game';
import type { War, Soldier } from './war';
import { riverX, type Bridge } from '../world/layout';

type Side = 'vanguardia' | 'ironreach';

interface Live { center: THREE.Vector3; dir: THREE.Vector3; t: number; start: Record<Side, number>; ids: Set<Soldier>; phaseT: number; id: number }
export interface Front { bridge: Bridge; path: THREE.Vector3[]; cum: number[]; line: number; battleT: number; live: Live | null; name: string }

let BID = 1;

export class Fronts {
  fronts: Front[] = [];
  private repathT = new Map<Soldier, number>();
  log: string[] = [];
  constructor(public game: Game, public war: War) {}

  build() {
    const war = this.war;
    for (const b of this.game.world.bridges) {
      const near = (side: Side) => war.routes.filter((r) => r.side === side).sort((a, c) => a.pts[a.pts.length - 1].distanceTo(new THREE.Vector3(b.x, a.pts[0].y, b.z)) - c.pts[c.pts.length - 1].distanceTo(new THREE.Vector3(b.x, c.pts[0].y, b.z)))[0];
      const v = near('vanguardia'), ir = near('ironreach');
      if (!v || !ir) continue;
      // Vanguardian town -> west bank -> bridge -> east bank -> Ironreach town
      const path = [...v.pts, new THREE.Vector3(b.x, b.deck, b.z), ...[...ir.pts].reverse()];
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
      this.fronts.push({ bridge: b, path, cum, line: 0, battleT: 40 + Math.random() * 200, live: null, name: b.name });
    }
  }

  /** Point on the war road at front position t (-1 deep in Vanguardia, 0 the bridge, +1 deep in Ironreach). */
  posAt(f: Front, t: number) {
    const total = f.cum[f.cum.length - 1];
    const bridgeI = f.path.findIndex((p) => Math.abs(p.x - f.bridge.x) < 0.01 && Math.abs(p.z - f.bridge.z) < 0.01);
    const s0 = f.cum[bridgeI];
    const s = t < 0 ? s0 * (1 + t) : s0 + (total - s0) * t;
    let i = 1;
    while (i < f.cum.length - 1 && f.cum[i] < s) i++;
    const a = f.path[i - 1], b = f.path[i];
    const u = THREE.MathUtils.clamp((s - f.cum[i - 1]) / Math.max(0.01, f.cum[i] - f.cum[i - 1]), 0, 1);
    const p = a.clone().lerp(b, u);
    const dir = b.clone().sub(a).setY(0).normalize();
    return { p, dir };
  }

  status(f: Front) {
    const l = f.line;
    if (Math.abs(l) < 0.06) return `${f.name}: the armies face each other across the bridge`;
    if (l > 0) return `${f.name}: Vanguardia has crossed and is pushing into Ironreach (${Math.round(l * 100)}% of the way)`;
    return `${f.name}: Ironreach has crossed and is pushing into Vanguardia (${Math.round(-l * 100)}% of the way)`;
  }

  update(dt: number) {
    const g = this.game, P = g.player.pos;
    for (const f of this.fronts) {
      if (f.live) { this.fight(f, dt); continue; }
      f.battleT -= dt;
      if (f.battleT > 0) continue;
      f.battleT = 260 + Math.random() * 360;
      const { p } = this.posAt(f, f.line);
      const d = p.distanceTo(P);
      if (d < 1400) this.begin(f);
      else this.resolve(f, d < 3500);
    }
  }

  /** Battle decided out of sight. */
  private resolve(f: Front, tell: boolean) {
    // the further a side advances, the longer its supply lines and the harder the enemy fights for home
    const pV = 0.5 - f.line * 0.35 + (Math.random() - 0.5) * 0.2;
    const v = Math.random() < pV;
    this.shift(f, v ? 'vanguardia' : 'ironreach', tell);
  }
  private shift(f: Front, winner: Side, tell: boolean) {
    const step = 0.12 + Math.random() * 0.08;
    const before = f.line;
    f.line = THREE.MathUtils.clamp(f.line + (winner === 'vanguardia' ? step : -step), -0.85, 0.85);
    this.war.battles[winner]++;
    const crossed = Math.sign(before) !== Math.sign(f.line) || (before === 0);
    const msg = `${winner === 'vanguardia' ? 'Vanguardia' : 'Ironreach'} wins the battle at ${f.name}${crossed ? ' and takes the bridge' : ''}. ${this.status(f)}.`;
    this.log.push(msg);
    if (tell) this.game.hud.toast(msg);
  }

  /** Raise the armies on both sides of the front and set them in line of battle. */
  begin(f: Front) {
    const g = this.game, war = this.war;
    const { p, dir } = this.posAt(f, f.line);
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    // at the bridge the armies form on the two banks; elsewhere 140 m apart across the road
    const atBridge = Math.abs(f.line) < 0.06;
    const gap = atBridge ? f.bridge.len / 2 + 35 : 70;
    const live: Live = { center: p.clone(), dir: dir.clone(), t: 0, start: { vanguardia: 0, ironreach: 0 }, ids: new Set(), phaseT: 0, id: BID++ };
    const budget = Math.max(12, 70 - war.soldiers.filter((s) => s.alive).length);
    const per = Math.min(26, Math.floor(budget / 2));
    for (const side of ['vanguardia', 'ironreach'] as Side[]) {
      const sg = side === 'vanguardia' ? -1 : 1;           // Vanguardia stands on the -dir side
      const front = p.clone().addScaledVector(dir, sg * gap);
      const face = Math.atan2(-sg * dir.x, -sg * dir.z);
      const enemy = p.clone().addScaledVector(dir, -sg * gap);
      const nCav = Math.max(2, Math.floor(per * 0.15)), nInf = per - nCav;
      const files = Math.ceil(nInf / 3);
      for (let k = 0; k < per; k++) {
        const cav = k >= nInf;
        let slot: THREE.Vector3;
        if (!cav) {
          const rank = Math.floor(k / files), file = (k % files) - (files - 1) / 2;
          slot = front.clone().addScaledVector(across, file * 1.7).addScaledVector(dir, sg * rank * 2.0);
        } else {
          const wing = (k - nInf) % 2 ? 1 : -1;
          slot = front.clone().addScaledVector(across, wing * (files * 0.85 + 8 + ((k - nInf) >> 1) * 3)).addScaledVector(dir, sg * 6);
        }
        slot.y = g.world.heightAt(slot.x, slot.z);
        // they march up from behind their own line
        const spawn = slot.clone().addScaledVector(dir, sg * (35 + Math.random() * 15)).addScaledVector(across, (Math.random() - 0.5) * 6);
        spawn.y = g.groundAt(spawn.x, spawn.z, spawn.y + 40);
        const s = cav ? war.spawnCavalry(side, spawn) : war.spawnSoldier(side, spawn);
        s.battle = { slot, face, phase: 'form', enemy, id: live.id };
        s.marching = false; s.order = 'advance';
        s.path = [slot.clone()];
        if (k === Math.floor(files / 2)) { s.standard = true; war.carryStandard(s); }
        live.ids.add(s);
        live.start[side]++;
      }
    }
    f.live = live;
    const d = p.distanceTo(g.player.pos);
    g.hud.toast(`Drums at ${f.name}! The armies of Vanguardia and Ironreach are forming for battle ${d < 300 ? 'right here' : `${Math.round(d)} m away`}.`);
    g.sound?.('horn', p, 1);
  }

  private fight(f: Front, dt: number) {
    const L = f.live!, g = this.game;
    L.t += dt;
    const alive = (side: Side) => [...L.ids].filter((s) => s.alive && s.side === side).length;
    const v = alive('vanguardia'), i = alive('ironreach');
    // phases: form up (20 s), advance at a walk, charge when the lines are close
    for (const s of L.ids) {
      if (!s.alive || !s.battle) continue;
      const b = s.battle;
      const across = new THREE.Vector3(-L.dir.z, 0, L.dir.x);
      const lateral = b.slot.clone().sub(L.center).dot(across);
      if (b.phase === 'form' && L.t > 18) { b.phase = 'advance'; s.path = this.route(f, s.st.pos, b.enemy.clone().addScaledVector(across, lateral), lateral * 0.15); }
      if (b.phase !== 'charge' && (s.fightTarget || (L.t > 22 && this.nearestFoe(s, L) < 70))) { b.phase = 'charge'; s.sprint = true; }
      if (b.phase === 'charge' && !s.fightTarget && (s.path.length === 0 || (this.repathT.get(s) ?? 0) < L.t)) {
        const e = this.nearestFoeS(s, L);
        if (e) { s.path = this.route(f, s.st.pos, e.st.pos, lateral * 0.15); this.repathT.set(s, L.t + 2); }
      }
      if (b.phase === 'form' && !s.path.length) s.st.yaw += (b.face - s.st.yaw) * Math.min(1, dt * 3);
    }
    const done = (v < L.start.vanguardia * 0.28 || i < L.start.ironreach * 0.28) || L.t > 300;
    if (!done) return;
    const winner: Side = v / Math.max(1, L.start.vanguardia) >= i / Math.max(1, L.start.ironreach) ? 'vanguardia' : 'ironreach';
    this.shift(f, winner, true);
    // the beaten side flees back down the road; the victors hold the field
    for (const s of L.ids) {
      if (!s.alive) continue;
      s.battle = null; s.sprint = s.side !== winner;
      if (s.side !== winner) s.path = [L.center.clone().addScaledVector(L.dir, (s.side === 'vanguardia' ? -1 : 1) * 250)];
    }
    f.live = null;
    void g;
  }
  /** A route from a to b that crosses the river by the front's bridge (never wading through the water). */
  route(f: Front, a: THREE.Vector3, b: THREE.Vector3, lateral = 0) {
    const g = this.game, br = f.bridge;
    const sideOf = (p: THREE.Vector3) => Math.sign(p.x - riverX(p.z));
    if (sideOf(a) === sideOf(b)) return [b.clone()];
    const ax = Math.cos(br.yaw), az = -Math.sin(br.yaw);
    const end = (sgn: number, extra: number) => { const e = (br.len / 2 + extra) * sgn; const p = new THREE.Vector3(br.x + ax * e, 0, br.z + az * e); p.y = g.groundAt(p.x, p.z, br.deck + 20); return p; };
    // which end is on a's bank?
    const sa = sideOf(end(1, 5)) === sideOf(a) ? 1 : -1;
    const lat = THREE.MathUtils.clamp(lateral, -2.4, 2.4), px = -az, pz = ax;
    const pts: THREE.Vector3[] = [];
    // how far along the bridge axis a already is: waypoints behind it are skipped
    const ta = (a.x - br.x) * ax + (a.z - br.z) * az;
    for (const [sg, ex] of [[sa, 18], [sa, 2], [0, 0], [-sa, 2], [-sa, 18]] as [number, number][]) {
      const tw = sg * (br.len / 2 + ex);
      if (sa * tw >= sa * ta - 0.5 && !(sg === -sa)) continue;
      const p = sg === 0 ? new THREE.Vector3(br.x, br.deck, br.z) : end(sg, ex);
      p.x += px * lat; p.z += pz * lat;
      p.y = g.groundAt(p.x, p.z, br.deck + 20);
      pts.push(p);
    }
    pts.push(b.clone());
    return pts;
  }
  private nearestFoe(s: Soldier, L: Live) { let d = 1e9; for (const o of L.ids) if (o.alive && o.side !== s.side) d = Math.min(d, o.st.pos.distanceTo(s.st.pos)); return d; }
  private nearestFoeS(s: Soldier, L: Live) { let d = 1e9, best: Soldier | null = null; for (const o of L.ids) if (o.alive && o.side !== s.side) { const dd = o.st.pos.distanceTo(s.st.pos); if (dd < d) { d = dd; best = o; } } return best; }
}
