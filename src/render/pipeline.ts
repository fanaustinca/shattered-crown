// Frame pipeline:
//  1. opaque scene (layer 0) -> HDR MSAA target (+ depth texture)
//  2. copy colour + linear depth for refraction / SSR
//  3. water + transparents (layer 1) into the same target
//  4. atmosphere pass: volumetric clouds, aerial perspective / height fog, god rays, underwater
//  5. bloom
//  6. final: exposure, AgX tone mapping, grading, vignette, grain -> screen
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SKY_GLSL, SKY_UNIFORMS } from './skyglsl';
import { skyUniforms } from './sky';
import { makeCloudNoise3D, makeNoiseTexture } from './textures';
import type { Quality } from '../core/settings';

export const LAYER_OPAQUE = 0;
export const LAYER_WATER = 1;
/** objects that only render into shadow maps (cheap shadow proxies) */
export const LAYER_SHADOW_ONLY = 2;
/** detailed building shells: main view + near cascades only */
export const LAYER_NEAR_DETAIL = 4;
/** shadow-only stand-ins for the far cascades */
export const LAYER_FAR_SHADOW = 5;

export const sharedUniforms = {
  tSceneColor: { value: null as THREE.Texture | null },
  tSceneDepth: { value: null as THREE.Texture | null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uTime: { value: 0 },
  tNoise: { value: null as THREE.Texture | null },
  uSunColor: { value: new THREE.Color(1, 1, 1) },     // radiance of direct sun (linear, scene units)
  uAmbient: { value: new THREE.Color(0.3, 0.35, 0.4) },
  uWind: { value: new THREE.Vector2(1, 0.3) },
  uRain: { value: 0 },
  uWetness: { value: 0 },
  uSnow: { value: 0 },
  uCamNear: { value: 0.2 },
  uCamFar: { value: 25000 },
};

const copyShader = {
  uniforms: { tColor: { value: null }, tDepth: { value: null }, uNear: { value: 0.2 }, uFar: { value: 25000 }, uMode: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform float uNear, uFar; uniform int uMode;
    varying vec2 vUv;
    void main() {
      if (uMode == 0) { gl_FragColor = texture2D(tColor, vUv); return; }
      float d = texture2D(tDepth, vUv).x;
      float z = d * 2.0 - 1.0;
      float lin = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
      gl_FragColor = vec4(d >= 1.0 ? 1e6 : lin, 0.0, 0.0, 1.0);
    }`,
};

const atmosphereShader = (q: Quality) => ({
  uniforms: {
    ...skyUniforms,
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tCloud: { value: null as THREE.Texture | null },
    tNoise: sharedUniforms.tNoise,
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSunColor: sharedUniforms.uSunColor,
    uCloudCover: { value: 0.45 },
    uCloudDensity: { value: 0.035 },
    uCloudOffset: { value: new THREE.Vector2() },
    uFogDensity: { value: 0.00012 },
    uFogFalloff: { value: 0.0045 },
    uMist: { value: 0.0 },
    uFrame: { value: 0 },
    uUnderwater: { value: 0 },
    uWaterY: { value: 0 },
    uSunScreen: { value: new THREE.Vector3(0.5, 0.5, 0) },
    uRain: sharedUniforms.uRain,
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: SKY_UNIFORMS + SKY_GLSL + /* glsl */ `
    #define CLOUD_STEPS ${q.cloudSteps}
    #define LIGHT_STEPS ${q.cloudSteps > 32 ? 6 : 4}
    #define GODRAYS ${q.godrays ? 1 : 0}
    uniform sampler2D tColor, tDepth, tNoise;
    uniform highp sampler3D tCloud;
    uniform mat4 uProjInv, uViewInv;
    uniform vec3 uCamPos, uSunColor, uSunScreen;
    uniform float uCloudCover, uCloudDensity, uFogDensity, uFogFalloff, uMist, uUnderwater, uWaterY, uRain;
    uniform vec2 uCloudOffset;
    uniform int uFrame;
    varying vec2 vUv;

    const float CB = 1500.0, CT = 2900.0;
    float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

    float cloudDensity(vec3 p, bool cheap) {
      float h = (p.y - CB) / (CT - CB);
      if (h < 0.0 || h > 1.0) return 0.0;
      vec2 q = p.xz + uCloudOffset;
      // weather map: large-scale coverage
      vec4 wm = texture2D(tNoise, q / 52000.0);
      float cov = clamp(uCloudCover + (wm.r - 0.5) * 0.9 + (wm.g - 0.5) * 0.35, 0.0, 1.0);
      // height gradient: rounded bases, tapering tops (cumulus profile)
      float grad = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.45 - 0.3 * cov, h);
      vec4 n = texture(tCloud, vec3(q.x, p.y * 0.8, q.y) / 6200.0);
      float fbmW = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
      float base = remap(n.r, -(1.0 - fbmW), 1.0, 0.0, 1.0);
      base = clamp(remap(base * grad, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
      if (cheap || base <= 0.0) return base * cov;
      vec4 d = texture(tCloud, vec3(q.x + uTime * 6.0, p.y, q.y) / 1100.0);
      float df = d.g * 0.625 + d.b * 0.25 + d.a * 0.125;
      df = mix(df, 1.0 - df, clamp(h * 4.0, 0.0, 1.0));
      return clamp(remap(base, df * 0.38, 1.0, 0.0, 1.0), 0.0, 1.0) * cov;
    }
    float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

    vec4 marchClouds(vec3 ro, vec3 rd, float maxDist) {
      if (uCloudCover <= 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
      float t0, t1;
      if (ro.y < CB) { if (rd.y <= 0.0) return vec4(0,0,0,1); t0 = (CB - ro.y) / rd.y; t1 = (CT - ro.y) / rd.y; }
      else if (ro.y > CT) { if (rd.y >= 0.0) return vec4(0,0,0,1); t0 = (CT - ro.y) / rd.y; t1 = (CB - ro.y) / rd.y; }
      else { t0 = 0.0; t1 = rd.y > 0.0 ? (CT - ro.y) / rd.y : rd.y < 0.0 ? (CB - ro.y) / rd.y : 20000.0; }
      t1 = min(t1, t0 + 14000.0);
      t1 = min(t1, maxDist);
      if (t1 <= t0 || t0 > 60000.0) return vec4(0,0,0,1);
      float steps = float(CLOUD_STEPS);
      float dt = (t1 - t0) / steps;
      float jitter = hash12(gl_FragCoord.xy + float(uFrame % 64) * 17.31);
      float t = t0 + dt * jitter;
      vec3 sunDir = normalize(uSunDir);
      vec3 lightDir = sunDir.y > -0.05 ? sunDir : normalize(uMoonDir);
      float cosA = dot(rd, lightDir);
      float phase = mix(hg(cosA, 0.6), hg(cosA, -0.25), 0.3);
      vec3 lightCol = sunDir.y > -0.05 ? uSunColor : vec3(0.02, 0.025, 0.035) * max(uMoonDir.y, 0.0);
      vec3 ambTop = skyRadiance(vec3(0.0, 1.0, 0.0), 0.0) * 1.6;
      vec3 ambBot = skyRadiance(normalize(vec3(rd.x, 0.05, rd.z)), 0.0) * 0.5;
      float T = 1.0; vec3 L = vec3(0.0);
      for (int i = 0; i < CLOUD_STEPS; i++) {
        vec3 p = ro + rd * t;
        float dens = cloudDensity(p, false);
        if (dens > 0.001) {
          float sigma = dens * uCloudDensity;
          // light march toward the sun
          float od = 0.0;
          for (int j = 0; j < LIGHT_STEPS; j++) {
            vec3 lp = p + lightDir * (float(j) + 0.5) * 160.0;
            od += cloudDensity(lp, true) * uCloudDensity * 160.0;
          }
          float beer = exp(-od) ;
          float beerSoft = exp(-od * 0.25) * 0.7;
          float powder = 1.0 - exp(-sigma * 2.0 * dt * 0.1);
          float hfrac = (p.y - CB) / (CT - CB);
          vec3 S = lightCol * max(beer, beerSoft) * phase * 12.566 * mix(1.0, powder * 2.0, 0.3) + mix(ambBot, ambTop, hfrac) * (0.55 + 0.45 * hfrac);
          float sd = exp(-sigma * dt);
          L += T * S * (1.0 - sd);
          T *= sd;
          if (T < 0.01) break;
        }
        t += dt;
      }
      // fade distant clouds into the sky haze
      float fade = exp(-t0 / 45000.0);
      return vec4(L * fade, mix(1.0, T, fade));
    }

    void main() {
      vec3 col = texture2D(tColor, vUv).rgb;
      float d = texture2D(tDepth, vUv).x;
      vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
      vec4 vp = uProjInv * ndc; vp /= vp.w;
      vec3 wp = (uViewInv * vp).xyz;
      vec3 ro = uCamPos;
      vec3 rd = normalize(wp - ro);
      float dist = length(wp - ro);
      bool isSky = d >= 0.999999;
      if (isSky) dist = 1e7;

      if (uUnderwater > 0.5) {
        // underwater: strong absorption and scattering, light shafts from the surface
        float dw = min(dist, 400.0);
        vec3 absorb = exp(-vec3(0.36, 0.11, 0.075) * dw);
        float depthBelow = max(0.0, uWaterY - ro.y);
        vec3 scatter = vec3(0.012, 0.05, 0.06) * dot(uSunColor, vec3(0.33)) * exp(-depthBelow * 0.12);
        col = col * absorb + scatter * (1.0 - absorb);
        gl_FragColor = vec4(col, 1.0);
        return;
      }

      // clouds
      vec4 cl = marchClouds(ro, rd, dist);
      col = col * cl.a + cl.rgb;

      // aerial perspective: analytic exponential height fog, coloured by the sky in that direction
      if (!isSky) {
        float b = uFogFalloff;
        float a = uFogDensity * (1.0 + uRain * 2.5) + uMist * 0.004;
        float fh = rd.y;
        float fogInt = a * exp(-b * ro.y) * (abs(fh) > 1e-4 ? (1.0 - exp(-b * fh * dist)) / (b * fh) : dist);
        float fogAmt = 1.0 - exp(-fogInt);
        vec3 fdir = normalize(vec3(rd.x, max(rd.y, 0.0) * 0.4 + 0.03, rd.z));
        vec3 fogCol = skyRadiance(fdir, 0.0);
        // forward-scattered sunlight glow in the haze
        vec3 sunDir = normalize(uSunDir);
        float sg = pow(max(dot(rd, sunDir), 0.0), 8.0);
        fogCol += uSunColor * sg * 0.12 * max(sunDir.y + 0.1, 0.0);
        col = mix(col, fogCol, fogAmt);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
});

// Radial blur of the bright sky toward the sun: crepuscular rays through clouds, trees and towers.
const godrayShader = {
  uniforms: { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector3() }, uStrength: { value: 0.0 }, uSunColor: sharedUniforms.uSunColor },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tDepth; uniform vec3 uSun; uniform float uStrength; uniform vec3 uSunColor;
    varying vec2 vUv;
    void main() {
      vec2 delta = (vUv - uSun.xy);
      float n = 48.0;
      vec2 stepv = delta / n;
      vec2 uv = vUv;
      float acc = 0.0, w = 1.0;
      for (int i = 0; i < 48; i++) {
        uv -= stepv;
        float d = texture2D(tDepth, uv).x;
        vec3 c = texture2D(tColor, uv).rgb;
        float sky = d >= 0.999999 ? 1.0 : 0.0;
        acc += sky * min(dot(c, vec3(0.333)), 4.0) * w;
        w *= 0.965;
      }
      acc /= n;
      float fall = smoothstep(1.2, 0.0, length(delta * vec2(1.6, 1.0)));
      gl_FragColor = vec4(uSunColor * acc * fall * uStrength * 0.25, 1.0);
    }`,
};

const finalShader = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null }, tRays: { value: null as THREE.Texture | null }, uExposure: { value: 1.0 },
    uTime: sharedUniforms.uTime, uVignette: { value: 0.32 }, uGrain: { value: 0.035 }, uHurt: { value: 0 }, uSat: { value: 1.06 },
    uRaysOn: { value: 0 }, uFade: { value: 0 }, uWetLens: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor, tRays; uniform float uExposure, uTime, uVignette, uGrain, uHurt, uSat, uRaysOn, uFade, uWetLens;
    varying vec2 vUv;
    // AgX (Troy Sobotka / three.js port) with a light punchy look
    vec3 agxDefaultContrastApprox(vec3 x) {
      vec3 x2 = x * x; vec3 x4 = x2 * x2;
      return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
    }
    vec3 AgX(vec3 color) {
      const mat3 AgXInsetMatrix = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
      const mat3 AgXOutsetMatrix = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
      const float AgxMinEv = -12.47393; const float AgxMaxEv = 4.026069;
      color = AgXInsetMatrix * color;
      color = max(color, 1e-10);
      color = log2(color);
      color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
      color = clamp(color, 0.0, 1.0);
      color = agxDefaultContrastApprox(color);
      // punchy look
      vec3 lw = vec3(0.2126, 0.7152, 0.0722);
      float luma = dot(color, lw);
      color = pow(color, vec3(1.08));
      color = luma + 1.12 * (color - luma);
      color = AgXOutsetMatrix * color;
      color = pow(max(vec3(0.0), color), vec3(2.2));
      return clamp(color, 0.0, 1.0);
    }
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      if (uWetLens > 0.0) {
        float dr = hash(floor(uv * vec2(40.0, 22.0)) + floor(uTime * 0.7));
        if (dr > 0.985) uv += (hash(uv * 9.0) - 0.5) * 0.004 * uWetLens;
      }
      vec3 c = texture2D(tColor, uv).rgb;
      if (uRaysOn > 0.5) c += texture2D(tRays, uv).rgb;
      c *= uExposure;
      c = AgX(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // gentle filmic split-tone: warm highlights, cool shadows
      c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.1, 0.8, l));
      vec2 q = vUv - 0.5;
      c *= 1.0 - uVignette * dot(q, q) * 1.6;
      c = mix(c, vec3(l * 1.2, l * 0.15, l * 0.1), uHurt * 0.45 * smoothstep(0.1, 0.7, length(q) * 1.4));
      c = pow(c, vec3(1.0 / 2.2)); // sRGB-ish encode
      c += (hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      c *= 1.0 - uFade;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Pipeline {
  rtMain!: THREE.WebGLRenderTarget;
  rtColor!: THREE.WebGLRenderTarget;   // scene colour copy (refraction)
  rtDepth!: THREE.WebGLRenderTarget;   // linear depth copy
  rtA!: THREE.WebGLRenderTarget;
  rtRays!: THREE.WebGLRenderTarget;
  copy = new FullScreenQuad(new THREE.ShaderMaterial(copyShader));
  atmo: FullScreenQuad;
  atmoMat: THREE.ShaderMaterial;
  rays = new FullScreenQuad(new THREE.ShaderMaterial(godrayShader));
  final = new FullScreenQuad(new THREE.ShaderMaterial(finalShader));
  bloom: UnrealBloomPass | null = null;
  width = 1; height = 1;
  frame = 0;
  shadowsDirty = true;
  stats = { calls: 0, tris: 0 };
  /** smoothed CPU ms of the opaque and water passes */
  cpu = { opaque: 0, water: 0 };

  constructor(public renderer: THREE.WebGLRenderer, public scene: THREE.Scene, public camera: THREE.PerspectiveCamera, public q: Quality) {
    sharedUniforms.tNoise.value = makeNoiseTexture(256);
    this.atmoMat = new THREE.ShaderMaterial(atmosphereShader(q));
    this.atmoMat.uniforms.tCloud.value = makeCloudNoise3D(q.cloudSteps >= 48 ? 96 : 64);
    this.atmo = new FullScreenQuad(this.atmoMat);
    this.setSize(1, 1);
  }

  get finalUniforms() { return (this.final.material as THREE.ShaderMaterial).uniforms; }
  get atmoUniforms() { return this.atmoMat.uniforms; }

  setQuality(q: Quality) {
    const old = this.atmoMat;
    this.q = q;
    this.atmoMat = new THREE.ShaderMaterial(atmosphereShader(q));
    for (const k of Object.keys(old.uniforms)) if (this.atmoMat.uniforms[k] && k !== 'tCloud') this.atmoMat.uniforms[k].value = old.uniforms[k].value;
    this.atmoMat.uniforms.tCloud.value = old.uniforms.tCloud.value;
    this.atmo.material = this.atmoMat;
    old.dispose();
    this.setSize(this.width, this.height, true);
  }

  setSize(w: number, h: number, force = false) {
    const pr = this.q.pixelRatio * Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
    if (!force && W === this.width && H === this.height) return;
    this.width = W; this.height = H;
    for (const rt of [this.rtMain, this.rtColor, this.rtDepth, this.rtA, this.rtRays]) rt?.dispose();
    const depthTexture = new THREE.DepthTexture(W, H);
    depthTexture.type = THREE.UnsignedIntType;
    this.rtMain = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: this.q.msaa, depthTexture, depthBuffer: true });
    this.rtColor = new THREE.WebGLRenderTarget(Math.ceil(W / 2), Math.ceil(H / 2), { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtDepth = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtA = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtRays = new THREE.WebGLRenderTarget(Math.ceil(W / 2), Math.ceil(H / 2), { type: THREE.HalfFloatType, depthBuffer: false });
    sharedUniforms.tSceneColor.value = this.rtColor.texture;
    sharedUniforms.tSceneDepth.value = this.rtDepth.texture;
    sharedUniforms.uResolution.value.set(W, H);
    this.bloom?.dispose();
    this.bloom = this.q.bloom ? new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.16, 0.55, 0.92) : null;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
  }

  render(beforeWater?: () => void) {
    const r = this.renderer, cam = this.camera, scene = this.scene;
    this.frame++;
    const t0 = performance.now();
    r.info.autoReset = false; r.info.reset();
    sharedUniforms.uCamNear.value = cam.near; sharedUniforms.uCamFar.value = cam.far;
    // 1. opaque
    r.shadowMap.needsUpdate = this.shadowsDirty || this.frame % this.q.shadowEvery === 0;
    cam.layers.set(LAYER_OPAQUE); cam.layers.enable(LAYER_NEAR_DETAIL);
    r.setRenderTarget(this.rtMain);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(scene, cam);
    const tA = performance.now();
    // 2. copies for refraction and depth-aware effects
    const cm = this.copy.material as THREE.ShaderMaterial;
    cm.uniforms.tColor.value = this.rtMain.texture;
    cm.uniforms.tDepth.value = this.rtMain.depthTexture;
    cm.uniforms.uNear.value = cam.near; cm.uniforms.uFar.value = cam.far;
    cm.uniforms.uMode.value = 0; r.setRenderTarget(this.rtColor); this.copy.render(r);
    cm.uniforms.uMode.value = 1; r.setRenderTarget(this.rtDepth); this.copy.render(r);
    beforeWater?.();
    // 3. water + transparent effects
    r.shadowMap.needsUpdate = false;
    const ac = r.autoClear; r.autoClear = false;
    cam.layers.set(LAYER_WATER);
    r.setRenderTarget(this.rtMain);
    scene.background = null;
    const tB = performance.now();
    r.render(scene, cam);
    r.autoClear = ac;
    this.cpu.opaque = this.cpu.opaque * 0.9 + (tA - t0) * 0.1; this.cpu.water = this.cpu.water * 0.9 + (performance.now() - tB) * 0.1;
    cam.layers.set(LAYER_OPAQUE); cam.layers.enable(LAYER_NEAR_DETAIL);
    this.stats.calls = r.info.render.calls; this.stats.tris = r.info.render.triangles;
    // 4. atmosphere
    const u = this.atmoMat.uniforms;
    u.tColor.value = this.rtMain.texture; u.tDepth.value = this.rtMain.depthTexture;
    u.uProjInv.value.copy(cam.projectionMatrixInverse); u.uViewInv.value.copy(cam.matrixWorld);
    u.uCamPos.value.copy(cam.position);
    u.uFrame.value = this.frame;
    r.setRenderTarget(this.rtA); this.atmo.render(r);
    // god rays
    const fu = this.finalUniforms;
    fu.uRaysOn.value = 0;
    if (this.q.godrays) {
      const sun = skyUniforms.uSunDir.value;
      const sp = new THREE.Vector3().copy(cam.position).addScaledVector(sun, 10000).project(cam);
      const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).dot(sun);
      const strength = THREE.MathUtils.smoothstep(facing, 0.0, 0.5) * THREE.MathUtils.smoothstep(sun.y, -0.02, 0.12) * (1 - skyUniforms.uOvercast.value) * (u.uUnderwater.value > 0.5 ? 0 : 1);
      if (strength > 0.01) {
        const ru = (this.rays.material as THREE.ShaderMaterial).uniforms;
        ru.tColor.value = this.rtA.texture; ru.tDepth.value = this.rtMain.depthTexture;
        ru.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5, 0); ru.uStrength.value = strength;
        r.setRenderTarget(this.rtRays); this.rays.render(r);
        fu.uRaysOn.value = 1; fu.tRays.value = this.rtRays.texture;
      }
    }
    // 5. bloom (adds onto rtA)
    if (this.bloom) this.bloom.render(r, this.rtA, this.rtA, 0.016, false);
    // 6. final
    fu.tColor.value = this.rtA.texture;
    r.setRenderTarget(null);
    this.final.render(r);
    this.shadowsDirty = false;
  }
}
