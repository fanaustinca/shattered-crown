// Downloads CC0 assets from Poly Haven (https://polyhaven.com, all CC0) and optimises them for the web.
//   node tools/fetch-assets.mjs            fetch anything missing
//   node tools/fetch-assets.mjs --force    re-process everything
// Raw downloads go to assets-src/ (gitignored); optimised output goes to public/assets/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'assets');
const FORCE = process.argv.includes('--force');
const UA = { 'User-Agent': 'shattered-crown-build (github.com/fanaustinca/shattered-crown)' };

// id -> simplify ratio (1 = keep all triangles). Dimensions on Poly Haven are millimetres; glTF is metres.
export const MODELS = {
  dutch_ship_medium: 1, cannon_01: 1, treasure_chest: 0.2, wicker_basket_01: 0.4, wicker_basket_02: 0.5,
  food_apple_01: 0.25, food_pears_asian_01: 0.15, yellow_onion: 0.3, sweet_potato: 0.6, lemon: 0.4, croissant: 1,
  CheeseBox_01: 1, jug_01: 0.6, metal_jug: 0.6, antique_ceramic_vase_01: 0.5, wooden_bowl_01: 0.3, brass_goblets: 0.5,
  wooden_crate_01: 1, wooden_crate_02: 1, Barrel_01: 1, wine_barrel_01: 0.6, wooden_bucket_01: 1,
  kite_shield: 0.6, antique_estoc: 0.6, ornate_medieval_mace: 0.4, wooden_axe: 1, hatchet: 1,
  large_castle_door: 0.6, large_iron_gate: 0.4, modular_wooden_pier: 0.35,
  boulder_01: 0.06, rock_moss_set_01: 0.3, rock_moss_set_02: 0.3, namaqualand_boulder_02: 0.05, mountainside: 0.15,
  tree_stump_01: 0.2, dead_tree_trunk: 0.1, stone_fire_pit: 1, wooden_lantern_01: 0.6, Lantern_01: 0.3,
  fern_02: 1, shrub_02: 0.4, shrub_04: 0.5, nettle_plant: 0.5,
  wooden_stool_01: 0.5, wooden_table_02: 1, WoodenChair_01: 0.4, round_wooden_table_01: 0.6, painted_wooden_bench: 1,
  GothicCabinet_01: 0.6, vintage_wooden_drawer_01: 1, drawer_cabinet: 0.4, GothicBed_01: 0.5, spinning_wheel_01: 0.3,
  wooden_ladder: 0.6, rusted_spade_01: 0.5, wooden_broom: 0.4, wooden_barrels_01: 0.5,
};

// Terrain layers are packed into two RGBA webp images each: albedo+height and normal.xy+rough+ao.
export const TERRAIN = [
  'forrest_ground_01', 'leafy_grass', 'forest_leaves_02', 'brown_mud_02', 'aerial_rocks_02', 'mossy_rock',
  'coast_sand_01', 'snow_02', 'farm_soil', 'cobblestone_floor_01', 'river_small_rocks', 'dry_ground_rocks',
];

// Surface materials for buildings, props and characters: diffuse + normal + arm (ao/rough/metal).
export const MATERIALS = [
  'castle_brick_07', 'castle_wall_slates', 'medieval_blocks_02', 'plastered_wall_02', 'white_plaster_rough_01',
  'roof_slates_02', 'clay_roof_tiles_02', 'thatch_roof_angled', 'reed_roof_04', 'wood_planks', 'weathered_planks',
  'old_wood_floor', 'rough_pine_door', 'dark_wooden_planks', 'medieval_wood', 'pine_bark', 'bark_brown_02',
  'hessian_230', 'fabric_leather_02', 'rusty_metal_02', 'stone_wall_04', 'mossy_stone_wall', 'cobblestone_floor_01',
  'brown_leather', 'denim_fabric', 'rough_linen',
  // furniture woods, fabrics, metals and floors for interiors
  'wood_table_001', 'oak_veneer_01', 'walnut_veneer', 'dark_wood', 'fine_grained_wood', 'wood_peeling_paint_weathered',
  'blue_painted_planks', 'worn_planks', 'kitchen_wood', 'wood_cabinet_worn_long', 'stained_pine', 'plank_flooring_02',
  'fabric_pattern_05', 'fabric_pattern_07', 'gingham_check', 'quatrefoil_jacquard_fabric', 'floral_jacquard', 'hessian_380',
  'wool_boucle', 'knitted_fleece', 'velour_velvet', 'curly_teddy_natural', 'poly_wool_herringbone', 'crepe_satin',
  'metal_plate', 'green_metal_rust', 'monastery_stone_floor', 'stone_tiles_02', 'clay_floor_001', 'grey_plaster',
  'wood_shutter', 'wooden_gate', 'defense_wall', 'stacked_stone_wall', 'clay_plaster', 'flour', 'wooden_barrel', 'castle_brick_02_white', 'white_sandstone_blocks_02', 'castle_wall_varriation',
];

async function getJSON(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: UA }); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('failed ' + url);
}
async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); return; }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error('failed ' + url);
}

