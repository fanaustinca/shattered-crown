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
import { ITEMS, buildItemMesh } from '../props/items';

type Side = 'vanguardia' | 'ironreach';

interface Live { center: THREE.Vector3; dir: THREE.Vector3; t: number; start: Record<Side, number>; ids: Set<Soldier>; phaseT: number; id: number; guns: ReturnType<War['addCannon']>[]; over?: boolean }
export interface Front {
  bridge: Bridge; path: THREE.Vector3[]; cum: number[]; line: number; battleT: number; live: Live | null; name: string;
  /** troops each side keeps at this front (the war goes on out of sight: attrition, reinforcement, the line moves) */
  str: Record<Side, number>;
  /** line movement per game hour, for the journal */
  trend: number;
  /** a battle that broke out away from the fronts (armies meeting in the field) */
  field?: boolean;
}

let BID = 1;

export class Fronts {
  fronts: Front[] = [];
  private repathT = new Map<Soldier, number>();
  log: string[] = [];
  constructor(public game: Game, public war: War) {}

  build() {
    const war = this.war;
    for (const p of this.game.towns.plans) for (const b of p.buildings) if (b.spec.type === 'barracks' && (p.site.kingdom === 'vanguardia' || p.site.kingdom === 'ironreach')) this.barracks[p.site.kingdom]++;
    for (const b of this.game.world.bridges) {
      const near = (side: Side) => war.routes.filter((r) => r.side === side).sort((a, c) => a.pts[a.pts.length - 1].distanceTo(new THREE.Vector3(b.x, a.pts[0].y, b.z)) - c.pts[c.pts.length - 1].distanceTo(new THREE.Vector3(b.x, c.pts[0].y, b.z)))[0];
      const v = near('vanguardia'), ir = near('ironreach');
      if (!v || !ir) continue;
      // Vanguardian town -> west bank -> bridge -> east bank -> Ironreach town
      const path = [...v.pts, new THREE.Vector3(b.x, b.deck, b.z), ...[...ir.pts].reverse()];
      const cum = [0];
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + path[i].distanceTo(path[i - 1]));
      this.fronts.push({ bridge: b, path, cum, line: 0, battleT: 40 + Math.random() * 200, live: null, name: b.name, str: { vanguardia: 1100 + Math.random() * 200, ironreach: 1100 + Math.random() * 200 }, trend: 0 });
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
    const strs = ` — ${Math.round(f.str.vanguardia)} Vanguardian and ${Math.round(f.str.ironreach)} Ironreach troops`;
    const mom = Math.abs(f.trend) < 0.002 ? ', holding' : f.trend > 0 ? ', Vanguardia gaining ground' : ', Ironreach gaining ground';
    if (Math.abs(l) < 0.06) return `${f.name}: the armies face each other across the bridge${strs}${mom}`;
    if (l > 0) return `${f.name}: Vanguardia has crossed and is pushing into Ironreach (${Math.round(l * 100)}% of the way)${strs}${mom}`;
    return `${f.name}: Ironreach has crossed and is pushing into Vanguardia (${Math.round(-l * 100)}% of the way)${strs}${mom}`;
  }

  /** battles that broke out in the open, away from a front */
  fields: Front[] = [];
  private detectT = 2;
  /** barracks per kingdom (reinforcements per game hour come from them) */
  barracks: Record<Side, number> = { vanguardia: 0, ironreach: 0 };

