// Weather: a slowly evolving system of clear skies, cloud banks, rain, thunderstorms, fog and
// snow (in the cold Ironreach heights). Drives clouds, wind, wetness, puddles, snow cover,
// rain/snow particles around the camera, splashes, lightning and thunder.
import * as THREE from 'three';
import { sharedUniforms } from './pipeline';
import type { Game } from '../game';
import { waterUniforms } from './water';

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'fog' | 'snow';
const PROFILE: Record<WeatherKind, { cover: number; overcast: number; rain: number; wind: number; fog: number; snow: number }> = {
  clear: { cover: 0.32, overcast: 0, rain: 0, wind: 0.5, fog: 0, snow: 0 },
  cloudy: { cover: 0.58, overcast: 0.15, rain: 0, wind: 0.8, fog: 0, snow: 0 },
  overcast: { cover: 0.85, overcast: 0.6, rain: 0, wind: 1.0, fog: 0.2, snow: 0 },
  rain: { cover: 0.92, overcast: 0.8, rain: 0.65, wind: 1.3, fog: 0.35, snow: 0 },
  storm: { cover: 1.0, overcast: 0.95, rain: 1.0, wind: 2.4, fog: 0.4, snow: 0 },
  fog: { cover: 0.6, overcast: 0.5, rain: 0, wind: 0.2, fog: 1, snow: 0 },
  snow: { cover: 0.9, overcast: 0.75, rain: 0, wind: 0.9, fog: 0.4, snow: 1 },
};

