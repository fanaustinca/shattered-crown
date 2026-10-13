// People. Everyone in every household has a schedule (wake, work, tavern, home, sleep, take shelter
// from rain). Inside the simulation bubble they are fully simulated humans with bodies, IK walking,
// doors, stairs, sight and hearing; outside it they run as a cheap schedule queue.
// Also: the law (witnessed crimes, bounties, guards), and what happens if you sleep in their beds.
import * as THREE from 'three';
import { RAPIER, groups, G_CHAR, G_SENSOR, G_HELD, ALL } from '../physics/physics';
import type { Game } from '../game';
import type { Person, Placed } from '../world/towns';
import type { Rig } from '../creature/rig';
import { BipedAnimator, type MoveState } from '../creature/anim';
import { SKIN_TONES, HAIR_COLORS, AnimLod, releaseRig } from '../creature/rig';
import type { LiveBuilding } from '../build/settlements';
import { navPath } from '../build/building';
import type { FurnitureNode } from '../props/furnish';
import type { Action } from '../player/interact';
import type { Limb } from '../player/player';
import { mulberry32 } from '../core/noise';
import { kingdomAt, type Kingdom } from '../world/layout';
import { Grid } from '../player/inventory';

export type Activity = 'sleep' | 'home' | 'work' | 'tavern' | 'wander' | 'shelter' | 'patrol' | 'flee' | 'fight' | 'arrest' | 'investigate' | 'dead' | 'talk' | 'field';

const DYES = [0x7a2a20, 0x3a4a6a, 0x4a5a2a, 0x6a5a3a, 0x8a7a5a, 0x5a3a5a, 0x9a8a6a, 0x2a2a2a, 0x7a6040, 0xa09070];

