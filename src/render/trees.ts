// Forest placement, LOD instancing (full mesh / reduced mesh / baked impostor billboards) and wind.
import * as THREE from 'three';
import type { World } from '../world/world';
import { SITES, HALF } from '../world/layout';
import { generateTree, foliageTexture, birchBark, type Species, type TreeParts } from './treegen';
import { pbr } from './textures';
import { sharedUniforms } from './pipeline';
import { skyUniforms } from './sky';
import type { Quality } from '../core/settings';
import type { Lighting } from './lighting';
import { mulberry32 } from '../core/noise';

const SPECIES: Species[] = ['spruce', 'pine', 'oak', 'birch', 'beech', 'bush'];
const VARIANTS = 3;
const CHUNK = 128;
const FRAMES = 8;            // impostor views around the tree
const FRAME_PX = 256;

interface TreeType { species: Species; variant: number; parts: TreeParts; lod1Wood: THREE.BufferGeometry; lod1Leaves: THREE.BufferGeometry; frameBase: number; size: THREE.Vector2; }

export const treeUniforms = {
  uTreeWind: { value: 0.5 },
};

const WIND_VERT = /* glsl */ `
  #ifdef USE_INSTANCING
    vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
    vec3 iPos = vec3(0.0);
  #endif
  float wPhase = dot(iPos.xz, vec2(0.07, 0.05));
  vec2 wdir = normalize(uWind + 1e-4);
  float wstr = length(uWind);
  float gust = sin(uTime * 0.7 + wPhase) * 0.5 + sin(uTime * 1.9 + wPhase * 2.3) * 0.3 + 0.6;
  float bend = aWind.x * aWind.x * wstr * gust * 0.35;
  transformed.xz += wdir * bend * (0.5 + position.y * 0.04);
  transformed.y -= bend * bend * 0.05;
  float fl = aWind.y * wstr * (0.04 + 0.04 * gust);
  transformed += vec3(sin(uTime * 7.0 + position.x * 3.0 + wPhase), cos(uTime * 6.1 + position.z * 3.0), sin(uTime * 5.3 + position.y * 2.0)) * fl;
`;

function addWind(m: THREE.Material, extraFrag?: (sh: THREE.WebGLProgramParametersWithUniforms) => void, leaves = false) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, { uTime: sharedUniforms.uTime, uWind: sharedUniforms.uWind });
    const inflate = leaves ? `
      #ifdef USE_INSTANCING
        vec3 wC = (instanceMatrix * vec4(aCenter, 1.0)).xyz;
        float dC = distance((modelMatrix * vec4(wC, 1.0)).xyz, cameraPosition);
        transformed = aCenter + (transformed - aCenter) * (1.0 + smoothstep(50.0, 450.0, dC) * 0.75);
      #endif` : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWind; uniform float uTime; uniform vec2 uWind;' + (leaves ? 'attribute vec3 aCenter;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + inflate + WIND_VERT);
    extraFrag?.(sh);
  };
}

/** Keep every k-th foliage card, enlarged, for the mid-distance LOD. */
function thinCards(g: THREE.BufferGeometry, keepEvery: number, grow: number): THREE.BufferGeometry {
  const P = g.getAttribute('position'), N = g.getAttribute('normal'), U = g.getAttribute('uv'), W = g.getAttribute('aWind'), C = g.getAttribute('aCenter');
  const cards = P.count / 4;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], wind: number[] = [], idx: number[] = [], ctr: number[] = [];
  for (let c = 0; c < cards; c += keepEvery) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 4; k++) { cx += P.getX(c * 4 + k) / 4; cy += P.getY(c * 4 + k) / 4; cz += P.getZ(c * 4 + k) / 4; }
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const v = c * 4 + k;
      pos.push(cx + (P.getX(v) - cx) * grow, cy + (P.getY(v) - cy) * grow, cz + (P.getZ(v) - cz) * grow);
      nor.push(N.getX(v), N.getY(v), N.getZ(v)); uv.push(U.getX(v), U.getY(v)); wind.push(W.getX(v), W.getY(v));
      ctr.push(C.getX(v), C.getY(v), C.getZ(v));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  o.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  o.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  o.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 2));
  o.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  o.setIndex(idx);
  o.computeBoundingSphere();
  return o;
}
/** Only the first (trunk) tube of a wood geometry. */
function trunkOnly(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.getIndex()!;
  // the trunk is the first tube; its triangles reference only its own (lowest) vertices
  const trunkVerts = g.userData.trunkVerts as number;
  const tri: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    if (a < trunkVerts && b < trunkVerts && c < trunkVerts) tri.push(a, b, c);
  }
  const o = g.clone();
  o.setIndex(tri);
  return o;
}

