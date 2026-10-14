// Ocean (camera-following radial grid with Gerstner waves), river ribbon with flow, source lake.
// Shading: depth-based absorption + refraction of the opaque scene, screen-space reflections with
// sky fallback, sun glints, crest/shore foam, rain ripples, seen-from-below underwater surface.
import * as THREE from 'three';
import { sharedUniforms, LAYER_WATER } from './pipeline';
import { skyUniforms } from './sky';
import { SKY_GLSL, SKY_UNIFORMS } from './skyglsl';
import { terrainUniforms, TERRAIN_HEIGHT_GLSL } from './terrain';
import { riverX, riverWidth, riverLevel, RIVER_Z0 } from '../world/layout';
import type { Quality } from '../core/settings';

// Gerstner wave set (direction xz, steepness, wavelength)
export const WAVES: [number, number, number, number][] = [
  [1.0, 0.3, 0.16, 38], [0.7, -0.7, 0.13, 23], [-0.25, 1.0, 0.12, 15], [0.9, 0.45, 0.10, 9.5], [-0.6, 0.8, 0.08, 6.1], [0.2, -1.0, 0.06, 3.7],
];

// Long ocean swell: built up by the wind over open water, it only reaches full height well offshore (deep
// water), and is what makes a big ship pitch and roll. Same format as WAVES.
export const SWELLS: [number, number, number, number][] = [[1.0, 0.12, 0.07, 150], [0.75, 0.66, 0.055, 96], [0.95, -0.3, 0.045, 62]];

export const waterUniforms = {
  /** up to four hulls near the camera: water is not drawn inside them (world->ship matrices, and
   *  half-length, half-beam, side height, active) */
  uHullInv: { value: [0, 1, 2, 3].map(() => new THREE.Matrix4()) },
  uHullDim: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
  uSwell: { value: 0.3 },        // swell height (wind strength and duration)
  uWaveAmp: { value: 0.7 },      // overall sea state (weather)
  uWaveRot: { value: 0 },        // the swell turns to run with the wind
  tWaterNormal: { value: null as THREE.Texture | null },
  uSSR: { value: 1 },
};

/** CPU evaluation of the sea surface height (for buoyancy), matching the shader. */
let seaFloor: ((x: number, z: number) => number) | null = null;
/** The game tells the sea how deep it is (waves shoal and die on the beach; swells need open water). */
export function setSeaFloor(fn: (x: number, z: number) => number) { seaFloor = fn; }
const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function seaHeight(x: number, z: number, t: number, amp: number, rot = waterUniforms.uWaveRot.value): number {
  // Gerstner: approximate height at (x,z) ignoring the small horizontal displacement
  let y = 0;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const depth = seaFloor ? Math.max(0, -seaFloor(x, z)) : 50;
  const wind = amp * ss(0, 7, depth), swell = waterUniforms.uSwell.value * ss(6, 60, depth);
  for (const [set, A] of [[WAVES, wind], [SWELLS, swell]] as const) {
    if (A <= 0) continue;
    for (const [dx0, dz0, st, L] of set) {
      const dx = dx0 * cr - dz0 * sr, dz = dx0 * sr + dz0 * cr;
      const l = Math.hypot(dx, dz), k = (2 * Math.PI) / L, c = Math.sqrt(9.8 / k);
      const a = (st / k) * A;
      y += a * Math.sin(k * ((dx / l) * x + (dz / l) * z) - c * k * t * 1.0);
    }
  }
  return y;
}
/** Wind chop on the river (matches the shader). */
export function riverChop(x: number, z: number, t: number, amp: number): number {
  const a = amp * 0.035;
  return a * (Math.sin(x * 0.9 + t * 1.7) + Math.sin(z * 0.7 - t * 1.3) + 0.5 * Math.sin((x + z) * 1.9 + t * 2.6));
}