export class NPC {
  rig: Rig;
  anim: BipedAnimator;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  kcc: RAPIER.KinematicCharacterController;
  st: MoveState & { carry?: boolean; eating?: boolean; sitting?: boolean; blocking?: boolean; armed?: boolean };
  path: THREE.Vector3[] = [];
  activity: Activity = 'home';
  target: THREE.Vector3 | null = null;
  health: Record<Limb, number> = { head: 100, torso: 100, larm: 100, rarm: 100, lleg: 100, rleg: 100 };
  bleeding = 0;
  alertness = 0;   // 0 calm .. 1 hostile
  hostile = false;
  vy = 0;
  sayT = 0; bubble = ''; bubbleT = 0;
  attackT = 0;
  sword: THREE.Object3D | null = null;
  loot: Grid;
  waitT = 0;
  lastSeenPlayer = -1e9;
  doorCooldown = 0;
  get name() { return this.person.name; }
  get alive() { return this.activity !== 'dead'; }
  constructor(public game: Game, public person: Person, pos: THREE.Vector3) {
    const r = mulberry32(person.cloth1);
    const dye = () => DYES[Math.floor(r() * DYES.length)];
    const guard = person.role === 'guard' || person.role === 'lord';
    const fac = person.faction;
    const coat = {
      coat: 0, cloth1: guard ? (fac === 'ironreach' ? 0x5a1a14 : 0x2a3a6a) : dye(), cloth2: guard ? 0x3a3a3c : dye(), boots: 0x2a1c12,
      skin: SKIN_TONES[person.skin % SKIN_TONES.length], hair: HAIR_COLORS[person.hair % HAIR_COLORS.length], belt: 0x2a1a0a,
    };
    this.rig = game.creatures.instance('human' + person.variant, coat);
    this.anim = new BipedAnimator(this.rig, (x, z) => game.groundAt(x, z, this.st?.pos.y ?? 999));
    this.anim.heightScale = person.role === 'child' ? 0.62 + (person.age - 6) * 0.025 : person.female ? 0.95 : 1 + (r() - 0.5) * 0.08;
    this.st = { pos: pos.clone(), yaw: r() * 6.28, speed: 0, turn: 0, vel: new THREE.Vector3(), action: 'idle', look: null };
    const ph = game.physics;
    this.body = ph.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + 0.9, pos.z));
    this.collider = ph.world.createCollider(RAPIER.ColliderDesc.capsule(0.55 * this.anim.heightScale, 0.28).setCollisionGroups(groups(G_CHAR, ALL & ~G_SENSOR & ~G_HELD)), this.body);
    ph.owners.set(this.collider.handle, { kind: 'npc', npc: this });
    this.kcc = ph.world.createCharacterController(0.03);
    this.kcc.enableAutostep(0.4, 0.15, true);
    this.kcc.enableSnapToGround(0.4);
    this.kcc.setMaxSlopeClimbAngle(0.85);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    game.scene.add(this.rig.root);
    if (guard) this.equipSword();
    this.loot = new Grid(5, 4, person.name, person.home);
    if (r() < 0.6) this.loot.add('coin_purse');
    if (r() < 0.4) this.loot.add(['bread', 'apple', 'cheese_box', 'smoked_fish'][Math.floor(r() * 4)]);
    if (guard) this.loot.add('bandage');
  }
  equipSword() {
    import('../props/models').then(({ instanceModel }) => {
      const s = instanceModel('antique_estoc');
      if (!s) return;
      this.sword = s;
      s.rotation.set(Math.PI, 0, 0);
      s.position.set(0, -0.06, 0.03);
      this.rig.byName.handR.add(s);
      this.st.armed = true;
    });
  }
  dispose() {
    this.game.scene.remove(this.rig.root);
    this.game.physics.removeBody(this.body);
    this.game.physics.world.removeCharacterController(this.kcc);
    releaseRig(this.rig);
  }
  say(text: string, sound = false) {
    if (this.bubbleT > 0 && this.bubble === text) return;
    this.bubble = text; this.bubbleT = 3.5;
    if (sound) this.game.sound?.('shout', this.st.pos, 0.6);
    this.game.hud.subtitle(this.name, text, this.st.pos);
  }
  get eye() { return new THREE.Vector3(this.st.pos.x, this.st.pos.y + 1.6 * this.anim.heightScale, this.st.pos.z); }
  /** Can this person see the player right now? (vision cone + line of sight, light matters). */
  sees(p: THREE.Vector3, night: number): boolean {
    if (!this.alive || this.activity === 'sleep') return false;
    const to = p.clone().sub(this.eye);
    const d = to.length();
    const range = 26 * (1 - night * 0.55);
    if (d > range) return false;
    const fwd = new THREE.Vector3(Math.sin(this.st.yaw), 0, Math.cos(this.st.yaw));
    if (d > 2.5 && to.clone().setY(0).normalize().dot(fwd) < 0.25) return false;
    const hit = this.game.physics.ray(this.eye, to.normalize(), d - 0.4, groups(ALL, 1), this.collider);
    return !hit;
  }
  hears(p: THREE.Vector3, noise: number): boolean {
    if (!this.alive) return false;
    const d = p.distanceTo(this.st.pos);
    return d < noise * (this.activity === 'sleep' ? 4 : 14);
  }

  hurt(limb: Limb, dmg: number, attacker: 'player' | NPC) {
    if (!this.alive) return;
    this.health[limb] = Math.max(0, this.health[limb] - dmg);
    this.bleeding += dmg > 15 ? dmg * 0.02 : 0;
    this.anim.limp = Math.max(0, 1 - Math.min(this.health.lleg, this.health.rleg) / 100);
    this.game.sound?.('hit:flesh', this.st.pos, 0.8);
    if (this.health.head <= 0 || this.health.torso <= 0) { this.die(); return; }
    if (attacker === 'player') {
      this.alertness = 1;
      if (this.person.role === 'guard' || this.person.temperament > 0.6) this.hostile = true;
      else { this.activity = 'flee'; this.say(['Help! Murder!', 'Guards! Guards!', 'Mercy!'][Math.floor(Math.random() * 3)], true); }
      this.game.law.crime('assault', this.st.pos, this.person.home, 0.6, true);
    }
  }
  die() {
    this.activity = 'dead'; this.st.action = 'dead'; this.st.speed = 0;
    this.collider.setEnabled(false);
    this.game.law.crime('murder', this.st.pos, this.person.home, 1, true);
    this.game.residents.onDeath(this);
  }

  actions(g: Game): Action[] {
    if (!this.alive) return [{ key: 'F', label: `Search ${this.name}`, run: () => { g.interaction.openContainer = { grid: this.loot, title: this.name, owner: this.person.home }; g.ui.openInventory(); } }];
    const acts: Action[] = [{ key: 'E', label: `Talk to ${this.name}`, run: () => g.ui.openDialogue(this) }];
    if (this.person.role === 'merchant' || this.person.role === 'innkeeper' || this.person.role === 'blacksmith') acts.push({ key: 'F', label: 'Trade', run: () => g.ui.openTrade(this) });
    if (this.person.role === 'guard' && g.law.bountyIn(kingdomAt(this.st.pos.x, this.st.pos.z)) > 0) acts.push({ key: 'F', label: `Pay your fine (${g.law.bountyIn(kingdomAt(this.st.pos.x, this.st.pos.z))}d)`, run: () => g.law.payFine(this) });
    return acts;
  }

  /** Fixed-step movement and decisions. */
  step(dt: number) {
    const g = this.game, st = this.st;
    this.bubbleT -= dt; this.doorCooldown -= dt;
    if (!this.alive) { st.speed = 0; return; }
    if (this.bleeding > 0) { this.health.torso -= this.bleeding * dt; if (this.health.torso <= 0) { this.die(); return; } }
    const p = g.player;
    let speed = 0;
    let goal: THREE.Vector3 | null = null;
    st.look = null;
    const foe = this.fightTarget && this.fightTarget.alive ? this.fightTarget : null;
    if ((this.hostile && p.alive) || foe) {
      // fight: close in, circle, strike
      const fpos = foe ? foe.st.pos : p.pos;
      const d = st.pos.distanceTo(fpos);
      st.look = foe ? foe.eye : p.eyePos();
      goal = fpos.clone();
      if (this.holdAt && !foe) goal = this.holdAt.clone();
      speed = d > 2.2 ? 4.2 * (1 - this.anim.limp * 0.6) : 0;
      this.attackT -= dt;
      st.blocking = d < 3 && Math.random() < 0.01 ? true : st.blocking && Math.random() > 0.02;
      if (d < 2.4 && this.attackT <= 0) {
        this.attackT = 1.2 + Math.random() * 0.8;
        const dirs = ['left', 'right', 'over', 'thrust'] as const;
        this.anim.attack(dirs[Math.floor(Math.random() * 4)]);
        if (foe) { const f = foe; setTimeout(() => { if (f.alive && f.st.pos.distanceTo(this.st.pos) < 2.8) { if (f.st.blocking && Math.random() < 0.6) g.sound?.('hit:block', f.st.pos, 0.6); else { const limbs: Limb[] = ['head', 'torso', 'torso', 'larm', 'rarm', 'lleg', 'rleg']; f.hurt(limbs[Math.floor(Math.random() * limbs.length)], 14 + Math.random() * 14, this); g.blood(f.eye.setY(f.st.pos.y + 1.2), 5); } } }, 300); }
        else g.combat.npcStrike(this);
      }
      if (this.health.torso < 25 && this.person.role !== 'guard') { this.hostile = false; this.activity = 'flee'; }
    } else if (this.activity === 'flee') {
      const away = st.pos.clone().sub(p.pos).setY(0).normalize();
      goal = st.pos.clone().addScaledVector(away, 10);
      speed = 5 * (1 - this.anim.limp * 0.6);
      if (st.pos.distanceTo(p.pos) > 40) { this.activity = 'home'; this.path = []; }
    } else if (this.activity === 'arrest') {
      goal = p.pos.clone(); st.look = p.eyePos();
      const d = st.pos.distanceTo(p.pos);
      speed = d > 2.5 ? 4.5 : 0;
      if (d < 3 && this.sayT <= 0) { this.say(`Halt! You owe ${g.law.bountyIn(this.person.faction as Kingdom)} pennies to the crown. Pay, or face the cells.`, true); this.sayT = 8; }
      this.sayT -= dt;
      if (g.law.bountyIn(this.person.faction as Kingdom) <= 0) this.activity = 'patrol';
    } else {
      // scheduled life: follow the path toward where the schedule says we should be
      if (this.path.length) {
        goal = this.path[0];
        const d = Math.hypot(goal.x - st.pos.x, goal.z - st.pos.z);
        if (d < (this.path.length === 1 ? 0.7 : 0.45)) { this.path.shift(); goal = this.path[0] ?? null; }
        speed = this.activity === 'shelter' ? 3.2 : 1.35;
      } else if (this.waitT > 0) this.waitT -= dt;
      st.action = this.activity === 'sleep' ? 'sleep' : 'idle';
      // look at the player when they are close and staring
      if (st.pos.distanceTo(p.pos) < 4 && this.activity !== 'sleep') st.look = p.eyePos();
    }
    // open doors in the way
    if (goal && this.doorCooldown <= 0) { g.residents.openDoorsNear(st.pos, goal); this.doorCooldown = 0.25; }
    // steering
    if (goal) {
      const want = Math.atan2(goal.x - st.pos.x, goal.z - st.pos.z);
      let dy = want - st.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const turn = THREE.MathUtils.clamp(dy * 5, -4, 4);
      st.turn = turn; st.yaw += turn * dt;
      if (Math.abs(dy) > 1.2) speed *= 0.3;
    } else st.turn *= 0.8;
    st.speed += (speed - st.speed) * Math.min(1, dt * 4);
    const t = this.collider.translation();
    this.vy -= 9.81 * dt;
    const desired = { x: Math.sin(st.yaw) * st.speed * dt, y: this.vy * dt, z: Math.cos(st.yaw) * st.speed * dt };
    // movement LOD: residents far from the player resolve collisions every third step (with the motion
    // accumulated in between and shown as a prediction); nothing about their route or pace changes
    const far = !this.hostile && !this.fightTarget && st.pos.distanceToSquared(p.pos) > 32 * 32;
    this.pend.x += desired.x; this.pend.y += desired.y; this.pend.z += desired.z; this.pendT += dt;
    if (far && ++this.kccK % 3 !== 0) {
      st.pos.x += desired.x; st.pos.z += desired.z;
      st.vel.set(desired.x / dt, 0, desired.z / dt);
      return;
    }
    desired.x = this.pend.x; desired.y = this.pend.y; desired.z = this.pend.z;
    dt = this.pendT;
    this.pend.set(0, 0, 0); this.pendT = 0;
    this.kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(G_CHAR, ALL & ~G_SENSOR & ~G_HELD), (c) => { const o = g.physics.owners.get(c.handle); return !o || (o.kind !== 'npc' && o.kind !== 'soldier' && o.kind !== 'prop'); });
    const mv = this.kcc.computedMovement();
    if (this.kcc.computedGrounded()) this.vy = 0;
    const nt = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    const gy = g.world.heightAt(nt.x, nt.z) + 0.55 * this.anim.heightScale + 0.28;
    if (nt.y < gy - 0.05) nt.y = gy;
    this.body.setNextKinematicTranslation(nt);
    st.pos.set(nt.x, nt.y - 0.55 * this.anim.heightScale - 0.28, nt.z);
    const moved = Math.hypot(mv.x, mv.z) / dt;
    // stuck: nudge sideways, then give up on the waypoint
    this.chkT += dt;
    if (this.chkT > 3) { this.chkT = 0; const prog = this.chkPos.distanceTo(st.pos); this.chkPos.copy(st.pos); this.noProgress = this.path.length > 0 && !this.hostile && prog < 0.8; }
    if (this.noProgress || (this.path.length && !this.hostile && moved < 0.15)) {
      this.waitT += dt; this.stuckT += dt;
      if (this.waitT > 1.2) { st.yaw += (Math.random() < 0.5 ? 1 : -1) * 1.1; this.waitT = 0; }
      if (this.noProgress) this.stuckT = Math.max(this.stuckT, 3.1);
      if (this.stuckT > 3 && this.path.length) {
        this.noProgress = false;
        // out of the player's sight we can quietly step past the obstruction; in sight, re-plan
        const toP = g.player.pos.clone().sub(st.pos);
        const camF = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
        const seen = toP.length() < 22 && camF.dot(st.pos.clone().sub(g.camera.position).normalize()) > 0.3;
        if (!seen || this.stuckT > 6) {
          const nx = this.path.shift()!;
          const y = g.groundAt(nx.x, nx.z, nx.y + 1);
          this.body.setTranslation({ x: nx.x, y: y + 0.55 * this.anim.heightScale + 0.3, z: nx.z }, true);
          this.body.setNextKinematicTranslation({ x: nx.x, y: y + 0.55 * this.anim.heightScale + 0.3, z: nx.z });
          g.physics.world.propagateModifiedBodyPositionsToColliders();
          st.pos.set(nx.x, y, nx.z);
        }
        if (!seen || this.stuckT > 6) this.stuckT = 0;
      }
    } else if (moved > 0.4) { this.stuckN = 0; this.stuckT = 0; }
    st.vel.set(mv.x / dt, 0, mv.z / dt);
  }
  animate(dt: number) {
    this.st.speed = Math.min(this.st.speed, this.st.vel.length() + 0.2);
    this.anim.update(dt, this.st);
    if (this.sleepPose) { this.rig.root.position.copy(this.sleepPose.pos); this.rig.root.rotation.set(-Math.PI / 2, this.sleepPose.yaw, 0, 'YXZ'); this.rig.root.updateMatrixWorld(true); }
  }
  sleepPose: { pos: THREE.Vector3; yaw: number } | null = null;
  lod = new AnimLod();
  private pend = new THREE.Vector3();
  private pendT = 0;
  private kccK = Math.floor(Math.random() * 3);
  fightTarget: NPC | null = null;
  stuckN = 0;
  stuckT = 0;
  chkT = 0;
  chkPos = new THREE.Vector3(1e9, 0, 0);
  noProgress = false;
  holdAt: THREE.Vector3 | null = null;
}

