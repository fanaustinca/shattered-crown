// CDLOD terrain: an instanced patch mesh selected per frame from a quadtree, morphing seamlessly
// between LODs, displaced from a float heightmap, splatted with 12 photo-scanned materials
// (height-blended, anti-tiled, triplanar on cliffs), wetness/puddles under rain and snow cover.
import * as THREE from 'three';
import { HM_N, CELL, HALF } from '../world/layout';
import type { World } from '../world/world';
import { ASSET, loadArray } from './textures';
import { sharedUniforms } from './pipeline';
import type { Quality } from '../core/settings';
import type { Lighting } from './lighting';

const LODS = 9;
const LEAF = 64;                    // finest node size (2 m vertex spacing)
export const TERRAIN_LAYERS = [
  'forrest_ground_01', 'leafy_grass', 'forest_leaves_02', 'brown_mud_02', 'aerial_rocks_02', 'mossy_rock',
  'coast_sand_01', 'snow_02', 'farm_soil', 'cobblestone_floor_01', 'river_small_rocks', 'dry_ground_rocks',
];
// metres per texture repeat for each layer
const SCALE = [3.2, 3.6, 3.0, 3.0, 5.0, 11.0, 4.0, 5.0, 3.6, 2.6, 2.4, 3.4];

export const terrainUniforms = {
  tHeight: { value: null as THREE.Texture | null },
  tNormalMap: { value: null as THREE.Texture | null },
  tCtrlA: { value: null as THREE.Texture | null },
  tCtrlB: { value: null as THREE.Texture | null },
  tCrop: { value: null as THREE.Texture | null },
  uTCam: { value: new THREE.Vector3() },
  uHalf: { value: HALF }, uCell: { value: CELL }, uN: { value: HM_N }, uGrid: { value: 32 },
};

