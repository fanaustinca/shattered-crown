// Looking at things and doing things to them: hold/carry/throw physical props, put them into
// containers or the pack, open doors/drawers/lids/chests, light candles, sit, sleep, eat, ride,
// lead animals, strap bags onto donkeys. Anything else can expose actions through `actions()`.
import * as THREE from 'three';
import { RAPIER, groups, G_CHAR, G_HELD, G_PROP, ALL, v3, q4 } from '../physics/physics';
import type { Game } from '../game';
import type { Prop } from '../props/props';
import { ITEMS } from '../props/items';
import type { MovableNode, FurnitureNode, Candle } from '../props/furnish';
import type { Door, LiveBuilding } from '../build/settlements';
import type { Animal } from '../creature/animals';
import { Grid, freshness, freshLabel, type InvItem } from './inventory';
import type { Seat } from './player';
import { mulberry32 } from '../core/noise';

export interface Action { key: 'E' | 'F' | 'X' | 'Q' | 'R' | 'G' | 'LMB'; label: string; run: () => void; disabled?: boolean }
export interface Interactable { actions(game: Game): Action[]; name(): string }

const REACH = 3.0;

export class Interaction {
  held: Prop | null = null;
  holdDist = 1.4;
  holdQuat = new THREE.Quaternion();
  rotating = false;
  actions: Action[] = [];
  targetName = '';
  targetPoint = new THREE.Vector3();
  containers = new Map<string, Grid>();
  openContainer: { grid: Grid; title: string; owner: string | null } | null = null;
  pack = new Grid(10, 8, 'Pack');
  hands: InvItem | null = null; // equipped weapon (from the pack)
  money = 25;
  private ray = new THREE.Raycaster();
  constructor(public game: Game) {
    this.pack.add('apple', 3); this.pack.add('bread', 1); this.pack.add('bandage', 2); this.pack.add('candle', 2); this.pack.add('rope', 1); this.pack.add('hatchet', 1);
  }

