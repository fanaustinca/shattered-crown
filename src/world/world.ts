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
  /** A beaten-earth path or track between two points: wanders a little, worn darker in the middle. */
  trail(x0: number, z0: number, x1: number, z1: number, w: number, amount = 0.75) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const n = Math.max(1, Math.ceil(len / 1.4)), nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const wob = Math.sin(Math.PI * t) * Math.min(len * 0.08, 4) * this.noise.noise(x0 / 30 + t * len / 40, z0 / 30);
      const x = x0 + (x1 - x0) * t + nx * wob, z = z0 + (z1 - z0) * t + nz * wob;
      const hw = w / 2 * (0.85 + 0.3 * this.noise.noise(x / 7, z / 7));
      this.paint(x, z, hw + 1, (q, d) => {
        const v = (1 - smoothstep(hw * 0.4, hw + 1, d)) * amount;
        if (v * 255 > this.ctrlA[q * 4]) this.ctrlA[q * 4] = Math.round(v * 255);
        this.forest[q] = 0;
      });
    }
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
  /** A garden / paddock / orchard plot: soil and an optional crop for the grass system. */
  paintPlot(x: number, z: number, w: number, d: number, yaw: number, crop: number, amount: number) {
    const c = Math.cos(yaw), sn = Math.sin(yaw), R = Math.hypot(w, d) / 2 + 2;
    this.paint(x, z, R, (q) => {
      const i = q % HM_N, j = Math.floor(q / HM_N);
      const px = -HALF + i * CELL - x, pz = -HALF + j * CELL - z;
      const u = c * px - sn * pz, v = sn * px + c * pz;
      const m = (1 - smoothstep(w / 2 - 1.2, w / 2 + 0.8, Math.abs(u))) * (1 - smoothstep(d / 2 - 1.2, d / 2 + 0.8, Math.abs(v)));
      if (m <= 0) return;
      this.ctrlA[q * 4 + 2] = Math.max(this.ctrlA[q * 4 + 2], Math.round(m * amount * 255));
      if (m > 0.5 && crop) this.crop[q] = crop;
      this.forest[q] = 0;
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

  /** Soften impossible walls. Two slope-limited versions of the terrain are made with a chamfer distance
   *  transform (forward and backward raster passes): one cut down from above (crags lowered until no face
   *  is steeper than ~50°) and one filled up from below (a scree skirt at the foot of every cliff). Their
   *  average keeps half of every mountain's height and spreads the rest into its foot, and — being an
   *  average of two fields that both obey the limit — obeys it too. River channels and the sea floor only
   *  ever take the cut version, so no bank is filled in. */
  private limitSlopes() {
    const N = HM_N, H = this.heights, lim = CELL * Math.tan((50 * Math.PI) / 180), lim2 = lim * Math.SQRT2;
    const cut = new Float32Array(H), fill = new Float32Array(H);
    const pass = (A: Float32Array, sign: 1 | -1) => {
      // sign 1: A = min(A, A[n] + lim·d) (cut); sign -1: A = max(A, A[n] - lim·d) (fill)
      const relax = (q: number, n: number, d: number) => { const v = A[n] + sign * d; if (sign > 0 ? v < A[q] : v > A[q]) A[q] = v; };
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) { const q = j * N + i; relax(q, q - 1, lim); relax(q, q - N, lim); relax(q, q - N - 1, lim2); relax(q, q - N + 1, lim2); }
      for (let j = N - 2; j >= 1; j--) for (let i = N - 2; i >= 1; i--) { const q = j * N + i; relax(q, q + 1, lim); relax(q, q + N, lim); relax(q, q + N + 1, lim2); relax(q, q + N - 1, lim2); }
    };
    pass(cut, 1); pass(cut, 1);
    pass(fill, -1); pass(fill, -1);
    for (let q = 0; q < N * N; q++) {
      const wet = this.ctrlB[q * 4 + 2] > 20 || this.ctrlB[q * 4 + 1] > 10;
      H[q] = wet ? cut[q] : (cut[q] + fill[q]) * 0.5;
    }
  }

  /** A* over the heightmap between two points for a road with a ruling grade: steep ground is crossed on
   *  the slant and climbed in zig-zags, water is avoided. Returns null if no sensible route. */
  private routeGraded(a: [number, number], b: [number, number], maxG: number): [number, number][] | null {
    const G = 6, dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const margin = Math.max(400, dist * 0.7);
    const x0 = Math.min(a[0], b[0]) - margin, z0 = Math.min(a[1], b[1]) - margin;
    const nx = Math.ceil((Math.max(a[0], b[0]) + margin - x0) / G), nz = Math.ceil((Math.max(a[1], b[1]) + margin - z0) / G);
    const hgt = new Float32Array(nx * nz), wet = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * G, z = z0 + j * G, h = this.heightAt(x, z);
      hgt[j * nx + i] = h; wet[j * nx + i] = this.waterLevelAt(x, z) > h - 0.4 ? 1 : 0;
    }
    const idx = (x: number, z: number) => Math.round((z - z0) / G) * nx + Math.round((x - x0) / G);
    const sA = idx(a[0], a[1]), sB = idx(b[0], b[1]);
    const gScore = new Float64Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz);
    const heap: number[] = [], hf: number[] = [];
    const push = (n: number, f: number) => { heap.push(n); hf.push(f); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= hf[k]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; [hf[p], hf[k]] = [hf[k], hf[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const ln = heap.pop()!, lf = hf.pop()!; if (heap.length) { heap[0] = ln; hf[0] = lf; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && hf[l] < hf[m]) m = l; if (r < heap.length && hf[r] < hf[m]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; [hf[m], hf[k]] = [hf[k], hf[m]]; k = m; } } return top; };
    const bi = sB % nx, bj = (sB - bi) / nx;
    const hcost = (n: number) => { const i = n % nx, j = (n - i) / nx; return Math.hypot(i - bi, j - bj) * G; };
    const moves: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2]];
    gScore[sA] = 0; push(sA, hcost(sA));
    let found = false, iter = 0;
    while (heap.length && iter++ < 1500000) {
      const n = pop();
      if (n === sB) { found = true; break; }
      if (closed[n]) continue;
      closed[n] = 1;
      const i = n % nx, j = (n - i) / nx, g0 = gScore[n];
      for (const [di, dj] of moves) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const m = jj * nx + ii;
        const len = Math.hypot(di, dj) * G, grade = Math.abs(hgt[m] - hgt[n]) / len;
        let c = len * (1 + 20 * grade * grade);
        if (grade > maxG) c *= 1 + 120 * (grade - maxG);
        if (grade > maxG * 2.2) c += 4000;          // a cliff: practically impassable
        if (wet[m] && m !== sB) c += 2000;
        const ng = g0 + c;
        if (ng < gScore[m]) { gScore[m] = ng; from[m] = n; push(m, ng + hcost(m)); }
      }
    }
    this.genTimes.lastIter = iter; this.genTimes.lastFound = found ? 1 : 0; this.genTimes.lastNodes = nx * nz; this.genTimes.lastHeap = heap.length;
    if (!found) return null;
    const out: [number, number][] = [];
    for (let n = sB; n !== -1; n = from[n]) { const i = n % nx, j = (n - i) / nx; out.push([x0 + i * G, z0 + j * G]); }
    out.reverse();
    out[0] = [a[0], a[1]]; out[out.length - 1] = [b[0], b[1]];
    // round the corners (Chaikin), keeping the ends
    let pts = out;
    for (let k = 0; k < 3; k++) {
      const q: [number, number][] = [pts[0]];
      for (let t = 0; t < pts.length - 1; t++) { const [ax, az] = pts[t], [bx, bz] = pts[t + 1]; q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]); }
      q.push(pts[pts.length - 1]); pts = q;
    }
    return pts;
  }

  /** Mountain trails: a dirt path from the nearest road up to every big summit (and on over the saddle), so
   *  no mountain is a wall — the grade is held to about one in two (~25°). */
  private mountainTrails(): { pts: [number, number][]; kind: 'track' }[] {
    const peaks: [number, number, number][] = [];
    const step = 60, N = Math.floor((HALF * 2) / step);
    for (let j = 2; j < N - 2; j++) for (let i = 2; i < N - 2; i++) {
      const x = -HALF + i * step, z = -HALF + j * step, h = this.heightAt(x, z);
      if (h < 110 || this.waterLevelAt(x, z) > h) continue;
      let top = true;
      for (let dj = -6; dj <= 6 && top; dj++) for (let di = -6; di <= 6; di++) { if (!di && !dj) continue; if (this.heightAt(x + di * step, z + dj * step) > h) { top = false; break; } }
      if (top && !SITES.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 80)) peaks.push([x, z, h]);
    }
    peaks.sort((a, b) => b[2] - a[2]);
    const out: { pts: [number, number][]; kind: 'track' }[] = [];
    for (const [px, pz] of peaks.slice(0, 10)) {
      // join the nearest road
      let best: [number, number] | null = null, bd = 1e9;
      for (const r of this.roads) for (let k = 0; k < r.pts.length; k += 15) { const d = Math.hypot(r.pts[k] - px, r.pts[k + 1] - pz); if (d < bd) { bd = d; best = [r.pts[k], r.pts[k + 1]]; } }
      if (!best || bd > 2600) continue;
      out.push({ pts: [best, [px, pz]], kind: 'track' });
    }
    return out;
  }

  genTimes: Record<string, number> = {};
  private buildRoads() {
    let t0 = performance.now();
    this.limitSlopes();
    this.genTimes.slopes = performance.now() - t0; t0 = performance.now();
    const plans: { pts: [number, number][]; kind: 'road' | 'track'; routed?: boolean }[] = [];
    for (const r of ROADS) {
      const ctrl = r.pts.map((p) => resolveRoadPt(p, this.bridges));
      // a road meets a bridge square on: pin an approach point out along the bridge axis
      const pinned = new Set<number>();
      const ctl: [number, number][] = [];
      r.pts.forEach((p, k) => {
        const c = ctrl[k];
        if (typeof p === 'string' && p.startsWith('B')) {
          const b = this.bridges[+p[1]], ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
          const sg = Math.sign((c[0] - b.x) * ax + (c[1] - b.z) * az) || 1;
          const app: [number, number] = [c[0] + ax * sg * 30, c[1] + az * sg * 30];
          if (k === 0) { ctl.push(c, app); pinned.add(0); }
          else { ctl.push(app, c); pinned.add(ctl.length - 2); }
        } else ctl.push(c);
      });
      const maxG = r.kind === 'road' ? 0.11 : 0.18;
      const pts: [number, number][] = [];
      let routed = false;
      for (let s = 0; s < ctl.length - 1; s++) {
        const p0 = ctl[Math.max(0, s - 1)], p1 = ctl[s], p2 = ctl[s + 1], p3 = ctl[Math.min(ctl.length - 1, s + 2)];
        const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        const n = Math.max(2, Math.ceil(len / 2));
        const seg: [number, number][] = [];
        for (let k = 0; k < n; k++) {
          const t = k / n, t2 = t * t, t3 = t2 * t;
          const cr = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          let x = cr(p0[0], p1[0], p2[0], p3[0]), z = cr(p0[1], p1[1], p2[1], p3[1]);
          const wig = pinned.has(s) ? 0 : Math.sin(Math.PI * t) * 1;
          x += wig * 9 * this.noise.noise(x / 140, z / 140); z += wig * 9 * this.noise.noise(z / 140 + 5, x / 140);
          seg.push([x, z]);
        }
        // too steep for carts? find a graded line instead (switchbacks up the mountainside)
        let steep = false;
        for (let k = 0; k + 15 < seg.length && !steep; k += 5) {
          const a = seg[k], b = seg[k + 15];
          steep = Math.abs(this.heightAt(b[0], b[1]) - this.heightAt(a[0], a[1])) / Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])) > maxG * 1.35;
        }
        if (steep && !pinned.has(s)) {
          const alt = this.routeGraded(p1, p2, maxG);
          if (alt) { alt.pop(); pts.push(...alt); routed = true; continue; }
        }
        pts.push(...seg);
      }
      pts.push(ctl[ctl.length - 1]);
      plans.push({ pts, kind: r.kind, routed });
    }
    this.genTimes.route = performance.now() - t0; t0 = performance.now();
    for (const pl of plans) this.layRoad(pl.pts, pl.kind);
    // and a dirt trail up every big mountain
    for (const t of this.mountainTrails()) {
      const alt = this.routeGraded(t.pts[0], t.pts[1], 0.42);
      if (alt) this.layRoad(alt, 'track');
    }
    this.genTimes.trails = performance.now() - t0;
  }

  /** Resample a route every ~2 m, give it a smoothed, graded height profile, and cut it into the ground. */
  private layRoad(route: [number, number][], kind: 'road' | 'track') {
    const pts: number[] = [];
    let carry = 0;
    for (let k = 0; k < route.length - 1; k++) {
      const [ax, az] = route[k], [bx, bz] = route[k + 1];
      const L = Math.hypot(bx - ax, bz - az);
      let t = carry;
      while (t < L) { pts.push(ax + (bx - ax) * t / L, az + (bz - az) * t / L, 0); t += 2; }
      carry = t - L;
    }
    const last = route[route.length - 1]; pts.push(last[0], last[1], 0);
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
    const width = kind === 'road' ? 6.5 : 3.6;
    this.roads.push({ kind, pts: arr, width });
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
        if (wRoad > cur) this.ctrlA[q * 4] = Math.round(wRoad * (kind === 'road' ? 255 : 200));
      });
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
