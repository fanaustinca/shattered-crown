// Sun / moon lighting with cascaded shadow maps, day-night cycle, IBL from the sky.
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { skyUniforms, sunTransmittance } from './sky';
import { sharedUniforms } from './pipeline';
import type { Quality } from '../core/settings';

const LIT = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial']);

export class Lighting {
  csm: CSM;
  prepped = new WeakSet<THREE.Material>();
  sunDir = new THREE.Vector3();
  moonDir = new THREE.Vector3();
  sunColor = new THREE.Color();
  dayFactor = 1;
  /** Fraction of sunlight blocked by cloud cover (0..1), set by weather. */
  cloudShade = 0;
  exposure = 1;
  /** eye adaptation rate per frame (tests set 1 for instant) */
  adapt = 0.03;
  /** camera is inside a building: the eye opens up */
  interior = false;
  /** lightning flash intensity */
  flash = 0;
  private tmp = new THREE.Color();

  constructor(private scene: THREE.Scene, camera: THREE.PerspectiveCamera, q: Quality) {
    this.csm = new CSM({
      maxFar: q.shadowFar, cascades: q.cascades, mode: 'practical', parent: scene, shadowMapSize: q.shadowSize,
      lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), camera, lightIntensity: 3, lightNear: 1, lightFar: 6000, lightMargin: 600,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.shadow.normalBias = 0.04; l.shadow.radius = 1.5; }
  }

  /** Wire a lit material into CSM, chaining any existing onBeforeCompile. */
  prep(m: THREE.Material) {
    if (this.prepped.has(m) || !LIT.has(m.type)) return;
    this.prepped.add(m);
    const orig = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) { orig.call(m, sh, r); csmHook.call(m, sh, r); };
    m.needsUpdate = true;
  }
  prepObject(o: THREE.Object3D) {
    o.traverse((c) => {
      const mm = (c as THREE.Mesh).material;
      if (!mm) return;
      if (Array.isArray(mm)) mm.forEach((x) => this.prep(x)); else this.prep(mm);
    });
  }

  /** hours: 0..24 */
  setTime(hours: number, overcast: number) {
    const h = ((hours - 12) / 24) * Math.PI * 2;
    this.sunDir.set(-Math.sin(h), Math.cos(h) * 0.82 + 0.09, 0.42 * Math.cos(h) + 0.12).normalize();
    // the moon runs roughly opposite the sun, a little higher in the south
    const hm = h + Math.PI * 0.94;
    this.moonDir.set(-Math.sin(hm), Math.cos(hm) * 0.75 + 0.12, 0.5).normalize();
    skyUniforms.uSunDir.value.copy(this.sunDir);
    skyUniforms.uMoonDir.value.copy(this.moonDir);
    skyUniforms.uOvercast.value = overcast;

    const sy = this.sunDir.y;
    const sunUp = THREE.MathUtils.smoothstep(sy, -0.04, 0.06);
    this.dayFactor = THREE.MathUtils.smoothstep(sy, -0.2, 0.25);
    sunTransmittance(sy, skyUniforms.uTurbidity.value, this.tmp);
    const shade = 1 - overcast * 0.85;
    if (sunUp > 0.001) {
      this.sunColor.copy(this.tmp).multiplyScalar(4.2 * sunUp * shade);
      this.csm.lightDirection.copy(this.sunDir).negate();
    } else {
      const mu = THREE.MathUtils.smoothstep(this.moonDir.y, -0.02, 0.15);
      this.sunColor.setRGB(0.32, 0.4, 0.62).multiplyScalar(0.16 * mu * (1 - overcast * 0.8));
      this.csm.lightDirection.copy(this.moonDir).negate();
    }
    for (const l of this.csm.lights) { l.color.copy(this.sunColor); l.intensity = 1; }
    // radiance used to light clouds and water glints
    sharedUniforms.uSunColor.value.copy(this.tmp).multiplyScalar(2.2 * sunUp + 0.0);
    if (sunUp <= 0.001) sharedUniforms.uSunColor.value.setRGB(0.02, 0.025, 0.04);
    // IBL brightness and auto exposure (the eye adapts to night)
    this.scene.environmentIntensity = 0.55 + 0.45 * this.dayFactor;
    const target = THREE.MathUtils.lerp(5.5, 1.0, this.dayFactor) * (1 + overcast * 0.35) * (this.interior ? THREE.MathUtils.lerp(1.3, 2.6, this.dayFactor) : 1);
    this.exposure += (target - this.exposure) * this.adapt;
  }

  update(camera: THREE.Camera) {
    this.csm.update();
    void camera;
  }
}