  /** The war out of sight, every moment: each front is a slow grind (Lanchester attrition — each side loses
   *  men in proportion to the other's numbers), the barracks feed fresh battalions in, and the line drifts
   *  toward whoever is weaker; long supply lines slow an advance deep in enemy country. */
  private simulate(dtH: number) {
    if (dtH <= 0) return;
    const n = Math.max(1, this.fronts.length);
    for (const f of this.fronts) {
      if (f.live) continue;
      const V = f.str.vanguardia, I = f.str.ironreach;
      f.str.vanguardia = Math.max(50, V - 0.02 * I * dtH + (8 + this.barracks.vanguardia * 6) / n * dtH);
      f.str.ironreach = Math.max(50, I - 0.02 * V * dtH + (8 + this.barracks.ironreach * 6) / n * dtH);
      const push = (V - I) / (V + I);
      const dl = (push * 0.05 - f.line * 0.012) * dtH;
      f.trend = dl / dtH;
      const before = f.line;
      f.line = THREE.MathUtils.clamp(f.line + dl, -0.85, 0.85);
      if (Math.sign(before) !== Math.sign(f.line) && Math.abs(before) > 0.001) this.log.push(`${f.line > 0 ? 'Vanguardia' : 'Ironreach'} has pushed over the river at ${f.name}.`);
    }
  }

  update(dt: number) {
    const g = this.game, P = g.player.pos;
    this.simulate(dt * g.daySpeed * (g.sleepUntil >= 0 ? 900 : 1));
    for (const f of [...this.fields]) {
      if (f.live) this.fight(f, dt);
      if (!f.live) this.fields.splice(this.fields.indexOf(f), 1);
    }
    this.detectT -= dt;
    if (this.detectT <= 0) { this.detectT = 2; this.detectField(); }
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
    if (f.field) { const msg = `${winner === 'vanguardia' ? 'Vanguardia' : 'Ironreach'} wins the fight at ${f.name}.`; this.log.push(msg); if (tell) this.game.hud.toast(msg); return; }
    f.str[winner === 'vanguardia' ? 'ironreach' : 'vanguardia'] *= 0.85;
    const step = 0.12 + Math.random() * 0.08;
    const before = f.line;
    f.line = THREE.MathUtils.clamp(f.line + (winner === 'vanguardia' ? step : -step), -0.85, 0.85);
    this.war.battles[winner]++;
    const crossed = Math.sign(before) !== Math.sign(f.line) || (before === 0);
    const msg = `${winner === 'vanguardia' ? 'Vanguardia' : 'Ironreach'} wins the battle at ${f.name}${crossed ? ' and takes the bridge' : ''}. ${this.status(f)}.`;
    this.log.push(msg);
    if (tell) this.game.hud.toast(msg);
  }

