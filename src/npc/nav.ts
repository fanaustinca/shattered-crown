// Simple local navigation for people on foot. A straight walk is used whenever it is clear; when a house,
// a wall or water stands in the way, a grid A* (3 m cells, around the start and goal) finds a way round —
// through doors in walls (gates), over bridges, never through a river. And a soft separation keeps people
// from walking through or standing inside one another.
import * as THREE from 'three';
import type { Game } from '../game';
import { RAPIER, groups, G_STATIC, ALL } from '../physics/physics';

const CELL = 3;
const _p = new THREE.Vector3();

export class Nav {
  private _ball: RAPIER.Ball | null = null;
  private get ball() { return this._ball ??= new RAPIER.Ball(1.1); }
  private ident = { x: 0, y: 0, z: 0, w: 1 };
  /** cell blocked? cached per frame-ish (a battle asks about the same ground over and over) */
  private cache = new Map<string, boolean>();
  private cacheT = 0;
  constructor(public game: Game) {}

  private wet(x: number, z: number) {
    const w = this.game.world, h = w.heightAt(x, z), wl = w.waterLevelAt(x, z);
    if (wl <= h - 0.25) return false;
    // a bridge deck over the water is dry going
    return this.game.groundAt(x, z, wl + 12) < wl + 0.4;
  }
  blocked(x: number, z: number) {
    const k = `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
    let b = this.cache.get(k);
    if (b !== undefined) return b;
    const g = this.game;
    b = this.wet(x, z);
    if (!b) {
      const y = g.groundAt(x, z, g.world.heightAt(x, z) + 20) + 1.2;
      const hit = g.physics.world.intersectionWithShape({ x, y, z }, this.ident, this.ball, undefined, groups(ALL, G_STATIC), undefined, undefined, (c) => c !== g.physics.terrainCollider);
      b = !!hit;
    }
    this.cache.set(k, b);
    return b;
  }
  /** Is the straight walk from a to b clear (no walls, houses or water along it)? */
  clear(a: THREE.Vector3, b: THREE.Vector3) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 2.5));
    for (let i = 1; i < n; i++) { const t = i / n; if (this.blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
    return true;
  }
  /** Waypoints from a to b around obstacles (null: no way found nearby — walk straight and hope). */
  route(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3[] | null {
    if (performance.now() - this.cacheT > 20000) { this.cache.clear(); this.cacheT = performance.now(); }
    const margin = 45;
    const x0 = Math.min(a.x, b.x) - margin, z0 = Math.min(a.z, b.z) - margin;
    const nx = Math.ceil((Math.max(a.x, b.x) + margin - x0) / CELL) + 1, nz = Math.ceil((Math.max(a.z, b.z) + margin - z0) / CELL) + 1;
    if (nx * nz > 40000) return null;
    const id = (x: number, z: number) => Math.round((z - z0) / CELL) * nx + Math.round((x - x0) / CELL);
    const sA = id(a.x, a.z), sB = id(b.x, b.z);
    const g = new Float64Array(nx * nz).fill(Infinity), from = new Int32Array(nx * nz).fill(-1), closed = new Uint8Array(nx * nz), blk = new Int8Array(nx * nz).fill(-1);
    const isBlk = (n: number) => { if (blk[n] < 0) { const i = n % nx, j = (n - i) / nx; blk[n] = n === sA || n === sB ? 0 : this.blocked(x0 + i * CELL, z0 + j * CELL) ? 1 : 0; } return blk[n] === 1; };
    const bi = sB % nx, bj = (sB - bi) / nx;
    const h = (n: number) => { const i = n % nx, j = (n - i) / nx; return Math.hypot(i - bi, j - bj); };
    const heap: [number, number][] = [];
    const push = (n: number, f: number) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top[1]; };
    g[sA] = 0; push(sA, h(sA));
    let found = false, it = 0;
    while (heap.length && it++ < 9000) {
      const n = pop();
      if (n === sB) { found = true; break; }
      if (closed[n]) continue;
      closed[n] = 1;
      const i = n % nx, j = (n - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const m = jj * nx + ii;
        if (closed[m] || isBlk(m)) continue;
        if (di && dj && (isBlk(j * nx + ii) || isBlk(jj * nx + i))) continue;      // no cutting corners
        const ng = g[n] + (di && dj ? 1.414 : 1);
        if (ng < g[m]) { g[m] = ng; from[m] = n; push(m, ng + h(m)); }
      }
    }
    if (!found) return null;
    const cells: THREE.Vector3[] = [];
    for (let n = sB; n !== -1 && n !== sA; n = from[n]) { const i = n % nx, j = (n - i) / nx; cells.push(new THREE.Vector3(x0 + i * CELL, 0, z0 + j * CELL)); }
    cells.reverse();
    // string-pull: keep only the corners
    const out: THREE.Vector3[] = [];
    let cur = a.clone();
    for (let k = 0; k < cells.length; k++) {
      const nxt = cells[k + 1];
      if (nxt && this.clear(cur, nxt)) continue;
      out.push(cells[k]); cur = cells[k];
    }
    out.push(b.clone());
    for (const p of out) p.y = this.game.groundAt(p.x, p.z, this.game.world.heightAt(p.x, p.z) + 20);
    return out;
  }

  /** Soft separation: nobody stands inside anybody else. Returns a push for each person (m/s). */
  separate(people: { st: { pos: THREE.Vector3 }; sep: THREE.Vector3; alive: boolean }[], radius = 0.75) {
    const grid = new Map<number, number[]>();
    const key = (x: number, z: number) => (Math.floor(x / 2) + 4096) * 8192 + Math.floor(z / 2) + 4096;
    people.forEach((p, i) => { p.sep.set(0, 0, 0); if (!p.alive) return; const k = key(p.st.pos.x, p.st.pos.z); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); });
    people.forEach((p, i) => {
      if (!p.alive) return;
      const cx = Math.floor(p.st.pos.x / 2), cz = Math.floor(p.st.pos.z / 2);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const c = grid.get((cx + dx + 4096) * 8192 + cz + dz + 4096);
        if (!c) continue;
        for (const j of c) {
          if (j <= i) continue;
          const q = people[j];
          _p.subVectors(p.st.pos, q.st.pos).setY(0);
          const d = _p.length();
          if (d >= radius * 2 || Math.abs(p.st.pos.y - q.st.pos.y) > 1.5) continue;
          if (d < 1e-3) _p.set(Math.random() - 0.5, 0, Math.random() - 0.5);
          _p.normalize().multiplyScalar((radius * 2 - d) / (radius * 2) * 2.5);
          p.sep.add(_p); q.sep.sub(_p);
        }
      }
    });
  }
}