async function fetchModel(id, ratio) {
  const out = path.join(OUT, 'models', id + '.glb');
  if (fs.existsSync(out) && !FORCE) return;
  const files = await getJSON(`https://api.polyhaven.com/files/${id}`);
  const g = files.gltf['1k'].gltf;
  const dir = path.join(SRC, 'models', id);
  const main = path.join(dir, path.basename(g.url));
  await download(g.url, main);
  await Promise.all(Object.entries(g.include).map(([p, v]) => download(v.url, path.join(dir, p))));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['optimize', main, out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
    '--join', 'false', '--flatten', 'false', '--instance', 'false', '--palette', 'false'];
  if (ratio < 1) args.push('--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', '0.002');
  else args.push('--simplify', 'false');
  execFileSync(path.join(ROOT, 'node_modules/.bin/gltf-transform'), args, { stdio: 'pipe' });
  console.log('model', id, (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
}

async function texFiles(id) {
  const f = await getJSON(`https://api.polyhaven.com/files/${id}`);
  const pick = (k) => f[k]?.['1k']?.jpg?.url;
  return { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm'), rough: pick('Rough'), ao: pick('AO'), disp: pick('Displacement') };
}

async function fetchTerrain(id) {
  const a = path.join(OUT, 'terrain', id + '_ah.webp'), n = path.join(OUT, 'terrain', id + '_nr.webp');
  if (fs.existsSync(a) && fs.existsSync(n) && !FORCE) return;
  const u = await texFiles(id);
  const dir = path.join(SRC, 'textures', id);
  const loc = {};
  for (const [k, url] of Object.entries(u)) if (url) { loc[k] = path.join(dir, k + '.jpg'); await download(url, loc[k]); }
  const S = 1024;
  const raw = async (file, ch) => (await sharp(file).resize(S, S).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true }));
  const diff = await raw(loc.diff), nor = await raw(loc.nor);
  const disp = loc.disp ? await raw(loc.disp) : null;
  const arm = loc.arm ? await raw(loc.arm) : null;
  const rough = !arm && loc.rough ? await raw(loc.rough) : null;
  const ah = Buffer.alloc(S * S * 4), nr = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const c = diff.info.channels;
    ah[i * 4] = diff.data[i * c]; ah[i * 4 + 1] = diff.data[i * c + 1]; ah[i * 4 + 2] = diff.data[i * c + 2];
    ah[i * 4 + 3] = disp ? disp.data[i * disp.info.channels] : 128;
    const cn = nor.info.channels;
    nr[i * 4] = nor.data[i * cn]; nr[i * 4 + 1] = nor.data[i * cn + 1];
    nr[i * 4 + 2] = arm ? arm.data[i * arm.info.channels + 1] : rough ? rough.data[i * rough.info.channels] : 200;
    nr[i * 4 + 3] = arm ? arm.data[i * arm.info.channels] : 255;
  }
  fs.mkdirSync(path.dirname(a), { recursive: true });
  // alphaQuality 100 keeps the height channel usable for height-blended splatting
  await sharp(ah, { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 88, alphaQuality: 100 }).toFile(a);
  await sharp(nr, { raw: { width: S, height: S, channels: 4 } }).webp({ quality: 92, alphaQuality: 100, nearLossless: false }).toFile(n);
  console.log('terrain', id);
}

async function fetchMaterial(id) {
  const base = path.join(OUT, 'materials', id);
  if (fs.existsSync(base + '_diff.webp') && !FORCE) return;
  const u = await texFiles(id);
  const dir = path.join(SRC, 'textures', id);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  for (const k of ['diff', 'nor', 'arm']) {
    let url = u[k];
    if (!url) continue;
    const f = path.join(dir, k + '.jpg');
    await download(url, f);
    await sharp(f).resize(1024, 1024).webp({ quality: k === 'diff' ? 86 : 90 }).toFile(`${base}_${k}.webp`);
  }
  if (!u.arm && u.rough) { // synthesise arm from AO + roughness
    const r = path.join(dir, 'rough.jpg'); await download(u.rough, r);
    const R = await sharp(r).resize(1024, 1024).greyscale().raw().toBuffer();
    let A = null;
    if (u.ao) { const a = path.join(dir, 'ao.jpg'); await download(u.ao, a); A = await sharp(a).resize(1024, 1024).greyscale().raw().toBuffer(); }
    const buf = Buffer.alloc(1024 * 1024 * 3);
    for (let i = 0; i < 1024 * 1024; i++) { buf[i * 3] = A ? A[i] : 255; buf[i * 3 + 1] = R[i]; buf[i * 3 + 2] = 0; }
    await sharp(buf, { raw: { width: 1024, height: 1024, channels: 3 } }).webp({ quality: 90 }).toFile(`${base}_arm.webp`);
  }
  console.log('material', id);
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { console.error('FAIL', it, e.message); } } }));
}

await pool(TERRAIN, 4, fetchTerrain);
await pool(MATERIALS, 6, fetchMaterial);
await pool(Object.entries(MODELS), 3, ([id, r]) => fetchModel(id, r));
fs.writeFileSync(path.join(OUT, 'CREDITS.txt'), 'All textures and models in this folder are CC0 from Poly Haven (https://polyhaven.com).\n' +
  [...TERRAIN, ...MATERIALS, ...Object.keys(MODELS)].map((i) => ' - https://polyhaven.com/a/' + i).join('\n') + '\n');
console.log('done');