// ------------------------------------------------------------------------------------------

interface Abstract { person: Person; home: Placed; work: Placed | null; where: THREE.Vector3; activity: Activity; live: NPC | null }

export class Residents {
  people: Abstract[] = [];
  live: NPC[] = [];
  private lastActivityCheck = -1;
  cap = 90;
  constructor(public game: Game) {
    const towns = game.towns;
    for (const p of towns.people) {
      const home = towns.byBuilding.get(p.home)!;
      const work = p.work ? towns.byBuilding.get(p.work) ?? null : null;
      this.people.push({ person: p, home, work, where: new THREE.Vector3(home.x, home.y, home.z), activity: 'home', live: null });
    }
  }

  /** Where the schedule puts this person right now. */
  scheduled(a: Abstract, hours: number, raining: boolean): Activity {
    const role = a.person.role;
    const r = mulberry32(a.person.cloth2)();
    const wake = 5.5 + r * 1.5, bed = 20.5 + r * 2;
    if (role === 'guard') return hours > 22 || hours < 6 ? (r < 0.5 ? 'patrol' : 'sleep') : 'patrol';
    if (hours < wake || hours > bed) return 'sleep';
    if (raining && role !== 'guard') return a.work && hours > 8 && hours < 17 ? 'work' : 'shelter';
    if (hours > 7.5 && hours < 17.5) {
      if (role === 'farmer') return 'field';
      if (a.work) return 'work';
      if (role === 'child') return r < 0.5 ? 'wander' : 'home';
      return r < 0.4 ? 'wander' : 'home';
    }
    if (hours >= 17.5 && hours < bed && (role === 'farmer' || role === 'laborer' || role === 'blacksmith' || role === 'carpenter') && r < 0.45) return 'tavern';
    return 'home';
  }