export class Weather {
  kind: WeatherKind = 'clear';
  next: WeatherKind = 'clear';
  timer = 600;
  cur = { ...PROFILE.clear };
  wetness = 0;
  snowCover = 0;
  windDir = 0.6;
  rainMesh: THREE.Mesh;
  snowMesh: THREE.Mesh;
  lightning = 0;
  private boltT = 8;
  constructor(public game: Game) {
    // rain: instanced streaks in a box around the camera, animated in the vertex shader
    const N = 26000;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.004, 0, 0, 0.004, 0, 0, 0.004, 1, 0, -0.004, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    g.instanceCount = N;
    const u = { uTime: sharedUniforms.uTime, tSceneDepth: sharedUniforms.tSceneDepth, uResolution: sharedUniforms.uResolution, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uWind: { value: new THREE.Vector2() }, uSnow: { value: 0 }, uLight: { value: new THREE.Color() } };
    const vert = (snow: boolean) => /* glsl */ `
      attribute vec3 aSeed; uniform float uTime, uAmount; uniform vec3 uCam; uniform vec2 uWind; varying float vA; varying vec2 vUv; varying float vDepth;
      void main() {
        float box = ${snow ? '30.0' : '24.0'};
        float fall = ${snow ? '1.4' : '11.0'} * (0.85 + aSeed.z * 0.3);
        vec3 p = vec3(aSeed.x, 0.0, aSeed.y) * box - box * 0.5;
        float h = mod(aSeed.z * 40.0 - uTime * fall, 22.0) - 6.0;
        p.y = h;
        p.xz += uWind * (h + 6.0) * ${snow ? '0.12' : '0.06'};
        ${snow ? 'p.x += sin(uTime * 1.3 + aSeed.x * 40.0) * 0.4; p.z += cos(uTime * 1.1 + aSeed.y * 40.0) * 0.4;' : ''}
        // wrap the box around the camera
        vec3 c = uCam;
        p.xz = mod(p.xz - c.xz + box * 0.5, box) - box * 0.5 + c.xz;
        p.y += c.y;
        vA = step(aSeed.x * 0.999, uAmount) * (1.0 - smoothstep(box * 0.35, box * 0.5, length(p.xz - c.xz)));
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), normalize(cameraPosition - p) + 1e-4));
        float len = ${snow ? '0.03' : '0.95'};
        // never thinner than about a pixel, or distant drops vanish between pixels
        float dc = length(p - cameraPosition);
        float wid = max(${snow ? '6.0' : '1.6'}, dc * ${snow ? '0.16' : '0.17'});
        vA *= ${snow ? '1.0' : 'clamp(1.6 / wid * 1.3, 0.35, 1.0)'};
        vec3 wp = p + right * position.x * wid + vec3(uWind.x * 0.06, -1.0, uWind.y * 0.06) * position.y * len ${snow ? '+ vec3(0.0, position.y * 0.03, 0.0)' : ''};
        vUv = position.xy;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`;
    const frag = (snow: boolean) => /* glsl */ `
      varying float vA; varying vec2 vUv; varying float vDepth; uniform vec3 uLight; uniform sampler2D tSceneDepth; uniform vec2 uResolution;
      void main() {
        if (vA < 0.01) discard;
        // hidden behind walls, roofs and ground (manual depth test against the opaque pass)
        float sd = texture2D(tSceneDepth, gl_FragCoord.xy / uResolution).x;
        if (vDepth > sd) discard;
        float edge = 1.0 - abs(vUv.x) * 120.0;
        ${snow ? 'gl_FragColor = vec4(uLight * 1.6, 0.9 * vA);' : 'float tip = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y); gl_FragColor = vec4(uLight * 1.5, 0.5 * vA * tip * clamp(edge, 0.5, 1.0));'}
      }`;
    const mk = (snow: boolean) => {
      const m = new THREE.ShaderMaterial({ uniforms: { ...u, uAmount: { value: 0 } }, vertexShader: vert(snow), fragmentShader: frag(snow), transparent: true, depthWrite: false, depthTest: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      return mesh;
    };
    this.rainMesh = mk(false);
    this.snowMesh = mk(true);
    this.uniforms = u;
    game.pipeline.overlay.add(this.rainMesh, this.snowMesh);
  }
  uniforms: Record<string, { value: unknown }>;

  get raining() { return this.cur.rain > 0.2 && !this.coldHere(); }
  coldHere() { const p = this.game.player.pos; return this.game.world.heightAt(p.x, p.z) > 190 || (this.game.world.eastAt(p.x, p.z) > 0.6 && this.game.world.heightAt(p.x, p.z) > 120); }

  set(kind: WeatherKind, instant = false) { this.next = kind; this.kind = kind; this.timer = 300 + Math.random() * 600; if (instant) this.cur = { ...PROFILE[kind] }; }
  /** Fronts come and go: pick a starting sky so every session doesn't open on the same weather. */
  randomize() {
    const r = Math.random();
    this.set(r < 0.4 ? 'clear' : r < 0.65 ? 'cloudy' : r < 0.78 ? 'overcast' : r < 0.9 ? 'rain' : r < 0.95 ? 'fog' : 'storm', true);
  }

  update(dt: number) {
    const g = this.game;
    this.timer -= dt;
    if (this.timer <= 0) {
      const r = Math.random();
      const opts: WeatherKind[] = this.kind === 'clear' ? ['clear', 'cloudy', 'cloudy', 'fog', 'overcast'] : this.kind === 'cloudy' ? ['clear', 'overcast', 'rain', 'cloudy'] : this.kind === 'overcast' ? ['rain', 'cloudy', 'storm', 'snow'] : this.kind === 'rain' ? ['overcast', 'storm', 'cloudy'] : this.kind === 'storm' ? ['rain', 'overcast'] : ['cloudy', 'clear'];
      this.set(opts[Math.floor(r * opts.length)]);
    }
    let target = { ...PROFILE[this.kind] };
    // the same front brings snow up in the cold mountains and rain in the lowlands
    if (this.coldHere() && target.rain > 0) { target = { ...target, snow: target.rain, rain: 0 }; }
    if (this.kind === 'snow' && !this.coldHere()) target = { ...target, rain: 0.5, snow: 0 };
    const k = Math.min(1, dt * 0.02);
    for (const key of Object.keys(target) as (keyof typeof target)[]) this.cur[key] += (target[key] - this.cur[key]) * k;
    // wind direction wanders
    this.windDir += (Math.sin(g.time * 0.01) * 0.002) * dt * 60;
    // gusts ride on the mean wind (stronger and more ragged in storms)
    const gust = 1 + (0.12 + this.cur.wind * 0.08) * (Math.sin(g.time * 0.37) * 0.6 + Math.sin(g.time * 1.13 + 1.7) * 0.4);
    const w = this.cur.wind * gust;
    sharedUniforms.uWind.value.set(Math.cos(this.windDir) * w, Math.sin(this.windDir) * w);
    // ground wetness and snow cover accumulate and dry/melt
    this.wetness = THREE.MathUtils.clamp(this.wetness + (this.cur.rain > 0.1 ? dt * 0.01 * this.cur.rain : -dt * 0.002 * (0.3 + g.lighting.dayFactor)), 0, 1);
    this.snowCover = THREE.MathUtils.clamp(this.snowCover + (this.cur.snow > 0.1 ? dt * 0.004 * this.cur.snow : -dt * 0.0015), 0, 1);
    sharedUniforms.uWetness.value = this.wetness;
    sharedUniforms.uRain.value = this.cur.rain;
    sharedUniforms.uSnow.value = this.snowCover;
    // sea state follows the wind: a gentle swell in fair weather, steep running seas in a storm
    waterUniforms.uWaveAmp.value = Math.min(2.8, 0.35 + w * 0.5 + w * w * 0.32 + this.cur.rain * 0.25);
    waterUniforms.uWaveRot.value = this.windDir - Math.atan2(0.3, 1.0);
    g.overcast = this.cur.overcast;
    const au = g.pipeline.atmoUniforms;
    au.uCloudCover.value = this.cur.cover;
    au.uCloudDensity.value = 0.03 + this.cur.overcast * 0.03;
    au.uCloudOffset.value.x += Math.cos(this.windDir) * w * dt * 12;
    au.uCloudOffset.value.y += Math.sin(this.windDir) * w * dt * 12;
    au.uMist.value = this.cur.fog * (0.4 + 0.6 * (1 - g.lighting.dayFactor * 0.6));
    // particles
    const u = this.uniforms;
    (u.uCam.value as THREE.Vector3).copy(g.camera.position);
    (u.uWind.value as THREE.Vector2).copy(sharedUniforms.uWind.value);
    const light = (u.uLight.value as THREE.Color).setRGB(0.5, 0.55, 0.6).multiplyScalar(0.25 + g.lighting.dayFactor * 0.9);
    // the distant rain sheets in the atmosphere pass: lit by the grey sky, invisible indoors
    (au.uRainLight.value as THREE.Color).copy(light).multiplyScalar(g.settlements.inside(g.camera.position) ? 0 : 0.9);
    this.rainMesh.visible = this.cur.rain > 0.02 && !g.settlements.inside(g.camera.position);
    this.snowMesh.visible = this.cur.snow > 0.02 && !g.settlements.inside(g.camera.position);
    (this.rainMesh.material as THREE.ShaderMaterial).uniforms.uAmount.value = this.cur.rain;
    (this.snowMesh.material as THREE.ShaderMaterial).uniforms.uAmount.value = this.cur.snow;
    // lightning and thunder
    if (this.kind === 'storm' && this.cur.rain > 0.6) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = 6 + Math.random() * 20; this.lightning = 1;
        const dist = 300 + Math.random() * 2500;
        setTimeout(() => g.sound?.('thunder', null, Math.min(1, 900 / dist)), dist / 343 * 1000);
      }
    }
    this.lightning *= Math.exp(-dt * 7);
    if (this.lightning > 0.01) g.lighting.flash = this.lightning * (Math.random() < 0.3 ? 0.4 : 1);
    else g.lighting.flash = 0;
  }
}
