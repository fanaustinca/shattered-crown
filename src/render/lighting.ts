// Sun / moon lighting with cascaded shadow maps, day-night cycle, IBL from the sky.
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { skyUniforms, sunTransmittance } from './sky';
import { sharedUniforms, LAYER_SHADOW_ONLY, LAYER_NEAR_DETAIL, LAYER_FAR_SHADOW } from './pipeline';
import type { Quality } from '../core/settings';

const _fwd = new THREE.Vector3();
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
      maxFar: q.shadowFar, cascades: q.cascades, mode: 'custom', parent: scene, shadowMapSize: q.shadowSize,
      // geometric splits from a tight ~28 m near cascade: crisp contact shadows up close, few casters per cascade
      customSplitsCallback: (n: number, _near: number, far: number, out: number[]) => {
        const first = Math.min(28, far / n), r = Math.pow(far / first, 1 / Math.max(1, n - 1));
        for (let i = 0; i < n; i++) out.push(Math.min(1, (first * Math.pow(r, i)) / far));
      },
      lightDirection: new THREE.Vector3(-1, -1, -1).normalize(), camera, lightIntensity: 3, lightNear: 1, lightFar: 6000, lightMargin: 600,
      shadowBias: -0.00012,
    });
    this.csm.fade = true;
    this.csm.lights.forEach((l, i) => {
      l.shadow.normalBias = 0.04; l.shadow.radius = 1.5;
      // shadow-only proxies everywhere; detailed building shells only in the near cascades, the far-box
      // stand-ins only in the far ones (at that range a shell's shadow is its box)
      l.shadow.camera.layers.enable(LAYER_SHADOW_ONLY);
      if (i < 2) l.shadow.camera.layers.enable(LAYER_NEAR_DETAIL); else l.shadow.camera.layers.enable(LAYER_FAR_SHADOW);
    });
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
    // thick cloud scatters the sun into the sky: the direct beam (and its hard shadows) all but vanish
    const shade = 1 - Math.pow(overcast, 0.75) * 0.93;
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
    // under heavy cloud there is no sun disc: no glints on the water, no sunlit cloud rims
    sharedUniforms.uSunColor.value.copy(this.tmp).multiplyScalar(2.2 * sunUp * (1 - overcast * 0.9));
    if (sunUp <= 0.001) sharedUniforms.uSunColor.value.setRGB(0.02, 0.025, 0.04);
    // IBL brightness and auto exposure (the eye adapts to night)
    this.scene.environmentIntensity = 0.55 + 0.45 * this.dayFactor;
    const target = THREE.MathUtils.lerp(5.5, 1.0, this.dayFactor) * (1 + overcast * 0.35) * (this.interior ? THREE.MathUtils.lerp(1.3, 2.6, this.dayFactor) : 1);
    this.exposure += (target - this.exposure) * this.adapt;
  }

  /** Staggered cascade refresh: the near cascade renders every frame, far ones every 2nd/3rd/4th frame
   *  (phase-offset), or immediately when the camera or sun moved enough to matter for that cascade. The stale
   *  map and its matrix stay consistent, so shadows never swim; they just refresh less often far away. */
  private frame = 0;
  private last: { pos: THREE.Vector3; fwd: THREE.Vector3; sun: THREE.Vector3; f: number }[] = [];
  forceShadows = true;
  update(camera: THREE.Camera) {
    this.csm.update();
    this.frame++;
    const fwd = _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this.csm.lights.forEach((l, i) => {
      const sh = l.shadow;
      sh.autoUpdate = false;
      const st = (this.last[i] ??= { pos: new THREE.Vector3(1e9, 0, 0), fwd: new THREE.Vector3(), sun: new THREE.Vector3(), f: -99 });
      const cam = sh.camera as THREE.OrthographicCamera;
      const extent = Math.max(1, cam.right - cam.left);
      const every = i === 0 ? 1 : i + 1;
      const due = (this.frame + i) % every === 0;
      const moved = st.pos.distanceTo(camera.position) > extent * 0.015;
      const turned = st.fwd.dot(fwd) < (i === 0 ? 0.9994 : 0.9976);
      const sunMoved = st.sun.dot(this.csm.lightDirection) < 0.999998;
      if (this.forceShadows || due || moved || turned || sunMoved) {
        sh.needsUpdate = true;
        st.pos.copy(camera.position); st.fwd.copy(fwd); st.sun.copy(this.csm.lightDirection); st.f = this.frame;
      }
    });
    this.forceShadows = false;
  }
}