export class Trees {
  types: TreeType[] = [];
  /** packed trees: x, y, z, rotation, scale, typeIndex */
  data: Float32Array = new Float32Array(0);
  count = 0;
  chunks = new Map<number, number[]>(); // chunk key -> tree indices
  lod0: { wood: THREE.InstancedMesh; leaves: THREE.InstancedMesh }[] = [];
  lod1: { wood: THREE.InstancedMesh; leaves: THREE.InstancedMesh }[] = [];
  impostors!: THREE.Mesh;
  impAttr!: THREE.InstancedBufferAttribute;
  impMax = 260000;
  atlas!: THREE.WebGLRenderTarget;
  group = new THREE.Group();
  private lastCam = new THREE.Vector3(1e9, 0, 0);
  woodMats = new Map<Species, THREE.Material>();
  leafMats = new Map<Species, THREE.Material>();
  impMat!: THREE.ShaderMaterial;
  near0 = 110;
  orchards: { x: number; z: number; w: number; d: number; yaw: number }[] = [];

  constructor(private world: World, private q: Quality, private lighting: Lighting, private renderer: THREE.WebGLRenderer) {}

  build(progress?: (f: number) => void) {
    // ---- geometry + materials per species/variant ----
    const bark: Record<Species, THREE.Material> = {
      spruce: pbr('pine_bark', { repeat: 1, color: 0x8a8070 }),
      pine: pbr('pine_bark', { repeat: 1, color: 0xc29a7a }),
      oak: pbr('bark_brown_02', { repeat: 1 }),
      beech: pbr('bark_brown_02', { repeat: 1, color: 0x9a9a92 }),
      birch: new THREE.MeshStandardMaterial({ map: birchBark(), roughness: 0.8 }),
      bush: pbr('bark_brown_02'),
    };
    for (const sp of SPECIES) {
      const wm = (bark[sp] as THREE.MeshStandardMaterial).clone();
      addWind(wm);
      this.lighting.prep(wm);
      this.woodMats.set(sp, wm);
      const lm = new THREE.MeshStandardMaterial({
        map: foliageTexture(sp, 7), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, metalness: 0,
        alphaToCoverage: this.q.msaa > 0,
      });
      addWind(lm, (sh) => {
        sh.uniforms.uSunColor = sharedUniforms.uSunColor;
        sh.uniforms.uSunDirT = skyUniforms.uSunDir;
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uSunColor; uniform vec3 uSunDirT;')
          .replace('#include <aomap_fragment>', `#include <aomap_fragment>
            // leaves glow when backlit by the sun
            vec3 vdT = normalize(vViewPosition);
            vec3 sunV = normalize((viewMatrix * vec4(uSunDirT, 0.0)).xyz);
            float back = pow(clamp(dot(normalize(-vViewPosition), -sunV), 0.0, 1.0), 4.0);
            reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * back * 0.45;
            reflectedLight.indirectDiffuse *= 0.85;`);
      }, true);
      this.lighting.prep(lm);
      this.leafMats.set(sp, lm);
      for (let v = 0; v < VARIANTS; v++) {
        const parts = generateTree(sp, v + 1);
        this.types.push({
          species: sp, variant: v, parts,
          lod1Wood: sp === 'bush' ? parts.wood : trunkOnly(parts.wood),
          lod1Leaves: sp === 'spruce' ? thinCards(parts.leaves, 1, 1.0) : thinCards(parts.leaves, 2, 1.25),
          frameBase: 0, size: new THREE.Vector2(),
        });
      }
    }
    progress?.(0.3);
    this.place();
    progress?.(0.7);
    this.makeInstanced();
    this.bakeImpostors();
    this.makeImpostorMesh();
    progress?.(1);
  }

  private typeIndex(sp: Species, v: number) { return SPECIES.indexOf(sp) * VARIANTS + v; }

