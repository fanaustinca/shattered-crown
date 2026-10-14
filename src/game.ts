// Top-level game object: owns renderer, world, systems and the main loop.
import * as THREE from 'three';
import { World } from './world/world';
import { Pipeline, sharedUniforms } from './render/pipeline';
import { Sky, skyUniforms } from './render/sky';
import { Lighting } from './render/lighting';
import { Terrain } from './render/terrain';
import { Grass, sunDirRef } from './render/grass';
import { Trees } from './render/trees';
import { Water, setSeaFloor, seaHeight, riverChop, waterUniforms } from './render/water';
import { QUALITY, settings, saveSettings, guessQuality, type Quality } from './core/settings';
import { Physics, groups, G_STATIC, G_VEHICLE } from './physics/physics';
import { Input } from './core/input';
import { Player } from './player/player';
import { siteById, SITES, riverX, riverWidth, HALF, nearestSite } from './world/layout';
import { CreatureLib } from './creature/rig';
import { Fauna, type GameCtx, Animal } from './creature/animals';
import { setMaterialPrep } from './props/palette';
import { Towns } from './world/towns';
import { Settlements } from './build/settlements';
import { PropManager } from './props/props';
import { setModelPrep } from './props/models';
import { LightPool, type FurnitureNode } from './props/furnish';
import { Interaction } from './player/interact';
import { PlayerBody } from './player/body';
import { Combat } from './combat/combat';
import { Weather } from './render/weather';
import { Particles } from './render/particles';
import { Audio } from './core/audio';
import { Hud, UI } from './ui/ui';
import { Residents, Law } from './npc/npc';
import { Economy } from './world/economy';
import { War } from './war/war';
import { Cart } from './vehicles/cart';
import { Ship } from './vehicles/ship';
import { mulberry32 } from './core/noise';
import type { Placed } from './world/towns';
import { VERSION } from './version';
import { frameStamp, flushBoneAtlas } from './creature/rig';
import { Music } from './core/music';
import { Talk } from './npc/talk';
import { Naval } from './war/naval';
import { Destruction } from './war/destruct';
import { ClothSystem } from './render/cloth';

export type Progress = (f: number, msg: string) => void;

class Events {
  private h = new Map<string, ((a: unknown) => void)[]>();
  on(e: string, fn: (a: unknown) => void) { (this.h.get(e) ?? this.h.set(e, []).get(e)!).push(fn); }
  emit(e: string, a?: unknown) { for (const f of this.h.get(e) ?? []) f(a); }
}

