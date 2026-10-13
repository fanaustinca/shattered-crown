// Turns anatomies into skinned meshes: bones, bind pose, eyes, and coat/clothing materials.
import * as THREE from 'three';
import { horse, donkey, cow, pig, bunny, bird, human, type Anatomy, type HumanP } from './species';
import type { MeshData } from './sdf';
import { tex } from '../render/textures';
import type { Lighting } from '../render/lighting';

export interface Coat {
  coat: THREE.ColorRepresentation; coat2?: THREE.ColorRepresentation; belly?: THREE.ColorRepresentation;
  muzzle?: THREE.ColorRepresentation; hoof?: THREE.ColorRepresentation; hair?: THREE.ColorRepresentation;
  sock?: THREE.ColorRepresentation; horn?: THREE.ColorRepresentation; beak?: THREE.ColorRepresentation;
  pattern?: number; patternScale?: number; sockAmt?: number; fur?: number; roughness?: number;
  // clothing (humans)
  cloth1?: THREE.ColorRepresentation; cloth2?: THREE.ColorRepresentation; boots?: THREE.ColorRepresentation; skin?: THREE.ColorRepresentation; belt?: THREE.ColorRepresentation;
}

export interface Rig {
  root: THREE.Object3D;      // positioned/rotated by the creature
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  rest: THREE.Vector3[];     // bind-pose head positions (model space)
  anatomy: Anatomy;
  byName: Record<string, THREE.Bone>;
}

const VERT_PARS = `attribute float aRegion; varying vec3 vRest; varying float vRegion; varying vec3 vRestN;`;
const VERT_MAIN = `vRest = position; vRegion = aRegion; vRestN = normal;`;
const FRAG_PARS = /* glsl */ `
varying vec3 vRest; varying float vRegion; varying vec3 vRestN;
uniform vec3 uCoat, uCoat2, uBelly, uMuzzle, uHoof, uHair, uSock, uHorn, uBeak, uCloth1, uCloth2, uBoots, uSkin, uBelt;
uniform float uPattern, uPatScale, uSockAmt, uFur, uHumanTex;
uniform sampler2D tLinen, tLinenN, tLeather, tLeatherN, tNoiseC;
float hashC(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hashC(i), hashC(i + vec3(1,0,0)), f.x), mix(hashC(i + vec3(0,1,0)), hashC(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hashC(i + vec3(0,0,1)), hashC(i + vec3(1,0,1)), f.x), mix(hashC(i + vec3(0,1,1)), hashC(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float creatureRough = 0.78;
float fbmC(vec3 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.25 + vnoise(p * 4.1) * 0.125 + vnoise(p * 8.3) * 0.0625; }
vec4 triTex(sampler2D t, vec3 p, vec3 n, float s) {
  vec3 w = abs(n); w /= (w.x + w.y + w.z);
  return texture2D(t, p.yz * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, p.xy * s) * w.z;
}
`;
const FRAG_COLOR = /* glsl */ `
  int reg = int(floor(vRegion + 0.001));
  float regW = fract(vRegion);
  vec3 c = uCoat;
  float rough = roughness;
  float fn = fbmC(vRest * uPatScale);
  if (uPattern > 0.5 && uPattern < 1.5) {               // piebald / holstein patches
    float m = smoothstep(0.47, 0.53, fbmC(vRest * uPatScale * 0.55 + 3.1));
    c = mix(uCoat, uCoat2, m);
  } else if (uPattern > 1.5 && uPattern < 2.5) {        // dapples
    float d = smoothstep(0.55, 0.7, vnoise(vRest * uPatScale * 3.0));
    c = mix(uCoat, uCoat2, d * smoothstep(0.6, 1.2, vRest.y));
  } else if (uPattern > 2.5 && uPattern < 3.5) {        // agouti ticking
    c = mix(uCoat, uCoat2, smoothstep(0.35, 0.75, vnoise(vRest * 220.0)) * 0.6);
  } else if (uPattern > 3.5 && uPattern < 4.5) {        // dorsal stripe + shoulder cross (donkeys)
    float stripe = smoothstep(0.035, 0.012, abs(vRest.x)) * step(0.0, vRestN.y);
    c = mix(uCoat, uCoat2, stripe);
  }
  c *= 0.88 + 0.24 * fn;
  if (reg == 1) { c = uHoof; rough = 0.45; }
  else if (reg == 2) { c = mix(c, uMuzzle, smoothstep(0.2, 0.6, regW)); rough = 0.5; }
  else if (reg == 3) { c = mix(c, uBelly, smoothstep(0.1, 0.5, regW)); }
  else if (reg == 4) { c = uHair * (0.8 + 0.4 * vnoise(vRest * vec3(300.0, 30.0, 300.0))); rough = 0.6; }
  else if (reg == 7) { c = mix(c, uSock, uSockAmt * smoothstep(0.2, 0.0, vRest.y)); }
  else if (reg == 8) { c = uHorn; rough = 0.35; }
  else if (reg == 9) { c = uBeak; rough = 0.4; }
  else if (reg >= 10) {
    // clothing and skin, with real fabric textures mapped in bind space
    vec3 lin = triTex(tLinen, vRest, vRestN, 3.0).rgb;
    vec3 lea = triTex(tLeather, vRest, vRestN, 4.0).rgb;
    if (reg == 10) { c = uCloth1 * (lin * 1.9); rough = 0.9; }
    else if (reg == 11) { c = uCloth2 * (lin * 1.9); rough = 0.88; }
    else if (reg == 12) { c = uBoots * (lea * 2.2); rough = 0.55; }
    else if (reg == 13) { c = uSkin * (0.94 + 0.08 * vnoise(vRest * 80.0)); rough = 0.55; }
    else if (reg == 14) { c = uHair * (0.75 + 0.5 * vnoise(vRest * vec3(40.0, 400.0, 40.0))); rough = 0.5; }
    else if (reg == 15) { c = uBelt * (lea * 2.0); rough = 0.5; }
  }
  diffuseColor.rgb = c;
  creatureRough = rough;
`;
const FRAG_NORMAL = /* glsl */ `
  // fine hair / fabric weave as a normal perturbation in bind space
  {
    int regN = int(floor(vRegion + 0.001));
    float amp = regN >= 10 ? 0.25 : uFur;
    float sc = regN >= 10 ? 260.0 : 900.0;
    vec3 q = vRest * sc;
    vec3 g = vec3(vnoise(q + 1.3) - 0.5, vnoise(q + 7.1) - 0.5, vnoise(q + 3.7) - 0.5);
    normal = normalize(normal + (viewMatrix * vec4(g, 0.0)).xyz * amp);
  }
`;