  /** Raise the armies and set them in line of battle: two long ranks of foot, archers behind, field guns
   *  behind them and horse on the wings. At a bridge the attackers have already forced a crossing, so the
   *  battle is fought on open ground on one bank instead of in a crush on the bridge. */
  begin(f: Front) {
    const g = this.game, war = this.war;
    let { p, dir } = this.posAt(f, f.line);
    const atBridge = Math.abs(f.line) < 0.06;
    // the field: open, fairly level, dry ground near the front, clear of towns, with both armies on the
    // same bank (the line of battle may be turned off the road's line to fit the ground)
    {
      const sideB = atBridge ? (Math.random() < 0.5 ? 1 : -1) : 0;
      const base = atBridge ? p.clone().addScaledVector(dir, sideB * (f.bridge.len / 2 + 70)) : p.clone();
      const bankOf = (q: THREE.Vector3) => Math.sign(q.x - riverX(q.z));
      const dry = (x: number, z: number) => g.world.waterLevelAt(x, z) < g.world.heightAt(x, z) - 0.3;
      const acr0 = new THREE.Vector3(-dir.z, 0, dir.x);
      let best = p.clone(), bestDir = dir.clone(), bs = 1e9;
      for (let a = 0; a < 6; a++) for (let c = -3; c <= 3; c++) {
        const q = base.clone().addScaledVector(dir, (atBridge ? sideB : (a % 2 ? 1 : -1)) * a * 30 * (atBridge ? 1 : 0.6)).addScaledVector(acr0, c * 35);
        if (!dry(q.x, q.z)) continue;
        let town = 0;
        for (const pl of g.towns.plans) { const d = Math.hypot(pl.site.x - q.x, pl.site.z - q.z); town += Math.max(0, (pl.siteR ?? 80) + 80 - d); }
        for (let k = 0; k < 8; k++) {
          const th = Math.atan2(dir.z, dir.x) + (k < 4 ? k : 4 - k) * Math.PI / 8;
          const dd = new THREE.Vector3(Math.cos(th), 0, Math.sin(th)), ac = new THREE.Vector3(-dd.z, 0, dd.x);
          let ok = true, lo = 1e9, hi = -1e9, wood = 0;
          for (const u of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) for (const w of [-1, 0, 1]) {
            const x = q.x + dd.x * u * 75 + ac.x * w * 30, z = q.z + dd.z * u * 75 + ac.z * w * 30;
            const pt = new THREE.Vector3(x, 0, z);
            if (!dry(x, z) || bankOf(pt) !== bankOf(q)) { ok = false; break; }
            const h = g.world.heightAt(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h);
            wood += g.world.forestAt(x, z);
          }
          if (!ok) continue;
          const score = (hi - lo) * 2 + wood * 25 + town * 3 + q.distanceTo(base) * 0.05 + Math.abs(k < 4 ? k : 4 - k) * 4;
          if (score < bs) { bs = score; best = q; bestDir = dd; }
        }
      }
      p = best.clone(); p.y = g.world.heightAt(p.x, p.z);
      dir = bestDir;
    }
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    const gap = 75;
    const live: Live = { center: p.clone(), dir: dir.clone(), t: 0, start: { vanguardia: 0, ironreach: 0 }, ids: new Set(), phaseT: 0, id: BID++, guns: [] };
    const budget = Math.max(16, 200 - war.soldiers.filter((s) => s.alive).length);
    const per = Math.min(72, Math.floor(budget / 2));
    const bank = (q: THREE.Vector3) => Math.sign(q.x - riverX(q.z));
    for (const side of ['vanguardia', 'ironreach'] as Side[]) {
      const sg = side === 'vanguardia' ? -1 : 1;           // Vanguardia stands on the -dir side
      const front = p.clone().addScaledVector(dir, sg * gap);
      const face = Math.atan2(-sg * dir.x, -sg * dir.z);
      const enemy = p.clone().addScaledVector(dir, -sg * gap);
      const nCav = Math.max(2, Math.round(per * 0.12)), nArch = Math.max(2, Math.round(per * 0.25)), nInf = per - nCav - nArch;
      const files = Math.ceil(nInf / 2), aFiles = nArch;
      for (let k = 0; k < per; k++) {
        const cav = k >= nInf + nArch, arch = !cav && k >= nInf;
        let slot: THREE.Vector3;
        if (!cav && !arch) {
          // two ranks, a pace and a half between files, the rear rank covering the gaps
          const rank = Math.floor(k / files), file = (k % files) - (files - 1) / 2 + rank * 0.5;
          slot = front.clone().addScaledVector(across, file * 3.0).addScaledVector(dir, sg * rank * 2.4);
        } else if (arch) {
          const a = k - nInf, file = a - (aFiles - 1) / 2;
          slot = front.clone().addScaledVector(across, file * 4.0).addScaledVector(dir, sg * 12);
        } else {
          const c = k - nInf - nArch, wing = c % 2 ? 1 : -1;
          slot = front.clone().addScaledVector(across, wing * (files * 1.5 + 12 + (c >> 1) * 3.5)).addScaledVector(dir, sg * 8);
        }
        slot.x += (Math.random() - 0.5) * 0.5; slot.z += (Math.random() - 0.5) * 0.5;
        slot.y = g.world.heightAt(slot.x, slot.z);
        // they march up from behind their own line (unless that would be in the river)
        let spawn = slot.clone().addScaledVector(dir, sg * (12 + Math.random() * 10)).addScaledVector(across, (Math.random() - 0.5) * 6);
        if (bank(spawn) !== bank(slot) || g.world.waterLevelAt(spawn.x, spawn.z) > g.world.heightAt(spawn.x, spawn.z) - 0.2) spawn = slot.clone().addScaledVector(dir, sg * 4);
        spawn.y = g.groundAt(spawn.x, spawn.z, spawn.y + 40);
        const s = cav ? war.spawnCavalry(side, spawn) : war.spawnSoldier(side, spawn);
        s.battle = { slot, face, phase: 'form', enemy, id: live.id };
        s.marching = false; s.order = 'advance';
        s.path = [slot.clone()];
        if (arch) this.makeArcher(s);
        if (k === Math.floor(files / 2)) { s.standard = true; war.carryStandard(s); }
        live.ids.add(s);
        live.start[side]++;
      }
      // the commander stands behind the centre of the line, by the guns
      const cpos = front.clone().addScaledVector(dir, sg * 16);
      cpos.y = g.groundAt(cpos.x, cpos.z, cpos.y + 40);
      const cmd = war.spawnSoldier(side, cpos);
      cmd.battle = { slot: cpos.clone(), face, phase: 'form', enemy, id: live.id };
      cmd.marching = false; cmd.order = 'hold'; cmd.path = [];
      this.makeCommander(cmd);
      live.ids.add(cmd); live.start[side]++;
      // a battery of field guns behind the archers, laid on the enemy line
      for (const e of [-1, 1]) {
        const gp = front.clone().addScaledVector(across, e * Math.min(18, files * 0.6)).addScaledVector(dir, sg * 22);
        if (bank(gp) !== bank(front)) continue;
        gp.y = g.world.heightAt(gp.x, gp.z);
        const c = war.addCannon(gp, face, side);
        c.reload = 8 + Math.random() * 10; c.loaded = false;
        c.aim = () => {
          // the nearest knot of enemy foot, with the guns lifting fire once the lines have met
          let best: THREE.Vector3 | null = null, bd = 1e9;
          for (const o of live.ids) if (o.alive && o.side !== side) { const d = o.st.pos.distanceTo(c.pos); if (d < bd) { bd = d; best = o.st.pos; } }
          if (!best || bd < 45) return null;
          for (const o of live.ids) if (o.alive && o.side === side && o.st.pos.distanceTo(best) < 14) return null;
          return best.clone();
        };
        live.guns.push(c);
      }
    }
    f.live = live;
    const d = p.distanceTo(g.player.pos);
    g.hud.toast(`Drums at ${f.name}! The armies of Vanguardia and Ironreach are forming for battle ${d < 300 ? 'right here' : `${Math.round(d)} m away`}.`);
    g.sound?.('horn', p, 1);
  }
  private makeArcher(s: Soldier) {
    s.archer = true;
    // Ironreach has the mines and the powder mills: half its shot are musketeers; Vanguardia a third
    s.musket = Math.random() < (s.side === 'ironreach' ? 0.5 : 0.3);
    s.volleyT = s.musket ? 6 + Math.random() * 6 : 3 + Math.random() * 3;
    if (s.sword) s.sword.visible = false;
    const m = buildItemMesh(s.musket ? ITEMS.musket : ITEMS.bow);
    if (m) {
      if (s.musket) { m.rotation.set(1.2, 0, 0); m.position.set(0, -0.05, 0.05); s.rig.byName.handR.add(m); }
      else { m.position.set(0.02, -0.08, 0.02); s.rig.byName.handL.add(m); }
    }
  }

