// Town gates in war. Every gate passage has an iron-shod portcullis on a winch. When enemy soldiers come
// within bowshot of a walled town the portcullis drops, pikemen form up behind it and archers and
// musketeers climb the stairs to the wall-walk and shoot down at the attackers. Attackers who reach a closed
// gate set about it with axes and a ram; enough of them for long enough and the gate is forced. When the
// danger has passed the gate is raised again. You can work the winch yourself (E).
import * as THREE from 'three';
import type { Game } from '../game';
import type { Soldier } from './war';
import { GeoBuilder } from '../build/geom';
import { meshesFrom } from '../props/palette';
import { RAPIER, groups, G_STATIC, ALL } from '../physics/physics';
import type { Action, Interactable } from '../player/interact';
import { ITEMS, buildItemMesh } from '../props/items';

type Side = 'vanguardia' | 'ironreach';
interface Gate {
  pos: THREE.Vector3; yaw: number; w: number; h: number; site: string; inward: THREE.Vector3; side: Side | null;
  idx: number; body: RAPIER.RigidBody;
  open: number; target: number; manualT: number;
  threatT: number; calmT: number; forcedT: number; batter: number;
  defenders: Soldier[];
}

export class Gates {
  gates: Gate[] = [];
  private checkT = 0;
  constructor(public game: Game) {}