  /** The bubble: spawn full NPCs near the player, keep the rest as schedule entries. */
  update(radius: number) {
    const g = this.game, p = g.player.pos;
    const hours = g.hours, raining = g.weather.raining;
    const tick = Math.floor(hours * 4);
    const check = tick !== this.lastActivityCheck;
    this.lastActivityCheck = tick;
    // only the nearest few dozen are fully simulated; the rest stay on the cheap schedule queue
    const cap = this.cap;
    const dist = (a: Abstract) => { const q = a.live ? a.live.st.pos : a.where; return Math.hypot(q.x - p.x, q.z - p.z); };
    const near = this.people.filter((a) => a.activity !== 'dead' && dist(a) < radius).sort((a, b) => dist(a) - dist(b));
    const keep = new Set(near.slice(0, cap));
    for (const a of this.people) {
      if (a.activity === 'dead') continue;
      const act = this.scheduled(a, hours, raining);
      const d = keep.has(a) ? dist(a) : 1e9;
      if (!a.live && d < radius) {
        // spawn at the logical location: inside the building they should be in
        const b = act === 'work' && a.work ? a.work : act === 'tavern' ? this.nearestTavern(a.home) : a.home;
        const live = g.settlements.live.get(b.id);
        let pos = new THREE.Vector3(b.x, b.y, b.z);
        if (live) pos = this.indoorSpot(live, a.person);
        else pos = this.frontOf(b).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
        pos.y = g.groundAt(pos.x, pos.z, pos.y + 1.5);
        a.live = new NPC(g, a.person, pos);
        a.activity = 'home';
        this.live.push(a.live);
        this.plan(a, act);
      } else if (a.live && (d > radius + 30 || (d === 1e9 && !a.live.hostile && dist(a) > 25))) {
        a.where.copy(a.live.st.pos);
        a.live.dispose();
        this.live.splice(this.live.indexOf(a.live), 1);
        a.live = null;
      } else if (a.live && check && a.live.alive && !a.live.hostile && a.live.activity !== 'flee' && a.live.activity !== 'arrest' && act !== a.activity) {
        this.plan(a, act);
      }
      if (!a.live) { a.activity = act; }
    }
  }
  private nearestTavern(home: Placed) {
    const plan = this.game.towns.plans.find((pl) => pl.site.id === home.site)!;
    return plan.buildings.find((b) => b.spec.type === 'tavern') ?? home;
  }
  frontOf(b: Placed) { return new THREE.Vector3(b.x + Math.sin(b.yaw) * (b.spec.d / 2 + 1.6), b.y, b.z + Math.cos(b.yaw) * (b.spec.d / 2 + 1.6)); }
  private toWorld(b: Placed, lx: number, ly: number, lz: number) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); return new THREE.Vector3(b.x + lx * c + lz * s, b.y + ly, b.z - lx * s + lz * c); }
  private indoorSpot(l: LiveBuilding, person: Person) {
    // doorway approaches and stair landings are always kept clear of furniture
    const m = l.model;
    const spots: THREE.Vector3[] = [];
    for (const d of m.doors) {
      const n = Math.abs(Math.sin(d.yaw)) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      if (d.exterior) spots.push(d.pos.clone().setZ(d.pos.z - 1.0));
      else spots.push(d.pos.clone().addScaledVector(n, 0.8), d.pos.clone().addScaledVector(n, -0.8));
    }
    for (const st of m.stairs) spots.push(st.from.clone(), st.to.clone());
    const r0 = mulberry32(person.cloth1 + person.name.length * 7); r0();
    const p = spots[Math.floor(r0() * spots.length)] ?? new THREE.Vector3((r0() - 0.5) * 2, m.floorY[0], m.spec.d / 2 - 1.2);
    return this.toWorld(l.placed, p.x, p.y, p.z);
  }
  /** Interior route from outside the front door to a local point (doors, partitions, stairs). */
  private interiorRoute(b: Placed, targetWorld: THREE.Vector3) {
    const m = this.game.settlements.model(b);
    const local = this.toLocal(b, targetWorld);
    return navPath(m, 'outside', local).map((p) => this.toWorld(b, p.x, p.y, p.z));
  }
  private toLocal(b: Placed, w: THREE.Vector3) {
    const dx = w.x - b.x, dz = w.z - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    return new THREE.Vector3(dx * c - dz * s, w.y - b.y, dx * s + dz * c);
  }
  /** Build a path for a new activity. */
  plan(a: Abstract, act: Activity) {
    const n = a.live!, g = this.game;
    a.activity = act; n.activity = act;
    n.sleepPose = null;
    const here = n.st.pos.clone();
    const route: THREE.Vector3[] = [];
    const curB = g.settlements.inside(here);
    // leave the current building through its door
    if (curB) {
      const b = curB.placed;
      route.push(...navPath(curB.model, this.toLocal(b, here), 'outside').map((p) => this.toWorld(b, p.x, p.y, p.z)), this.frontOf(b));
    }
    const plan = g.towns.plans.find((pl) => pl.site.id === a.home.site)!;
    const goInto = (b: Placed, kind: 'bed' | 'room') => {
      route.push(new THREE.Vector3(plan.plaza.x, b.y, plan.plaza.z).lerp(this.frontOf(b), 0.65));
      route.push(this.frontOf(b));
      const live = g.settlements.live.get(b.id);
      if (live && kind === 'bed') {
        const bed = live.bedOwners.find((x) => x.person === a.person.id) ?? live.bedOwners[0];
        if (bed) { route.push(...this.interiorRoute(b, bed.sleep.clone().setY(bed.sleep.y - 0.4))); return; }
      }
      const m = g.settlements.model(b);
      const rm = m.rooms.find((x) => x.floor === 0) ?? m.rooms[0];
      route.push(...this.interiorRoute(b, this.toWorld(b, (rm.min.x + rm.max.x) / 2 + (Math.random() - 0.5) * 1.5, rm.y, (rm.min.y + rm.max.y) / 2 + (Math.random() - 0.5) * 1.5)));
    };
    if (act === 'sleep') goInto(a.home, 'bed');
    else if (act === 'home' || act === 'shelter') goInto(curB && act === 'shelter' ? curB.placed : a.home, 'room');
    else if (act === 'work' && a.work) goInto(a.work, 'room');
    else if (act === 'tavern') goInto(this.nearestTavern(a.home), 'room');
    else if (act === 'field') {
      const f = g.world.fields.filter((fl) => fl.site === a.home.site);
      const fl = f[Math.floor(Math.random() * Math.max(1, f.length))];
      if (fl) route.push(new THREE.Vector3(fl.x + (Math.random() - 0.5) * fl.w * 0.6, 0, fl.z + (Math.random() - 0.5) * fl.d * 0.6));
    } else if (act === 'wander' || act === 'patrol') {
      for (let i = 0; i < 3; i++) { const ang = Math.random() * 6.28, rr = Math.random() * plan.site.r * 0.8; route.push(new THREE.Vector3(plan.site.x + Math.cos(ang) * rr, 0, plan.site.z + Math.sin(ang) * rr)); }
    }
    n.path = route.map((v) => (v.y === 0 ? v.setY(g.world.heightAt(v.x, v.z)) : v));
  }

  /** NPCs open closed doors on their way and close them behind (if it's their own house). */
  openDoorsNear(pos: THREE.Vector3, goal: THREE.Vector3) {
    for (const l of this.game.settlements.live.values()) {
      if (l.root.position.distanceToSquared(pos) > 400) continue;
      for (const d of l.doors) {
        const dp = d.node.getWorldPosition(new THREE.Vector3());
        if (dp.distanceTo(pos) < 1.6 && d.target < 0.5 && goal.distanceTo(dp) < goal.distanceTo(pos) + 1) {
          if (d.locked) d.locked = false; // residents have keys
          d.toggle();
          d.autoClose = 4;
        }
      }
    }
  }

  step(dt: number) {
    for (const n of this.live) n.step(dt);
    // arriving to sleep: lie in the assigned bed (or find the player in it!)
    const g = this.game;
    for (const a of this.people) {
      const n = a.live;
      if (!n || !n.alive || n.activity !== 'sleep' || n.path.length || n.sleepPose) continue;
      const live = g.settlements.live.get(a.home.id);
      const bed = live?.bedOwners.find((x) => x.person === a.person.id);
      if (!bed) continue;
      if (g.sleepingIn && g.sleepingIn.node === bed.node) this.caughtInBed(n, live!);
      else n.sleepPose = { pos: bed.sleep.clone(), yaw: bed.node.group.rotation.y };
    }
    // night-time trespass: residents notice strangers in their home
    const inside = g.settlements.inside(g.player.pos);
    if (inside && (g.hours > 21 || g.hours < 6)) {
      for (const a of this.people) {
        const n = a.live;
        if (!n || !n.alive || a.home.id !== inside.placed.id || n.hostile) continue;
        if ((n.sees(g.player.eyePos(), 0.3) || n.hears(g.player.pos, g.player.noise + 0.2)) && n.activity !== 'flee') {
          if (n.activity === 'sleep') { n.sleepPose = null; n.activity = 'investigate'; }
          if (n.sayT <= 0) {
            n.say(n.person.temperament > 0.65 ? 'Thief! Get out of my house or I\'ll gut you!' : 'Who\'s there?! Get out! Guards!', true);
            n.sayT = 10;
            g.law.crime('trespass', g.player.pos, a.home.id, 0.35, false);
            if (n.person.temperament > 0.75 && n.person.role !== 'child') n.hostile = true;
            else { n.activity = 'flee'; }
          }
          n.sayT -= 1 / 60;
        }
      }
    }
  }
  private caughtInBed(n: NPC, live: LiveBuilding) {
    const g = this.game;
    g.wakeUp();
    n.say(n.person.temperament > 0.6 ? 'Out of MY bed, you filthy vagrant!' : 'By the gods — a stranger in my bed! Help! Guards!', true);
    // they shove you out of bed, then fetch the guard
    g.player.standUp(live.placed ? g.residents.frontOf(live.placed) : undefined);
    g.player.hurt('torso', 3, 'shoved');
    g.law.crime('trespass', g.player.pos, live.placed.id, 0.5, false);
    if (n.person.temperament > 0.8) n.hostile = true; else n.activity = 'flee';
  }
  /** Sleep in a bed: advances time until morning (or until someone finds you). */
  sleepIn(fn: FurnitureNode, building: Placed | undefined) {
    const g = this.game;
    const night = g.hours > 19 || g.hours < 5;
    const live = building ? g.settlements.live.get(building.id) : undefined;
    const bo = live?.bedOwners.find((b) => b.node === fn);
    const owner = bo?.person ? this.people.find((a) => a.person.id === bo.person) : null;
    if (owner && owner.live?.activity === 'sleep' && owner.live.sleepPose) { g.hud.toast(`${owner.person.name} is asleep in that bed.`); return; }
    g.sleepingIn = { node: fn, building: building ?? null, owner: owner?.person.id ?? null };
    const s = fn.model.sleep![0];
    const pos = s.pos.clone().applyMatrix4(fn.group.matrixWorld);
    const yaw = new THREE.Euler().setFromQuaternion(fn.group.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y;
    g.player.sitIn({ label: 'Bed', eye: 0.3, getTransform: (p, q) => { p.copy(pos).setY(pos.y - 0.2); q.setFromEuler(new THREE.Euler(0, yaw, 0)); }, leave: () => { g.sleepingIn = null; g.playerBody?.setPose('idle'); } });
    g.playerBody?.setPose('sleep');
    g.startSleep(night ? 8 : 2);
    if (owner) g.hud.toast(`This is ${owner.person.name}'s bed${owner.person.role === 'innkeeper' ? '' : '. They will not be pleased'}…`);
  }
  onDeath(n: NPC) {
    const a = this.people.find((x) => x.live === n);
    if (a) a.activity = 'dead';
  }
  animate(dt: number) {
    const cam = this.game.camera.position;
    for (const n of this.live) {
      const d = n.st.pos.distanceTo(cam);
      n.rig.root.visible = d < 160;
      const a = n.lod.step(n.rig, d, dt);
      if (a > 0) n.animate(a);
    }
  }
}