function makeNormalTexture(size = 256): THREE.DataTexture {
  // tileable sum of sines + noise -> height -> normals
  const h = new Float32Array(size * size);
  const rnd = (i: number) => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const kx = Math.round((rnd(i) - 0.5) * 24), ky = Math.round((rnd(i + 99) - 0.5) * 24);
    if (kx === 0 && ky === 0) continue;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.3), rnd(i + 7) * Math.PI * 2]);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (const [kx, ky, a, p] of waves) v += a * Math.sin(2 * Math.PI * (kx * x + ky * y) / size + p);
    h[y * size + x] = v;
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hl = h[y * size + ((x - 1 + size) % size)], hr = h[y * size + ((x + 1) % size)];
    const hd = h[((y - 1 + size) % size) * size + x], hu = h[((y + 1) % size) * size + x];
    const nx = (hl - hr) * 2.2, ny = (hd - hu) * 2.2, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const k = (y * size + x) * 4;
    data[k] = (nx / l * 0.5 + 0.5) * 255; data[k + 1] = (ny / l * 0.5 + 0.5) * 255; data[k + 2] = (nz / l * 0.5 + 0.5) * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */ `
uniform float uTime, uWaveAmp, uWaveRot, uSwell;
uniform vec2 uWind;
attribute float aKind;      // 0 sea, 1 river, 2 lake
attribute vec2 aFlow;       // river flow direction * speed
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vKind;
varying vec2 vFlow;
varying float vCrest;
varying vec4 vClip;
${TERRAIN_HEIGHT_GLSL}
const int NW = ${WAVES.length};
const vec4 WV[NW] = vec4[NW](${WAVES.map((w) => `vec4(${w.map((v) => v.toFixed(3)).join(',')})`).join(',')});
const int NS = ${SWELLS.length};
const vec4 SV[NS] = vec4[NS](${SWELLS.map((w) => `vec4(${w.map((v) => v.toFixed(3)).join(',')})`).join(',')});
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vKind = aKind;
  vFlow = aFlow;
  vec3 n = vec3(0.0, 1.0, 0.0);
  vCrest = 0.0;
  if (aKind < 0.5) {
    float depth = max(0.0, p.y - terrainHeight(p.xz));
    float dist = distance(p.xz, cameraPosition.xz);
    float amp = uWaveAmp * smoothstep(0.0, 7.0, depth) * (1.0 - smoothstep(1500.0, 5000.0, dist));
    vec3 disp = vec3(0.0); vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
    for (int i = 0; i < NW; i++) {
      vec2 d = mat2(cos(uWaveRot), sin(uWaveRot), -sin(uWaveRot), cos(uWaveRot)) * normalize(WV[i].xy);
      float k = 6.2831853 / WV[i].w, c = sqrt(9.8 / k);
      float a = WV[i].z / k * amp;
      float f = k * (dot(d, p.xz) - c * uTime);
      float s = sin(f), co = cos(f);
      disp += vec3(d.x * a * co, a * s, d.y * a * co) * vec3(0.8, 1.0, 0.8);
      tx += vec3(-d.x * d.x * WV[i].z * amp * s * 0.8, d.x * WV[i].z * amp * co, -d.x * d.y * WV[i].z * amp * s * 0.8);
      tz += vec3(-d.x * d.y * WV[i].z * amp * s * 0.8, d.y * WV[i].z * amp * co, -d.y * d.y * WV[i].z * amp * s * 0.8);
      vCrest += max(0.0, s) * WV[i].z * amp;
    }
    // the long swell, building offshore
    float sa = uSwell * smoothstep(6.0, 60.0, depth) * (1.0 - smoothstep(3000.0, 9000.0, dist));
    if (sa > 0.001) for (int i = 0; i < NS; i++) {
      vec2 d = mat2(cos(uWaveRot), sin(uWaveRot), -sin(uWaveRot), cos(uWaveRot)) * normalize(SV[i].xy);
      float k = 6.2831853 / SV[i].w, c = sqrt(9.8 / k);
      float a = SV[i].z / k * sa;
      float f = k * (dot(d, p.xz) - c * uTime);
      float s = sin(f), co = cos(f);
      disp += vec3(d.x * a * co, a * s, d.y * a * co) * vec3(0.8, 1.0, 0.8);
      tx += vec3(-d.x * d.x * SV[i].z * sa * s * 0.8, d.x * SV[i].z * sa * co, -d.x * d.y * SV[i].z * sa * s * 0.8);
      tz += vec3(-d.x * d.y * SV[i].z * sa * s * 0.8, d.y * SV[i].z * sa * co, -d.y * d.y * SV[i].z * sa * s * 0.8);
      vCrest += max(0.0, s) * SV[i].z * sa * 0.6;
    }
    p += disp;
    n = normalize(cross(tz, tx));
  } else if (aKind < 1.5) {
    // wind chop on the river
    float a = uWaveAmp * 0.035;
    p.y += a * (sin(p.x * 0.9 + uTime * 1.7) + sin(p.z * 0.7 - uTime * 1.3) + 0.5 * sin((p.x + p.z) * 1.9 + uTime * 2.6));
    vec2 gr = a * vec2(0.9 * cos(p.x * 0.9 + uTime * 1.7) + 0.95 * cos((p.x + p.z) * 1.9 + uTime * 2.6), 0.7 * cos(p.z * 0.7 - uTime * 1.3) + 0.95 * cos((p.x + p.z) * 1.9 + uTime * 2.6));
    n = normalize(vec3(-gr.x, 1.0, -gr.y));
  }
  vWorld = p;
  vNormalW = n;
  vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vClip = clip;
  gl_Position = clip;
}`;

