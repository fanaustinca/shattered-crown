// Material palette: string keys like "wood:oak|stain:honey|fin:varnished" or "cloth:linen|dye:madder"
// resolve to cached PBR materials built from Poly Haven texture sets.
import * as THREE from 'three';
import { pbr, tex } from '../render/textures';

export const WOODS: Record<string, string> = {
  oak: 'oak_veneer_01', walnut: 'walnut_veneer', pine: 'stained_pine', dark: 'dark_wood', table: 'wood_table_001',
  fine: 'fine_grained_wood', kitchen: 'kitchen_wood', worn: 'worn_planks', planks: 'wood_planks', weathered: 'weathered_planks',
  cabinet: 'wood_cabinet_worn_long', peeling: 'wood_peeling_paint_weathered', bluepaint: 'blue_painted_planks', rough: 'rough_pine_door',
};
export const STAINS: Record<string, number> = {
  natural: 0xffffff, honey: 0xffdcaa, amber: 0xe8b078, chestnut: 0xb07850, walnut: 0x8a6048, ebony: 0x4a3830,
  whitewash: 0xfff8f0, oxblood: 0xa05048, sage: 0x8a9a7a, woad: 0x7a8aa8,
};
export const FINISHES: Record<string, number> = { raw: 1.0, oiled: 0.78, waxed: 0.62, varnished: 0.42, lacquered: 0.3 };
export const FABRICS: Record<string, string> = {
  linen: 'rough_linen', gingham: 'gingham_check', jacquard: 'quatrefoil_jacquard_fabric', floral: 'floral_jacquard',
  weave: 'fabric_pattern_05', stripe: 'fabric_pattern_07', wool: 'wool_boucle', fleece: 'knitted_fleece', velvet: 'velour_velvet',
  fur: 'curly_teddy_natural', herringbone: 'poly_wool_herringbone', satin: 'crepe_satin', hessian: 'hessian_380', leather: 'brown_leather', canvas: 'hessian_230',
};
export const DYES: Record<string, number> = {
  undyed: 0xffffff, madder: 0xc05548, woad: 0x5a74b0, weld: 0xe8d070, walnut: 0x9a7458, moss: 0x7a9a5a, murex: 0x8a4a8a,
  lichen: 0xb0b8a0, saffron: 0xe8a040, soot: 0x4a4a50, rose: 0xe0a0a0, cream: 0xf4ead8,
};

const cache = new Map<string, THREE.Material>();
let prep: ((m: THREE.Material) => void) | null = null;
export function setMaterialPrep(fn: (m: THREE.Material) => void) { prep = fn; }

function parse(key: string) {
  const parts = key.split('|');
  const [kind, name] = parts[0].split(':');
  const opts: Record<string, string> = {};
  for (const p of parts.slice(1)) { const [k, v] = p.split(':'); opts[k] = v; }
  return { kind, name, opts };
}

export function material(key: string): THREE.Material {
  let m = cache.get(key);
  if (m) return m;
  const { kind, name, opts } = parse(key);
  switch (kind) {
    case 'wood': {
      const base = pbr(WOODS[name] ?? WOODS.oak, { color: STAINS[opts.stain ?? 'natural'] ?? 0xffffff });
      const w = base.clone();
      w.roughness = FINISHES[opts.fin ?? 'oiled'] ?? 0.8;
      w.metalness = 0;
      w.metalnessMap = null;
      m = w; break;
    }
    case 'cloth': {
      const base = pbr(FABRICS[name] ?? FABRICS.linen, { color: DYES[opts.dye ?? 'undyed'] ?? 0xffffff }).clone() as THREE.MeshStandardMaterial;
      const phys = new THREE.MeshPhysicalMaterial({
        map: base.map, normalMap: base.normalMap, aoMap: base.aoMap, roughnessMap: base.roughnessMap, color: base.color,
        roughness: 1, metalness: 0, sheen: name === 'velvet' || name === 'satin' || name === 'fur' ? 0.9 : 0.35, sheenRoughness: name === 'satin' ? 0.3 : 0.7,
        sheenColor: new THREE.Color(DYES[opts.dye ?? 'undyed'] ?? 0xffffff).lerp(new THREE.Color(1, 1, 1), 0.5), side: THREE.DoubleSide,
      });
      if (opts.rep) for (const t of [phys.map, phys.normalMap, phys.aoMap, phys.roughnessMap]) if (t) t.repeat.setScalar(+opts.rep);
      m = phys; break;
    }
    case 'mat': {
      // a direct Poly Haven set (walls, floors, roofs)
      m = pbr(name, { color: opts.tint ? parseInt(opts.tint, 16) : 0xffffff, normalScale: opts.ns ? +opts.ns : 1 }).clone();
      (m as THREE.MeshStandardMaterial).metalness = 0;
      (m as THREE.MeshStandardMaterial).metalnessMap = null;
      break;
    }
    case 'iron': m = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.55, metalness: 0.85, normalMap: tex('materials/metal_plate_nor.webp'), roughnessMap: tex('materials/rusty_metal_02_arm.webp') }); break;
    case 'rust': m = pbr('rusty_metal_02').clone(); break;
    case 'brass': m = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.32, metalness: 1 }); break;
    case 'pewter': m = new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.4, metalness: 0.9 }); break;
    case 'silver': m = new THREE.MeshStandardMaterial({ color: 0xe0e0e4, roughness: 0.18, metalness: 1 }); break;
    case 'gold': m = new THREE.MeshStandardMaterial({ color: 0xe8c060, roughness: 0.22, metalness: 1 }); break;
    case 'wax': m = new THREE.MeshPhysicalMaterial({ color: opts.c ? parseInt(opts.c, 16) : 0xf2e8d0, roughness: 0.45, metalness: 0, sheen: 0.5, sheenColor: new THREE.Color(1, 0.95, 0.85), transmission: 0, thickness: 0.02 }); break;
    case 'wick': m = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1 }); break;
    case 'flame': m = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.22).multiplyScalar(12), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); break;
    case 'glass': m = new THREE.MeshPhysicalMaterial({ color: opts.c ? parseInt(opts.c, 16) : 0xc8d8c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, envMapIntensity: 1.5 }); break;
    case 'straw': m = pbr('thatch_roof_angled', { color: 0xf0d890 }).clone(); break;
    case 'paper': m = new THREE.MeshStandardMaterial({ color: opts.c ? parseInt(opts.c, 16) : 0xe8dcc0, roughness: 0.95 }); break;
    case 'color': m = new THREE.MeshStandardMaterial({ color: parseInt(name, 16), roughness: opts.r ? +opts.r : 0.8, metalness: opts.m ? +opts.m : 0 }); break;
    case 'ceramic': m = new THREE.MeshPhysicalMaterial({ color: opts.c ? parseInt(opts.c, 16) : 0xb07050, roughness: opts.glaze ? 0.25 : 0.85, clearcoat: opts.glaze ? 0.8 : 0, metalness: 0 }); break;
    case 'stone': m = pbr(name || 'stone_tiles_02').clone(); (m as THREE.MeshStandardMaterial).metalness = 0; break;
    default: m = new THREE.MeshStandardMaterial({ color: 0xff00ff });
  }
  m!.name = key;
  if (opts.wx) weathering(m as THREE.MeshStandardMaterial, +opts.wx);
  // interior surfaces: the sky light (IBL) mostly doesn't reach inside rooms
  if (opts.in) (m as THREE.MeshStandardMaterial).envMapIntensity = 0.22;
  prep?.(m!);
  cache.set(key, m!);
  return m!;
}