export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
uniform highp sampler2D tHeight;
uniform float uHalf, uCell, uN;
float terrainHeight(vec2 p) {
  vec2 f = (p + uHalf) / uCell;
  if (f.x < 0.0 || f.y < 0.0 || f.x >= uN - 1.0 || f.y >= uN - 1.0) return -50.0;
  ivec2 i = ivec2(floor(f)); vec2 t = f - vec2(i);
  float a = texelFetch(tHeight, i, 0).r, b = texelFetch(tHeight, i + ivec2(1, 0), 0).r;
  float c = texelFetch(tHeight, i + ivec2(0, 1), 0).r, d = texelFetch(tHeight, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec2 terrainUV(vec2 p) { return ((p + uHalf) / uCell + 0.5) / uN; }
`;

const VERT_PARS = /* glsl */ `
attribute vec4 aNode;
uniform vec3 uTCam;
uniform vec2 uMorph[${LODS}];
uniform float uGrid;
varying vec3 vTWorld;
${TERRAIN_HEIGHT_GLSL}
`;
const VERT_MAIN = /* glsl */ `
  vec2 gp = position.xz;
  vec2 wp = aNode.xy + gp * aNode.z;
  float dist = distance(wp, uTCam.xz);
  vec2 mr = uMorph[int(aNode.w + 0.5)];
  float mk = clamp((dist - mr.x) / (mr.y - mr.x), 0.0, 1.0);
  vec2 fracPart = fract(gp * uGrid * 0.5 + 1e-4) * 2.0 / uGrid;
  wp -= fracPart * aNode.z * mk;
  vec3 transformed = vec3(wp.x, terrainHeight(wp), wp.y);
  vTWorld = transformed;
`;

export class Terrain {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  nodeAttr: THREE.InstancedBufferAttribute;
  maxNodes = 1400;
  ranges: number[] = [];
  material: THREE.MeshStandardMaterial;
  ready = false;

  constructor(private world: World, private q: Quality, private lighting: Lighting) {
    // patch geometry in [0,1]^2
    const G = q.name === 'ultra' || q.name === 'high' ? 64 : 32;
    terrainUniforms.uGrid.value = G;
    const pos: number[] = [], idx: number[] = [];
    for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) pos.push(i / G, 0, j / G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = j * (G + 1) + i, b = a + 1, c = a + G + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geo.setIndex(idx);
    this.nodeAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.maxNodes * 4), 4);
    this.nodeAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aNode', this.nodeAttr);
    this.geo.instanceCount = 0;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e3, -1e6), new THREE.Vector3(1e6, 1e4, 1e6));

    this.setRanges(q.terrainRange);
    this.uploadWorld();
    this.material = this.makeMaterial();
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = this.makeDepthMaterial();
  }

  setRanges(r0: number) {
    this.ranges = [];
    r0 = Math.max(LEAF * 2.2, r0);
    for (let i = 0; i < LODS; i++) this.ranges.push(r0 * Math.pow(2, i));
    const morph: THREE.Vector2[] = [];
    for (let i = 0; i < LODS; i++) {
      const end = this.ranges[i] * 0.98, start = i === 0 ? end * 0.6 : Math.max(this.ranges[i - 1] * 1.02, end * 0.68);
      morph.push(new THREE.Vector2(start, end));
    }
    this.morph = morph;
    if (this.material) (this.material.userData.shader?.uniforms?.uMorph ?? {}).value = morph;
  }
  morph: THREE.Vector2[] = [];

  uploadWorld() {
    const w = this.world;
    const h = new THREE.DataTexture(w.heights, HM_N, HM_N, THREE.RedFormat, THREE.FloatType);
    h.minFilter = h.magFilter = THREE.NearestFilter; h.needsUpdate = true;
    const mk = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, HM_N, HM_N, THREE.RGBAFormat);
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
    };
    const crop = new THREE.DataTexture(w.crop, HM_N, HM_N, THREE.RedFormat, THREE.UnsignedByteType);
    crop.minFilter = crop.magFilter = THREE.NearestFilter; crop.needsUpdate = true;
    terrainUniforms.tHeight.value = h;
    terrainUniforms.tNormalMap.value = mk(w.normals);
    terrainUniforms.tCtrlA.value = mk(w.ctrlA);
    terrainUniforms.tCtrlB.value = mk(w.ctrlB);
    terrainUniforms.tCrop.value = crop;
  }

  async loadTextures(size: number) {
    const albh = await loadArray(TERRAIN_LAYERS.map((n) => ASSET(`terrain/${n}_ah.webp`)), size, true);
    const nr = await loadArray(TERRAIN_LAYERS.map((n) => ASSET(`terrain/${n}_nr.webp`)), size, false);
    this.texUniforms.tAlbH.value = albh;
    this.texUniforms.tNorRA.value = nr;
    this.ready = true;
  }
  texUniforms = { tAlbH: { value: null as THREE.Texture | null }, tNorRA: { value: null as THREE.Texture | null } };

  private makeMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    const tu = this.texUniforms;
    const morph = this.morph;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, terrainUniforms, tu, {
        uMorph: { value: morph }, tNoise: sharedUniforms.tNoise, uTime: sharedUniforms.uTime,
        uWetness: sharedUniforms.uWetness, uSnow: sharedUniforms.uSnow, uRain: sharedUniforms.uRain,
      });
      m.userData.shader = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', VERT_MAIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <map_fragment>', FRAG_SPLAT)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_begin>', FRAG_NORMAL)
        .replace('#include <normal_fragment_maps>', '')
        .replace('#include <aomap_fragment>', AO_FRAG);
    };
    m.customProgramCacheKey = () => 'terrain-v1';
    this.lighting.prep(m);
    return m;
  }

  private makeDepthMaterial() {
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const morph = this.morph;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, terrainUniforms, { uMorph: { value: morph } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <begin_vertex>', VERT_MAIN);
    };
    m.customProgramCacheKey = () => 'terrain-depth-v1';
    return m;
  }

  /** Select CDLOD nodes for this camera position. */
  update(cam: THREE.Vector3) {
    terrainUniforms.uTCam.value.copy(cam);
    const arr = this.nodeAttr.array as Float32Array;
    let n = 0;
    const leafSize = LEAF;
    const rootSize = leafSize * Math.pow(2, LODS - 1);
    const ranges = this.ranges;
    const add = (x: number, z: number, size: number, lod: number) => {
      if (n >= this.maxNodes) return;
      arr[n * 4] = x; arr[n * 4 + 1] = z; arr[n * 4 + 2] = size; arr[n * 4 + 3] = lod; n++;
    };
    const distRect = (x: number, z: number, size: number) => {
      const dx = Math.max(x - cam.x, 0, cam.x - (x + size)), dz = Math.max(z - cam.z, 0, cam.z - (z + size));
      return Math.hypot(dx, dz);
    };
    const select = (x: number, z: number, size: number, lod: number): boolean => {
      if (distRect(x, z, size) > ranges[lod]) return false;
      if (lod === 0) { add(x, z, size, 0); return true; }
      if (distRect(x, z, size) > ranges[lod - 1]) { add(x, z, size, lod); return true; }
      const h = size / 2;
      for (const [ox, oz] of [[0, 0], [h, 0], [0, h], [h, h]]) {
        if (!select(x + ox, z + oz, h, lod - 1)) add(x + ox, z + oz, h, lod);
      }
      return true;
    };
    // the root grid tiles a 3x3 area so the ocean floor extends to the horizon
    const R = rootSize;
    const cx = Math.floor(cam.x / R) * R, cz = Math.floor(cam.z / R) * R;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const x = cx + i * R, z = cz + j * R;
      if (!select(x, z, R, LODS - 1)) add(x, z, R, LODS - 1);
    }
    this.geo.instanceCount = n;
    this.nodeAttr.needsUpdate = true;
    this.nodeAttr.clearUpdateRanges();
    this.nodeAttr.addUpdateRange(0, n * 4);
  }
}

const FRAG_PARS = /* glsl */ `
uniform sampler2D tNormalMap, tCtrlA, tCtrlB, tNoise;
uniform highp sampler2DArray tAlbH, tNorRA;
uniform float uTime, uWetness, uSnow, uRain;
${TERRAIN_HEIGHT_GLSL}
uniform vec3 uTCam;
varying vec3 vTWorld;
float tRough; float tAO; vec3 tNormalW;
const float LSCALE[12] = float[12](${SCALE.map((s) => s.toFixed(2)).join(',')});
vec2 tUV(vec2 p) { return ((p + uHalf) / uCell + 0.5) / uN; }
vec4 nz(vec2 p) { return texture2D(tNoise, p); }
// rotate uv by a noise-driven angle for the anti-tiling second tap
vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec3 ripple(vec2 p, float t) {
  // procedural rain ripples: expanding rings in a few jittered cells
  vec3 n = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (k == 0 ? 3.0 : 4.7) + float(k) * 3.7;
    vec2 c = floor(q); vec2 f = fract(q) - 0.5;
    float h = fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5);
    vec2 o = vec2(fract(h * 13.1), fract(h * 71.7)) - 0.5;
    vec2 d = f - o * 0.5;
    float ph = fract(t * 1.3 + h);
    float r = length(d);
    float ring = sin((r - ph * 0.5) * 60.0) * smoothstep(0.0, 0.02, ph * 0.5 - r + 0.04) * (1.0 - ph) * smoothstep(0.5, 0.1, r);
    n.xy += normalize(d + 1e-4) * ring * 0.35;
  }
  return n;
}
`;

const FRAG_SPLAT = /* glsl */ `
  vec2 huv = tUV(vTWorld.xz);
  vec4 nrm = texture2D(tNormalMap, huv);
  float cav = nrm.a;
  // per-pixel normal from the float heightmap (8-bit normals band on long slopes)
  vec2 pe = vec2(uCell, 0.0);
  float hL = terrainHeight(vTWorld.xz - pe.xy), hR = terrainHeight(vTWorld.xz + pe.xy);
  float hD = terrainHeight(vTWorld.xz - pe.yx), hU = terrainHeight(vTWorld.xz + pe.yx);
  vec3 Nb = normalize(vec3(hL - hR, 2.0 * uCell, hD - hU));
  vec4 cA = texture2D(tCtrlA, huv);
  vec4 cB = texture2D(tCtrlB, huv);
  vec4 n1 = nz(vTWorld.xz / 180.0);
  vec4 n2 = nz(vTWorld.xz / 23.0);
  float slope = 1.0 - Nb.y;
  float camDist = distance(vTWorld, cameraPosition);

  float w[12];
  w[4] = 0.0;
  float east = cB.r, riverbed = cB.g, wetMud = cB.b, flowers = cB.a;
  float road = cA.r, pave = cA.g, field = cA.b, forest = cA.a;
  float dry = smoothstep(0.45, 0.75, n1.g + east * 0.25);
  w[0] = (1.0 - east) * (1.0 - dry * 0.6);
  w[1] = east * 0.35 + dry * 0.45 * (1.0 - east) + 0.1;
  w[2] = forest * (0.9 + east * 0.4) + east * (0.35 + smoothstep(0.45, 0.8, n2.r) * 0.5);
  w[4] += east * smoothstep(0.55, 0.85, n2.g) * 0.5 * smoothstep(60.0, 160.0, vTWorld.y);
  w[3] = wetMud * 0.9 + road * smoothstep(0.45, 0.7, n2.b) * 0.6;
  for (int i = 5; i < 12; i++) w[i] = 0.0;
  float sum = w[0] + w[1] + w[2] + w[3] + w[4];
  for (int i = 0; i < 5; i++) w[i] /= max(sum, 1e-3);
  // overlays, each covering what is under it
  #define OVER(i, a) { float _a = clamp(a, 0.0, 1.0); for (int k = 0; k < 12; k++) w[k] *= (1.0 - _a); w[i] += _a; }
  OVER(8, field);
  OVER(11, road * (1.0 - pave));
  OVER(9, pave);
  float sandW = (1.0 - smoothstep(1.4, 3.4, vTWorld.y + (n2.g - 0.5) * 1.6)) * (1.0 - riverbed) * (1.0 - pave);
  OVER(6, sandW);
  OVER(10, riverbed);
  float rockW = smoothstep(0.16, 0.30, slope + (n2.r - 0.5) * 0.14) * (1.0 - pave * 0.9);
  float cliffW = smoothstep(0.36, 0.52, slope + (n1.b - 0.5) * 0.12) * (1.0 - pave);
  OVER(4, rockW * (1.0 - cliffW));
  OVER(5, cliffW);
  float snowLine = 330.0 + (n1.r - 0.5) * 90.0 - uSnow * 340.0 * (0.3 + east * 0.7);
  float snowW = smoothstep(snowLine, snowLine + 45.0, vTWorld.y) * (1.0 - smoothstep(0.45, 0.65, slope));
  snowW = max(snowW, uSnow * smoothstep(0.65, 0.85, Nb.y) * smoothstep(-2.0, 8.0, vTWorld.y) * (1.0 - pave * 0.6) * smoothstep(0.3, 0.6, n2.a + uSnow * 0.5));
  OVER(7, snowW);

  // height-blend: sharpen transitions using each layer's displacement
  float hmax = -1.0; float hs[12];
  bool far = camDist > 900.0;
  float rotA = n1.a * 6.2831;
  for (int i = 0; i < 12; i++) {
    hs[i] = 0.0;
    if (w[i] < 0.02) { w[i] = 0.0; continue; }
    vec2 uv = vTWorld.xz / LSCALE[i];
    hs[i] = texture(tAlbH, vec3(uv, float(i))).a;
    hs[i] = (hs[i] - 0.5) * 0.5;
    hmax = max(hmax, hs[i] + w[i]);
  }
  float bw = 0.0;
  for (int i = 0; i < 12; i++) { if (w[i] > 0.0) { w[i] = max(hs[i] + w[i] - (hmax - 0.2), 0.0); bw += w[i]; } }
  vec3 alb = vec3(0.0); vec3 nts = vec3(0.0); float rgh = 0.0, aoL = 0.0;
  float tri = cliffW; // triplanar weight for steep faces
  vec3 an = abs(Nb);
  for (int i = 0; i < 12; i++) {
    if (w[i] <= 0.0) continue;
    float wi = w[i] / bw;
    float L = float(i);
    vec2 uv = vTWorld.xz / LSCALE[i];
    vec4 a, nr;
    if ((i == 5 || i == 4) && tri > 0.05) {
      // triplanar for cliffs (projected on X and Z planes, blended by normal)
      vec2 uvx = vTWorld.zy / LSCALE[i], uvz = vTWorld.xy / LSCALE[i];
      float bx = an.x / (an.x + an.z + 1e-4);
      a = mix(texture(tAlbH, vec3(uvz, L)), texture(tAlbH, vec3(uvx, L)), bx);
      nr = mix(texture(tNorRA, vec3(uvz, L)), texture(tNorRA, vec3(uvx, L)), bx);
      a = mix(texture(tAlbH, vec3(uv, L)), a, tri);
      nr = mix(texture(tNorRA, vec3(uv, L)), nr, tri);
    } else {
      a = texture(tAlbH, vec3(uv, L));
      nr = texture(tNorRA, vec3(uv, L));
      if (!far) {
        // anti-tiling: blend with a rotated, rescaled tap
        vec2 uv2 = rot2(uv * 0.37, rotA) + n1.xy * 3.0;
        vec4 a2 = texture(tAlbH, vec3(uv2, L));
        vec4 nr2 = texture(tNorRA, vec3(uv2, L));
        float m = smoothstep(0.35, 0.65, n2.b);
        a = mix(a, a2, m * 0.6); nr = mix(nr, nr2, m * 0.6);
      }
    }
    if (i == 0) a.rgb *= vec3(0.78, 1.0, 0.55);
    if (i == 1) a.rgb *= vec3(0.92, 1.0, 0.7);
    alb += a.rgb * wi; rgh += nr.b * wi; aoL += nr.a * wi;
    nts += vec3(nr.r * 2.0 - 1.0, -(nr.g * 2.0 - 1.0), 1.0) * wi;
  }
  // macro variation: large-scale colour patches so distant land isn't uniform
  alb *= 0.86 + 0.28 * vec3(n1.r, mix(n1.r, n1.g, 0.5), n1.g * 0.9 + 0.1);
  alb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.82), flowers * 0.25 * w[0]);
  tRough = rgh; tAO = aoL * mix(1.0, cav, 0.85);

  // world-space detail normal
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - Nb * Nb.x);
  vec3 B = normalize(vec3(0.0, 0.0, 1.0) - Nb * Nb.z);
  nts.xy *= mix(1.0, 0.35, smoothstep(150.0, 900.0, camDist));
  tNormalW = normalize(T * nts.x + B * nts.y + Nb * max(nts.z, 0.2));

  // rain: darken porous ground, glossy surfaces, puddles in hollows with ripples
  float wet = uWetness * (1.0 - snowW);
  if (wet > 0.001) {
    float porosity = 1.0 - w[9] / max(bw, 1e-3) * 0.5;
    alb *= mix(1.0, 0.58, wet * porosity);
    tRough = mix(tRough, 0.18, wet * 0.8);
    float hollow = smoothstep(0.62, 0.5, cav + (nz(vTWorld.xz / 7.0).r - 0.5) * 0.4) + (road + pave) * smoothstep(0.55, 0.75, nz(vTWorld.xz / 5.0).g);
    float puddle = clamp(hollow, 0.0, 1.0) * smoothstep(0.92, 0.985, Nb.y) * smoothstep(0.3, 0.8, wet);
    if (puddle > 0.01) {
      alb = mix(alb, alb * 0.35, puddle);
      tRough = mix(tRough, 0.03, puddle);
      vec3 rp = uRain > 0.01 ? ripple(vTWorld.xz, uTime) * uRain : vec3(0.0);
      tNormalW = normalize(mix(tNormalW, normalize(vec3(rp.x, 1.0, rp.y)), puddle));
    }
  }
  diffuseColor.rgb *= alb;
`;

const FRAG_NORMAL = /* glsl */ `
  float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
  vec3 normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);
  vec3 nonPerturbedNormal = normal;
`;

const AO_FRAG = /* glsl */ `
  float ambientOcclusion = tAO;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
`;
