// Texture loading: exact (un-premultiplied) RGBA decoding for packed data textures, PBR material sets,
// and procedurally generated helper textures (noise, leaves, cloth patterns).
import * as THREE from 'three';

export const ASSET = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`;

let decodeGL: WebGL2RenderingContext | null = null;
// decoding (and the GPU read-back it needs) runs in a small pool of workers so streaming in new materials
// never stalls a frame; the main-thread path is kept as a fallback
let pool: Worker[] | null = null, poolOk = typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined';
let nextJob = 1;
const pending = new Map<number, { res: (u: Uint8Array) => void; rej: (e: unknown) => void }>();
function workers() {
  if (pool) return pool;
  pool = [];
  for (let i = 0; i < 3; i++) {
    const w = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; out?: Uint8Array; error?: string }>) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); if (e.data.out) p.res(e.data.out); else p.rej(e.data.error); };
    w.onerror = () => { poolOk = false; };
    pool.push(w);
  }
  return pool;
}
/** Decode an image to raw RGBA bytes without the premultiply round-trip a 2D canvas would apply. */
export async function decodeRGBA(url: string, size: number): Promise<Uint8Array> {
  if (poolOk) {
    try {
      const abs = new URL(url, location.href).href;
      const id = nextJob++, ws = workers();
      return await new Promise<Uint8Array>((res, rej) => { pending.set(id, { res, rej }); ws[id % ws.length].postMessage({ id, url: abs, size }); });
    } catch { poolOk = false; }
  }
  return decodeMain(url, size);
}
async function decodeMain(url: string, size: number): Promise<Uint8Array> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
  if (!decodeGL) {
    const c = new OffscreenCanvas(1, 1);
    decodeGL = c.getContext('webgl2', { premultipliedAlpha: false }) as WebGL2RenderingContext;
  }
  const gl = decodeGL;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const out = new Uint8Array(size * size * 4);
  gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, out);
  gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
  bmp.close();
  return out;
}

export async function loadArray(urls: string[], size: number, srgb: boolean): Promise<THREE.DataArrayTexture> {
  const data = new Uint8Array(size * size * 4 * urls.length);
  await Promise.all(urls.map(async (u, i) => data.set(await decodeRGBA(u, size), i * size * size * 4)));
  const t = new THREE.DataArrayTexture(data, size, size, urls.length);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const texLoader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
export function tex(path: string, srgb = false, repeat = 1): THREE.Texture {
  const key = path + (srgb ? '|s' : '') + '|' + repeat;
  let t = texCache.get(key);
  if (!t) {
    t = texLoader.load(ASSET(path));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.repeat.set(repeat, repeat);
    texCache.set(key, t);
  }
  return t;
}

export interface MatOpts { repeat?: number; color?: THREE.ColorRepresentation; roughness?: number; metalness?: number; normalScale?: number; side?: THREE.Side }
const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** A Poly Haven PBR set as a MeshStandardMaterial (diffuse/normal/arm). */
export function pbr(name: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const key = name + JSON.stringify(o);
  let m = matCache.get(key);
  if (m) return m;
  const r = o.repeat ?? 1;
  const arm = tex(`materials/${name}_arm.webp`, false, r);
  m = new THREE.MeshStandardMaterial({
    map: tex(`materials/${name}_diff.webp`, true, r),
    normalMap: tex(`materials/${name}_nor.webp`, false, r),
    aoMap: arm, roughnessMap: arm, metalnessMap: arm,
    roughness: o.roughness ?? 1, metalness: o.metalness ?? 1,
    color: o.color ?? 0xffffff, side: o.side ?? THREE.FrontSide,
  });
  m.normalScale.setScalar(o.normalScale ?? 1);
  // Poly Haven's metal channel is usually black; treat metalness as a multiplier on it
  if (o.metalness === undefined) m.metalness = 1;
  m.name = name;
  matCache.set(key, m);
  return m;
}

// ---------------- procedural helpers ----------------

/** Tileable RGBA value-noise texture (each channel a different octave), used by many shaders. */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const grid = (cells: number, seed: number) => {
    const g = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return (x: number, y: number) => {
      const fx = x * cells, fy = y * cells;
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[((b % cells + cells) % cells) * cells + ((a % cells + cells) % cells)];
      return (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
    };
  };
  const octs = [[4, 1], [8, 2], [16, 3], [32, 4], [64, 5]].map(([c, s]) => grid(c, s * 7919));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, k = (y * size + x) * 4;
    const f = (a: number) => octs[a](u, v);
    data[k] = (f(0) * 0.5 + f(1) * 0.3 + f(2) * 0.2) * 255;
    data[k + 1] = (f(1) * 0.5 + f(2) * 0.3 + f(3) * 0.2) * 255;
    data[k + 2] = (f(2) * 0.5 + f(3) * 0.3 + f(4) * 0.2) * 255;
    data[k + 3] = f(4) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Tileable 3D Perlin-Worley noise for volumetric clouds (R: perlin-worley, G/B/A: worley octaves). */
export function makeCloudNoise3D(size = 64): THREE.Data3DTexture {
  const N = size, data = new Uint8Array(N * N * N * 4);
  const worley = (cells: number, seed: number) => {
    const pts = new Float32Array(cells * cells * cells * 3);
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < pts.length; i++) pts[i] = rnd();
    return (x: number, y: number, z: number) => {
      const fx = x * cells, fy = y * cells, fz = z * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let md = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
        const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells, wz = ((cz % cells) + cells) % cells;
        const p = (wz * cells * cells + wy * cells + wx) * 3;
        const px = cx + pts[p], py = cy + pts[p + 1], pz = cz + pts[p + 2];
        const d = (px - fx) ** 2 + (py - fy) ** 2 + (pz - fz) ** 2;
        if (d < md) md = d;
      }
      return 1 - Math.min(1, Math.sqrt(md));
    };
  };
  const perlinish = (() => {
    const cells = 4; const g = new Float32Array(cells ** 3); let s = 17;
    for (let i = 0; i < g.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; g[i] = s / 4294967296; }
    const at = (a: number, b: number, c: number) => g[(((c % cells) + cells) % cells) * cells * cells + (((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)];
    const one = (x: number, y: number, z: number, m: number) => {
      const fx = x * cells * m, fy = y * cells * m, fz = z * cells * m;
      const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
      const tx = fx - i, ty = fy - j, tz = fz - k;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      return l(l(l(at(i, j, k), at(i + 1, j, k), sx), l(at(i, j + 1, k), at(i + 1, j + 1, k), sx), sy),
        l(l(at(i, j, k + 1), at(i + 1, j, k + 1), sx), l(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), sx), sy), sz);
    };
    return (x: number, y: number, z: number) => one(x, y, z, 1) * 0.5 + one(x * 2, y * 2, z * 2, 1) * 0.3 + one(x * 4, y * 4, z * 4, 1) * 0.2;
  })();
  const w1 = worley(4, 11), w2 = worley(8, 23), w3 = worley(16, 37), w4 = worley(32, 51);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, w = z / N, k = (z * N * N + y * N + x) * 4;
    const wf = w1(u, v, w) * 0.625 + w2(u, v, w) * 0.25 + w3(u, v, w) * 0.125;
    const p = perlinish(u, v, w);
    const pw = Math.max(0, Math.min(1, (p - (1 - wf)) / (1 - (1 - wf) + 1e-3) * 0.5 + p * 0.5));
    data[k] = pw * 255;
    data[k + 1] = wf * 255;
    data[k + 2] = (w2(u, v, w) * 0.625 + w3(u, v, w) * 0.25 + w4(u, v, w) * 0.125) * 255;
    data[k + 3] = (w3(u, v, w) * 0.625 + w4(u, v, w) * 0.375) * 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Canvas helper. */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}