/** Wanted posters nailed up at gates and plazas while you have a bounty in that kingdom. */
class WantedPosters {
  group = new THREE.Group();
  constructor(public game: Game) { game.scene.add(this.group); }
  update(law: Law) {
    this.group.clear();
    for (const plan of this.game.towns.plans) {
      if (plan.minor) continue;
      const k = plan.site.kingdom;
      const b = law.bountyIn(k);
      if (b <= 0) continue;
      const c = document.createElement('canvas'); c.width = 256; c.height = 360;
      const g = c.getContext('2d')!;
      g.fillStyle = '#d8c8a0'; g.fillRect(0, 0, 256, 360);
      g.fillStyle = 'rgba(80,60,30,0.25)'; for (let i = 0; i < 60; i++) g.fillRect(Math.random() * 256, Math.random() * 360, 20, 2);
      g.fillStyle = '#2a1a0a'; g.font = 'bold 44px serif'; g.textAlign = 'center'; g.fillText('WANTED', 128, 56);
      g.strokeStyle = '#2a1a0a'; g.lineWidth = 3; g.strokeRect(58, 80, 140, 160);
      g.beginPath(); g.arc(128, 145, 38, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(80, 240); g.quadraticCurveTo(128, 180, 176, 240); g.stroke();
      g.font = '22px serif'; g.fillText('for crimes against', 128, 275); g.fillText(k === 'ironreach' ? 'the Iron Throne' : 'the Crown', 128, 300);
      g.font = 'bold 28px serif'; g.fillText(`${b} PENNIES`, 128, 340);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
      this.game.lighting.prep(mat);
      const spots: THREE.Vector3[] = [new THREE.Vector3(plan.plaza.x + 3, 0, plan.plaza.z - 2)];
      for (const s of spots) {
        s.y = this.game.world.heightAt(s.x, s.z);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 }));
        post.position.copy(s).setY(s.y + 1.1);
        const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), mat);
        poster.position.copy(s).add(new THREE.Vector3(0, 1.6, 0.07));
        this.group.add(post, poster);
      }
    }
  }
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = Object.assign(new THREE.Scene(), { matrixWorldAutoUpdate: false });
  camera: THREE.PerspectiveCamera;
  world = new World();
  q: Quality;
  pipeline!: Pipeline;
  sky!: Sky;
  lighting!: Lighting;
  terrain!: Terrain;
  grass!: Grass;
  trees!: Trees;
  water!: Water;
  clock = new THREE.Clock();
  time = 0;
  hours = 9.5;
  dayCount = 0;
  daySpeed = 24 / (48 * 60);
  overcast = 0.0;
  ready = false;
  paused = false;
  manual = false;
  physics = new Physics();
  input: Input;
  player!: Player;
  creatures!: CreatureLib;
  fauna!: Fauna;
  towns!: Towns;
  settlements!: Settlements;
  props!: PropManager;
  lightPool!: LightPool;
  ctx!: GameCtx;
  interaction!: Interaction;
  playerBody!: PlayerBody;
  combat!: Combat;
  weather!: Weather;
  particles!: Particles;
  audio = new Audio();
  hud!: Hud;
  ui!: UI;
  residents!: Residents;
  law!: Law;
  economy!: Economy;
  war!: War;
  events = new Events();
  wantedPosters!: WantedPosters;
  carts: Cart[] = [];
  ships: Ship[] = [];
  campfires: THREE.Vector3[] = [];
  freeCam = false;
  treeColliders = new Map<number, unknown>();
  frameMs = 16;
  music = new Music();
  talk = new Talk(this);
  naval = new Naval(this);
  destruct = new Destruction(this);
  private clothDt = 0;
  cloth!: ClothSystem;
  get clothOn() { return settings.cloth; }
  setCloth(on: boolean) { settings.cloth = on; saveSettings(); this.cloth?.setEnabled(on); }
  avgFrame = 16;
  frameNo = 0;
  shake = 0;
  sleepingIn: { node: FurnitureNode; building: Placed | null; owner: string | null } | null = null;
  sleepUntil = -1;
  rentedRoom: string | null = null;
  deathCause = '';
  version = VERSION;
  started = false;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: new URLSearchParams(location.search).has('test') });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const params = new URLSearchParams(location.search);
    const forced = params.get('quality') as Quality['name'] | null;
    if (forced && QUALITY[forced]) settings.quality = forced;
    else if (!localStorage.getItem('shattered-crown.settings.v1')) settings.quality = guessQuality(this.renderer.getContext() as WebGL2RenderingContext);
    this.q = QUALITY[settings.quality];
    this.camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.15, 30000);
    this.input = new Input(canvas);
  }

  get mount(): Animal | null { const s = this.player?.seat as unknown as Animal | null; return s && (s as Animal).species ? s : null; }

  async init(progress: Progress) {
    progress(0.02, 'Unfurling the map');
    await this.world.generate(progress);
    progress(0.76, 'Founding towns and castles');
    this.towns = new Towns(this.world);
    this.towns.plan();
    this.world.finalize();
    progress(0.78, 'Mixing pigments');
    this.lighting = new Lighting(this.scene, this.camera, this.q);
    setMaterialPrep((m) => this.lighting.prep(m));
    setModelPrep((o) => this.lighting.prepObject(o));
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.q);
    this.sky = new Sky(this.renderer);
    this.scene.add(this.sky.mesh);
    this.terrain = new Terrain(this.world, this.q, this.lighting);
    await this.terrain.loadTextures(this.q.name === 'low' ? 512 : 1024);
    this.scene.add(this.terrain.mesh);
    this.grass = new Grass(this.q, this.lighting);
    for (const m of this.grass.meshes) this.scene.add(m);
    progress(0.84, 'Planting the forests');
    await tick();
    this.trees = new Trees(this.world, this.q, this.lighting, this.renderer);
    this.trees.orchards = this.towns.plans.flatMap((p) => p.orchards);
    this.trees.build();
    this.scene.add(this.trees.group);
    this.water = new Water(this.q);
    this.scene.add(this.water.ocean, this.water.river);
    this.particles = new Particles(this.scene);
    progress(0.88, 'Breeding livestock and raising families');
    this.creatures = new CreatureLib(this.lighting);
    await this.creatures.build();
    progress(0.92, 'Setting the laws of nature');
    await this.physics.init(this.world);
    this.props = new PropManager(this.physics, this.scene, (x, z) => this.groundAt(x, z));
    this.props.prep = (o) => this.lighting.prepObject(o);
    this.props.onImpact = (p, speed, at) => { if (p.def.id === 'powder' && speed > 9) this.destruct.detonate(p); this.impactSound(p, speed, at); };
    this.impactSound = (p, speed, at) => this.audio.play(p.def.breakable ? 'impact:ceramic' : p.def.kind === 'weapon' || p.def.id.includes('metal') ? 'impact:metal' : p.def.mass < 0.6 ? 'impact:soft' : 'impact:wood', at, Math.min(1, speed / 6));
    this.props.waterAt = (x, z) => { const wl = this.world.waterLevelAt(x, z); if (wl !== 0) return wl + riverChop(x, z, this.time, waterUniforms.uWaveAmp.value); return this.world.heightAt(x, z) < 0.5 ? seaHeight(x, z, this.time, waterUniforms.uWaveAmp.value) : -Infinity; };
    this.props.currentAt = (x, z) => this.world.currentAt(x, z);
    this.props.dryAt = (p) => this.ships.some((sh) => sh.contains(p));
    this.props.onSplash = (_p, at, sp) => { this.particles.emit('splash', at, Math.min(14, 3 + Math.round(sp * 2))); this.audio.play('splash', at, Math.min(1, 0.2 + sp * 0.12)); };
    this.props.onBreak = (_p, at) => { this.audio.play('shatter', at, 1); this.particles.emit('dust', at, 6); };
    progress(0.94, 'Carving furniture');
    await this.props.preloadAll();
    this.settlements = new Settlements(this.world, this.physics, this.scene, this.props, this.towns);
    this.cloth = new ClothSystem(this.scene, (x, z) => this.world.heightAt(x, z));
    this.cloth.setEnabled(settings.cloth);
    this.settlements.buildStatic();
    this.destruct.adopt(this.settlements.wallSections);
    // the kingdoms' banners stream from the towers
    for (const f of this.settlements.flags) {
      const pole = new THREE.Object3D();
      pole.position.copy(f.pos);
      pole.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(pole); pole.updateMatrixWorld(true);
      const iron = f.style === 'dark';
      this.cloth.banner(pole, 2.2, 1.4, iron ? 0x7a1612 : 0x22407a, pole);
    }
    this.lightPool = new LightPool(this.scene, this.q.name === 'low' ? 4 : 8);
    this.props.insideAt = (p) => !!this.settlements.inside(p);
    this.props.coldAt = (p) => { const l = this.settlements.inside(p); return !!l && p.y < l.root.position.y + 0.3; };
    this.player = new Player(this.physics, this.world, this.input);
    this.player.dryAt = (p) => this.ships.some((sh) => sh.contains(p));
    this.player.clock = () => this.time;
    const start = siteById('aurelhold');
    this.player.spawn(start.x + 8, start.z + 10, Math.PI);
    this.ctx = {
      physics: this.physics, world: this.world, input: this.input, player: this.player, creatures: this.creatures, scene: this.scene,
      groundAt: (x, z, fromY) => this.groundAt(x, z, fromY), hours: () => this.hours, sound: (n, p, v) => this.audio.play(n, p, v),
    };
    this.fauna = new Fauna(this.ctx, this.towns);
    this.interaction = new Interaction(this);
    this.playerBody = new PlayerBody(this);
    this.combat = new Combat(this);
    this.weather = new Weather(this);
    setSeaFloor((x, z) => this.world.heightAt(x, z));
    this.music.moodHint = () => {
      const p = this.player.pos, h = this.hours, w = this.weather.cur;
      if (this.battleNear) return 'battle';
      const inside = this.settlements.inside(p);
      if (inside) {
        const t = inside.placed.spec.type;
        if (t === 'tavern') return 'tavern';
        if (t === 'chapel' || t === 'hall') return 'hall';
      }
      if (w.rain > 0.3 || w.snow > 0.4) return 'rain';
      if (h < 5.5 || h > 20.5) return 'night';
      if (h > 18 || h < 7) return 'dusk';
      if (this.world.heightAt(p.x, p.z) > 110 || this.world.eastAt(p.x, p.z) > 0.6) return 'mountain';
      if (this.world.waterLevelAt(p.x, p.z) > this.world.heightAt(p.x, p.z) || Math.hypot(p.x, p.z) > 2700) return 'sea';
      const site = nearestSite(p.x, p.z);
      if (site.d < site.site.r && site.site.kind !== 'castle') return 'town';
      return 'day';
    };
    this.hud = new Hud(this);
    this.ui = new UI(this);
    this.law = new Law(this);
    this.residents = new Residents(this);
    this.residents.cap = { low: 30, medium: 55, high: 80, ultra: 100 }[this.q.name];
    this.economy = new Economy(this);
    this.war = new War(this);
    this.wantedPosters = new WantedPosters(this);
    progress(0.96, 'Rigging the ships');
    this.war.build();
    this.spawnVehicles();
    this.player.footstep = (surface, s) => {
      this.audio.play('step:' + surface, this.player.pos, 0.35 * s + 0.15);
      if (surface === 'water') this.particles.emit('splash', this.player.pos.clone().setY(this.player.waterY), 6);
      if (surface === 'mud' && s > 0.5) this.particles.emit('mud', this.player.pos.clone().setY(this.player.pos.y + 0.05), 4);
    };
    this.player.onHurt = (limb, dmg) => { if (dmg > 2) this.hud.flashHurt(limb); };
    this.player.onDeath = () => { this.deathCause = 'Your wounds were too much.'; setTimeout(() => this.ui.showDeath(), 1800); };
    this.physics.onStep((dt) => {
      this.player.step(dt);
      this.interaction.stepHeld(dt);
      this.combat.step(dt);
      for (const c of this.carts) c.step(dt);
      for (const s of this.ships) s.step(dt);
    });
    this.physics.onPostStep((dt) => this.props.step(dt, dt * this.daySpeed));
    this.physics.onPostStep(() => this.syncTreeColliders());
    for (const p of this.towns.plans) for (const b of p.buildings) {
      // chimney smoke from every lived-in home with a hearth (estimated position; refined when built)
      if (b.household && !['stable', 'barn', 'warehouse', 'chapel'].includes(b.spec.type)) {
        const m = this.settlements.model(b);
        for (const c of m.chimneys) {
          const wp = c.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw).add(new THREE.Vector3(b.x, b.y, b.z));
          this.particles.emitters.push({ pos: wp, kind: 'chimney', acc: Math.random() });
        }
      }
    }
    for (const t of this.settlements.torches) this.particles.emitters.push({ pos: t, kind: 'torch', acc: 0 });
    progress(0.99, 'Lighting the hearths');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (new URLSearchParams(location.search).has('test')) this.weather.set('clear', true); else this.weather.randomize();
    this.ready = true;
    progress(1, 'Ready');
  }

  /** Wagons at stables and farms, ships at the ports, rowing boats at landings. */
  private spawnVehicles() {
    const r = mulberry32(4242);
    for (const plan of this.towns.plans) {
      if (plan.minor) continue;
      const st = plan.buildings.filter((b) => b.spec.type === 'stable' || b.spec.type === 'barn').slice(0, 2);
      for (const b of st) {
        const p = this.settlements.towns && new THREE.Vector3(b.x + Math.sin(b.yaw) * (b.spec.d / 2 + 5) + Math.cos(b.yaw) * 3, 0, b.z + Math.cos(b.yaw) * (b.spec.d / 2 + 5) - Math.sin(b.yaw) * 3);
        p.y = this.world.heightAt(p.x, p.z);
        const cart = new Cart(this, p, b.yaw + Math.PI / 2, Math.floor(r() * 10));
        cart.owner = b.id;
        this.carts.push(cart);
        // load some carts with goods
        if (r() < 0.6) for (let i = 0; i < 3; i++) {
          const it = this.props.spawn(['crate', 'sack', 'barrel', 'basket'][Math.floor(r() * 4)], p.clone().add(new THREE.Vector3((r() - 0.5) * 0.6, 1.5 + i * 0.6, (r() - 0.5) * 1.6)), undefined, { owner: b.id });
          void it;
        }
      }
      for (const d of plan.docks) {
        if (d.len > 30) {
          // a brigantine moored off the dock, a frigate in the roads, and (Saltmarsh) the fleet's flagship
          const off = new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw));
          const side = new THREE.Vector3(off.z, 0, -off.x);
          const yaw = Math.atan2(-off.z, off.x);
          const isles = plan.site.kingdom === 'isles';
          const moor = (cls: 'brigantine' | 'frigate' | 'manowar', along: number, across: number, name: string) => {
            const L = { brigantine: 26, frigate: 44, manowar: 58 }[cls], dr = { brigantine: 2.9, frigate: 4.6, manowar: 6.8 }[cls];
            let sp = this.deepWater(new THREE.Vector3(d.x, 0, d.z).addScaledVector(off, along).addScaledVector(side, across), off, yaw, L / 2 + 2, dr + 1.5);
            // keep clear of ships already at anchor
            for (let k = 0; k < 12 && this.ships.some((o) => o.kind === 'ship' && o.pos.distanceTo(new THREE.Vector3(sp.x, o.pos.y, sp.z)) < (o.length + L) / 2 + 10); k++) sp = this.deepWater(sp.clone().addScaledVector(side, Math.sign(across || 1) * 35), off, yaw, L / 2 + 2, dr + 1.5);
            const sh = new Ship(this, sp, yaw, cls, name);
            sh.side = isles ? null : 'vanguardia';
            this.ships.push(sh);
          };
          moor('brigantine', d.len / 2 - 6, 11, isles ? 'The Gull' : 'The Wheat Maiden');
          moor('frigate', d.len / 2 + 60, -30, isles ? 'Wavecutter' : 'Resolute');
          if (!isles) moor('manowar', d.len / 2 + 160, 40, 'Sovereign of Vanguardia');
        }
        const bp = new THREE.Vector3(d.x, 0, d.z).add(new THREE.Vector3(Math.cos(d.yaw) * 3.5, 0, -Math.sin(d.yaw) * 3.5));
        this.ships.push(new Ship(this, bp, d.yaw, 'boat', 'Rowing boat'));
      }
    }
    // the Ironreach squadron rides at anchor off the eastern coast
    {
      const a = 0.25, base = new THREE.Vector3(Math.cos(a) * 2600, 0, Math.sin(a) * 2600), out = base.clone().normalize();
      const yaw = Math.atan2(-out.z, out.x) + Math.PI / 2;
      for (const [cls, k, name] of [['manowar', 0, 'Iron Wrath'], ['frigate', 1, 'Blackcrag'], ['brigantine', 2, 'The Raven']] as const) {
        const L = { brigantine: 26, frigate: 44, manowar: 58 }[cls], dr = { brigantine: 2.9, frigate: 4.6, manowar: 6.8 }[cls];
        const p0 = base.clone().add(new THREE.Vector3(-out.z, 0, out.x).multiplyScalar((k - 1) * 90));
        const sh = new Ship(this, this.deepWater(p0, out, yaw, L / 2 + 2, dr + 1.5), yaw, cls, name);
        sh.side = 'ironreach';
        this.ships.push(sh);
      }
    }
    // a boat at each bridge camp too
    for (const b of this.world.bridges) {
      const z = b.z + 60, x = riverX(z) - riverWidth(z) * 0.3;
      this.ships.push(new Ship(this, new THREE.Vector3(x, 0, z), 0, 'boat', 'Skiff'));
    }
  }

  /** Move a mooring point out along `dir` until the whole hull (half-length along its yaw) floats in `depth` m of water. */
  deepWater(p: THREE.Vector3, dir: THREE.Vector3, yaw: number, halfLen: number, depth: number) {
    const ax = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw), sd = new THREE.Vector3(-ax.z, 0, ax.x);
    const q = p.clone();
    for (let k = 0; k < 500; k++) {
      let ok = true;
      for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, 1]) {
        const x = q.x + ax.x * u * halfLen + sd.x * v * Math.max(3, halfLen * 0.25), z = q.z + ax.z * u * halfLen + sd.z * v * Math.max(3, halfLen * 0.25);
        if (this.world.waterLevelAt(x, z) - this.world.heightAt(x, z) < depth) { ok = false; break; }
      }
      if (ok) return q;
      q.addScaledVector(dir, 2);
    }
    return q;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(innerWidth, innerHeight);
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.manual || !this.ready) return;
      const dt = Math.min(0.1, this.clock.getDelta());
      this.avgFrame += (dt * 1000 - this.avgFrame) * 0.05;
      this.step(dt);
      this.renderFrame();
    };
    loop();
  }

  /** per-subsystem CPU time (ms, smoothed) for the perf overlay and QA */
  prof: Record<string, number> = {};
  private markT = 0;
  mark(name: string) { const t = performance.now(); this.prof[name] = (this.prof[name] ?? 0) * 0.9 + (t - this.markT) * 0.1; this.markT = t; }
  step(dt: number) {
    if (this.paused) { this.input.beginFrame(); this.input.endFrame(); return; }
    this.input.beginFrame();
    this.markT = performance.now();
    // sleeping: time flies until morning (or until someone finds you in their bed)
    let simDt = dt;
    if (this.sleepUntil >= 0) {
      const speed = 900;
      const before = this.hours;
      this.hours = (this.hours + dt * this.daySpeed * speed) % 24;
      if (this.hours < before) this.dayCount++;
      this.weather.update(dt * 20);
      this.interaction.pack.age(dt * this.daySpeed * speed);
      this.player.satiety = Math.max(5, this.player.satiety - dt * 0.4);
      this.player.heal(dt * 2);
      if (Math.abs(((this.hours - this.sleepUntil) + 24) % 24) < 0.25) this.wakeUp();
      simDt = dt;
    } else {
      const before = this.hours;
      this.hours = (this.hours + dt * this.daySpeed) % 24;
      if (this.hours < before) this.dayCount++;
      this.interaction.pack.age(dt * this.daySpeed);
    }
    this.time += simDt;
    if (!this.freeCam) this.player.look(dt);
    this.props.activators[0] = this.player.pos;
    this.props.updateActivity(dt);
    // creatures are kinematic characters: their AI and controllers run once per frame (the fixed physics
    // substeps below then carry them to their new poses); only dynamic bodies need the fixed-rate loop
    const aiDt = Math.min(simDt, 0.1);
    this.fauna.step(aiDt);
    this.residents.step(aiDt);
    this.talk.update(aiDt);
    this.naval.update(aiDt);
    this.destruct.update(aiDt);
    this.war.step(aiDt);
    this.mark('ai');
    this.physics.update(simDt);
    this.mark('physics');
    this.weather.update(dt);
    this.fauna.updateBubble(settings.simRadius);
    this.residents.update(settings.simRadius);
    this.mark('bubble');
    this.law.update(dt);
    this.economy.update();
    this.war.update(dt);
    this.mark('war');
    this.settlements.people = [this.player.pos, ...this.residents.live.map((n) => n.st.pos)];
    this.settlements.update(this.freeCam ? this.camera.position : this.player.pos, 2);
    this.settlements.update2(dt, dt * this.daySpeed * (this.sleepUntil >= 0 ? 900 : 1), this.time, this.camera.position);
    this.mark('settlements');
    this.fauna.animate(dt);
    this.residents.animate(dt);
    this.war.animate(dt);
    this.mark('animate');
    for (const c of this.carts) c.sync();
    for (const s of this.ships) s.sync(dt);
    this.mark('vehicles');
    this.interaction.update(dt);
    this.combat.update(dt);
    this.mark('interact');
    if (!this.freeCam) this.player.updateCamera(this.camera, dt);
    this.playerBody.update(dt);
    this.particles.update(dt, this.camera.position);
    this.ambience(dt);
    this.updateMusic(dt);
    this.clothDt += dt;
    this.mark('fx');
    if (this.input.hit('KeyB') && false) void 0;
    this.input.endFrame();
  }

  battleNear = false;
  impactSound: (p: import('./props/props').Prop, speed: number, at: THREE.Vector3) => void = () => {};
  private updateMusic(dt: number) {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    this.music.attach(ctx, this.audio.master);
    const p = this.player.pos;
    // fights duck the music; it keeps quiet while blades are out nearby
    const fight = this.residents.live.some((n) => n.hostile && n.st.pos.distanceToSquared(p) < 900) || this.war.soldiers.some((s) => s.alive && s.fightTarget && s.st.pos.distanceToSquared(p) < 600);
    this.battleNear = this.war.soldiers.some((s) => s.alive && s.fightTarget && s.st.pos.distanceToSquared(p) < 300 * 300);
    this.music.duck += ((fight ? 1 : 0) - this.music.duck) * Math.min(1, dt * 0.5);
    this.music.update(dt);
  }

  startSleep(hours: number) {
    this.sleepUntil = (this.hours + hours) % 24;
    this.pipeline.finalUniforms.uFade.value = 0.85;
  }
  wakeUp() {
    if (this.sleepUntil < 0) return;
    this.sleepUntil = -1;
    this.pipeline.finalUniforms.uFade.value = 0;
    this.hud.toast(`You wake. It is ${Math.floor(this.hours)}:${String(Math.floor((this.hours % 1) * 60)).padStart(2, '0')}.`);
    if (this.player.seat && this.sleepingIn) this.player.standUp();
  }

  /** A new animal that persists with the player's world (bought, spawned). */
  spawnAnimal(species: 'horse' | 'donkey' | 'cow' | 'pig', at: THREE.Vector3) {
    at.y = this.groundAt(at.x, at.z, at.y + 2);
    const a = new Animal(species, this.ctx, at, at.clone(), 10, Math.floor(Math.random() * 1e9));
    this.fauna.extra.push(a);
    return a;
  }

  /** Travel to another town's stable yard (hired horse and guide, or a boat): time passes, you arrive at the
   *  outskirts by the stables. A horse you are riding or leading comes with you. */
  fastTravel(plan: { site: { name: string; x: number; z: number }; stableYard?: { arrive: [number, number] }; plaza: { x: number; z: number } }, hours: number) {
    const [x, z] = plan.stableYard?.arrive ?? [plan.plaza.x + 6, plan.plaza.z + 6];
    const mount = this.mount;
    if (this.player.seat) this.player.standUp();
    this.pipeline.finalUniforms.uFade.value = 1;
    const before = this.hours;
    this.hours = (this.hours + hours) % 24;
    if (this.hours < before) this.dayCount++;
    this.interaction.pack.age(hours * 3600);
    this.player.satiety = Math.max(0, this.player.satiety - hours * 3);
    this.player.spawn(x, z);
    this.residents.update(settings.simRadius);
    this.settlements.update(this.player.pos, 6);
    if (mount && mount.mode !== 'dead') { mount.teleport(new THREE.Vector3(x + 2.5, this.groundAt(x + 2.5, z), z + 1.5)); this.physics.world.propagateModifiedBodyPositionsToColliders(); mount.mount(this.player); }
    this.lighting.forceShadows = true;
    setTimeout(() => { this.pipeline.finalUniforms.uFade.value = 0; }, 900);
    this.hud.toast(`After ${hours < 1 ? Math.round(hours * 60) + ' minutes' : hours.toFixed(1) + ' hours'} on the road you reach ${plan.site.name}.`);
  }

  respawn() {
    const s = nearestSite(this.player.pos.x, this.player.pos.z).site;
    const p = this.settlements.towns.plans.find((pl) => pl.site.id === s.id)!;
    this.player.mode = 'walk';
    for (const l of Object.keys(this.player.health)) (this.player.health as Record<string, number>)[l] = 60;
    this.player.bleeding = 0; this.player.satiety = 50; this.player.stamina = 60;
    this.player.spawn(p.plaza.x + 6, p.plaza.z + 6);
    this.interaction.money = Math.floor(this.interaction.money * 0.5);
    this.hud.toast('You come to in the town square, lighter of purse.');
  }

  /** Height of whatever walkable surface is under (x,z): terrain, bridges, floors, decks. */
  groundAt(x: number, z: number, fromY?: number): number {
    const h = this.world.heightAt(x, z);
    const top = fromY === undefined ? h + 60 : fromY + 0.6;
    if (top <= h) return h;
    const hit = this.physics.ray(new THREE.Vector3(x, top, z), new THREE.Vector3(0, -1, 0), top - h + 0.05, groups(G_STATIC | G_VEHICLE, G_STATIC | G_VEHICLE), this.physics.terrainCollider);
    return hit ? Math.max(h, hit.point.y) : h;
  }

  private lastTreeSync = new THREE.Vector3(1e9, 0, 0);
  private syncTreeColliders() {
    const p = this.player.pos;
    if (p.distanceTo(this.lastTreeSync) < 8) return;
    this.lastTreeSync.copy(p);
    const keep = new Set<number>();
    this.trees.forEachNear(p.x, p.z, 60, (i, x, y, z, s, sp) => {
      if (sp === 'bush' || s <= 0) return;
      keep.add(i);
      if (!this.treeColliders.has(i)) {
        const r = (sp === 'oak' ? 0.5 : sp === 'birch' ? 0.2 : 0.32) * s;
        const c = this.physics.fixedCylinder(new THREE.Vector3(x, y + 3, z), 3.5, r, { kind: 'tree', index: i });
        this.treeColliders.set(i, c);
      }
    });
    for (const [i, c] of this.treeColliders) if (!keep.has(i)) { this.physics.remove(c as never); this.treeColliders.delete(i); }
  }
  /** Fell a tree with an axe: it drops as firewood logs. */
  private chops = new Map<number, number>();
  chopTree(i: number, at: THREE.Vector3) {
    const n = (this.chops.get(i) ?? 0) + 1;
    this.chops.set(i, n);
    this.audio.play('impact:wood', at, 1);
    this.particles.emit('dust', at, 4);
    if (n >= 6) {
      const [x, y, z] = [this.trees.data[i * 6], this.trees.data[i * 6 + 1], this.trees.data[i * 6 + 2]];
      this.trees.remove(i);
      const c = this.treeColliders.get(i); if (c) { this.physics.remove(c as never); this.treeColliders.delete(i); }
      for (let k = 0; k < 5; k++) this.props.spawn('wood_log', new THREE.Vector3(x + (Math.random() - 0.5) * 2, y + 0.5 + k * 0.3, z + (Math.random() - 0.5) * 2));
      this.audio.play('impact:wood', at, 1.5);
      this.hud.toast('Timber!');
    }
  }
  blood(at: THREE.Vector3, n: number) { this.particles.emit('blood', at, n); }
  sound(name: string, pos: THREE.Vector3 | null, vol = 1) { this.audio.play(name, pos, vol); }

  private ambT = 0;
  private ambience(dt: number) {
    const p = this.camera.position;
    this.audio.setListener(this.camera);
    this.ambT -= dt;
    const day = this.lighting.dayFactor;
    const riverD = Math.abs(p.x - riverX(p.z)) - riverWidth(p.z) / 2;
    const h = this.world.heightAt(p.x, p.z);
    const inside = !!this.settlements.inside(p);
    let fire = 0;
    for (const c of this.campfires) fire = Math.max(fire, 1 - c.distanceTo(p) / 15);
    for (const l of this.settlements.live.values()) for (const f of l.fires) fire = Math.max(fire, 1 - f.clone().applyMatrix4(l.root.matrixWorld).distanceTo(p) / 8);
    const coast = h < 6 && Math.hypot(p.x, p.z) > 2200 ? 1 - h / 6 : 0;
    this.audio.ambience({
      wind: (inside ? 0.25 : 0.6) * (0.4 + this.weather.cur.wind * 0.5 + Math.max(0, p.y - 80) / 300),
      river: Math.max(0, 1 - riverD / 80) * (inside ? 0.3 : 1),
      surf: coast * (inside ? 0.3 : 1),
      rain: this.weather.cur.rain * (inside ? 0.45 : 1),
      fire: Math.max(0, fire),
      crowd: 0,
    }, this.weather.cur.wind);
    if (this.ambT <= 0) {
      this.ambT = 0.6 + Math.random() * 2.5;
      const near = new THREE.Vector3(p.x + (Math.random() - 0.5) * 30, p.y + 3, p.z + (Math.random() - 0.5) * 30);
      if (day > 0.5 && !inside && this.weather.cur.rain < 0.3 && this.world.forestAt(p.x, p.z) + 0.3 > Math.random()) this.audio.play('chirp', near, 0.5);
      else if (day < 0.3 && !inside && this.weather.cur.rain < 0.3) this.audio.play('cricket', near, 0.4);
      const a = this.fauna.all()[Math.floor(Math.random() * Math.max(1, this.fauna.all().length))];
      if (a && Math.random() < 0.15 && a.st.pos.distanceTo(p) < 50) this.audio.play(a.species === 'cow' ? 'moo' : a.species === 'pig' ? 'oink' : a.species === 'horse' || a.species === 'donkey' ? 'neigh' : 'chirp', a.st.pos, 0.6);
    }
  }

  renderFrame() {
    const t0 = performance.now();
    this.markT = t0;
    frameStamp.n++;
    sharedUniforms.uTime.value = this.time;
    skyUniforms.uTime.value = this.time;
    this.lighting.setTime(this.hours, this.overcast);
    if (this.shake > 0.001) { this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.15, (Math.random() - 0.5) * this.shake * 0.15, 0)); this.shake *= 0.9; }
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera);
    const env = this.sky.updateEnv();
    if (env) this.scene.environment = env;
    this.terrain.update(this.camera.position);
    this.grass.update(this.camera.position);
    this.grass.setInteractors(this.interactors());
    this.trees.update(this.camera.position, false, this.camera);
    this.water.update(this.camera);
    this.mark('r:world');
    sunDirRef.copy(this.lighting.sunDir);
    this.lighting.update(this.camera);
    this.settlements.update2(0, 0, this.time, this.camera.position);
    const night = 1 - this.lighting.dayFactor;
    const lights = this.settlements.lights(this.camera.position, night);
    for (const c of this.campfires) lights.push({ pos: c, intensity: 16, range: 14, color: new THREE.Color(1, 0.55, 0.25) });
    // the sea is not drawn inside the nearest hulls
    {
      const near = this.ships.filter((sh) => sh.plan).sort((a, b) => a.root.position.distanceToSquared(this.camera.position) - b.root.position.distanceToSquared(this.camera.position)).slice(0, 4);
      const wu = waterUniforms;
      for (let i = 0; i < 4; i++) {
        const sh = near[i];
        if (!sh || sh.root.position.distanceTo(this.camera.position) > 600) { wu.uHullDim.value[i].w = 0; continue; }
        sh.root.updateMatrixWorld();
        wu.uHullInv.value[i].copy(sh.root.matrixWorld).invert();
        wu.uHullDim.value[i].set(sh.length / 2, sh.beam / 2, sh.plan!.deckY + 0.3, 1);
      }
    }
    // ships' lanterns: on the stern at night, and always below decks where no daylight reaches
    for (const sh of this.ships) {
      if (!sh.lamps.length || sh.root.position.distanceToSquared(this.camera.position) > 140 * 140) continue;
      for (const lp of sh.lamps) { const w = lp.clone().applyMatrix4(sh.root.matrixWorld); if (w.y < sh.root.position.y + sh.deckY + 0.5 || night > 0.3) lights.push({ pos: w, intensity: 7, range: 9, color: new THREE.Color(1, 0.62, 0.3) }); }
    }
    this.lightPool.assign(lights, this.camera.position, this.time);
    // hearth flames in nearby homes
    if (this.frameNo % 3 === 0) for (const l of this.settlements.live.values()) {
      if (l.root.position.distanceTo(this.camera.position) > 40) continue;
      for (const f of l.fires) this.particles.emit('fire', f.clone().applyMatrix4(l.root.matrixWorld), 1);
    }
    this.lighting.interior = !!this.settlements.inside(this.camera.position);
    if (this.frameNo++ % 30 === 0) this.props.updateLooks();
    if (this.frameNo % 10 === 0 || this.freeCam) { this.props.cull(this.camera.position); this.shadowLod(); }
    const au = this.pipeline.atmoUniforms;
    this.mark('r:prep');
    au.uUnderwater.value = this.player && this.player.underwater && !this.freeCam ? 1 : 0;
    au.uWaterY.value = this.player?.waterY ?? 0;
    const fu = this.pipeline.finalUniforms;
    fu.uExposure.value = this.lighting.exposure * (1 + (this.lighting.flash ?? 0) * 3);
    fu.uHurt.value = this.player ? THREE.MathUtils.clamp(1 - this.player.totalHealth / 70, 0, 1) : 0;
    fu.uWetLens.value = this.weather && !this.lighting.interior ? this.weather.cur.rain : 0;
    // one scene-graph update per frame (the opaque and water passes would each redo it), then skin once
    this.scene.updateMatrixWorld();
    this.mark('r:graph');
    // cloth follows this frame's bones, then its own meshes get their world matrices
    this.cloth.update(Math.min(this.clothDt, 0.1), this.camera.position, this.time);
    this.clothDt = 0;
    this.mark('r:cloth');
    flushBoneAtlas(this.renderer);
    this.pipeline.render();
    this.mark('r:submit');
    this.hud?.update();
    this.frameMs = performance.now() - t0;
  }

  /** Screen-size shadow culling for vehicles: a cart's shadow is a few pixels beyond ~180 m, a ship's beyond ~500 m. */
  private shadowLod() {
    const cam = this.camera.position;
    const set = (root: THREE.Object3D, r: number) => {
      const cast = root.position.distanceTo(cam) < r * 60;
      if (root.userData.cast === cast) return;
      root.userData.cast = cast;
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.noShadow) m.castShadow = cast; });
    };
    for (const c of this.carts) set(c.root, 3);
    for (const s of this.ships) set(s.root, s.kind === 'ship' ? s.length * 0.35 : 3);
  }

  /** Feet, hooves and wheels that push the grass aside. */
  private interactors(): THREE.Vector4[] {
    const out: THREE.Vector4[] = [];
    const p = this.player.pos;
    out.push(new THREE.Vector4(p.x, p.y, p.z, 0.55));
    for (const a of this.fauna.all()) if (a.st.pos.distanceToSquared(p) < 3600 && out.length < 16) out.push(new THREE.Vector4(a.st.pos.x, a.st.pos.y, a.st.pos.z, a.spec.radius * 2.2));
    for (const n of this.residents.live) if (n.st.pos.distanceToSquared(p) < 2500 && out.length < 20) out.push(new THREE.Vector4(n.st.pos.x, n.st.pos.y, n.st.pos.z, 0.45));
    for (const c of this.carts) if (c.pos.distanceToSquared(p) < 3600 && out.length < 24) out.push(new THREE.Vector4(c.pos.x, c.pos.y - 0.8, c.pos.z, 1.8));
    return out;
  }

  /** Top-down map image (cached). */
  private mapCache: string | null = null;
  mapImage(size = 768) {
    if (this.mapCache) return this.mapCache;
    const w = this.world, c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d')!, img = g.createImageData(size, size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const x = -HALF + (i + 0.5) / size * HALF * 2, z = -HALF + (j + 0.5) / size * HALF * 2;
      const h = w.heightAt(x, z), n = w.normalAt(x, z);
      const shade = Math.max(0, n.x * -0.5 + n.y * 0.7 + n.z * -0.5);
      let r: number, gg: number, b: number;
      if (h < w.waterLevelAt(x, z)) { r = 120; gg = 140; b = 150; }
      else if (h < 3) { r = 215; gg = 200; b = 160; }
      else if (h > 320) { r = 235; gg = 232; b = 225; }
      else { r = 190 - h * 0.1; gg = 180 - h * 0.12; b = 140 - h * 0.1; }
      if (w.forestAt(x, z) > 0.5) { r *= 0.75; gg *= 0.85; b *= 0.7; }
      if (w.roadAt(x, z) > 0.4) { r = 120; gg = 85; b = 50; }
      const k = (j * size + i) * 4;
      img.data[k] = r * (0.5 + shade * 0.6); img.data[k + 1] = gg * (0.5 + shade * 0.6); img.data[k + 2] = b * (0.5 + shade * 0.6); img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // parchment edges
    const grd = g.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(60,40,20,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    this.mapCache = c.toDataURL();
    return this.mapCache;
  }

  save() {
    const p = this.player, ia = this.interaction;
    const data = {
      v: VERSION, hours: this.hours, day: this.dayCount, pos: p.pos.toArray(), yaw: p.yaw, health: p.health, satiety: p.satiety, money: ia.money,
      pack: ia.pack.items.map((i) => ({ id: i.id, n: i.n, age: i.age })), bounty: this.law.bounty, enlisted: this.war.enlisted, weather: this.weather.kind,
    };
    try { localStorage.setItem('shattered-crown.save.v1', JSON.stringify(data)); this.hud.toast('Game saved.'); } catch { this.hud.toast('Could not save.'); }
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem('shattered-crown.save.v1') || 'null');
      if (!d) { this.hud.toast('No saved game.'); return; }
      this.hours = d.hours; this.dayCount = d.day;
      this.player.spawn(d.pos[0], d.pos[2], d.yaw);
      Object.assign(this.player.health, d.health); this.player.satiety = d.satiety;
      this.interaction.money = d.money;
      this.interaction.pack.items = [];
      for (const it of d.pack) this.interaction.pack.add(it.id, it.n, { age: it.age });
      Object.assign(this.law.bounty, d.bounty);
      this.war.enlisted = d.enlisted;
      this.weather.set(d.weather, true);
      this.hud.toast('Game loaded.');
    } catch { this.hud.toast('Save is corrupt.'); }
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
void SITES;
