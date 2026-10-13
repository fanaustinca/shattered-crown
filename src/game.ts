// Top-level game object: owns renderer, world, systems and the main loop.
import * as THREE from 'three';
import { World } from './world/world';
import { Pipeline, sharedUniforms } from './render/pipeline';
import { Sky, skyUniforms } from './render/sky';
import { Lighting } from './render/lighting';
import { Terrain } from './render/terrain';
import { Grass, sunDirRef } from './render/grass';
import { Trees } from './render/trees';
import { Water } from './render/water';
import { QUALITY, settings, guessQuality, type Quality } from './core/settings';
import { Physics } from './physics/physics';
import { Input } from './core/input';
import { Player } from './player/player';
import { siteById } from './world/layout';
import { CreatureLib } from './creature/rig';

export type Progress = (f: number, msg: string) => void;

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
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
  time = 0;            // seconds since start
  hours = 9.5;         // time of day
  daySpeed = 24 / (48 * 60); // in-game hours per real second (a 48-minute day)
  overcast = 0.0;
  ready = false;
  paused = false;
  manual = false;      // tests drive frames explicitly
  updaters: ((dt: number) => void)[] = [];
  physics = new Physics();
  input: Input;
  player!: Player;
  creatures!: CreatureLib;
  /** when true the camera is driven externally (tests, cinematics) instead of by the player */
  freeCam = false;
  treeColliders = new Map<number, unknown>();
  frameMs = 16;

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
    this.scene.matrixWorldAutoUpdate = true;
  }

  async init(progress: Progress) {
    progress(0.02, 'Unfurling the map');
    await this.world.generate(progress);
    this.world.finalize();
    progress(0.78, 'Mixing pigments');
    this.lighting = new Lighting(this.scene, this.camera, this.q);
    this.pipeline = new Pipeline(this.renderer, this.scene, this.camera, this.q);
    this.sky = new Sky(this.renderer);
    this.scene.add(this.sky.mesh);
    this.terrain = new Terrain(this.world, this.q, this.lighting);
    await this.terrain.loadTextures(this.q.name === 'low' ? 512 : 1024);
    this.scene.add(this.terrain.mesh);
    this.grass = new Grass(this.q, this.lighting);
    for (const m of this.grass.meshes) this.scene.add(m);
    progress(0.86, 'Planting the forests');
    await new Promise((r) => setTimeout(r, 0));
    this.trees = new Trees(this.world, this.q, this.lighting, this.renderer);
    this.trees.build();
    this.scene.add(this.trees.group);
    this.water = new Water(this.q);
    this.scene.add(this.water.ocean, this.water.river);
    progress(0.9, 'Breeding livestock');
    this.creatures = new CreatureLib(this.lighting);
    await this.creatures.build();
    progress(0.93, 'Setting the laws of nature');
    await this.physics.init(this.world);
    this.player = new Player(this.physics, this.world, this.input);
    const start = siteById('aurelhold');
    this.player.spawn(start.x + 330, start.z + 20, Math.PI / 2);
    this.physics.onStep((dt) => this.player.step(dt));
    this.physics.onPostStep(() => this.syncTreeColliders());
    progress(0.95, 'Lighting the hearths');
    this.resize();
    addEventListener('resize', () => this.resize());
    this.camera.position.set(-1250, 60, 650);
    this.camera.lookAt(-1250, 40, 350);
    this.ready = true;
    progress(1, 'Ready');
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
      this.step(dt);
      this.renderFrame();
    };
    loop();
  }

  step(dt: number) {
    if (this.paused) return;
    this.input.beginFrame();
    this.time += dt;
    this.hours = (this.hours + dt * this.daySpeed) % 24;
    if (!this.freeCam) this.player.look(dt);
    this.physics.update(dt);
    for (const u of this.updaters) u(dt);
    if (!this.freeCam) this.player.updateCamera(this.camera, dt);
    this.input.endFrame();
  }

  /** Trunk colliders only exist for trees near the player. */
  private lastTreeSync = new THREE.Vector3(1e9, 0, 0);
  private syncTreeColliders() {
    const p = this.player.pos;
    if (p.distanceTo(this.lastTreeSync) < 8) return;
    this.lastTreeSync.copy(p);
    const keep = new Set<number>();
    this.trees.forEachNear(p.x, p.z, 60, (i, x, y, z, s, sp) => {
      if (sp === 'bush') return;
      keep.add(i);
      if (!this.treeColliders.has(i)) {
        const r = (sp === 'oak' ? 0.5 : sp === 'birch' ? 0.2 : 0.32) * s;
        const c = this.physics.fixedCylinder(new THREE.Vector3(x, y + 3, z), 3.5, r, { kind: 'tree', index: i });
        this.treeColliders.set(i, c);
      }
    });
    for (const [i, c] of this.treeColliders) if (!keep.has(i)) { this.physics.remove(c as never); this.treeColliders.delete(i); }
  }

  renderFrame() {
    const t0 = performance.now();
    sharedUniforms.uTime.value = this.time;
    skyUniforms.uTime.value = this.time;
    this.lighting.setTime(this.hours, this.overcast);
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera);
    const env = this.sky.updateEnv();
    if (env) this.scene.environment = env;
    this.terrain.update(this.camera.position);
    this.grass.update(this.camera.position);
    this.trees.update(this.camera.position);
    this.water.update(this.camera);
    sunDirRef.copy(this.lighting.sunDir);
    this.lighting.update(this.camera);
    this.pipeline.finalUniforms.uExposure.value = this.lighting.exposure;
    this.pipeline.render();
    this.frameMs = performance.now() - t0;
  }
}