  /** Scatter trees over the forest map with jittered sampling. */
  private place() {
    const w = this.world;
    const rnd = mulberry32(2024);
    const out: number[] = [];
    const cell = 5.5;
    const n = Math.floor((HALF * 2) / cell);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -HALF + (i + rnd()) * cell, z = -HALF + (j + rnd()) * cell;
      const f = w.forestAt(x, z);
      const r = rnd();
      const east = w.eastAt(x, z);
      const meadow = east > 0.5 ? 0.012 : 0.006;
      const isBushRoll = rnd();
      if (r > f * 0.8 + meadow && !(isBushRoll < 0.012 + f * 0.05)) continue;
      const h = w.heightAt(x, z);
      if (h < 2.2 || h > 330 + rnd() * 30) continue;
      const wl = w.waterLevelAt(x, z);
      if (h < wl + 0.8) continue;
      if (w.slopeAt(x, z) > 0.42) continue;
      if (w.roadAt(x, z) > 0.02 || w.fieldAt(x, z) > 0.05 || w.riverbedAt(x, z) > 0.01) continue;
      let inSite = false;
      for (const s of SITES) if (Math.hypot(x - s.x, z - s.z) < s.r * 1.15) { inSite = true; break; }
      if (inSite) continue;
      let sp: Species;
      const isTree = r <= f * 0.8 + meadow;
      if (!isTree) sp = 'bush';
      else if (east > 0.5) { const k = rnd(); sp = h > 200 ? (k < 0.85 ? 'spruce' : 'pine') : k < 0.6 ? 'spruce' : k < 0.95 ? 'pine' : 'birch'; }
      else { const k = rnd(); sp = k < 0.42 ? 'oak' : k < 0.72 ? 'beech' : k < 0.92 ? 'birch' : 'pine'; }
      const v = Math.floor(rnd() * VARIANTS);
      const scale = sp === 'bush' ? 0.7 + rnd() * 0.8 : 0.75 + rnd() * 0.5;
      out.push(x, h, z, rnd() * Math.PI * 2, scale, this.typeIndex(sp, v));
    }
    // orchards: neat rows of small, round fruit trees
    for (const o of this.orchards) {
      const c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
      for (let u = -o.w / 2 + 2.5; u < o.w / 2 - 1; u += 5) for (let v = -o.d / 2 + 2.5; v < o.d / 2 - 1; v += 5) {
        const x = o.x + u * c + v * sn + (rnd() - 0.5) * 0.6, z = o.z - u * sn + v * c + (rnd() - 0.5) * 0.6;
        out.push(x, w.heightAt(x, z), z, rnd() * Math.PI * 2, 0.42 + rnd() * 0.12, this.typeIndex(rnd() < 0.5 ? 'oak' : 'beech', Math.floor(rnd() * VARIANTS)));
      }
    }
    this.data = new Float32Array(out);
    this.count = out.length / 6;
    for (let t = 0; t < this.count; t++) {
      const k = this.chunkKey(this.data[t * 6], this.data[t * 6 + 2]);
      let arr = this.chunks.get(k);
      if (!arr) { arr = []; this.chunks.set(k, arr); }
      arr.push(t);
    }
  }
  chunkKey(x: number, z: number) { return (Math.floor((x + HALF) / CHUNK) & 0xffff) | ((Math.floor((z + HALF) / CHUNK) & 0xffff) << 16); }

  /** Iterate trees within r of (x,z) (used by physics for trunk colliders). */
  forEachNear(x: number, z: number, r: number, fn: (i: number, tx: number, ty: number, tz: number, scale: number, species: Species) => void) {
    const c0 = Math.floor((x - r + HALF) / CHUNK), c1 = Math.floor((x + r + HALF) / CHUNK);
    const d0 = Math.floor((z - r + HALF) / CHUNK), d1 = Math.floor((z + r + HALF) / CHUNK);
    for (let dj = d0; dj <= d1; dj++) for (let ci = c0; ci <= c1; ci++) {
      const arr = this.chunks.get((ci & 0xffff) | ((dj & 0xffff) << 16));
      if (!arr) continue;
      for (const t of arr) {
        const tx = this.data[t * 6], tz = this.data[t * 6 + 2];
        if ((tx - x) ** 2 + (tz - z) ** 2 < r * r) fn(t, tx, this.data[t * 6 + 1], tz, this.data[t * 6 + 4], this.types[this.data[t * 6 + 5]].species);
      }
    }
  }
  /** Remove a tree (felled). */
  remove(i: number) { this.data[i * 6 + 4] = 0; this.lastCam.set(1e9, 0, 0); }

  private makeInstanced() {
    const cap0 = 1600, cap1 = 9000;
    for (const t of this.types) {
      const mk = (g: THREE.BufferGeometry, m: THREE.Material, cap: number, shadow: boolean) => {
        const im = new THREE.InstancedMesh(g, m, cap);
        im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(im);
        return im;
      };
      const lm = this.leafMats.get(t.species)!, wm = this.woodMats.get(t.species)!;
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: (lm as THREE.MeshStandardMaterial).map, alphaTest: 0.45 });
      addWind(depth, undefined, true);
      const l0 = mk(t.parts.leaves, lm, cap0, true); l0.customDepthMaterial = depth;
      const l1 = mk(t.lod1Leaves, lm, cap1, true); l1.customDepthMaterial = depth;
      this.lod0.push({ wood: mk(t.parts.wood, wm, cap0, true), leaves: l0 });
      this.lod1.push({ wood: mk(t.lod1Wood, wm, cap1, false), leaves: l1 });
    }
  }

  /** Render each tree type from FRAMES directions into an albedo+normal atlas. */
  private bakeImpostors() {
    const total = this.types.length * FRAMES;
    const cols = Math.ceil(Math.sqrt(total));
    const size = cols * FRAME_PX;
    this.atlas = new THREE.WebGLRenderTarget(size, size, { count: 2, type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.atlas.textures[0].colorSpace = THREE.NoColorSpace;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const bakeMat = (map: THREE.Texture | null, alpha: boolean, tint: THREE.Color) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { map: { value: map }, tint: { value: tint } },
      vertexShader: `out vec2 vUv; out vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 tint; in vec2 vUv; in vec3 vN;
        layout(location = 0) out vec4 oAlb; layout(location = 1) out vec4 oNor;
        void main(){ vec4 c = texture(map, vUv); ${alpha ? 'if (c.a < 0.5) discard;' : ''}
          vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
          oAlb = vec4(pow(c.rgb * tint, vec3(1.0 / 2.2)), 1.0); oNor = vec4(n * 0.5 + 0.5, 1.0); }`,
      side: THREE.DoubleSide,
    });
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    r.setRenderTarget(this.atlas);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    let f = 0;
    for (const t of this.types) {
      t.frameBase = f;
      scene.clear();
      const woodMap = (this.woodMats.get(t.species) as THREE.MeshStandardMaterial).map;
      const wm = new THREE.Mesh(t.parts.wood, bakeMat(woodMap, false, new THREE.Color(1, 1, 1)));
      const lm = new THREE.Mesh(t.parts.leaves, bakeMat((this.leafMats.get(t.species) as THREE.MeshStandardMaterial).map, true, new THREE.Color(1, 1, 1)));
      scene.add(wm, lm);
      t.parts.leaves.computeBoundingBox(); t.parts.wood.computeBoundingBox();
      const bb = t.parts.leaves.boundingBox!.clone().union(t.parts.wood.boundingBox!);
      const halfW = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z)) * 1.02;
      const hgt = bb.max.y - Math.min(0, bb.min.y);
      const halfH = hgt / 2;
      t.size.set(halfW * 2, hgt);
      for (let k = 0; k < FRAMES; k++) {
        const a = (k / FRAMES) * Math.PI * 2;
        cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
        cam.position.set(Math.sin(a) * 60, bb.min.y + halfH, Math.cos(a) * 60);
        cam.lookAt(0, bb.min.y + halfH, 0);
        cam.updateProjectionMatrix();
        const fx = (f % cols) * FRAME_PX, fy = Math.floor(f / cols) * FRAME_PX;
        // square frames: stretch the narrower axis so the whole tree fits
        const side = Math.max(halfW, halfH);
        cam.left = -side; cam.right = side; cam.top = side; cam.bottom = -side;
        cam.position.y = bb.min.y + halfH; cam.updateProjectionMatrix();
        this.atlas.viewport.set(fx, fy, FRAME_PX, FRAME_PX);
        this.atlas.scissor.set(fx, fy, FRAME_PX, FRAME_PX);
        this.atlas.scissorTest = true;
        r.setRenderTarget(this.atlas);
        r.render(scene, cam);
        f++;
      }
      t.size.set(Math.max(halfW, halfH) * 2, Math.max(halfW, halfH) * 2);
      (t as TreeType & { yCenter: number }).yCenter = bb.min.y + halfH;
    }
    this.atlas.scissorTest = false;
    this.atlas.viewport.set(0, 0, size, size);
    r.setRenderTarget(prevRT);
    this.atlasCols = cols;
  }
  atlasCols = 1;

  private makeImpostorMesh() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.impAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.impMax * 4), 4); // x, z, packed(rot), packed(type+scale)
    this.impAttr.setUsage(THREE.DynamicDrawUsage);
    const yAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.impMax), 1);
    yAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aImp', this.impAttr);
    g.setAttribute('aImpY', yAttr);
    this.impY = yAttr;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    // per-type frame info: frameBase, size, yCenter
    const typeInfo = this.types.map((t) => new THREE.Vector4(t.frameBase, t.size.x, (t as TreeType & { yCenter: number }).yCenter, 0));
    this.impMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tAlb: { value: this.atlas.textures[0] }, tNor: { value: this.atlas.textures[1] },
        uCols: { value: this.atlasCols }, uTypes: { value: typeInfo },
        uSunDir: skyUniforms.uSunDir, uSunLight: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
        uNear: { value: 300 },
      },
      vertexShader: /* glsl */ `
        in vec4 aImp; in float aImpY;
        uniform vec4 uTypes[${this.types.length}];
        uniform float uCols, uNear;
        out vec2 vUv0, vUv1; out float vBlend; out vec3 vRight; out vec3 vToCam; out float vFade;
        void main() {
          int ti = int(aImp.w) / 1000;
          float scale = mod(aImp.w, 1000.0) / 100.0;
          vec4 info = uTypes[ti];
          float size = info.y * scale;
          vec3 base = vec3(aImp.x, aImpY, aImp.y);
          vec3 center = base + vec3(0.0, info.z * scale, 0.0);
          vec3 toCam = cameraPosition - center; toCam.y = 0.0;
          float dist = length(toCam);
          toCam /= max(dist, 1e-3);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 p = center + right * position.x * size + vec3(0.0, position.y * size, 0.0);
          // pick the two nearest baked views
          float ang = atan(toCam.x, toCam.z) - aImp.z;
          float fa = mod(ang / 6.2831853 * ${FRAMES}.0 + ${FRAMES * 4}.0, ${FRAMES}.0);
          float f0 = floor(fa), f1 = mod(f0 + 1.0, ${FRAMES}.0);
          vBlend = fa - f0;
          vec2 local = position.xy + 0.5;
          float i0 = info.x + f0, i1 = info.x + f1;
          vUv0 = (vec2(mod(i0, uCols), floor(i0 / uCols)) + local) / uCols;
          vUv1 = (vec2(mod(i1, uCols), floor(i1 / uCols)) + local) / uCols;
          vRight = right; vToCam = toCam;
          vFade = smoothstep(uNear * 0.92, uNear * 1.0, dist);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tAlb, tNor; uniform vec3 uSunDir, uSunLight, uAmb;
        in vec2 vUv0, vUv1; in float vBlend; in vec3 vRight; in vec3 vToCam; in float vFade;
        out vec4 oColor;
        float dith(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
        void main() {
          bool second = dith(gl_FragCoord.xy) < vBlend;
          vec2 uv = second ? vUv1 : vUv0;
          vec4 a = texture(tAlb, uv);
          if (a.a < 0.3) discard;
          a.rgb /= a.a;   // the atlas background is black: undo the coverage-weighted mip average
          if (dith(gl_FragCoord.xy + 17.0) > vFade) discard;
          vec4 nt = texture(tNor, uv); vec3 nb = (nt.xyz / max(nt.a, 1e-3)) * 2.0 - 1.0;
          vec3 n = normalize(vRight * nb.x + vec3(0.0, 1.0, 0.0) * nb.y + vToCam * nb.z);
          float ndl = max(dot(n, normalize(uSunDir)), 0.0);
          vec3 alb = pow(a.rgb, vec3(2.2));
          vec3 col = alb * (uSunLight * ndl * 0.9 + uAmb * (0.6 + 0.4 * n.y));
          oColor = vec4(col, 1.0);
        }`,
    });
    this.impostors = new THREE.Mesh(g, this.impMat);
    this.impostors.frustumCulled = false;
    this.group.add(this.impostors);
  }
  impY!: THREE.InstancedBufferAttribute;

  update(cam: THREE.Vector3, force = false) {
    const u = this.impMat.uniforms;
    u.uSunLight.value.copy(this.lighting.sunColor);
    const amb = (u.uAmb.value as THREE.Color);
    const d = this.lighting.dayFactor;
    amb.setRGB(0.18 * d + 0.012, 0.24 * d + 0.016, 0.34 * d + 0.03).multiplyScalar(1.6);
    if (!force && cam.distanceTo(this.lastCam) < 20) return;
    this.lastCam.copy(cam);
    const near0 = this.near0, near1 = this.q.treeDistance, far = 3600;
    u.uNear.value = near1;
    const counts0 = new Array(this.types.length).fill(0), counts1 = new Array(this.types.length).fill(0);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const imp = this.impAttr.array as Float32Array, impY = this.impY.array as Float32Array;
    let ni = 0;
    const c0 = Math.floor((cam.x - far + HALF) / CHUNK), c1 = Math.floor((cam.x + far + HALF) / CHUNK);
    const d0 = Math.floor((cam.z - far + HALF) / CHUNK), d1 = Math.floor((cam.z + far + HALF) / CHUNK);
    const D = this.data;
    for (let dj = d0; dj <= d1; dj++) for (let ci = c0; ci <= c1; ci++) {
      const arr = this.chunks.get((ci & 0xffff) | ((dj & 0xffff) << 16));
      if (!arr) continue;
      const ccx = -HALF + (ci + 0.5) * CHUNK - cam.x, ccz = -HALF + (dj + 0.5) * CHUNK - cam.z;
      const cd = Math.hypot(ccx, ccz);
      if (cd > far + CHUNK) continue;
      // thin out the farthest impostors
      const thin = cd > 2200 ? 3 : cd > 1400 ? 2 : 1;
      for (let a = 0; a < arr.length; a++) {
        const t = arr[a];
        const s = D[t * 6 + 4];
        if (s <= 0) continue;
        const x = D[t * 6], y = D[t * 6 + 1], z = D[t * 6 + 2], ty = D[t * 6 + 5];
        const dist = Math.hypot(x - cam.x, z - cam.z);
        if (dist < near0) {
          const k = counts0[ty]++;
          if (k < this.lod0[ty].wood.instanceMatrix.count) {
            qt.setFromAxisAngle(_up, D[t * 6 + 3]); sc.setScalar(s); ps.set(x, y, z);
            m.compose(ps, qt, sc);
            this.lod0[ty].wood.setMatrixAt(k, m); this.lod0[ty].leaves.setMatrixAt(k, m);
          }
        } else if (dist < near1) {
          const k = counts1[ty]++;
          if (k < this.lod1[ty].wood.instanceMatrix.count) {
            qt.setFromAxisAngle(_up, D[t * 6 + 3]); sc.setScalar(s); ps.set(x, y, z);
            m.compose(ps, qt, sc);
            this.lod1[ty].wood.setMatrixAt(k, m); this.lod1[ty].leaves.setMatrixAt(k, m);
          }
          // overlap band: impostor fades in over the last 8% of the mesh range
          if (dist > near1 * 0.92 && ni < this.impMax) {
            imp[ni * 4] = x; imp[ni * 4 + 1] = z; imp[ni * 4 + 2] = D[t * 6 + 3]; imp[ni * 4 + 3] = ty * 1000 + Math.min(999, Math.round(s * 100)); impY[ni] = y; ni++;
          }
        } else if (dist < far && ni < this.impMax && (thin === 1 || (t % thin) === 0)) {
          const s2 = s * (thin > 1 ? 1 + (thin - 1) * 0.15 : 1);
          imp[ni * 4] = x; imp[ni * 4 + 1] = z; imp[ni * 4 + 2] = D[t * 6 + 3]; imp[ni * 4 + 3] = ty * 1000 + Math.min(999, Math.round(s2 * 100)); impY[ni] = y; ni++;
        }
      }
    }
    for (let ty = 0; ty < this.types.length; ty++) {
      for (const [lod, counts] of [[this.lod0, counts0], [this.lod1, counts1]] as const) {
        const c = Math.min(counts[ty], lod[ty].wood.instanceMatrix.count);
        lod[ty].wood.count = c; lod[ty].leaves.count = c;
        lod[ty].wood.instanceMatrix.needsUpdate = true; lod[ty].leaves.instanceMatrix.needsUpdate = true;
      }
    }
    (this.impostors.geometry as THREE.InstancedBufferGeometry).instanceCount = ni;
    this.impAttr.needsUpdate = true; this.impY.needsUpdate = true;
    this.impAttr.clearUpdateRanges(); this.impAttr.addUpdateRange(0, ni * 4);
    this.impY.clearUpdateRanges(); this.impY.addUpdateRange(0, ni);
  }
}
const _up = new THREE.Vector3(0, 1, 0);