/** Build meshes from a GeoBuilder output map. */
export function meshesFrom(geos: Map<string, THREE.BufferGeometry>, cast = true, suffix = ''): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (const [k, g] of geos) {
    const mesh = new THREE.Mesh(g, material(k.startsWith('flame') || k.startsWith('glass') ? k : k + suffix));
    mesh.castShadow = cast && !k.startsWith('flame') && !k.startsWith('glass');
    mesh.receiveShadow = true;
    if (k.startsWith('glass') || k.startsWith('flame')) mesh.layers.set(1);
    if (k.startsWith('glass') || k.startsWith('flame')) mesh.renderOrder = 5;
    out.push(mesh);
  }
  return out;
}

const WX_FRAG = /* glsl */ `
float wxHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wxNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(wxHash(i), wxHash(i + vec3(1,0,0)), f.x), mix(wxHash(i + vec3(0,1,0)), wxHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(wxHash(i + vec3(0,0,1)), wxHash(i + vec3(1,0,1)), f.x), mix(wxHash(i + vec3(0,1,1)), wxHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float wxFbm(vec3 p) { return wxNoise(p) * 0.55 + wxNoise(p * 2.1) * 0.3 + wxNoise(p * 4.3) * 0.15; }
`;
/** Weathering: patchy stone tone, rain streaks running down, moss in damp patches, soot. */
function weathering(m: THREE.MeshStandardMaterial, amount: number) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.uniforms.uWx = { value: amount };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWxPos; varying vec3 vWxN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWxPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWxN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWxPos; varying vec3 vWxN; uniform float uWx;' + WX_FRAG)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wp = vWxPos;
          float tone = wxFbm(wp * 0.11);
          vec3 tint = mix(vec3(0.82, 0.8, 0.76), vec3(1.1, 1.06, 0.98), tone);
          tint *= mix(vec3(1.0), vec3(1.04, 1.0, 0.92), smoothstep(0.55, 0.8, wxNoise(wp * 0.035 + 7.0)));
          // streaks: stretched noise running down the wall
          float streak = wxNoise(vec3(wp.x * 1.7 + wp.z * 1.7, wp.y * 0.12, wp.z * 1.7 - wp.x * 0.3));
          tint *= 1.0 - smoothstep(0.55, 0.85, streak) * 0.3 * uWx;
          // damp moss and lichen low down and on ledges
          float up = clamp(vWxN.y, 0.0, 1.0);
          float moss = smoothstep(0.66, 0.84, wxFbm(wp * 0.45 + 3.0)) * (0.2 + up * 0.8) * uWx;
          vec3 mossCol = diffuseColor.rgb * mix(vec3(0.55, 0.68, 0.38), vec3(0.7, 0.78, 0.5), wxNoise(wp * 3.0));
          diffuseColor.rgb = mix(diffuseColor.rgb * tint, mossCol, moss * 0.6);
          // fine pitting
          diffuseColor.rgb *= 0.92 + 0.16 * wxNoise(wp * 6.0);
        }`);
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (key ? key() : '') + '|wx';
}
