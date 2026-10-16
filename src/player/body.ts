// The player's own body: visible in third person and when you look down in first person
// (head hidden so it doesn't block the camera). Holds the drawn weapon, sits, rides, sleeps, eats.
import * as THREE from 'three';
import type { Game } from '../game';
import { BipedAnimator } from '../creature/anim';
import type { Rig } from '../creature/rig';
import type { ItemDef } from '../props/items';
import { instanceModel } from '../props/models';
import { buildItemMesh } from '../props/items';

export class PlayerBody {
  rig: Rig;
  anim: BipedAnimator;
  pose: 'idle' | 'sit' | 'sleep' | 'ride' = 'idle';
  eatT = 0;
  weapon: THREE.Object3D | null = null;
  constructor(public game: Game) {
    this.rig = game.creatures.instance('human0', { coat: 0, cloth1: 0x4a3a2a, cloth2: 0x3a3a30, boots: 0x2a1a10, skin: 0xd8a888, hair: 0x3a2414, belt: 0x2a1a0a });
    this.anim = new BipedAnimator(this.rig, (x, z) => game.groundAt(x, z, game.player.pos.y - 0.05));   // from knee height: not tables, bunks or guns
    game.scene.add(this.rig.root);
  }
  setPose(p: PlayerBody['pose']) { this.pose = p; }
  eat() { this.eatT = 1.6; }
  setWeapon(d: ItemDef | null) {
    if (this.weapon) { this.weapon.removeFromParent(); this.weapon = null; }
    if (!d) return;
    const m = d.glb ? instanceModel(d.glb) : buildItemMesh(d);
    if (!m) return;
    m.rotation.set(Math.PI, 0, 0);
    m.position.set(0, -0.06, 0.03);
    this.rig.byName.handR.add(m);
    this.weapon = m;
  }
  update(dt: number) {
    const g = this.game, p = g.player;
    this.eatT = Math.max(0, this.eatT - dt);
    const fp = !p.thirdPerson && p.mode !== 'dead';
    // in first person, keep the body slightly behind the eye so it doesn't clip into view
    const back = fp ? 0.18 : 0;
    // in the saddle the body faces where the horse faces; looking about turns only the head and shoulders
    const mount = g.mount as { st?: { yaw: number } } | null;
    const bodyYaw = mount?.st ? mount.st.yaw : p.yaw + Math.PI;
    const pos = p.pos.clone().add(new THREE.Vector3(-Math.sin(bodyYaw) * back, 0, -Math.cos(bodyYaw) * back));
    const look = mount?.st ? p.pos.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch) * 10, 1.6 + Math.sin(p.pitch) * 10, -Math.cos(p.yaw) * Math.cos(p.pitch) * 10)) : null;
    const planar = Math.hypot(p.vel.x, p.vel.z);
    this.anim.limp = p.limp;
    this.anim.update(dt, {
      pos, yaw: bodyYaw, speed: p.mode === 'seat' ? 0 : planar, swimming: p.mode === 'swim', turn: 0, vel: p.vel,
      action: p.mode === 'dead' ? 'dead' : this.pose === 'sleep' ? 'sleep' : 'idle',
      look, carry: !!g.interaction.held, eating: this.eatT > 0, sitting: this.pose === 'sit', riding: !!g.mount, armed: !!g.combat.drawn,
      blocking: g.combat.blocking,
    } as never);
    // hide the head in first person
    this.rig.byName.head.scale.setScalar(fp ? 0.001 : 1);
    this.rig.byName.neck.scale.setScalar(fp ? 0.6 : 1);
    this.rig.root.visible = p.mode !== 'seat' || !!g.mount || this.pose !== 'idle' || p.thirdPerson;
  }
}
