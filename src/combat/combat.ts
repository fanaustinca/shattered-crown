// Melee and archery. Swing direction comes from how you move the mouse as you click (left, right,
// overhead, thrust). Hits land on a body region; legs make you limp, arms spoil your aim and draw,
// deep cuts bleed. Blocking with a shield or blade stops blows; a well-timed block parries.
import * as THREE from 'three';
import type { Game } from '../game';
import type { NPC } from '../npc/npc';
import type { Limb } from '../player/player';
import { ITEMS } from '../props/items';
import { groups, ALL, G_HELD } from '../physics/physics';
import type { Animal } from '../creature/animals';

interface Arrow { pos: THREE.Vector3; vel: THREE.Vector3; mesh: THREE.Object3D; life: number; dmg: number; fromPlayer: boolean }

export class Combat {
  drawn = false;           // weapon out
  swingT = -1;
  swingDir: 'left' | 'right' | 'over' | 'thrust' = 'right';
  private mouseAcc = new THREE.Vector2();
  blocking = false;
  blockStart = 0;
  bowDraw = 0;
  arrows: Arrow[] = [];
  hitDone = false;
  constructor(public game: Game) {}

  get weapon() { const h = this.game.interaction.hands; return h ? ITEMS[h.id] : null; }

  update(dt: number) {
    const g = this.game, inp = g.input, p = g.player;
    if (!p.alive || inp.uiOpen || g.freeCam) return;
    // draw/sheathe the best weapon in the pack
    if (inp.hit('Digit1')) this.toggleWeapon();
    if (!this.drawn || g.interaction.held || p.mode === 'seat' && !g.mount) { this.blocking = false; return; }
    const w = this.weapon!;
    this.mouseAcc.x = this.mouseAcc.x * 0.8 + inp.mouse.dx; this.mouseAcc.y = this.mouseAcc.y * 0.8 + inp.mouse.dy;
    if (w.id === 'musket') {
      // shoulder it (right button) to steady the aim; fire with the left; R to reload
      this.bowDraw = inp.btn(2) ? Math.min(1, this.bowDraw + dt * 2) : Math.max(0, this.bowDraw - dt * 3);
      if (this.musketReload > 0) {
        this.musketReload -= dt;
        if (this.musketReload <= 0) { this.musketLoaded = true; g.hud.toast('Loaded.'); }
      } else if (inp.hit('KeyR') && !this.musketLoaded) {
        const sh = g.interaction.pack.find('lead_shot');
        if (!sh) g.hud.toast('No lead shot.');
        else { g.interaction.pack.remove(sh, 1); this.musketReload = 12 * (1.4 - 0.4 * p.armSteadiness); g.hud.toast('Reloading: powder, wadding, ball, ramrod, prime the pan…'); }
      }
      if (inp.btnHit(0)) {
        if (!this.musketLoaded) g.hud.toast(this.musketReload > 0 ? 'Still reloading…' : 'Not loaded — R to reload.');
        else this.fireMusket();
      }
      return;
    }
    if (w.id === 'bow') {
      if (inp.btn(2)) this.bowDraw = Math.min(1, this.bowDraw + dt * (0.9 * p.armSteadiness + 0.1));
      if (inp.btnUp(2) && this.bowDraw > 0.3 && g.interaction.pack.count('arrow')) this.loose();
      if (!inp.btn(2)) this.bowDraw = Math.max(0, this.bowDraw - dt * 3);
      return;
    }
    const wasBlocking = this.blocking;
    this.blocking = inp.btn(2) && this.swingT < 0;
    if (this.blocking && !wasBlocking) this.blockStart = g.time;
    if (inp.btnHit(0) && this.swingT < 0 && p.stamina > 6) {
      const m = this.mouseAcc;
      this.swingDir = m.length() < 6 ? 'thrust' : Math.abs(m.y) > Math.abs(m.x) ? (m.y < 0 ? 'over' : 'thrust') : m.x < 0 ? 'left' : 'right';
      this.swingT = 0; this.hitDone = false;
      p.stamina -= 6 + w.mass * 2;
      g.playerBody?.anim.attack(this.swingDir);
      g.residents.alarm(p.pos, 6, true);
      g.sound?.('swing', p.pos, 0.5);
    }
    if (this.swingT >= 0) {
      this.swingT += dt / (0.55 / (w.weapon?.speed ?? 1));
      if (!this.hitDone && this.swingT > 0.45) { this.hitDone = true; this.playerHit(); }
      if (this.swingT >= 1) this.swingT = -1;
    }
  }

