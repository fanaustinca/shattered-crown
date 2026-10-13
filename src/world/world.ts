// World data: heightmap, biome/control maps, roads, fields. Generated once at boot (multi-threaded).
import { HM_N, CELL, HALF, WORLD, ROADS, SITES, makeBridges, resolveRoadPt, riverX, riverWidth, riverLevel, RIVER_Z0, type Bridge, type Site } from './layout';
import { mulberry32, smoothstep, clamp, Simplex } from '../core/noise';

export interface RoadPath { kind: 'road' | 'track'; pts: Float32Array; /* x,z,y triples every ~2m */ width: number }
export interface Field { x: number; z: number; w: number; d: number; yaw: number; crop: number; site: string }

export class World {
  heights = new Float32Array(HM_N * HM_N);
  /** R road, G paving, B field, A forest floor */
  ctrlA = new Uint8Array(HM_N * HM_N * 4);
  /** R east biome, G riverbed, B wet/mud, A flowers */
  ctrlB = new Uint8Array(HM_N * HM_N * 4);
  /** RGB normal (0..255), A cavity AO */
  normals = new Uint8Array(HM_N * HM_N * 4);
  /** crop type per sample (0 none, 1 wheat, 2 plowed, 3 greens) */
  crop = new Uint8Array(HM_N * HM_N);
  bridges: Bridge[] = makeBridges();
  roads: RoadPath[] = [];
  fields: Field[] = [];
  forest = new Uint8Array(HM_N * HM_N);
  noise = new Simplex(99);

  async generate(progress: (f: number, msg: string) => void) {
    const threads = Math.max(2, Math.min(12, (navigator.hardwareConcurrency || 4) - 1));
    const band = Math.ceil(HM_N / (threads * 4));
    const jobs: { r0: number; r1: number }[] = [];
    for (let r = 0; r < HM_N; r += band) jobs.push({ r0: r, r1: Math.min(HM_N, r + band) });
    let done = 0;
    await new Promise<void>((resolve, reject) => {
      const workers: Worker[] = [];
      const next = (w: Worker) => {
        const j = jobs.shift();
        if (j) w.postMessage(j); else w.terminate();
      };
      for (let t = 0; t < threads; t++) {
        const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
        workers.push(w);
        w.onerror = (e) => reject(e);
        w.onmessage = (e) => {
          const { r0, heights, bio, wet } = e.data as { r0: number; r1: number; heights: Float32Array; bio: Uint8Array; wet: Uint8Array };
          this.heights.set(heights, r0 * HM_N);
          const o = r0 * HM_N;
          for (let k = 0; k < heights.length; k++) {
            const q = (o + k) * 4;
            this.ctrlB[q] = bio[k * 4]; this.ctrlB[q + 1] = bio[k * 4 + 1]; this.ctrlB[q + 2] = wet[k]; this.ctrlB[q + 3] = bio[k * 4 + 3];
            this.forest[o + k] = bio[k * 4 + 2];
          }
          done++;
          progress(0.6 * done / (done + jobs.length + 0.0001), 'Raising mountains and carving the river');
          if (done === Math.ceil(HM_N / band)) { resolve(); }
          next(w);
        };
        next(w);
      }
    });
    progress(0.62, 'Laying roads');
    await tick();
    this.buildRoads();
    progress(0.7, 'Ploughing fields');
    await tick();
    this.buildFields();
  }

  /** Call after settlements have painted paving and levelled their building pads. */
  finalize() {
    this.computeNormals();
    for (let k = 0; k < HM_N * HM_N; k++) this.ctrlA[k * 4 + 3] = this.forest[k];
  }