// ------------------------------------------------------------------------------------------

export class Law {
  bounty: Record<string, number> = { vanguardia: 0, ironreach: 0, river: 0, isles: 0 };
  log: { crime: string; t: number; where: string }[] = [];
  constructor(public game: Game) {}
  bountyIn(k: Kingdom) { return Math.round(this.bounty[k] ?? 0); }
  get wanted() { return Math.max(...Object.values(this.bounty)); }
  /**
   * Report a crime at pos. When `needsWitness`, only counts if someone sees or hears it.
   * severity scales the bounty (0..1).
   */
  crime(kind: string, pos: THREE.Vector3, victim: string | null, severity: number, needsWitness = true) {
    const g = this.game;
    if (victim === 'player') return;
    const night = 1 - g.lighting.dayFactor;
    const witnesses = g.residents.live.filter((n) => n.alive && n.activity !== 'sleep' && (n.sees(g.player.eyePos(), night) || (kind !== 'theft' && n.hears(pos, 1))));
    if (needsWitness && !witnesses.length) return;
    const k = kingdomAt(pos.x, pos.z);
    const add = Math.round({ theft: 15, trespass: 10, assault: 40, murder: 200, 'horse theft': 60 }[kind] ?? 10) * (0.5 + severity);
    this.bounty[k] = (this.bounty[k] ?? 0) + add;
    this.log.push({ crime: kind, t: g.hours, where: k });
    g.hud.toast(`Crime witnessed: ${kind}. Bounty in ${k[0].toUpperCase() + k.slice(1)}: ${this.bountyIn(k)} pennies.`, 'crime');
    for (const w of witnesses.slice(0, 3)) if (w.person.role !== 'guard') w.say(kind === 'theft' ? ['Thief!', 'Stop, thief!', 'Put that back!'][Math.floor(Math.random() * 3)] : 'Guards! Guards!', true);
    // nearby guards come to arrest
    for (const n of g.residents.live) if (n.person.role === 'guard' && n.alive && n.st.pos.distanceTo(pos) < 90 && !n.hostile) { n.activity = 'arrest'; n.path = []; }
    g.wantedPosters.update(this);
  }
  payFine(guard: NPC) {
    const g = this.game, k = guard.person.faction as Kingdom;
    const due = this.bountyIn(k);
    if (g.interaction.money >= due) { g.interaction.money -= due; this.bounty[k] = 0; guard.say('Your debt is paid. Mind yourself.'); guard.activity = 'patrol'; g.sound?.('coins', guard.st.pos, 0.6); g.wantedPosters.update(this); }
    else { guard.say('You cannot pay? Then you will come with me.'); guard.hostile = true; }
  }
  update(dt: number) {
    // guards who spot a wanted player in their kingdom move to arrest
    const g = this.game;
    const k = kingdomAt(g.player.pos.x, g.player.pos.z);
    if (this.bountyIn(k) > 0) for (const n of g.residents.live) if (n.person.role === 'guard' && n.alive && !n.hostile && n.activity !== 'arrest' && n.sees(g.player.eyePos(), 1 - g.lighting.dayFactor)) { n.activity = 'arrest'; n.path = []; n.say('You there! Halt!', true); }
    // bounties slowly fade
    for (const key of Object.keys(this.bounty)) this.bounty[key] = Math.max(0, this.bounty[key] - dt * 0.002);
  }
}