  /** Draw a particular weapon from the pack. */
  equip(it: import('../player/inventory').InvItem) {
    const g = this.game, ia = g.interaction, d = ITEMS[it.id];
    if (!d?.weapon) return;
    ia.hands = it; this.drawn = true;
    g.playerBody?.setWeapon(d);
    if (it.id === 'musket') { this.musketLoaded = false; this.musketReload = 0; }
    g.hud.toast(`You take up the ${d.name.toLowerCase()}. ${d.id === 'bow' ? 'Right-click to draw, left-click to loose.' : d.id === 'musket' ? 'R to load, right-click to shoulder, left-click to fire.' : 'Left-click to strike, right-click to block. 1 to sheathe.'}`);
  }
  toggleWeapon() {
    const g = this.game, ia = g.interaction;
    if (this.drawn) { this.drawn = false; ia.hands = null; g.playerBody?.setWeapon(null); return; }
    const best = ia.pack.items.filter((i) => ITEMS[i.id]?.weapon).sort((a, b) => (ITEMS[b.id].weapon!.damage) - (ITEMS[a.id].weapon!.damage))[0];
    if (!best) { g.hud.toast('You have no weapon.'); return; }
    ia.hands = best; this.drawn = true;
    g.playerBody?.setWeapon(ITEMS[best.id]);
    g.hud.toast(`You draw your ${ITEMS[best.id].name.toLowerCase()}.`);
  }

  /** Region hit by a swing of a given direction at a target of a given height. */
  private region(dir: string, rel: THREE.Vector3, crouch: boolean): Limb {
    const side = rel.x > 0 ? 'l' : 'r';
    if (crouch) return Math.random() < 0.7 ? (side + 'leg') as Limb : 'torso';
    if (dir === 'over') return Math.random() < 0.55 ? 'head' : Math.random() < 0.5 ? 'torso' : (side + 'arm') as Limb;
    if (dir === 'thrust') return Math.random() < 0.75 ? 'torso' : 'head';
    const r = Math.random();
    return r < 0.45 ? 'torso' : r < 0.75 ? ((dir === 'left' ? 'r' : 'l') + 'arm') as Limb : r < 0.9 ? 'head' : ((dir === 'left' ? 'r' : 'l') + 'leg') as Limb;
  }

