// Travel posts: a waystone and signpost by the road outside every town's gates. The post-riders carry you
// (and your purse) to any other post in an hour or so — but not your pack: goods are left in the post's
// strongbox, to be collected when you come back the same way. Horses stay at the post too.
import * as THREE from 'three';
import type { Game } from '../game';
import type { TownPlan } from './towns';
import type { InvItem } from '../player/inventory';
import type { DNode, DOption } from '../npc/talk';
import { GeoBuilder } from '../build/geom';
import { meshesFrom } from '../props/palette';
import { RAPIER, groups, G_STATIC, ALL } from '../physics/physics';
import type { Action, Interactable } from '../player/interact';

export interface Post { plan: TownPlan; pos: THREE.Vector3; yaw: number; stash: InvItem[]; name: string }

export class TravelPosts {
  posts: Post[] = [];
  group = new THREE.Group();
  constructor(public game: Game) { game.scene.add(this.group); }

  build() {
    const g = this.game;
    const geo = new GeoBuilder();
    for (const plan of g.towns.plans) {
      const sy = plan.stableYard;
      if (plan.minor || !sy) continue;
      // across the road from the stable yard, facing the road
      const [ax, az] = sy.arrive;
      let nx = sy.x - ax, nz = sy.z - az; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const x = ax - nx * 10, z = az - nz * 10;
      const yaw = Math.atan2(nx, nz);
      const y = g.world.heightAt(x, z);
      const pos = new THREE.Vector3(x, y, z);
      this.posts.push({ plan, pos, yaw, stash: [], name: plan.site.name });
      this.model(geo, pos, yaw);
      // a solid collider to bump into and to look at
      const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y + 1.2, z));
      const col = g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 1.2, 0.45).setCollisionGroups(groups(G_STATIC, ALL)), body);
      const post = this.posts[this.posts.length - 1];
      const it: Interactable = { name: () => `Travel post — ${post.name}`, actions: (): Action[] => [{ key: 'E', label: 'Travel by post-rider', run: () => this.open(post) }] };
      g.physics.owners.set(col.handle, { kind: 'post', interact: it });
    }
    for (const m of meshesFrom(geo.build())) { m.matrixAutoUpdate = false; m.updateMatrix(); this.group.add(m); }
  }

  /** A carved waystone with the kingdom's lantern, a fingerpost and a bench and strongbox for the riders. */
  private model(g: GeoBuilder, p: THREE.Vector3, yaw: number) {
    const STONE = 'mat:medieval_blocks_02', WOOD = 'wood:dark|stain:walnut|fin:raw';
    g.push().translate(p.x, p.y, p.z).rotateY(yaw);
    g.box(STONE, 0, 0.12, 0, 1.3, 0.3, 1.3, 0.6);                    // plinth
    g.box(STONE, 0, 1.25, 0, 0.62, 2.1, 0.62, 0.6);                   // the stone
    g.box(STONE, 0, 2.4, 0, 0.8, 0.22, 0.8, 0.6);                     // capstone
    g.cyl(STONE, 0, 2.5, 0, 0.32, 0.05, 0.45, 4);                     // pyramidion
    g.box('color:d8c070|e:0', 0, 1.7, 0.315, 0.36, 0.36, 0.02);       // brass plate
    // the fingerpost with three arms
    g.box(WOOD, 1.3, 1.6, 0, 0.12, 3.2, 0.12, 2);
    for (const [h, a] of [[2.8, 0.4], [2.45, -0.9], [2.1, 2.2]] as const) { g.push().translate(1.3, h, 0).rotateY(a); g.box('wood:weathered|stain:honey|fin:raw', 0.45, 0, 0, 0.9, 0.18, 0.04, 2); g.pop(); }
    // lantern on a bracket
    g.box('iron', 0, 2.1, 0.45, 0.05, 0.05, 0.4, 2);
    g.cyl('iron', 0, 1.82, 0.62, 0.08, 0.1, 0.26, 8, true);
    g.ellipsoid('color:ffc070|e:4', 0, 1.95, 0.62, 0.05, 0.07, 0.05, 6);
    // the riders' bench and strongbox
    g.box(WOOD, -1.5, 0.45, 0.2, 1.6, 0.08, 0.45, 2); for (const s of [-1, 1]) g.box(WOOD, -1.5 + s * 0.65, 0.22, 0.2, 0.08, 0.45, 0.4, 2);
    g.box('wood:planks|stain:oxblood|fin:raw', -1.5, 0.25, -0.55, 0.8, 0.5, 0.5, 1.5); g.box('iron', -1.5, 0.51, -0.55, 0.84, 0.04, 0.54, 2);
    g.pop();
  }

  near(p: THREE.Vector3, r = 4) { return this.posts.find((q) => q.pos.distanceTo(p) < r) ?? null; }

  private open(post: Post) {
    this.game.ui.openChoice('Travel post', post.name, 'Post-rider', this.menu(post));
  }
  private menu(post: Post, line?: string): DNode {
    const g = this.game, ia = g.interaction;
    const opts: DOption[] = [];
    if (post.stash.length) opts.push({ label: `Collect what I left here (${post.stash.length} item${post.stash.length > 1 ? 's' : ''})`, go: () => {
      const left: InvItem[] = [];
      for (const it of post.stash) { const extra = { ...it } as Partial<InvItem>; delete extra.uid; delete extra.x; delete extra.y; if (!ia.pack.add(it.id, it.n, extra)) left.push(it); }
      post.stash = left;
      return this.menu(post, left.length ? `Your pack's full — ${left.length} thing${left.length > 1 ? 's' : ''} still in the box.` : 'All there, sealed as you left it.');
    } });
    const others = this.posts.filter((q) => q !== post).sort((a, b) => a.pos.distanceTo(post.pos) - b.pos.distanceTo(post.pos));
    for (const q of others.slice(0, 8)) {
      const d = q.pos.distanceTo(post.pos);
      const fee = Math.max(3, Math.round(d / 400));
      const hours = 0.25 + d / 9000;
      opts.push({ label: `${q.name} — ${fee}d, ${hours < 1 ? Math.round(hours * 60) + ' min' : hours.toFixed(1) + ' h'}`, go: () => {
        if (ia.money < fee) return this.menu(post, `${fee} pennies for the ride. You haven't got it.`);
        ia.money -= fee;
        this.travel(post, q, hours);
        return null;
      } });
    }
    opts.push({ label: 'Not today.', go: () => null });
    const carrying = ia.pack.items.length + (ia.held ? 1 : 0);
    return { line: line ?? (carrying ? `We ride light — coin only. Whatever's in your pack goes in the strongbox here, safe till you come back for it. Where to?` : 'Fresh horses at every post. Where to?'), options: opts };
  }

  /** Off you go: pack into the strongbox, horse left in the post's care, a fade, and you're there. */
  travel(from: Post, to: Post, hours: number) {
    const g = this.game, ia = g.interaction;
    if (ia.held) ia.release(false);
    if (g.combat.drawn) g.combat.toggleWeapon();
    from.stash.push(...ia.pack.items);
    ia.pack.items = [];
    const mount = g.mount;
    if (g.player.seat) g.player.standUp();
    if (mount) mount.teleport(from.pos.clone().add(new THREE.Vector3(2.5, 0, 2.5)));
    const plan = { ...to.plan, stableYard: undefined, plaza: { x: to.pos.x + Math.sin(to.yaw) * 3, z: to.pos.z + Math.cos(to.yaw) * 3 } };
    g.fastTravel(plan as never, hours, true);
    if (from.stash.length) g.hud.toast(`Your belongings wait in the strongbox at ${from.name}.`);
  }
}