  build() {
    const g = this.game;
    const grille = new GeoBuilder();
    // oak lattice shod with iron, spiked at the foot (built 1 m wide × 1 m tall, scaled per gate)
    const W = 1, H = 1;
    for (let i = 0; i <= 10; i++) grille.box('wood:dark|stain:ebony|fin:raw', -W / 2 + (i / 10) * W, H / 2, 0, 0.022, H, 0.03, 2);
    for (let j = 1; j <= 8; j++) grille.box('iron', 0, (j / 9) * H, 0.012, W, 0.014, 0.02, 2);
    const geos = grille.build();
    // every portcullis in the world is one instance of two instanced meshes (wood, iron): 2 draws, not 40+
    const N = g.settlements.gates.length;
    this.meshes = meshesFrom(geos).map((m) => { const im = new THREE.InstancedMesh(m.geometry, m.material as THREE.Material, Math.max(1, N)); im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; g.scene.add(im); return im; });
    for (const gt of g.settlements.gates) {
      const site = g.towns.plans.find((p) => p.site.id === gt.site)?.site;
      const side = site?.kingdom === 'vanguardia' || site?.kingdom === 'ironreach' ? site.kingdom : null;
      const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(gt.pos.x, gt.pos.y + gt.h / 2, gt.pos.z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), gt.yaw)));
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(gt.w / 2, gt.h / 2, 0.2).setCollisionGroups(groups(G_STATIC, ALL)), body);
      const gate: Gate = { ...gt, side, idx: this.gates.length, body, open: 1, target: 1, manualT: 0, threatT: 0, calmT: 0, forcedT: 0, batter: 0, defenders: [] };
      const it: Interactable = {
        name: () => `Portcullis${gate.forcedT > 0 ? ' (smashed)' : ''}`,
        actions: (): Action[] => gate.forcedT > 0 ? [] : [{ key: 'E', label: gate.target > 0.5 ? 'Lower the portcullis' : 'Raise the portcullis', run: () => { gate.target = gate.target > 0.5 ? 0 : 1; gate.manualT = 90; g.sound?.('creak', gate.pos, 1.2); } }],
      };
      g.physics.owners.set(col.handle, { kind: 'gate', interact: it });
      this.gates.push(gate);
      this.place(gate);
    }
  }
  meshes: THREE.InstancedMesh[] = [];
  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion(); private _s = new THREE.Vector3(); private _p = new THREE.Vector3();
  private place(gt: Gate) {
    this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), gt.yaw);
    this._s.set(gt.w * 0.98, gt.h, 1);
    this._p.set(gt.pos.x, gt.pos.y + gt.open * (gt.h - 0.5), gt.pos.z);
    this._m.compose(this._p, this._q, this._s);
    for (const im of this.meshes) { im.setMatrixAt(gt.idx, this._m); im.instanceMatrix.needsUpdate = true; }
  }

  isClosed(i: number) { return this.gates[i].open < 0.3; }

  update(dt: number) {
    const g = this.game, war = g.war, P = g.player.pos;
    this.checkT -= dt;
    const check = this.checkT <= 0;
    if (check) this.checkT = 1;
    for (const gt of this.gates) {
      // portcullis travel: it drops fast and is winched up slowly
      const prev = gt.open;
      gt.open += THREE.MathUtils.clamp(gt.target - gt.open, -dt * 0.6, dt * 0.18);
      if (Math.abs(gt.open - prev) > 1e-5) {
        const lift = gt.open * (gt.h - 0.5);
        this.place(gt);
        gt.body.setNextKinematicTranslation({ x: gt.pos.x, y: gt.pos.y + gt.h / 2 + lift, z: gt.pos.z });
        if (gt.open < 0.02 && prev >= 0.02) g.sound?.('impact:metal', gt.pos, 1.6);
      }
      gt.manualT = Math.max(0, gt.manualT - dt);
      if (gt.forcedT > 0) { gt.forcedT -= dt; gt.target = 1; }
      if (!check || !gt.side) continue;
      // is an enemy army near?
      let enemies = 0, atGate = 0;
      for (const s of war.soldiers) {
        if (!s.alive || s.side === gt.side) continue;
        const d = s.st.pos.distanceTo(gt.pos);
        if (d < 260) enemies++;
        if (d < 12) atGate++;
      }
      if (enemies >= 3) {
        gt.threatT += 1; gt.calmT = 0;
        if (gt.manualT <= 0 && gt.forcedT <= 0 && gt.target > 0.5) {
          gt.target = 0;
          if (gt.pos.distanceTo(P) < 600) g.hud.toast(`The enemy is at the walls of ${this.siteName(gt)}! The portcullis comes down.`);
          g.sound?.('bell', gt.pos, 1.5);
        }
        if (gt.defenders.filter((d) => d.alive).length < 4) this.garrison(gt);
        // a ram and axes against the closed gate
        if (gt.open < 0.1 && atGate >= 4) {
          gt.batter += atGate;
          if (Math.random() < 0.3) g.sound?.('impact:wood', gt.pos, 1.5);
          if (gt.batter > 900) {
            gt.forcedT = 300; gt.batter = 0;
            if (gt.pos.distanceTo(P) < 900) g.hud.toast(`The gate of ${this.siteName(gt)} is forced! The enemy pours in.`);
            g.particles.emit('dust', gt.pos.clone().setY(gt.pos.y + 2), 40);
          }
        }
      } else {
        gt.calmT += 1;
        if (gt.calmT > 60 && gt.manualT <= 0 && gt.target < 0.5) gt.target = 1;
        if (gt.calmT > 90) this.standDown(gt);
      }
    }
    this.shootFromWalls(dt);
  }
  private siteName(gt: Gate) { return this.game.towns.plans.find((p) => p.site.id === gt.site)?.site.name ?? 'the town'; }

  /** Pikemen behind the gate; archers and musketeers up on the wall-walk to either side of it. */
  private garrison(gt: Gate) {
    const g = this.game, war = g.war;
    if (war.soldiers.filter((s) => s.alive).length > 150) return;
    const across = new THREE.Vector3(Math.cos(gt.yaw), 0, -Math.sin(gt.yaw));
    for (let k = 0; k < 4; k++) {
      const p = gt.pos.clone().addScaledVector(gt.inward, 6 + (k >> 1) * 1.8).addScaledVector(across, ((k % 2) - 0.5) * 2.4);
      p.y = g.groundAt(p.x, p.z, p.y + 3);
      const s = war.spawnSoldier(gt.side!, p, true);
      s.order = 'hold'; s.holdAt = p.clone(); s.st.yaw = Math.atan2(-gt.inward.x, -gt.inward.z);
      gt.defenders.push(s);
    }
    const posts = g.settlements.wallWalk.filter((w) => w.pos.distanceTo(gt.pos) < 70).sort((a, b) => a.pos.distanceTo(gt.pos) - b.pos.distanceTo(gt.pos)).slice(0, 6);
    for (const w of posts) {
      if (gt.defenders.some((d) => d.alive && (d as Soldier & { post?: THREE.Vector3 }).post === w.pos)) continue;
      const s = war.spawnSoldier(gt.side!, w.pos.clone().setY(w.pos.y + 0.05), true);
      s.order = 'hold'; s.holdAt = w.pos.clone();
      s.archer = true; s.musket = Math.random() < (gt.side === 'ironreach' ? 0.5 : 0.3);
      s.volleyT = 2 + Math.random() * 5;
      (s as Soldier & { post?: THREE.Vector3; wallOut?: THREE.Vector3 }).post = w.pos;
      (s as Soldier & { post?: THREE.Vector3; wallOut?: THREE.Vector3 }).wallOut = w.out;
      s.st.yaw = Math.atan2(w.out.x, w.out.z);
      if (s.sword) s.sword.visible = false;
      const m = buildItemMesh(s.musket ? ITEMS.musket : ITEMS.bow);
      if (m) { if (s.musket) { m.rotation.set(1.2, 0, 0); m.position.set(0, -0.05, 0.05); s.rig.byName.handR.add(m); } else { m.position.set(0.02, -0.08, 0.02); s.rig.byName.handL.add(m); } }
      gt.defenders.push(s);
    }
  }
  private standDown(gt: Gate) {
    const g = this.game;
    if (!gt.defenders.length || gt.pos.distanceTo(g.player.pos) < 90) return;
    for (const s of gt.defenders) if (s.alive) { s.dispose(); const i = g.war.soldiers.indexOf(s); if (i >= 0) g.war.soldiers.splice(i, 1); }
    gt.defenders = [];
  }

  /** Archers and musketeers on the walls pick the nearest attacker in range and shoot down at him. */
  private shootFromWalls(dt: number) {
    const g = this.game;
    for (const gt of this.gates) for (const s of gt.defenders) {
      if (!s.alive || !s.archer) continue;
      s.volleyT -= dt;
      let e: Soldier | null = null, bd = s.musket ? 110 : 150;
      for (const o of g.war.soldiers) if (o.alive && o.side !== s.side) { const d = o.st.pos.distanceTo(s.st.pos); if (d < bd) { bd = d; e = o; } }
      if (!e) continue;
      s.st.yaw = Math.atan2(e.st.pos.x - s.st.pos.x, e.st.pos.z - s.st.pos.z);
      if (s.volleyT > 0) continue;
      g.war.volley(s, e.st.pos);
    }
  }
}