const FRAG = (q: Quality) => SKY_UNIFORMS + SKY_GLSL + /* glsl */ `
#define SSR ${q.waterSSR ? 1 : 0}
uniform sampler2D tSceneColor, tSceneDepth, tWaterNormal, tNoise;
uniform vec2 uResolution;
uniform float uCamNear, uCamFar, uRain, uWaveAmp;
uniform vec2 uWind;
uniform vec3 uSunColor;
uniform mat4 uProj;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vKind;
varying vec2 vFlow;
varying float vCrest;
uniform mat4 uHullInv[4]; uniform vec4 uHullDim[4];
bool insideHull(vec3 w) {
  for (int i = 0; i < 4; i++) {
    vec4 d = uHullDim[i];
    if (d.w < 0.5) continue;
    vec3 l = (uHullInv[i] * vec4(w, 1.0)).xyz;
    if (abs(l.x) > d.x || l.y > d.z || l.y < 0.0) continue;
    float xn = l.x / d.x;
    float pf = xn > 0.0 ? sqrt(max(0.0, 1.0 - pow(xn, 2.3))) : 1.0 - pow(-xn, 3.4) * 0.38;
    if (abs(l.z) < d.y * pf * 0.97) return true;
  }
  return false;
}
varying vec4 vClip;

float linDepth(float zNdc) { return (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - zNdc * (uCamFar - uCamNear)); }

vec3 sampleN(vec2 uv) { vec3 n = texture2D(tWaterNormal, uv).xzy * 2.0 - 1.0; return vec3(n.x, n.y, n.z); }

vec3 detailNormal(vec2 p, float scale) {
  if (vKind > 0.5 && vKind < 1.5) {
    // flow-mapped river normals: two phases cross-faded to hide the reset
    vec2 flow = vFlow;
    float t0 = fract(uTime * 0.25), t1 = fract(uTime * 0.25 + 0.5);
    float w = abs(t0 - 0.5) * 2.0;
    vec3 a = sampleN(p / 6.0 - flow * t0 * 1.6);
    vec3 b = sampleN(p / 6.0 - flow * t1 * 1.6 + 0.37);
    vec3 c = sampleN(p / 2.3 - flow * t0 * 2.2 + 0.11);
    vec3 d = sampleN(p / 2.3 - flow * t1 * 2.2 + 0.71);
    vec3 n = mix(a, b, w) + mix(c, d, w) * 0.6;
    return normalize(vec3(n.x, n.y * 1.0 + 1.6, n.z));
  }
  vec2 wd = normalize(uWind + 1e-3);
  vec3 a = sampleN(p / (14.0 * scale) + wd * uTime * 0.03);
  vec3 b = sampleN(p / (5.0 * scale) - wd.yx * uTime * 0.05 + 0.3);
  vec3 c = sampleN(p / (1.7 * scale) + vec2(uTime * 0.04, -uTime * 0.03));
  vec3 n = a + b * 0.6 + c * 0.35;
  return normalize(vec3(n.x, 2.2 / (0.6 + uWaveAmp * 0.6), n.z));
}

vec3 ripples(vec2 p) {
  vec3 n = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    vec2 q = p * (1.6 + float(k) * 0.9) + float(k) * 3.7;
    vec2 c = floor(q); vec2 f = fract(q) - 0.5;
    float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5);
    vec2 o = vec2(fract(h * 13.1), fract(h * 71.7)) - 0.5;
    vec2 d = f - o * 0.6;
    float ph = fract(uTime * 1.1 + h);
    float r = length(d);
    float ring = sin((r - ph * 0.45) * 70.0) * smoothstep(0.0, 0.03, ph * 0.45 - r + 0.04) * (1.0 - ph) * smoothstep(0.45, 0.1, r);
    n.xz += normalize(d + 1e-4) * ring * 0.5;
  }
  return n;
}

void main() {
  if (vKind < 0.5 && insideHull(vWorld)) discard;
  vec2 suv = gl_FragCoord.xy / uResolution;
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  bool below = !gl_FrontFacing;
  vec3 N = normalize(vNormalW);
  vec3 dn = detailNormal(vWorld.xz, 1.0);
  float detailFade = mix(1.0, 0.3, smoothstep(80.0, 1500.0, dist));
  N = normalize(vec3(N.x + dn.x * detailFade * 0.55, N.y, N.z + dn.z * detailFade * 0.55));
  if (uRain > 0.01) { vec3 rp = ripples(vWorld.xz) * uRain * (1.0 - smoothstep(10.0, 60.0, dist)); N = normalize(N + rp); }
  if (below) N = -N;

  // scene depth behind the water
  float sceneZ = texture2D(tSceneDepth, suv).r;
  float waterZ = linDepth(gl_FragCoord.z * 2.0 - 1.0);
  float thick = max(0.0, sceneZ - waterZ);
  // refraction offset by the surface normal, clamped so foreground objects don't smear in
  vec2 roff = N.xz * 0.035 * clamp(thick / 3.0, 0.0, 1.0) / max(1.0, dist * 0.04);
  vec2 ruv = suv + roff;
  float sceneZ2 = texture2D(tSceneDepth, ruv).r;
  if (sceneZ2 < waterZ) { ruv = suv; sceneZ2 = sceneZ; }
  float thick2 = max(0.0, sceneZ2 - waterZ);
  vec3 refr = texture2D(tSceneColor, ruv).rgb;

  // absorption: the sea is a deep teal, the river a greener, siltier colour
  vec3 absorb = vKind > 0.5 ? vec3(0.42, 0.22, 0.20) : vec3(0.46, 0.09, 0.06);
  float pathLen = thick2 * (below ? 1.0 : 1.0 + (1.0 - abs(V.y)) * 1.5);
  vec3 trans = exp(-absorb * pathLen);
  float sunUp = clamp(uSunDir.y * 3.0 + 0.2, 0.0, 1.0);
  vec3 skyAmb = skyRadiance(vec3(0.0, 1.0, 0.0), 0.0);
  vec3 deepCol = (vKind > 0.5 ? vec3(0.03, 0.07, 0.045) : vec3(0.008, 0.05, 0.065)) * (dot(uSunColor, vec3(0.3)) * 0.5 + skyAmb * 2.0);
  vec3 body = refr * trans + deepCol * (1.0 - trans);

  // reflection: screen-space march, falling back to the sky
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 refl = skyRadiance(R, 0.0);
  float ssrHit = 0.0;
#if SSR
  if (!below && dist < 900.0) {
    vec3 rp = vWorld;
    float stepL = 0.6 + dist * 0.02;
    for (int i = 0; i < 28; i++) {
      rp += R * stepL; stepL *= 1.18;
      vec4 c = uProj * viewMatrix * vec4(rp, 1.0);
      if (c.w <= 0.0) break;
      vec2 uv = c.xy / c.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float sz = texture2D(tSceneDepth, uv).r;
      float rz = c.w;
      if (rz > sz + 0.2 && rz < sz + stepL * 2.5 + 2.0) {
        vec2 edge = smoothstep(0.0, 0.08, uv) * smoothstep(1.0, 0.92, uv);
        ssrHit = edge.x * edge.y * (1.0 - float(i) / 28.0);
        refl = mix(refl, texture2D(tSceneColor, uv).rgb, ssrHit);
        break;
      }
    }
  }
#endif
  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  if (below) {
    // looking up from underwater: Snell's window and total internal reflection
    float tir = smoothstep(0.66, 0.6, NdV);
    vec3 skyThru = skyRadiance(refract(-V, N, 1.33), 1.0);
    gl_FragColor = vec4(mix(skyThru * 0.8, deepCol, tir), 1.0);
    return;
  }
  vec3 col = mix(body, refl, F);
  // sun glint
  vec3 H = normalize(V + normalize(uSunDir));
  float spec = pow(max(dot(N, H), 0.0), 900.0) * 140.0 + pow(max(dot(N, H), 0.0), 120.0) * 3.0;
  col += uSunColor * spec * sunUp * (1.0 - ssrHit * 0.5) * pow(1.0 - uOvercast, 3.0);   // no sun disc behind storm cloud
  // foam: wave crests, shorelines, and white water around rocks in the river
  vec4 nz = texture2D(tNoise, vWorld.xz / 9.0 + uTime * 0.01);
  vec4 nz2 = texture2D(tNoise, vWorld.xz / 3.1 - uTime * 0.02);
  float shore = 1.0 - smoothstep(0.0, vKind > 0.5 ? 0.6 : 1.4, thick);
  float crest = smoothstep(0.55, 1.1, vCrest / max(uWaveAmp, 0.1)) * uWaveAmp;
  float foamMask = clamp(shore * 0.9 + crest + (vKind > 0.5 && vKind < 1.5 ? length(vFlow) * 0.05 : 0.0), 0.0, 1.0);
  float foam = smoothstep(0.35, 0.75, foamMask * (nz.r * 0.7 + nz2.g * 0.5));
  vec3 foamCol = vec3(0.9) * (dot(uSunColor, vec3(0.25)) * max(dot(N, normalize(uSunDir)), 0.2) + skyAmb * 2.5);
  col = mix(col, foamCol, foam * 0.85 * (1.0 - smoothstep(200.0, 800.0, dist)));
  // soft edge where the water meets the shore
  float alphaEdge = smoothstep(0.0, 0.15, thick);
  gl_FragColor = vec4(mix(refr, col, alphaEdge), 1.0);
}`;