export class CreatureLib {
  geos = new Map<string, THREE.BufferGeometry>();
  anatomies = new Map<string, Anatomy>();
  private eyeGeo = new THREE.SphereGeometry(1, 16, 12);
  private eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0605, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 });
  humanVariants: HumanP[] = [
    { female: false, build: 0, dress: false, beard: true, hairLong: false },
    { female: false, build: 1, dress: false, beard: false, hairLong: false },
    { female: true, build: 0, dress: true, beard: false, hairLong: true },
    { female: true, build: 0.5, dress: false, beard: false, hairLong: true },
    { female: false, build: 0.6, dress: false, beard: true, hairLong: false, armor: true },
    { female: false, build: 0.2, dress: false, beard: false, hairLong: true },
  ];

  constructor(private lighting: Lighting) {}

  async build(progress?: (f: number) => void) {
    const list: [string, Anatomy][] = [
      ['horse', horse()], ['donkey', donkey()], ['cow', cow()], ['pig', pig()], ['bunny', bunny()],
      ['sparrow', bird('sparrow')], ['crow', bird('crow')], ['pigeon', bird('pigeon')], ['chicken', bird('chicken')],
      ...this.humanVariants.map((v, i) => ['human' + i, human(v)] as [string, Anatomy]),
    ];
    const threads = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    let done = 0;
    const queue = list.map(([id, a], i) => ({ id, a, i }));
    await new Promise<void>((resolve, reject) => {
      let active = 0;
      const launchNext = () => {
        const job = queue.shift();
        if (!job) { if (active === 0) resolve(); return; }
        active++;
        const w = new Worker(new URL('./creature.worker.ts', import.meta.url), { type: 'module' });
        w.onerror = reject;
        w.onmessage = (e) => {
          const m = e.data.mesh as MeshData;
          this.geos.set(job.id, this.toGeometry(m));
          this.anatomies.set(job.id, job.a);
          w.terminate(); active--; done++;
          progress?.(done / list.length);
          launchNext();
        };
        w.postMessage({ id: job.i, anatomy: job.a });
      };
      for (let t = 0; t < threads; t++) launchNext();
    });
  }

  private toGeometry(m: MeshData) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight, 4));
    g.setAttribute('aRegion', new THREE.BufferAttribute(m.regions, 1));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeBoundingSphere();
    return g;
  }

  material(c: Coat, isHuman: boolean): THREE.MeshPhysicalMaterial {
    const col = (v: THREE.ColorRepresentation | undefined, d: THREE.ColorRepresentation) => new THREE.Color(v ?? d);
    const u = {
      uCoat: { value: col(c.coat, 0x806040) }, uCoat2: { value: col(c.coat2, 0xffffff) }, uBelly: { value: col(c.belly, c.coat) },
      uMuzzle: { value: col(c.muzzle, 0x2a2420) }, uHoof: { value: col(c.hoof, 0x1c1814) }, uHair: { value: col(c.hair, 0x1a1410) },
      uSock: { value: col(c.sock, 0xeeeeee) }, uHorn: { value: col(c.horn, 0xd8ccb0) }, uBeak: { value: col(c.beak, 0xd09030) },
      uCloth1: { value: col(c.cloth1, 0x6a5a40) }, uCloth2: { value: col(c.cloth2, 0x4a4030) }, uBoots: { value: col(c.boots, 0x3a2a1a) },
      uSkin: { value: col(c.skin, 0xc89878) }, uBelt: { value: col(c.belt, 0x3a2614) },
      uPattern: { value: c.pattern ?? 0 }, uPatScale: { value: c.patternScale ?? 3 }, uSockAmt: { value: c.sockAmt ?? 0 }, uFur: { value: c.fur ?? 0.35 },
      uHumanTex: { value: isHuman ? 1 : 0 },
      tLinen: { value: tex('materials/rough_linen_diff.webp', true) }, tLinenN: { value: tex('materials/rough_linen_nor.webp') },
      tLeather: { value: tex('materials/brown_leather_diff.webp', true) }, tLeatherN: { value: tex('materials/brown_leather_nor.webp') },
      tNoiseC: { value: null },
    };
    const m = new THREE.MeshPhysicalMaterial({ roughness: c.roughness ?? 0.78, metalness: 0, sheen: isHuman ? 0.3 : 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color(c.coat).lerp(new THREE.Color(1, 1, 1), 0.4) });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <map_fragment>', FRAG_COLOR)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = creatureRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL);
    };
    m.customProgramCacheKey = () => 'creature-v1';
    m.userData.u = u;
    this.lighting.prep(m);
    return m;
  }

  /** Create a posed, skinned instance of a species. */
  instance(id: string, coat: Coat): Rig {
    const a = this.anatomies.get(id)!, g = this.geos.get(id)!;
    const bones: THREE.Bone[] = [];
    const rest: THREE.Vector3[] = [];
    const byName: Record<string, THREE.Bone> = {};
    a.bones.forEach((b, i) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      const head = new THREE.Vector3(...b.head);
      rest.push(head);
      if (b.parent >= 0) { bone.position.copy(head).sub(rest[b.parent]); bones[b.parent].add(bone); } else bone.position.copy(head);
      bones.push(bone); byName[b.name] = bone;
    });
    const mesh = new THREE.SkinnedMesh(g, this.material(coat, id.startsWith('human')));
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const root = new THREE.Object3D();
    root.add(bones[0]);
    root.add(mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    for (const e of a.eyes ?? []) {
      const eye = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      eye.scale.setScalar(e.r);
      eye.position.set(e.pos[0], e.pos[1], e.pos[2]).sub(rest[e.bone]);
      eye.castShadow = false;
      bones[e.bone].add(eye);
    }
    return { root, mesh, bones, rest, anatomy: a, byName };
  }
}

