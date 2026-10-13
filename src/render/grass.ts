// GPU grass: tiles of individual curved blades around the camera in three density rings.
// Blades sway in gusting wind, part around feet/hooves/wheels (interactors), become golden wheat
// in Vanguardia's fields, flatten under snow and darken in rain. Heights come from the terrain texture.
import * as THREE from 'three';
import { terrainUniforms, TERRAIN_HEIGHT_GLSL } from './terrain';
import { sharedUniforms } from './pipeline';
import type { Quality } from '../core/settings';
import type { Lighting } from './lighting';
import { mulberry32 } from '../core/noise';

const TILE = 8;
export const MAX_INTERACTORS = 24;
export const grassUniforms = {
  uInteract: { value: Array.from({ length: MAX_INTERACTORS }, () => new THREE.Vector4(0, -1e5, 0, 0)) },
  uGrassCam: { value: new THREE.Vector3() },
  uGrassRadius: { value: 60 },
};

function bladeGeometry(count: number, segs: number, widthMul: number, seed: number) {
  const rnd = mulberry32(seed);
  const vpb = (segs + 1) * 2;
  const pos = new Float32Array(count * vpb * 3);
  const root = new Float32Array(count * vpb * 2);
  const rand = new Float32Array(count * vpb * 4);
  const idx: number[] = [];
  for (let b = 0; b < count; b++) {
    const rx = rnd() * TILE, rz = rnd() * TILE;
    const r = [0.55 + rnd() * 0.75, (0.7 + rnd() * 0.6) * widthMul, rnd() * Math.PI * 2, rnd()];
    for (let s = 0; s <= segs; s++) {
      for (let side = 0; side < 2; side++) {
        const v = b * vpb + s * 2 + side;
        pos[v * 3] = side ? 1 : -1; pos[v * 3 + 1] = s / segs; pos[v * 3 + 2] = 0;
        root[v * 2] = rx; root[v * 2 + 1] = rz;
        rand.set(r, v * 4);
      }
      if (s < segs) {
        const a = b * vpb + s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRoot', new THREE.BufferAttribute(root, 2));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const VERT_PARS = /* glsl */ `
attribute vec2 aRoot;
attribute vec4 aRand;
attribute vec3 aTile;   // tile origin x, z, lod
uniform vec4 uInteract[${MAX_INTERACTORS}];
uniform vec3 uGrassCam;
uniform float uGrassRadius, uTime, uSnow, uWetness;
uniform vec2 uWind;
uniform sampler2D tCtrlA, tCtrlB, tNoise, tNormalMap;
uniform highp sampler2D tCrop;
varying vec3 vGColor;
varying float vGTip;
varying vec3 vGWorld;
${TERRAIN_HEIGHT_GLSL}
`;

const VERT_MAIN = /* glsl */ `
  vec2 rootW = aTile.xy + aRoot;
  vec2 huv = terrainUV(rootW);
  vec4 cA = texture2D(tCtrlA, huv);
  vec4 cB = texture2D(tCtrlB, huv);
  vec3 tn = texture2D(tNormalMap, huv).xyz * 2.0 - 1.0;
  float crop = texture2D(tCrop, huv).r * 255.0;
  float h0 = terrainHeight(rootW);
  float dist = distance(rootW, uGrassCam.xz);
  // density mask: no grass on roads, paving, cliffs, sand, riverbed, snow, under water
  float slope = 1.0 - tn.y;
  float east = cB.r;
  float grassy = (1.0 - cA.r) * (1.0 - cA.g) * (1.0 - cB.g) * (1.0 - smoothstep(0.18, 0.3, slope));
  grassy *= smoothstep(1.6, 3.6, h0) * (1.0 - smoothstep(300.0, 340.0, h0));
  grassy *= 1.0 - cA.a * 0.55;          // thinner on forest floors
  grassy *= mix(1.0, 0.7, east);
  float isWheat = (crop > 0.5 && crop < 1.5) ? cA.b : 0.0;
  float isGreens = (crop > 2.5) ? cA.b : 0.0;
  grassy = mix(grassy, 0.0, cA.b * (1.0 - isWheat - isGreens));   // plowed soil
  grassy = max(grassy, isWheat + isGreens);
  vec4 nz = texture2D(tNoise, rootW / 37.0);
  float clump = smoothstep(0.25, 0.7, nz.g + (1.0 - east) * 0.25);
  float keep = grassy * mix(0.55, 1.0, clump) * (1.0 - uSnow * 0.85);
  // distance fade: blades shrink out at the ring edge
  float fade = 1.0 - smoothstep(uGrassRadius * 0.75, uGrassRadius, dist);
  if (aRand.w > keep || fade <= 0.0) {
    gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
    return;
  }
  float hgt = aRand.x * mix(0.38, 0.75, nz.r) * mix(1.0, 0.65, east) * fade;
  float wid = aRand.y * 0.035;
  if (isWheat > 0.5) { hgt = 0.85 + aRand.x * 0.35; wid = 0.012; }
  if (isGreens > 0.5) { hgt = 0.22 + aRand.x * 0.15; wid = 0.07; }
  float lodW = aTile.z > 1.5 ? 2.6 : aTile.z > 0.5 ? 1.7 : 1.0;
  wid *= lodW;
  float t = position.y;
  // wind: large gusts travelling across the land + per-blade flutter
  vec2 wdir = normalize(uWind + 1e-4);
  float wstr = length(uWind);
  vec4 gust = texture2D(tNoise, (rootW - wdir * uTime * 6.0) / 90.0);
  float sway = (gust.r - 0.35) * 1.4 * wstr + sin(uTime * (1.8 + aRand.w) + aRand.z * 7.0) * 0.12 * (0.4 + wstr * 0.6);
  vec2 bendV = wdir * sway;
  // interactors flatten and part the grass
  for (int i = 0; i < ${MAX_INTERACTORS}; i++) {
    vec4 it = uInteract[i];
    vec3 d = vec3(rootW.x - it.x, h0 - it.y, rootW.y - it.z);
    float r = it.w;
    float dl = length(d.xz);
    if (r > 0.0 && dl < r * 1.6 && abs(d.y) < 2.5) {
      float k = 1.0 - smoothstep(r * 0.4, r * 1.6, dl);
      bendV += normalize(d.xz + 1e-3) * k * 2.2;
    }
  }
  float bl = length(bendV);
  if (bl > 1.4) bendV *= 1.4 / bl;
  float yaw = aRand.z;
  vec2 side = vec2(cos(yaw), sin(yaw));
  float curve = 0.25 + aRand.w * 0.4;
  vec2 lean = vec2(-side.y, side.x) * curve;
  vec2 off = (lean + bendV) * t * t * hgt;
  float drop = dot(bendV, bendV) * 0.25 * t * t * hgt;
  float w = wid * (1.0 - t * (isWheat > 0.5 ? 0.3 : 0.85));
  vec3 transformed = vec3(rootW.x + side.x * position.x * w + off.x, h0 + t * hgt - drop, rootW.y + side.y * position.x * w + off.y);
  if (isWheat > 0.5 && t > 0.75) {
    // heavy ears: thicken and droop the top quarter
    transformed.xz += side * position.x * 0.012;
    transformed.xz += wdir * (t - 0.75) * 0.25;
  }
  vGTip = t;
  vGWorld = transformed;
  // colour: dark roots to sunlit tips, dry patches, wheat gold, frost under snow
  vec3 lush = mix(vec3(0.07, 0.13, 0.025), vec3(0.18, 0.30, 0.06), t);
  vec3 dry = mix(vec3(0.16, 0.14, 0.05), vec3(0.42, 0.37, 0.16), t);
  float dryness = clamp(smoothstep(0.45, 0.8, nz.b) * 0.7 + east * 0.45, 0.0, 1.0);
  vec3 c = mix(lush, dry, dryness);
  c *= 0.8 + 0.4 * aRand.w;
  if (isWheat > 0.5) c = mix(vec3(0.25, 0.18, 0.05), vec3(0.78, 0.6, 0.24), t) * (0.85 + 0.3 * nz.a);
  if (isGreens > 0.5) c = mix(vec3(0.05, 0.12, 0.04), vec3(0.16, 0.3, 0.12), t);
  c = mix(c, c * 0.65, uWetness * 0.6);
  vGColor = c;
  vec3 objectNormal = normalize(vec3(side.y, 0.0, -side.x) * position.x * 0.4 + vec3(0.0, 1.0, 0.0));
`;

export class Grass {
  meshes: THREE.Mesh[] = [];
  private tileAttrs: THREE.InstancedBufferAttribute[] = [];
  private rings: { r0: number; r1: number; maxTiles: number }[];
  material: THREE.MeshStandardMaterial;

  constructor(private q: Quality, lighting: Lighting) {
    grassUniforms.uGrassRadius.value = q.grassRadius;
    const R = q.grassRadius;
    this.rings = [
      { r0: 0, r1: Math.min(R, Math.max(16, R * 0.28)), maxTiles: 0 },
      { r0: Math.max(16, R * 0.28), r1: Math.max(24, R * 0.55), maxTiles: 0 },
      { r0: Math.max(24, R * 0.55), r1: R, maxTiles: 0 },
    ];
    this.material = this.makeMaterial();
    lighting.prep(this.material);
    const dens = q.grassDensity;
    const counts = [dens * TILE * TILE, dens * TILE * TILE / 4, dens * TILE * TILE / 14];
    this.rings.forEach((ring, i) => {
      ring.maxTiles = Math.ceil((Math.PI * ring.r1 * ring.r1) / (TILE * TILE) * 1.4 + 16);
      const g = bladeGeometry(Math.max(8, Math.round(counts[i])), i === 0 ? 4 : i === 1 ? 3 : 2, 1, 100 + i);
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(ring.maxTiles * 3), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aTile', attr);
      g.instanceCount = 0;
      const m = new THREE.Mesh(g, this.material);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false;
      this.meshes.push(m);
      this.tileAttrs.push(attr);
    });
  }

  private makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide, vertexColors: false });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, terrainUniforms, grassUniforms, {
        uTime: sharedUniforms.uTime, tNoise: sharedUniforms.tNoise, uWind: sharedUniforms.uWind,
        uSnow: sharedUniforms.uSnow, uWetness: sharedUniforms.uWetness, uSunColor: sharedUniforms.uSunColor,
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <beginnormal_vertex>', VERT_MAIN)
        .replace('#include <begin_vertex>', '');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGColor; varying float vGTip; varying vec3 vGWorld; uniform vec3 uSunColor;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vGColor;')
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, 0.55));`)
        .replace('#include <aomap_fragment>', `
          float gAO = mix(0.35, 1.0, vGTip);
          reflectedLight.indirectDiffuse *= gAO;
          reflectedLight.directDiffuse *= mix(0.55, 1.0, vGTip);
          // translucency: light through blades when looking toward the sun
          vec3 vdir = normalize(vGWorld - cameraPosition);
          float trans = pow(max(dot(vdir, normalize(uSunDirG)), 0.0), 4.0) * vGTip;
          reflectedLight.directDiffuse += vGColor * uSunColor * trans * 0.35;
        `);
      sh.fragmentShader = 'uniform vec3 uSunDirG;\n' + sh.fragmentShader;
      sh.uniforms.uSunDirG = { value: sunDirRef };
    };
    m.customProgramCacheKey = () => 'grass-v1';
    return m;
  }

  update(cam: THREE.Vector3) {
    grassUniforms.uGrassCam.value.copy(cam);
    const cx = Math.floor(cam.x / TILE), cz = Math.floor(cam.z / TILE);
    this.rings.forEach((ring, i) => {
      const arr = this.tileAttrs[i].array as Float32Array;
      let n = 0;
      const span = Math.ceil(ring.r1 / TILE) + 1;
      for (let j = -span; j <= span; j++) for (let k = -span; k <= span; k++) {
        const x = (cx + k) * TILE, z = (cz + j) * TILE;
        // distance from camera to tile centre decides the ring
        const d = Math.hypot(x + TILE / 2 - cam.x, z + TILE / 2 - cam.z);
        if (d < ring.r0 || d >= ring.r1 || n >= ring.maxTiles) continue;
        arr[n * 3] = x; arr[n * 3 + 1] = z; arr[n * 3 + 2] = i; n++;
      }
      const g = this.meshes[i].geometry as THREE.InstancedBufferGeometry;
      g.instanceCount = n;
      this.tileAttrs[i].needsUpdate = true;
      this.tileAttrs[i].clearUpdateRanges();
      this.tileAttrs[i].addUpdateRange(0, n * 3);
    });
  }

  /** Set interactors: [x, y, z, radius] for player, animals, wheels… */
  setInteractors(list: THREE.Vector4[]) {
    const u = grassUniforms.uInteract.value;
    for (let i = 0; i < MAX_INTERACTORS; i++) {
      if (i < list.length) u[i].copy(list[i]); else u[i].set(0, -1e5, 0, 0);
    }
  }
}
export const sunDirRef = new THREE.Vector3(0, 1, 0);