export class Water {
  ocean: THREE.Mesh;
  river: THREE.Mesh;
  material: THREE.ShaderMaterial;

  constructor(q: Quality) {
    waterUniforms.tWaterNormal.value = makeNormalTexture(256);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...skyUniforms, ...terrainUniforms, ...waterUniforms,
        tSceneColor: sharedUniforms.tSceneColor, tSceneDepth: sharedUniforms.tSceneDepth, tNoise: sharedUniforms.tNoise,
        uResolution: sharedUniforms.uResolution, uTime: sharedUniforms.uTime, uCamNear: sharedUniforms.uCamNear, uCamFar: sharedUniforms.uCamFar,
        uRain: sharedUniforms.uRain, uSunColor: sharedUniforms.uSunColor, uWind: sharedUniforms.uWind, uProj: { value: new THREE.Matrix4() },
      },
      vertexShader: VERT, fragmentShader: FRAG(q), side: THREE.DoubleSide,
    });
    this.ocean = new THREE.Mesh(this.oceanGeometry(), this.material);
    this.ocean.frustumCulled = false;
    this.ocean.layers.set(LAYER_WATER);
    this.river = new THREE.Mesh(this.riverGeometry(), this.material);
    this.river.frustumCulled = false;
    this.river.layers.set(LAYER_WATER);
  }

  private oceanGeometry() {
    // radial grid: dense rings near the centre, exponentially wider outward, to ~24 km
    const rings = 150, segs = 192;
    const pos: number[] = [], kind: number[] = [], flow: number[] = [], idx: number[] = [];
    pos.push(0, 0, 0); kind.push(0); flow.push(0, 0);
    for (let r = 1; r <= rings; r++) {
      const rad = 0.9 * r * Math.pow(1.042, r);
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); kind.push(0); flow.push(0, 0);
      }
    }
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, b = 1 + (r - 1) * segs + ((s + 1) % segs);
      const c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setIndex(idx);
    return g;
  }

  private riverGeometry() {
    const pos: number[] = [], kind: number[] = [], flow: number[] = [], idx: number[] = [];
    const across = 9;
    let rows = 0;
    for (let z = RIVER_Z0 - 40; z <= 2720; z += 4) {
      const cx = riverX(z), w = riverWidth(z) * 0.5 + 9, y = riverLevel(z);
      const dx = riverX(z + 2) - riverX(z - 2), l = Math.hypot(dx, 4);
      const fx = dx / l, fz = 4 / l;
      for (let k = 0; k < across; k++) {
        const u = k / (across - 1) * 2 - 1;
        pos.push(cx + u * w * fz, y, z - u * w * fx);
        kind.push(1);
        const speed = 2.6 * (1 - u * u);
        flow.push(fx * speed * 0.35, fz * speed * 0.35);
      }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < across - 1; k++) {
      const a = r * across + k, b = a + 1, c = a + across, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    // the source lake: a disc
    const lx = riverX(RIVER_Z0 + 40), lz = RIVER_Z0 - 40, ly = riverLevel(RIVER_Z0);
    const base = pos.length / 3;
    pos.push(lx, ly, lz); kind.push(2); flow.push(0, 0);
    const segs = 64;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos.push(lx + Math.cos(a) * 190, ly, lz + Math.sin(a) * 190 / 1.3); kind.push(2); flow.push(0, 0);
    }
    for (let s = 0; s < segs; s++) idx.push(base, base + 1 + ((s + 1) % segs), base + 1 + s);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  update(cam: THREE.PerspectiveCamera) {
    // keep the ocean grid centred under the camera, snapped to avoid swimming vertices
    const snap = 4;
    this.ocean.position.set(Math.round(cam.position.x / snap) * snap, 0, Math.round(cam.position.z / snap) * snap);
    this.material.uniforms.uProj.value.copy(cam.projectionMatrix);
  }
}