// ---------------- coat presets ----------------
const pick = <T,>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length];
export function coatFor(species: string, r: () => number): Coat {
  switch (species) {
    case 'horse': return pick<Coat>([
      { coat: 0x5a3018, hair: 0x120c08, muzzle: 0x2a1a12, sock: 0xe8e2d8, sockAmt: r() < 0.5 ? 1 : 0, fur: 0.25 },          // bay
      { coat: 0x8a4a22, hair: 0x9a5a2a, muzzle: 0x3a2418, sock: 0xe8e2d8, sockAmt: r() < 0.4 ? 1 : 0, fur: 0.25 },          // chestnut
      { coat: 0x15110f, hair: 0x0a0806, muzzle: 0x161210, fur: 0.2, roughness: 0.6 },                                        // black
      { coat: 0x9a9690, coat2: 0x555250, pattern: 2, patternScale: 4, hair: 0xcfcac2, muzzle: 0x3a3634, fur: 0.25 },        // dapple grey
      { coat: 0xb89a6a, hair: 0xe8dcc0, muzzle: 0x6a5040, fur: 0.25 },                                                        // palomino
    ], r());
    case 'donkey': return { coat: 0x7a6e62, coat2: 0x2a2420, pattern: 4, belly: 0xd8d0c4, muzzle: 0xe0d8cc, hair: 0x2a2420, fur: 0.5 };
    case 'cow': return pick<Coat>([
      { coat: 0xf0ece4, coat2: 0x141210, pattern: 1, patternScale: 3.2, muzzle: 0xd8a0a0, horn: 0xd8ccb0, fur: 0.35 },
      { coat: 0x6a3a1e, belly: 0x8a5a3a, muzzle: 0x2a1a14, fur: 0.4 },
      { coat: 0x8a6a40, coat2: 0xe8e0d0, pattern: 1, patternScale: 2.5, muzzle: 0x3a2a20, fur: 0.4 },
    ], r());
    case 'pig': return pick<Coat>([
      { coat: 0xe8b0a0, belly: 0xf0c0b0, muzzle: 0xe0908a, hoof: 0x6a5048, fur: 0.15, roughness: 0.55 },
      { coat: 0xd89a88, coat2: 0x2a2220, pattern: 1, patternScale: 3, muzzle: 0xd08a80, hoof: 0x4a3a34, fur: 0.15, roughness: 0.55 },
    ], r());
    case 'bunny': return pick<Coat>([
      { coat: 0x7a6250, coat2: 0x2a201a, pattern: 3, belly: 0xe8e0d4, muzzle: 0xc8b8a8, fur: 0.6 },
      { coat: 0xa89070, coat2: 0x4a3a2a, pattern: 3, belly: 0xf0e8dc, muzzle: 0xd8c8b8, fur: 0.6 },
    ], r());
    case 'sparrow': return { coat: 0x6a4a2a, coat2: 0x2a1a10, pattern: 2, patternScale: 30, belly: 0xc8b8a0, hair: 0x3a2818, beak: 0x2a2420, fur: 0.4 };
    case 'crow': return { coat: 0x101012, belly: 0x18181c, hair: 0x08080a, beak: 0x101010, fur: 0.3, roughness: 0.45 };
    case 'pigeon': return { coat: 0x7a7e88, belly: 0x8a8a94, hair: 0x4a4e58, beak: 0x2a2a2a, muzzle: 0x6a8a7a, fur: 0.35 };
    case 'chicken': return pick<Coat>([
      { coat: 0xe8e2d4, belly: 0xf0eadc, hair: 0xd8d0c0, beak: 0xd8a040, muzzle: 0xc02018, fur: 0.5 },
      { coat: 0x8a4a1a, belly: 0xa05a24, hair: 0x2a1a10, beak: 0xd8a040, muzzle: 0xc02018, fur: 0.5 },
    ], r());
  }
  return { coat: 0x888888 };
}
export const SKIN_TONES = [0xf0c8a8, 0xe0b090, 0xc89070, 0xa87050, 0x7a4a30, 0x5a3420];
export const HAIR_COLORS = [0x1a120c, 0x3a2414, 0x6a4422, 0xa07840, 0xc8a870, 0x8a3a18, 0x9a9690];