  private playerHit() {
    const g = this.game, p = g.player, w = this.weapon!.weapon!;
    const eye = p.eyePos();
    const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    let hitAny = false;
    const consider = (pos: THREE.Vector3, onHit: (limb: Limb, dmg: number, rel: THREE.Vector3) => void, blocking: boolean, facing: THREE.Vector3) => {
      const to = pos.clone().sub(p.pos); to.y = 0;
      const d = to.length();
      if (d > w.reach + 0.9 || d < 0.05) return;
      if (to.clone().normalize().dot(fwd) < (this.swingDir === 'thrust' ? 0.8 : 0.3)) return;
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const rel = new THREE.Vector3(to.dot(right), 0, to.dot(fwd));
      const limb = this.region(this.swingDir, rel, p.crouch);
      // a blocking defender facing us stops it
      if (blocking && facing.dot(fwd.clone().negate()) > 0.5 && limb !== 'lleg' && limb !== 'rleg') { g.sound?.('hit:block', pos, 0.8); hitAny = true; p.stamina -= 4; return; }
      const mult = { head: 1.8, torso: 1, larm: 0.6, rarm: 0.6, lleg: 0.7, rleg: 0.7 }[limb];
      const dmg = w.damage * mult * (0.6 + 0.4 * p.armSteadiness) * (0.85 + Math.random() * 0.3);
      onHit(limb, dmg, rel);
      hitAny = true;
      g.blood(pos.clone().setY(pos.y + 1.2), 6);
    };
    for (const n of g.residents.live) if (n.alive) consider(n.st.pos, (l, d) => n.hurt(l, d, 'player'), !!n.st.blocking, new THREE.Vector3(Math.sin(n.st.yaw), 0, Math.cos(n.st.yaw)));
    for (const s of g.war.soldiers) if (s.alive) consider(s.st.pos, (l, d) => s.hurt(l, d, 'player'), !!s.st.blocking, new THREE.Vector3(Math.sin(s.st.yaw), 0, Math.cos(s.st.yaw)));
    for (const n of g.naval.handsNear(p.pos, w.reach + 1.2)) consider(n.pos, (_l, d) => g.naval.hurtHand(n.h, d), false, n.facing);
    for (const a of g.fauna.all()) if (a.mode !== 'dead') consider(a.st.pos, (_l, d) => this.hurtAnimal(a, d), false, new THREE.Vector3());
    // chopping trees with an axe
    if (!hitAny && this.weapon!.weapon!.type === 'axe') {
      const hit = g.physics.ray(eye, new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion), w.reach + 1, groups(ALL, ALL & ~G_HELD), p.collider);
      if (hit?.owner?.kind === 'tree') g.chopTree(hit.owner.index as number, hit.point);
    }
    if (!hitAny) {
      const hit = g.physics.ray(eye, new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion), w.reach + 0.6, groups(ALL, ALL & ~G_HELD), p.collider);
      if (hit) {
        g.sound?.(hit.owner?.kind === 'prop' || hit.owner?.kind === 'furniture' || hit.owner?.kind === 'door' ? 'impact:wood' : 'impact:metal', hit.point, 0.6);
        const pr = hit.owner?.prop as { body?: { applyImpulseAtPoint: (i: THREE.Vector3, p: THREE.Vector3, w: boolean) => void } } | undefined;
        pr?.body?.applyImpulseAtPoint(new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion).multiplyScalar(w.damage * 0.15), hit.point, true);
      }
    }
  }
  hurtAnimal(a: Animal, dmg: number) {
    a.health -= dmg;
    a.fear = 1;
    this.game.sound?.(a.species === 'cow' ? 'moo' : a.species === 'pig' ? 'oink' : a.species === 'horse' || a.species === 'donkey' ? 'neigh' : 'impact:soft', a.st.pos, 1);
    if (a.health <= 0) {
      a.mode = 'dead';
      // butchering drops meat where it fell
      const n = a.species === 'cow' ? 6 : a.species === 'pig' ? 4 : a.species === 'bunny' ? 1 : 5;
      for (let i = 0; i < n; i++) this.game.props.spawn('meat', a.st.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + i * 0.12, (Math.random() - 0.5) * 1.2)));
      if (a.owner) this.game.law.crime('theft', a.st.pos, a.owner, 0.6, true);
    }
  }

  /** An NPC's blow at the player (called at the strike moment). */
  npcStrike(n: NPC | { st: { pos: THREE.Vector3; yaw: number }; anim: { swingDir: string }; person?: { role: string } }) {
    const g = this.game, p = g.player;
    setTimeout(() => {
      if (!p.alive) return;
      const d = n.st.pos.distanceTo(p.pos);
      if (d > 2.6) return;
      const theirFwd = new THREE.Vector3(Math.sin(n.st.yaw), 0, Math.cos(n.st.yaw));
      const toMe = p.pos.clone().sub(n.st.pos).setY(0).normalize();
      if (theirFwd.dot(toMe) < 0.4) return;
      const myFwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      if (this.blocking && myFwd.dot(toMe.clone().negate()) > 0.4) {
        const parry = g.time - this.blockStart < 0.3;
        g.sound?.('hit:block', p.pos, 1);
        p.stamina -= parry ? 2 : 10;
        if (parry) { g.hud.toast('Parried!'); (n as NPC).attackT = 2; }
        return;
      }
      const dir = (n as { anim: { swingDir: string } }).anim.swingDir;
      const r = Math.random();
      const limb: Limb = dir === 'over' ? (r < 0.5 ? 'head' : 'torso') : dir === 'thrust' ? 'torso' : r < 0.35 ? 'torso' : r < 0.55 ? 'larm' : r < 0.7 ? 'rarm' : r < 0.85 ? 'lleg' : 'rleg';
      const dmg = (limb === 'head' ? 26 : 16) * (0.8 + Math.random() * 0.4);
      p.hurt(limb, dmg, 'blade', dmg > 18 ? 0.25 : 0.08);
      g.sound?.('hit:flesh', p.pos, 1);
      g.blood(p.eyePos().setY(p.pos.y + 1.2), 8);
      g.hud.flashHurt(limb);
    }, 300);
  }

  musketLoaded = true;
  musketReload = 0;
  /** The pan flashes, a cloud of white smoke, and a lead ball at 300 m/s — accurate only when shouldered. */
  fireMusket() {
    const g = this.game, p = g.player;
    this.musketLoaded = false;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
    const wob = 0.004 + (1 - this.bowDraw) * 0.035 + (1 - p.armSteadiness) * 0.04;
    dir.x += (Math.random() - 0.5) * wob; dir.y += (Math.random() - 0.5) * wob; dir.z += (Math.random() - 0.5) * wob;
    dir.normalize();
    const muzzle = p.eyePos().addScaledVector(dir, 1.2);
    this.shoot(muzzle, dir.clone().multiplyScalar(300), 95, true);
    g.particles.emit('smoke', muzzle, 14); g.particles.emit('spark', muzzle, 10);
    g.sound?.('musket', muzzle, 1.4);
    g.residents.alarm(muzzle, 40);
    // the kick
    p.pitch = Math.min(1.4, p.pitch + 0.06); p.yaw += (Math.random() - 0.5) * 0.02;
  }
  loose() {
    const g = this.game, p = g.player, ia = g.interaction;
    const ar = ia.pack.find('arrow');
    if (!ar) return;
    ia.pack.remove(ar, 1);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
    // injured arms make the shot weaker and wobblier
    const wob = (1 - p.armSteadiness) * 0.08 + 0.004;
    dir.x += (Math.random() - 0.5) * wob; dir.y += (Math.random() - 0.5) * wob; dir.z += (Math.random() - 0.5) * wob;
    dir.normalize();
    const speed = 22 + 40 * this.bowDraw * (0.4 + 0.6 * p.armSteadiness);
    this.shoot(p.eyePos().addScaledVector(dir, 0.6), dir.multiplyScalar(speed), 45 * this.bowDraw, true);
    this.bowDraw = 0;
    g.sound?.('swing', p.pos, 0.4);
  }
  private static arrowGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.75, 5).rotateX(Math.PI / 2);
  private static arrowMat = new THREE.MeshStandardMaterial({ color: 0x8a6a40 });
  private static ballGeo = new THREE.SphereGeometry(0.009, 6, 4);
  private static ballMat = new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.8, roughness: 0.4 });
  shoot(pos: THREE.Vector3, vel: THREE.Vector3, dmg: number, fromPlayer: boolean, ball = vel.lengthSq() > 150 * 150) {
    const g = this.game;
    const mesh = new THREE.Mesh(ball ? Combat.ballGeo : Combat.arrowGeo, ball ? Combat.ballMat : Combat.arrowMat);
    g.scene.add(mesh);
    this.arrows.push({ pos: pos.clone(), vel: vel.clone(), mesh, life: 12, dmg, fromPlayer });
  }
  /** Physics step: integrate arrows with drag and gravity, ray-test the segment for hits. */
  step(dt: number) {
    const g = this.game;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      if (a.life <= 0) { a.mesh.removeFromParent(); this.arrows.splice(i, 1); continue; }
      if (a.vel.lengthSq() < 1e-4) continue;
      a.vel.y -= 9.81 * dt; a.vel.multiplyScalar(1 - 0.01 * dt);
      const step = a.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = g.physics.ray(a.pos, step.clone().normalize(), len, groups(ALL, ALL & ~G_HELD), a.fromPlayer ? g.player.collider : undefined);
      if (hit) {
        a.pos.copy(hit.point);
        a.vel.set(0, 0, 0);
        const o = hit.owner as Record<string, unknown> | undefined;
        if (o?.kind === 'npc' || o?.kind === 'soldier') {
          const n = (o.npc ?? o.soldier) as NPC;
          const rel = hit.point.y - n.st.pos.y;
          const limb: Limb = rel > 1.45 ? 'head' : rel > 0.9 ? 'torso' : rel > 0.5 ? (Math.random() < 0.5 ? 'larm' : 'torso') : Math.random() < 0.5 ? 'lleg' : 'rleg';
          n.hurt(limb, a.dmg * (limb === 'head' ? 2 : 1), a.fromPlayer ? 'player' : n);
          a.mesh.removeFromParent(); this.arrows.splice(i, 1); g.blood(hit.point, 5);
        } else if (o?.kind === 'player') {
          g.player.hurt(hit.point.y - g.player.pos.y > 1.45 ? 'head' : 'torso', a.dmg, 'arrow', 0.15);
          a.mesh.removeFromParent(); this.arrows.splice(i, 1);
        } else if (o?.kind === 'animal') { this.hurtAnimal(o.animal as Animal, a.dmg); a.mesh.removeFromParent(); this.arrows.splice(i, 1); }
        else { g.sound?.('impact:wood', hit.point, 0.4); a.life = Math.min(a.life, 30); }
        continue;
      }
      a.pos.add(step);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(a.pos.clone().add(a.vel));
    }
  }
}