  /** Called every frame (render rate). */
  update(dt: number) {
    const g = this.game, inp = g.input, p = g.player;
    this.actions = [];
    this.targetName = '';
    if (!p.alive || g.freeCam) return;
    if (inp.uiOpen) return;
    // ---- held prop controls ----
    if (this.held) {
      const h = this.held;
      if (!g.props.props.has(h) || h.broken) { this.held = null; }
      else {
        if (inp.mouse.wheel) this.holdDist = THREE.MathUtils.clamp(this.holdDist - inp.mouse.wheel * 0.15, 0.7, 2.6);
        this.rotating = inp.key('KeyR');
        if (this.rotating) {
          const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inp.mouse.dx * 0.01);
          const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), inp.mouse.dy * 0.01);
          this.holdQuat.premultiply(qy).premultiply(qx);
          inp.mouse.dx = 0; inp.mouse.dy = 0;
        }
        this.actions.push({ key: 'G', label: 'Put down', run: () => this.release(false) });
        this.actions.push({ key: 'LMB', label: 'Throw', run: () => this.release(true) });
        if (this.canStash(h)) this.actions.push({ key: 'F', label: 'Put in pack', run: () => this.stash(h) });
        if (h.def.food) this.actions.push({ key: 'Q', label: `Eat (${freshLabel(h.freshness)})`, run: () => this.eatProp(h) });
      }
    }
    // ---- what are we looking at? ----
    const cam = g.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const reach = REACH + (p.thirdPerson ? p.camDist : 0) + (p.mode === 'seat' ? 1 : 0);
    const hit = g.physics.ray(origin, dir, reach, groups(ALL, ALL & ~G_HELD), p.collider);
    // sensors (drawers/doors of furniture) are found with an intersection query along the ray
    let owner = hit?.owner as Record<string, unknown> | undefined;
    let point = hit?.point ?? origin.clone().addScaledVector(dir, reach);
    const sensor = this.sensorHit(origin, dir, hit?.toi ?? reach);
    if (sensor) { owner = sensor.owner; point = sensor.point; }
    this.targetPoint.copy(point);
    const add = (a: Action) => this.actions.push(a);
    if (owner) {
      switch (owner.kind) {
        case 'prop': {
          const pr = owner.prop as Prop;
          if (pr === this.held) break;
          this.targetName = this.propLabel(pr);
          if (!this.held) {
            if (pr.def.mass <= 60) add({ key: 'E', label: pr.def.mass > 25 ? 'Drag' : 'Pick up', run: () => this.grab(pr) });
            if (pr.price && pr.owner && pr.owner !== 'player') add({ key: 'R', label: `Buy (${pr.price}d)`, run: () => this.buy(pr) });
            if (this.canStash(pr)) add({ key: 'F', label: pr.price && pr.owner !== 'player' ? 'Take (steal)' : 'Take', run: () => this.stash(pr) });
            if (pr.def.food) add({ key: 'Q', label: 'Eat', run: () => this.eatProp(pr) });
            if (pr.container && !pr.container.open) add({ key: 'X', label: 'Open', run: () => this.openPropContainer(pr) });
            if (pr.def.id === 'powder') add({ key: 'X', label: 'Light the fuse', run: () => g.destruct.light(pr) });
          } else if (pr.container) {
            add({ key: 'E', label: `Put ${this.held.def.name.toLowerCase()} in ${pr.def.name.toLowerCase()}`, run: () => this.putInto(this.held!, pr) });
          }
          break;
        }
        case 'door': {
          const d = owner.door as Door;
          this.targetName = d.exterior ? 'Door' : 'Inner door';
          add({ key: 'E', label: d.locked ? (this.pack.count('lockpick') ? 'Pick the lock' : 'Locked') : d.target > 0.5 ? 'Close' : 'Open', run: () => this.useDoor(d) });
          if (!d.locked && d.target < 0.5 && d.exterior) add({ key: 'X', label: 'Knock', run: () => g.events.emit('knock', d) });
          break;
        }
        case 'movable': {
          const mv = owner.movable as MovableNode;
          const nm = mv.def.kind === 'drawer' ? 'Drawer' : mv.def.kind === 'lid' ? 'Chest' : 'Cupboard door';
          this.targetName = nm;
          add({ key: 'E', label: mv.target > 0.5 ? 'Close' : 'Open', run: () => { mv.furniture.toggle(mv); g.sound?.(mv.def.kind === 'drawer' ? 'drawer' : 'creak', point, 0.6); if (mv.target > 0.5 && mv.def.container) this.openFurnitureContainer(mv, owner!.building as never); } });
          if (mv.open > 0.5 && mv.def.container) add({ key: 'F', label: 'Search', run: () => this.openFurnitureContainer(mv, owner!.building as never) });
          if (this.held && mv.open > 0.5 && mv.def.container) add({ key: 'X', label: 'Put inside', run: () => this.putIntoFurniture(this.held!, mv, owner!.building as never) });
          break;
        }
        case 'furniture': {
          const fn = owner.furniture as FurnitureNode;
          this.targetName = fn.model.name;
          const candle = this.nearestCandle(fn, point);
          if (candle) add({ key: 'E', label: candle.lit ? 'Snuff the candle' : candle.burn > 0.02 ? 'Light the candle' : 'Burnt out', run: () => { if (candle.burn > 0.02) candle.lit = !candle.lit; } });
          if (fn.model.sleep?.length) add({ key: candle ? 'X' : 'E', label: 'Sleep', run: () => g.residents.sleepIn(fn, owner!.building as never) });
          if (fn.model.seats?.length && !fn.model.sleep?.length) add({ key: candle ? 'X' : 'E', label: 'Sit', run: () => this.sit(fn) });
          if (fn.model.container && !fn.movables.length) add({ key: 'F', label: 'Search', run: () => this.openFurnitureContainer(null, owner!.building as never, fn) });
          if (this.held && fn.model.surfaces?.length) add({ key: 'G', label: 'Set it down here', run: () => this.release(false) });
          break;
        }
        case 'animal': {
          const a = owner.animal as Animal;
          this.targetName = `${a.name} (${a.species})${a.owner ? '' : ''}`;
          if (a.spec.rideable && !this.held) add({ key: 'E', label: `Ride ${a.name}`, run: () => { if (a.owner) g.law.crime('horse theft', a.st.pos, a.owner, 0.4); a.mount(p); } });
          if (this.held && (this.held.def.id === 'sack' || this.held.def.id === 'saddlebag' || this.held.def.id === 'basket') && (a.species === 'donkey' || a.species === 'horse')) add({ key: 'E', label: `Strap the ${this.held.def.name.toLowerCase()} on`, run: () => this.attachBag(a) });
          if (this.held && ITEMS[this.held.def.id].food) add({ key: 'X', label: `Feed ${a.name}`, run: () => { const h = this.held!; this.release(false); g.props.destroy(h); a.fear = 0; a.mode = 'idle'; g.hud.toast(`${a.name} munches happily.`); } });
          if (!this.held && a.mode !== 'ridden') add({ key: 'X', label: a.leader ? 'Let go of the rope' : this.pack.count('rope') ? 'Lead with rope' : 'Lead (need rope)', run: () => { if (a.leader) { a.leader = null; a.mode = 'idle'; } else if (this.pack.count('rope')) { a.leader = p; a.mode = 'led'; } } });
          if (a.saddlebags.length) add({ key: 'F', label: 'Open saddlebags', run: () => this.openSaddlebags(a) });
          break;
        }
        default: {
          const it = owner as unknown as { interact?: Interactable };
          if (it.interact) { this.targetName = it.interact.name(); this.actions.push(...it.interact.actions(g)); }
          else if (owner.kind === 'npc' && owner.npc) {
            const npc = owner.npc as { name: string; actions(g: Game): Action[] };
            this.targetName = npc.name;
            this.actions.push(...npc.actions(g));
          }
        }
      }
    }
    // standing up / dismounting while seated
    if (p.mode === 'seat' && p.seat) {
      this.actions = this.actions.filter((a) => a.key !== 'E');
      this.actions.unshift({ key: 'E', label: (p.seat as Seat & { dismountLabel?: string }).dismountLabel ?? 'Get up', run: () => p.standUp() });
    }
    // run actions on key presses
    for (const a of this.actions) {
      const pressed = a.key === 'LMB' ? inp.btnHit(0) : inp.hit('Key' + a.key);
      if (pressed && !a.disabled) { a.run(); break; }
    }
    // quick-eat from the pack when nothing else uses Q
    if (inp.hit('KeyQ') && !this.actions.some((a) => a.key === 'Q')) this.eatBest();
    if (inp.hit('KeyB')) this.useBandage();
  }

  private sensorHit(origin: THREE.Vector3, dir: THREE.Vector3, maxToi: number) {
    const g = this.game;
    let best: { owner: Record<string, unknown>; point: THREE.Vector3; toi: number } | null = null;
    const ray = new RAPIER.Ray(origin, dir);
    g.physics.world.intersectionsWithRay(ray, maxToi + 0.05, true, (inter) => {
      const o = g.physics.owners.get(inter.collider.handle) as Record<string, unknown> | undefined;
      if (o && o.kind === 'movable' && (!best || inter.timeOfImpact < best.toi)) best = { owner: o, point: origin.clone().addScaledVector(dir, inter.timeOfImpact), toi: inter.timeOfImpact };
      return true;
    }, undefined, groups(ALL, 32));
    return best as { owner: Record<string, unknown>; point: THREE.Vector3; toi: number } | null;
  }

  private propLabel(pr: Prop) {
    let s = pr.def.name;
    if (pr.def.food) s += ` · ${freshLabel(pr.freshness)}`;
    if (pr.contents.length) s += ` · ${pr.contents.length} inside`;
    s += ` · ${pr.mass.toFixed(pr.mass < 2 ? 1 : 0)} kg`;
    if (pr.owner && pr.owner !== 'player') s += pr.price ? ` · for sale, ${pr.price} pennies (R to buy)` : ' · not yours';
    return s;
  }
  private nearestCandle(fn: FurnitureNode, point: THREE.Vector3): Candle | null {
    let best: Candle | null = null, bd = 0.7;
    for (const c of fn.candles) { const d = c.flameWorld.distanceTo(point); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /** Pay the stallholder or shopkeeper and the thing is yours. */
  buy(pr: Prop) {
    const g = this.game;
    if (!pr.price) return;
    if (this.money < pr.price) { g.hud.toast(`${pr.price} pennies — you only have ${this.money}.`); return; }
    this.money -= pr.price;
    g.hud.toast(`Bought ${pr.def.name.toLowerCase()} for ${pr.price} pennies.`);
    pr.owner = 'player'; pr.price = null;
    g.sound?.('pickup', pr.obj.position, 0.6);
  }

  // ---------- holding ----------
  grab(pr: Prop) {
    const g = this.game;
    if (pr.stowedIn) g.props.unstow(pr);
    if (!pr.body) return;
    this.held = pr;
    pr.held = true;
    pr.collider?.setCollisionGroups(groups(G_HELD, ALL & ~G_CHAR));
    pr.body.wakeUp();
    const cam = g.camera;
    this.holdDist = THREE.MathUtils.clamp(cam.position.distanceTo(pr.obj.position), 0.9, 2.0);
    this.holdQuat.copy(cam.quaternion).invert().multiply(pr.obj.quaternion);
    if (pr.owner && pr.owner !== 'player') g.law.crime('theft', pr.obj.position, pr.owner, Math.min(1, pr.def.value / 40 + 0.1), true);
    g.sound?.('pickup', pr.obj.position, 0.4);
  }
  release(throwIt: boolean) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    h.held = false;
    h.collider?.setCollisionGroups(groups(G_PROP, ALL));
    if (h.body && throwIt) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.game.camera.quaternion);
      const strength = 13 * this.game.player.armSteadiness + 2;
      h.body.applyImpulse(dir.multiplyScalar(Math.min(strength * h.def.mass, 40 * Math.sqrt(h.def.mass))).add(new THREE.Vector3(0, h.def.mass * 1.2, 0)), true);
      h.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * h.def.mass * 0.2, y: 0, z: (Math.random() - 0.5) * h.def.mass * 0.2 }, true);
    }
  }
  /** Physics step: steer the held body toward a point in front of the eyes. */
  stepHeld(dt: number) {
    const h = this.held, g = this.game;
    if (!h || !h.body) return;
    const cam = g.camera;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const heavy = h.def.mass > 25;
    const target = cam.position.clone().addScaledVector(dir, this.holdDist + (heavy ? 0.4 : 0));
    if (heavy) target.y = Math.max(g.groundAt(target.x, target.z, cam.position.y) + 0.3, Math.min(target.y, g.player.pos.y + 0.6));
    const pos = v3(h.body.translation());
    const err = target.clone().sub(pos);
    if (err.length() > 2.2) { this.release(false); return; }  // snagged on something
    const strength = (heavy ? 2.5 : 14) * this.game.player.armSteadiness * Math.min(1, 25 / Math.max(1, h.def.mass) + 0.3);
    const v = err.multiplyScalar(strength);
    const max = heavy ? 2.5 : 9;
    if (v.length() > max) v.setLength(max);
    // the player's own motion is added so held things don't lag behind
    v.add(g.player.vel.clone().setY(0).multiplyScalar(0.9));
    h.body.setLinvel(v, true);
    // orientation
    const want = cam.quaternion.clone().multiply(this.holdQuat);
    const cur = q4(h.body.rotation());
    const dq = want.multiply(cur.clone().invert());
    if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
    const ang = 2 * Math.acos(Math.min(1, dq.w));
    const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
    if (axis.lengthSq() > 1e-8) axis.normalize();
    const w = axis.multiplyScalar(heavy ? 0 : Math.min(ang, 3) * 10);
    h.body.setAngvel(w, true);
    void dt;
  }

  canStash(pr: Prop) { return pr.def.mass <= 40 && !!this.pack.fitsAny?.(pr.def.id); }
  stash(pr: Prop) {
    const g = this.game;
    if (pr.owner && pr.owner !== 'player') g.law.crime('theft', pr.obj.position, pr.owner, Math.min(1, pr.def.value / 40 + 0.1), true);
    const it = this.pack.add(pr.def.id, 1, { age: pr.age, salted: pr.salted, smoked: pr.smoked, owner: null });
    if (!it) { g.hud.toast('No room in your pack.'); return; }
    // containers keep what was inside them
    if (pr.container && (pr.contents.length || pr.inv.length)) {
      it.contents = new Grid(pr.container.w, pr.container.h, pr.def.name);
      for (const c of pr.contents) it.contents.add(c.def.id, 1, { age: c.age });
    }
    if (this.held === pr) { this.held = null; pr.held = false; }
    g.props.destroy(pr);
    g.hud.toast(`${ITEMS[it.id].name} → pack`);
    g.sound?.('pickup', g.player.pos, 0.3);
  }
  putInto(item: Prop, into: Prop) {
    const g = this.game;
    this.release(false);
    if (into.container?.open) {
      // drop it physically into the opening
      const b = into.bbox;
      const top = into.obj.localToWorld(new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y + 0.15, (b.min.z + b.max.z) / 2));
      item.body?.setTranslation(top, true);
      item.body?.setLinvel({ x: 0, y: -0.5, z: 0 }, true);
    } else {
      into.inv.push({ id: item.def.id, n: 1, age: item.age });
      g.props.destroy(item);
    }
  }
  eatProp(pr: Prop) {
    const f = pr.def.food;
    if (!f) return;
    this.consume(pr.def.id, pr.freshness);
    if (pr.owner && pr.owner !== 'player') this.game.law.crime('theft', pr.obj.position, pr.owner, 0.1, true);
    if (this.held === pr) this.held = null;
    this.game.props.destroy(pr);
  }
  consume(id: string, fresh: number) {
    const g = this.game, p = g.player, f = ITEMS[id].food;
    if (!f) return;
    const good = fresh > 0.25;
    p.satiety = Math.min(100, p.satiety + f.nutrition * (good ? 1 : 0.4));
    p.stamina = Math.min(p.maxStamina, p.stamina + f.nutrition * 0.8);
    if (!good || (f.raw && Math.random() < 0.4)) { p.sick = Math.min(1, p.sick + (good ? 0.3 : 0.8)); g.hud.toast(good ? 'Raw — your stomach turns.' : 'Rotten! You feel sick.'); }
    else g.hud.toast(`You eat the ${ITEMS[id].name.toLowerCase()}.`);
    g.playerBody?.eat();
    g.sound?.('eat', p.pos, 0.6);
  }
  eatBest() {
    const foods = this.pack.items.filter((i) => ITEMS[i.id]?.food).sort((a, b) => freshness(a) - freshness(b));
    const pick = foods.find((f) => freshness(f) > 0.25) ?? foods[0];
    if (!pick) { this.game.hud.toast('You have nothing to eat.'); return; }
    this.consume(pick.id, freshness(pick));
    this.pack.remove(pick, 1);
  }
  useBandage() {
    const b = this.pack.find('bandage');
    const p = this.game.player;
    if (!b) { this.game.hud.toast('No bandages.'); return; }
    if (p.bleeding <= 0.01 && p.totalHealth > 95) { this.game.hud.toast('You are not wounded.'); return; }
    this.pack.remove(b, 1);
    p.bleeding = 0;
    p.heal(15);
    this.game.hud.toast('You bind your wounds.');
  }
  useDoor(d: Door) {
    const g = this.game;
    if (d.locked) {
      const pick = this.pack.find('lockpick');
      if (!pick) { g.hud.toast('It is locked.'); g.sound?.('locked', d.node.position, 0.5); return; }
      if (Math.random() < 0.55) { d.locked = false; g.hud.toast('Click — the lock gives.'); g.law.crime('trespass', g.player.pos, d.owner, 0.3, true); }
      else { this.pack.remove(pick, 1); g.hud.toast('The pick snaps.'); }
      return;
    }
    d.toggle();
    g.sound?.('door', d.node.getWorldPosition(new THREE.Vector3()), 0.7);
  }
  sit(fn: FurnitureNode) {
    const s = fn.model.seats![0];
    const g = this.game;
    const world = s.pos.clone().applyMatrix4(fn.group.matrixWorld);
    const yaw = fn.group.getWorldQuaternion(new THREE.Quaternion());
    const e = new THREE.Euler().setFromQuaternion(yaw, 'YXZ');
    const seat: Seat & { dismountLabel: string } = {
      label: 'Seat', eye: 0.75, dismountLabel: 'Stand up',
      getTransform: (pos, q) => { pos.copy(world).setY(world.y - 0.45); q.setFromEuler(new THREE.Euler(0, e.y, 0)); },
      leave: () => { g.playerBody?.setPose('idle'); },
    };
    g.player.sitIn(seat);
    g.player.yaw = e.y + Math.PI;
    g.playerBody?.setPose('sit');
  }

  // ---------- containers ----------
  private furnitureKey(b: LiveBuilding | undefined, fn: FurnitureNode, mv: MovableNode | null) {
    const bid = (b as unknown as { id?: string })?.id ?? (b?.placed?.id ?? 'world');
    const idx = fn.movables.indexOf(mv as MovableNode);
    return `${bid}:${fn.model.id}:${fn.group.position.x.toFixed(1)},${fn.group.position.z.toFixed(1)}:${idx}`;
  }
  openFurnitureContainer(mv: MovableNode | null, building: { id: string; household?: { id: string } } | undefined, fn?: FurnitureNode) {
    const furn = fn ?? mv!.furniture;
    const spec = mv?.def.container ?? furn.model.container ?? { w: 4, h: 3, name: 'Storage' };
    const key = this.furnitureKey(building as never, furn, mv);
    let grid = this.containers.get(key);
    if (!grid) {
      grid = new Grid(Math.max(2, Math.min(10, spec.w)), Math.max(1, Math.min(8, spec.h)), spec.name, building?.id ?? null);
      this.fillLoot(grid, furn.model.category, key);
      this.containers.set(key, grid);
    }
    this.openContainer = { grid, title: spec.name, owner: building?.id ?? null };
    this.game.ui.openInventory();
  }
  private fillLoot(grid: Grid, cat: string, key: string) {
    let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    const r = mulberry32(h);
    const table: Record<string, string[]> = {
      drawers: ['candle', 'cloth', 'bandage', 'key', 'book', 'lockpick', 'coin_purse'],
      wardrobe: ['cloth', 'cloth', 'saddlebag', 'rope'],
      chest: ['coin_purse', 'goblet', 'cloth', 'book', 'candle', 'salt', 'arrow'],
      cupboard: ['bread', 'cheese', 'salted_meat', 'onion', 'apple', 'cup', 'plate', 'salt', 'smoked_fish'],
      desk: ['book', 'candle', 'key', 'coin_purse'],
      table: ['cup', 'bread'],
      bed: ['coin_purse'],
    };
    const pool = table[cat] ?? ['candle'];
    const n = Math.floor(r() * 4);
    for (let i = 0; i < n; i++) grid.add(pool[Math.floor(r() * pool.length)], 1, { age: r() * 48, owner: grid.owner });
  }
  putIntoFurniture(item: Prop, mv: MovableNode, building: { id: string } | undefined) {
    this.openFurnitureContainer(mv, building as never);
    const grid = this.openContainer!.grid;
    if (grid.add(item.def.id, 1, { age: item.age })) { this.release(false); this.game.props.destroy(item); }
    else this.game.hud.toast('It does not fit.');
  }
  openPropContainer(pr: Prop) {
    const grid = new Grid(pr.container!.w, pr.container!.h, pr.def.name, pr.owner);
    for (const s of pr.inv) grid.add(s.id, s.n, { age: s.age ?? 0 });
    (grid as Grid & { onClose?: () => void }).onClose = () => { pr.inv = grid.items.map((i) => ({ id: i.id, n: i.n, age: i.age })); };
    this.openContainer = { grid, title: pr.def.name, owner: pr.owner };
    this.game.ui.openInventory();
  }
  attachBag(a: Animal) {
    const h = this.held!;
    this.release(false);
    const grid = new Grid(h.container?.w ?? 6, h.container?.h ?? 5, `${a.name}'s ${h.def.name.toLowerCase()}`);
    for (const c of h.contents) grid.add(c.def.id, 1, { age: c.age });
    a.saddlebags.push(grid);
    // the bag's mesh rides on the animal's side, swinging with its back
    const mesh = h.obj.children[0].clone(true);
    const spine = a.rig.byName.spine;
    const side = a.saddlebags.length % 2 ? 1 : -1;
    const sp = a.rig.rest[a.rig.bones.indexOf(spine)];
    mesh.position.set(side * (a.species === 'donkey' ? 0.3 : 0.34), -0.12, 0).add(new THREE.Vector3(0, 0, 0)).sub(new THREE.Vector3(0, 0, 0));
    mesh.rotation.set(0, Math.PI / 2, side * 0.15);
    void sp;
    spine.add(mesh);
    a.bagMeshes.push(mesh);
    this.game.props.destroy(h);
    this.game.hud.toast(`You strap the ${h.def.name.toLowerCase()} onto ${a.name}.`);
  }
  openSaddlebags(a: Animal) {
    const grid = a.saddlebags[0] as Grid;
    this.openContainer = { grid, title: grid.name, owner: a.owner };
    this.game.ui.openInventory();
  }
  /** Take an item out of the pack into the world (in your hands). */
  dropFromPack(it: InvItem, grid: Grid = this.pack) {
    const g = this.game;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(g.camera.quaternion);
    const pos = g.camera.position.clone().addScaledVector(dir, 1.0);
    const pr = g.props.spawn(it.id, pos, undefined, { owner: null });
    if (!pr) return;
    pr.age = it.age; pr.salted = !!it.salted; pr.smoked = !!it.smoked;
    if (it.contents && pr.container) for (const c of it.contents.items) { const cp = g.props.spawn(c.id, pos.clone().add(new THREE.Vector3(0, 0.1, 0))); if (cp) { cp.age = c.age; g.props.stow(cp, pr); } }
    grid.remove(it, 1);
    if (!this.held && pr.def.mass <= 25) this.grab(pr);
  }
}

declare module './inventory' {
  interface Grid { fitsAny?(id: string): boolean }
}
Grid.prototype.fitsAny = function (this: Grid, id: string) {
  const d = ITEMS[id];
  if (!d) return false;
  if (d.stack && this.items.some((o) => o.id === id && o.n < d.stack!)) return true;
  for (const rot of [false, true]) for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.fits(id, x, y, rot)) return true;
  return false;
};