  /** Paint paving (cobbles) in a disc. */
  pave(x: number, z: number, r: number, amount = 1) {
    this.paint(x, z, r + 1.5, (q, d) => {
      const w = (1 - smoothstep(r - 1, r + 1.5, d)) * amount;
      if (w * 255 > this.ctrlA[q * 4 + 1]) this.ctrlA[q * 4 + 1] = Math.round(w * 255);
      this.forest[q] = 0;
    });
  }
  /** Paint paving along a segment. */
  paveLine(x0: number, z0: number, x1: number, z1: number, w: number, amount = 1) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 1.5));
    for (let k = 0; k <= n; k++) this.pave(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n, w / 2, amount);
  }
  /** Level the ground under a rectangular footprint to height y (with a soft skirt). */
  levelRect(x: number, z: number, w: number, d: number, yaw: number, y: number, skirt = 4) {
    const c = Math.cos(yaw), sn = Math.sin(yaw), R = Math.hypot(w, d) / 2 + skirt;
    this.paint(x, z, R, (q) => {
      const i = q % HM_N, j = Math.floor(q / HM_N);
      const px = -HALF + i * CELL - x, pz = -HALF + j * CELL - z;
      // local axes: yaw rotates +x to (cos, -sin)
      const u = c * px - sn * pz, v = sn * px + c * pz;
      const ex = Math.max(0, Math.abs(u) - w / 2), ez = Math.max(0, Math.abs(v) - d / 2);
      const e = Math.hypot(ex, ez);
      const wgt = 1 - smoothstep(0, skirt, e);
      if (wgt > 0) this.heights[q] += (y - this.heights[q]) * wgt;
      this.forest[q] = 0;
    });
  }
  /** Mark a building footprint as built-over (paving channel, no grass, no trees). */
  paveRect(x: number, z: number, w: number, d: number, yaw: number) {
    const c = Math.cos(yaw), sn = Math.sin(yaw), R = Math.hypot(w, d) / 2 + 1;
    this.paint(x, z, R, (q) => {
      const i = q % HM_N, j = Math.floor(q / HM_N);
      const px = -HALF + i * CELL - x, pz = -HALF + j * CELL - z;
      const u = c * px - sn * pz, v = sn * px + c * pz;
      if (Math.abs(u) < w / 2 + 1.5 && Math.abs(v) < d / 2 + 1.5) { this.ctrlA[q * 4 + 1] = 255; this.forest[q] = 0; }
    });
  }
  clearForest(x: number, z: number, r: number) { this.paint(x, z, r, (q) => { this.forest[q] = 0; }); }

  // ---------- queries ----------
  /** Bilinear terrain height (matches the GPU and the physics heightfield closely). */
  heightAt(x: number, z: number): number {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= HM_N - 1 || fz >= HM_N - 1) return -50;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const H = this.heights, k = j * HM_N + i;
    const a = H[k], b = H[k + 1], c = H[k + HM_N], d = H[k + HM_N + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  normalAt(x: number, z: number, out = { x: 0, y: 1, z: 0 }) {
    const e = CELL;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out.x = -hx / l; out.y = 2 * e / l; out.z = -hz / l;
    return out;
  }
  slopeAt(x: number, z: number) { return 1 - this.normalAt(x, z).y; }
  /** Sample a control byte (0..1) bilinearly. */
  ctrl(arr: Uint8Array, ch: number, x: number, z: number): number {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    if (fx < 0 || fz < 0 || fx >= HM_N - 1 || fz >= HM_N - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * HM_N + i;
    const g = (q: number) => arr[q * 4 + ch];
    return ((g(k) * (1 - tx) + g(k + 1) * tx) * (1 - tz) + (g(k + HM_N) * (1 - tx) + g(k + HM_N + 1) * tx) * tz) / 255;
  }
  roadAt(x: number, z: number) { return Math.max(this.ctrl(this.ctrlA, 0, x, z), this.ctrl(this.ctrlA, 1, x, z)); }
  fieldAt(x: number, z: number) { return this.ctrl(this.ctrlA, 2, x, z); }
  forestAt(x: number, z: number) { return this.ctrl(this.ctrlA, 3, x, z); }
  eastAt(x: number, z: number) { return this.ctrl(this.ctrlB, 0, x, z); }
  riverbedAt(x: number, z: number) { return this.ctrl(this.ctrlB, 1, x, z); }

  /** Height of the water surface at (x,z), or -Infinity if there is no water body here other than the sea (0). */
  waterLevelAt(x: number, z: number): number {
    if (z > RIVER_Z0 - 60 && z < 3100) {
      const d = Math.abs(x - riverX(z));
      if (d < riverWidth(z) * 0.5 + 10) return riverLevel(z);
    }
    const lx = riverX(RIVER_Z0 + 40), lz = RIVER_Z0 - 40;
    if (Math.hypot(x - lx, (z - lz) * 1.3) < 185) return riverLevel(RIVER_Z0);
    return 0;
  }
  /** River current (m/s) at a point, zero outside the river. */
  currentAt(x: number, z: number): [number, number] {
    if (z < RIVER_Z0 || z > 3000) return [0, 0];
    const d = Math.abs(x - riverX(z)), w = riverWidth(z) * 0.5;
    if (d > w) return [0, 0];
    const s = 2.6 * (1 - (d / w) ** 2);
    const dx = riverX(z + 1) - riverX(z - 1), l = Math.hypot(dx, 2);
    return [dx / l * s, 2 / l * s];
  }
  inBounds(x: number, z: number) { return Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10; }

  // ---------- generation passes ----------
  private paint(x: number, z: number, radius: number, fn: (k: number, d: number) => void) {
    const i0 = Math.max(0, Math.floor((x - radius + HALF) / CELL)), i1 = Math.min(HM_N - 1, Math.ceil((x + radius + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z - radius + HALF) / CELL)), j1 = Math.min(HM_N - 1, Math.ceil((z + radius + HALF) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = -HALF + i * CELL, pz = -HALF + j * CELL;
      const d = Math.hypot(px - x, pz - z);
      if (d <= radius) fn(j * HM_N + i, d);
    }
  }

  private buildRoads() {
    for (const r of ROADS) {
      const ctrl = r.pts.map((p) => resolveRoadPt(p, this.bridges));
      // Catmull-Rom through the waypoints, then add gentle wiggle so roads don't look ruled
      const pts: number[] = [];
      for (let s = 0; s < ctrl.length - 1; s++) {
        const p0 = ctrl[Math.max(0, s - 1)], p1 = ctrl[s], p2 = ctrl[s + 1], p3 = ctrl[Math.min(ctrl.length - 1, s + 2)];
        const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const n = Math.max(2, Math.ceil(len / 2));
        for (let k = 0; k < n; k++) {
          const t = k / n, t2 = t * t, t3 = t2 * t;
          const cr = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          let x = cr(p0[0], p1[0], p2[0], p3[0]), z = cr(p0[1], p1[1], p2[1], p3[1]);
          const wig = Math.sin(Math.PI * t) * 1; // keep endpoints exact
          x += wig * 9 * this.noise.noise(x / 140, z / 140); z += wig * 9 * this.noise.noise(z / 140 + 5, x / 140);
          pts.push(x, z, 0);
        }
      }
      const last = ctrl[ctrl.length - 1]; pts.push(last[0], last[1], 0);
      const n = pts.length / 3;
      // height profile: sample, then smooth along the road so grades are drivable
      const raw = new Float32Array(n);
      for (let k = 0; k < n; k++) raw[k] = this.heightAt(pts[k * 3], pts[k * 3 + 1]);
      for (let k = 0; k < n; k++) {
        let acc = 0, wsum = 0;
        for (let o = -10; o <= 10; o++) {
          const q = clamp(k + o, 0, n - 1), w = 1 - Math.abs(o) / 11;
          acc += raw[q] * w; wsum += w;
        }
        pts[k * 3 + 2] = acc / wsum;
      }
      const arr = new Float32Array(pts);
      const width = r.kind === 'road' ? 6.5 : 3.6;
      this.roads.push({ kind: r.kind, pts: arr, width });
      // rasterise: flatten across the road and paint the road channel
      const hw = width / 2, fall = width * 1.6;
      for (let k = 0; k < n; k++) {
        const x = arr[k * 3], z = arr[k * 3 + 1], y = arr[k * 3 + 2];
        this.paint(x, z, hw + fall, (q, d) => {
          if (this.ctrlB[q * 4 + 1] > 10) return; // never fill the river (bridges span it)
          const wRoad = 1 - smoothstep(hw - 0.8, hw + 0.8, d);
          const wFlat = 1 - smoothstep(hw, hw + fall, d);
          const cur = this.ctrlA[q * 4] / 255;
          if (wFlat > 0.001) this.heights[q] += (y - 0.12 * wRoad - this.heights[q]) * wFlat * 0.85;
          if (wRoad > cur) this.ctrlA[q * 4] = Math.round(wRoad * (r.kind === 'road' ? 255 : 200));
        });
      }
    }
  }

  private buildFields() {
    const rnd = mulberry32(777);
    const farmSites = SITES.filter((s) => s.kingdom === 'vanguardia' || s.id === 'greyford' || s.id === 'gullrock');
    for (const s of farmSites) {
      const count = s.kind === 'capital' ? 26 : s.kind === 'castle' ? 8 : 16;
      let tries = 0;
      while (this.fields.filter((f) => f.site === s.id).length < count && tries++ < 400) {
        const a = rnd() * Math.PI * 2, rr = s.r * 1.25 + 30 + rnd() * (s.kind === 'capital' ? 520 : 330);
        const x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr;
        const w = 35 + rnd() * 70, d = 25 + rnd() * 55, yaw = rnd() * Math.PI;
        if (!this.fieldClear(x, z, w, d, yaw)) continue;
        const east = this.eastAt(x, z);
        const crop = east > 0.5 ? (rnd() < 0.5 ? 2 : 3) : (rnd() < 0.68 ? 1 : rnd() < 0.5 ? 2 : 3);
        const f: Field = { x, z, w, d, yaw, crop, site: s.id };
        this.fields.push(f);
        this.rasterField(f);
      }
    }
  }
  private fieldClear(x: number, z: number, w: number, d: number, yaw: number): boolean {
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let u = -0.5; u <= 0.5; u += 0.25) for (let v = -0.5; v <= 0.5; v += 0.25) {
      const px = x + c * u * w + sn * v * d, pz = z - sn * u * w + c * v * d; // three.js yaw convention
      if (!this.inBounds(px, pz)) return false;
      const h = this.heightAt(px, pz);
      if (h < 2.5 || this.slopeAt(px, pz) > 0.06) return false;
      if (this.roadAt(px, pz) > 0.05 || this.fieldAt(px, pz) > 0.05 || this.riverbedAt(px, pz) > 0.02) return false;
      if (this.ctrl(this.ctrlB, 2, px, pz) > 0.1) return false;
      for (const s of SITES) if (Math.hypot(px - s.x, pz - s.z) < s.r * 1.1) return false;
      if (this.forest[Math.round((pz + HALF) / CELL) * HM_N + Math.round((px + HALF) / CELL)] > 60) return false;
    }
    return true;
  }
  private rasterField(f: Field) {
    const c = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const R = Math.hypot(f.w, f.d) / 2 + 3;
    this.paint(f.x, f.z, R, (q, _d) => {
      const i = q % HM_N, j = Math.floor(q / HM_N);
      const px = -HALF + i * CELL - f.x, pz = -HALF + j * CELL - f.z;
      const u = c * px - sn * pz, v = sn * px + c * pz;
      const m = (1 - smoothstep(f.w / 2 - 2, f.w / 2 + 1.5, Math.abs(u))) * (1 - smoothstep(f.d / 2 - 2, f.d / 2 + 1.5, Math.abs(v)));
      if (m <= 0) return;
      this.ctrlA[q * 4 + 2] = Math.max(this.ctrlA[q * 4 + 2], Math.round(m * 255));
      if (m > 0.5) this.crop[q] = f.crop;
      this.forest[q] = 0;
    });
  }

  private computeNormals() {
    const H = this.heights, N = HM_N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const l = H[j * N + Math.max(0, i - 1)], r = H[j * N + Math.min(N - 1, i + 1)];
      const u = H[Math.max(0, j - 1) * N + i], d = H[Math.min(N - 1, j + 1) * N + i];
      const nx = l - r, nz = u - d, ny = 2 * CELL;
      const len = Math.hypot(nx, ny, nz);
      this.normals[k * 4] = (nx / len * 0.5 + 0.5) * 255;
      this.normals[k * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      this.normals[k * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      // cavity: how far below its neighbourhood average the point sits (wider ring = valleys darken softly)
      let acc = 0;
      for (const [di, dj] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2], [-2, 2], [2, -2]]) {
        const ii = clamp(i + di, 0, N - 1), jj = clamp(j + dj, 0, N - 1);
        acc += H[jj * N + ii];
      }
      const cav = acc / 8 - H[k];
      this.normals[k * 4 + 3] = clamp(255 - Math.max(0, cav) * 22, 90, 255);
    }
  }

  siteAt(x: number, z: number): Site | null {
    for (const s of SITES) if (Math.hypot(x - s.x, z - s.z) < s.r) return s;
    return null;
  }
}
export const worldSize = WORLD;
const tick = () => new Promise((r) => setTimeout(r, 0));