  private fight(f: Front, dt: number) {
    const L = f.live!, g = this.game;
    L.t += dt;
    const alive = (side: Side) => [...L.ids].filter((s) => s.alive && s.side === side).length;
    const v = alive('vanguardia'), i = alive('ironreach');
    const across = new THREE.Vector3(-L.dir.z, 0, L.dir.x);
    // phases: form up (18 s), advance at a walk, charge when the lines are close; archers halt at bowshot
    // and loose volleys over their own line; field guns fire on the enemy foot until the lines meet
    // morale: a side that has lost most of its men and sees the battle going against it gives in — its commander
    // asks for terms, or (if he has fallen) it simply breaks and runs
    if (!L.over) {
      const sv = v / Math.max(1, L.start.vanguardia), si = i / Math.max(1, L.start.ironreach);
      for (const [side, mine, theirs] of [['vanguardia', sv, si], ['ironreach', si, sv]] as [Side, number, number][]) {
        const cmd = [...L.ids].find((x) => x.side === side && x.commander);
        const cmdAlive = !!cmd?.alive;
        if (L.t > 30 && mine < (cmdAlive ? 0.45 : 0.55) && theirs > mine * 1.25) { this.yield(f, L, side, cmdAlive); return; }
      }
    }
    for (const s of L.ids) {
      if (!s.alive || !s.battle || s.surrendered) continue;
      const b = s.battle;
      const lateral = b.slot.clone().sub(L.center).dot(across);
      if (s.commander) {
        // he rides out the battle behind his men, sword drawn only if the enemy reaches him
        if (!s.fightTarget) { s.st.yaw += (b.face - s.st.yaw) * Math.min(1, dt * 2); if (s.st.pos.distanceTo(b.slot) > 2 && !s.path.length) s.path = [b.slot.clone()]; }
        continue;
      }
      if (s.archer) {
        const e = this.nearestFoeS(s, L, lateral);
        const d = e ? e.st.pos.distanceTo(s.st.pos) : 1e9;
        if (d < 14) { if (s.sword) s.sword.visible = true; if (b.phase !== 'charge') { b.phase = 'charge'; s.sprint = true; } }
        else if (L.t > 18 && d > (s.musket ? 75 : 95) && b.phase !== 'charge') { if (b.phase === 'form') { b.phase = 'advance'; s.path = this.route(f, s.st.pos, b.enemy.clone().addScaledVector(across, lateral), lateral * 0.15); } }
        else if (L.t > 18 && e && b.phase !== 'charge') {
          s.path = []; s.st.speed = 0;
          s.st.yaw = Math.atan2(e.st.pos.x - s.st.pos.x, e.st.pos.z - s.st.pos.z);
          s.volleyT -= dt;
          if (s.volleyT <= 0 && s.musket) {
            // present, fire: a flat shot with a matchlock's scatter, a crack and a bank of white smoke
            s.volleyT = 13 + Math.random() * 6;
            const from = s.st.pos.clone().add(new THREE.Vector3(0, 1.45, 0)), to = e.st.pos.clone().add(new THREE.Vector3(0, 1.1, 0));
            const dir = to.sub(from).normalize();
            dir.x += (Math.random() - 0.5) * 0.05; dir.y += (Math.random() - 0.5) * 0.03 + 0.004; dir.z += (Math.random() - 0.5) * 0.05;
            dir.normalize();
            from.addScaledVector(dir, 1.1);
            g.combat.shoot(from, dir.multiplyScalar(260), 70, false);
            g.particles.emit('smoke', from, 10); g.particles.emit('spark', from, 6);
            g.sound?.('musket', from, 1.2);
          } else if (s.volleyT <= 0) {
            s.volleyT = 4 + Math.random() * 2.5;
            // a high, arcing shot at the enemy mass: solve the launch angle for the range, then add the
            // scatter of a tired arm in a crowd
            const from = s.st.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), to = e.st.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 1.0, (Math.random() - 0.5) * 6));
            const flat = Math.hypot(to.x - from.x, to.z - from.z), V = 48;
            const disc = V ** 4 - 9.81 * (9.81 * flat * flat + 2 * (to.y - from.y) * V * V);
            const ang = disc > 0 ? Math.atan((V * V - Math.sqrt(disc)) / (9.81 * flat)) : Math.PI / 4;
            const hd = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
            const vel = hd.multiplyScalar(V * Math.cos(ang)).setY(V * Math.sin(ang));
            from.addScaledVector(vel.clone().normalize(), 0.9);
            g.combat.shoot(from, vel, 30, false);
            g.sound?.('swing', from, 0.25);
          }
        }
        continue;
      }
      if (s.horse) {
        // horse waits on the wing until the foot are locked together, then sweeps round the flank onto
        // the enemy archers and guns
        if (L.t < 40) { if (b.phase !== 'charge' && s.st.pos.distanceTo(b.slot) > 3 && (this.repathT.get(s) ?? 0) < L.t) { s.path = [b.slot.clone()]; this.repathT.set(s, L.t + 1.5); } continue; }
        if (b.phase !== 'charge') { b.phase = 'charge'; s.sprint = true; }
        if (!s.fightTarget && (s.path.length === 0 || (this.repathT.get(s) ?? 0) < L.t)) {
          let tgt: Soldier | null = null, bd = 1e9;
          for (const o of L.ids) if (o.alive && o.side !== s.side) { const d = o.st.pos.distanceTo(s.st.pos) * (o.archer ? 0.5 : 1); if (d < bd) { bd = d; tgt = o; } }
          if (tgt) { s.path = [tgt.st.pos.clone()]; this.repathT.set(s, L.t + 2); }
        }
        continue;
      }
      if (b.phase === 'form' && L.t > 18) { b.phase = 'advance'; s.path = this.route(f, s.st.pos, b.enemy.clone().addScaledVector(across, lateral), lateral * 0.15); }
      if (b.phase !== 'charge' && (s.fightTarget || (L.t > 22 && this.nearestFoe(s, L, true) < 45))) { b.phase = 'charge'; s.sprint = true; }
      if (b.phase === 'charge' && !s.fightTarget && (s.path.length === 0 || (this.repathT.get(s) ?? 0) < L.t)) {
        // each man goes for the enemy in front of his own place in the line, so the lines meet along their
        // whole width instead of everyone converging on one knot
        const e = this.nearestFoeS(s, L, lateral);
        if (e) { s.path = this.route(f, s.st.pos, e.st.pos, lateral * 0.15); this.repathT.set(s, L.t + 2); }
      }
      if (b.phase === 'form' && !s.path.length) s.st.yaw += (b.face - s.st.yaw) * Math.min(1, dt * 3);
    }
    const done = (v < L.start.vanguardia * 0.28 || i < L.start.ironreach * 0.28) || L.t > 360;
    if (!done) return;
    const winner: Side = v / Math.max(1, L.start.vanguardia) >= i / Math.max(1, L.start.ironreach) ? 'vanguardia' : 'ironreach';
    if (!f.field) { f.str.vanguardia = Math.max(50, f.str.vanguardia - (L.start.vanguardia - v) * 8); f.str.ironreach = Math.max(50, f.str.ironreach - (L.start.ironreach - i) * 8); }
    this.shift(f, winner, true);
    // the beaten side flees back down the road; the victors hold the field; the guns are limbered up
    for (const s of L.ids) {
      if (!s.alive) continue;
      s.battle = null; s.sprint = s.side !== winner;
      if (s.side !== winner) s.path = [L.center.clone().addScaledVector(L.dir, (s.side === 'vanguardia' ? -1 : 1) * 250)];
    }
    for (const c of L.guns) this.war.removeCannon(c);
    f.live = null;
    void g;
  }
  private makeCommander(s: Soldier) {
    s.commander = true;
    s.person.name = (s.side === 'vanguardia' ? ['Captain Aldric', 'Lord Marshal Wynne', 'Captain Edrys', 'Sir Hollis'] : ['Warlord Kael', 'Captain Varr', 'Iron Marshal Bjorn', 'Thane Ulric'])[Math.floor(Math.random() * 4)];
    // a tall plume on the helm and a cloak in the kingdom's colour, so he can be picked out on the field
    const plume = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6).scale(0.6, 2.2, 1), new THREE.MeshStandardMaterial({ color: s.side === 'vanguardia' ? 0xe8e0d0 : 0xb01818, roughness: 0.9 }));
    plume.position.set(0, 1.86, -0.05);
    s.rig.byName.head.add(plume);
    this.war.carryStandard(s);
  }
  /** One side gives up the field: with its commander alive it surrenders (the men kneel and drop their
   *  weapons, and are not to be harmed); without him it breaks and runs. */
  private yield(f: Front, L: Live, side: Side, terms: boolean) {
    const g = this.game, winner: Side = side === 'vanguardia' ? 'ironreach' : 'vanguardia';
    L.over = true;
    const cmd = [...L.ids].find((x) => x.side === side && x.commander);
    const name = side === 'vanguardia' ? 'Vanguardia' : 'Ironreach';
    const msg = terms ? `${cmd?.person.name ?? 'The commander'} of ${name} lowers his sword and asks for terms at ${f.name}. His men throw down their arms.` : `With their commander dead, the ${name} line breaks at ${f.name} and runs!`;
    if (L.center.distanceTo(g.player.pos) < 1500) g.hud.toast(msg);
    this.log.push(msg);
    for (const s of L.ids) {
      if (!s.alive) continue;
      if (s.side === side) {
        s.battle = null; s.fightTarget = null; s.sprint = !terms;
        if (terms) this.surrender(s);
        else s.path = [L.center.clone().addScaledVector(L.dir, (s.side === 'vanguardia' ? -1 : 1) * 260)];
      } else { s.battle = null; s.sprint = false; s.fightTarget = null; s.path = []; s.say?.(['Victory!', 'They yield!', 'Huzzah!'][Math.floor(Math.random() * 3)], false); }
    }
    if (!f.field) { f.str[side] = Math.max(50, f.str[side] - (L.start[side] - [...L.ids].filter((x) => x.alive && x.side === side).length) * 8 - (terms ? L.start[side] * 4 : 0)); }
    this.shift(f, winner, false);
    for (const c of L.guns) this.war.removeCannon(c);
    f.live = null;
  }
  surrender(s: Soldier) {
    s.surrendered = true; s.hostile = false; s.order = 'hold'; s.holdAt = s.st.pos.clone(); s.path = [];
    if (s.sword) s.sword.visible = false;
    (s.st as { sitting?: boolean }).sitting = true;
  }

  /** Armies that meet in the open (columns on the road, troops you spawned) form up and fight a proper
   *  battle instead of brawling in a knot. */
  private detectField() {
    const war = this.war;
    const free = war.soldiers.filter((s) => s.alive && !s.battle && !s.squad && !s.surrendered && !s.holdAt && !s.horse);
    const V = free.filter((s) => s.side === 'vanguardia'), I = free.filter((s) => s.side === 'ironreach');
    if (V.length < 5 || I.length < 5) return;
    for (const a of V) {
      const b = I.find((o) => o.st.pos.distanceTo(a.st.pos) < 320);
      if (!b) continue;
      const mid = a.st.pos.clone().lerp(b.st.pos, 0.5);
      const vs = V.filter((s) => s.st.pos.distanceTo(mid) < 380), is = I.filter((s) => s.st.pos.distanceTo(mid) < 380);
      if (vs.length >= 5 && is.length >= 5) { this.fieldBattle([...vs, ...is]); return; }
    }
  }
  fieldBattle(men: Soldier[]) {
    const g = this.game, war = this.war;
    const cen = (side: Side) => { const a = men.filter((s) => s.side === side); return a.reduce((p, s) => p.add(s.st.pos), new THREE.Vector3()).multiplyScalar(1 / a.length); };
    const cV = cen('vanguardia'), cI = cen('ironreach');
    const center = cV.clone().lerp(cI, 0.5);
    const dir = cI.clone().sub(cV).setY(0).normalize();
    const across = new THREE.Vector3(-dir.z, 0, dir.x);
    const near = g.towns.plans.filter((p) => !p.minor).sort((a, b) => Math.hypot(a.site.x - center.x, a.site.z - center.z) - Math.hypot(b.site.x - center.x, b.site.z - center.z))[0];
    const bridge = [...g.world.bridges].sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z))[0];
    const f: Front = { bridge, path: [], cum: [], line: 0, battleT: 1e9, live: null, name: `the field near ${near?.site.name ?? 'the road'}`, str: { vanguardia: 0, ironreach: 0 }, trend: 0, field: true };
    const live: Live = { center, dir, t: 0, start: { vanguardia: 0, ironreach: 0 }, ids: new Set(), phaseT: 0, id: BID++, guns: [] };
    const half = Math.max(30, cV.distanceTo(cI) / 2);
    for (const side of ['vanguardia', 'ironreach'] as Side[]) {
      const sg = side === 'vanguardia' ? -1 : 1;
      const mine = men.filter((s) => s.side === side);
      const front = center.clone().addScaledVector(dir, sg * half), enemy = center.clone().addScaledVector(dir, -sg * half);
      const face = Math.atan2(-sg * dir.x, -sg * dir.z);
      const files = Math.ceil(mine.length / 2);
      mine.forEach((s, k) => {
        const rank = Math.floor(k / files), file = (k % files) - (files - 1) / 2 + rank * 0.5;
        const slot = front.clone().addScaledVector(across, file * 3.0).addScaledVector(dir, sg * rank * 2.4);
        slot.y = g.world.heightAt(slot.x, slot.z);
        s.battle = { slot, face, phase: 'form', enemy, id: live.id };
        s.marching = false; s.order = 'advance'; s.path = [slot.clone()]; s.sprint = true;
        live.ids.add(s); live.start[side]++;
      });
      if (mine.length >= 8) { const c = mine.find((x) => !x.standard && !x.archer) ?? mine[0]; this.makeCommander(c); c.battle!.slot = front.clone().addScaledVector(dir, sg * 10); c.path = [c.battle!.slot.clone()]; }
    }
    live.t = 6;   // they're already in the field: a shorter form-up
    f.live = live;
    this.fields.push(f);
    if (center.distanceTo(g.player.pos) < 1200) g.hud.toast(`The armies meet in the field near ${near?.site.name ?? 'here'} — they form their lines for battle!`);
    g.sound?.('horn', center, 1);
    void war;
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
  private nearestFoe(s: Soldier, L: Live, footOnly = false) { let d = 1e9; for (const o of L.ids) if (o.alive && !o.surrendered && o.side !== s.side && !(footOnly && o.horse)) d = Math.min(d, o.st.pos.distanceTo(s.st.pos)); return d; }
  /** the enemy a soldier in a live battle should engage (nearest, preferring the man opposite him) */
  foeFor(s: Soldier, range: number) {
    const f = this.fronts.find((x) => x.live && x.live.ids.has(s)) ?? this.fields.find((x) => x.live && x.live.ids.has(s));
    if (!f || !s.battle) return null;
    const L = f.live!, across = new THREE.Vector3(-L.dir.z, 0, L.dir.x);
    const lateral = s.battle.slot.clone().sub(L.center).dot(across);
    const e = this.nearestFoeS(s, L, lateral * 0.5 + s.st.pos.clone().sub(L.center).dot(across) * 0.5);
    return e && e.st.pos.distanceTo(s.st.pos) < range ? e : null;
  }
  /** nearest enemy, weighted toward the man opposite this one's place in the line */
  private nearestFoeS(s: Soldier, L: Live, lateral = 0) {
    const across = new THREE.Vector3(-L.dir.z, 0, L.dir.x);
    let d = 1e9, best: Soldier | null = null;
    for (const o of L.ids) if (o.alive && !o.surrendered && o.side !== s.side) {
      const lat = o.st.pos.clone().sub(L.center).dot(across);
      const dd = o.st.pos.distanceTo(s.st.pos) + Math.abs(lat - lateral) * 0.8;
      if (dd < d) { d = dd; best = o; }
    }
    return best;
  }
}
