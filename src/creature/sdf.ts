// Signed-distance anatomy: primitives bound to bones, smooth-unioned, meshed with surface nets,
// skinned automatically from per-primitive proximity. Pure math so it can run in a worker.

export type V3 = [number, number, number];
export interface Prim {
  type: 'cone' | 'ell' | 'box';
  bone: number;              // skin influence
  a: V3; b?: V3;             // cone: endpoints; ell/box: centre (a)
  ra?: number; rb?: number;  // cone radii (box: corner rounding)
  r?: V3;                    // ellipsoid / box half extents
  rot?: [number, number, number, number]; // quaternion (x,y,z,w) for ell/box
  k?: number;                // smooth-union radius with what came before
  region?: number;           // material region id (for colouring: 0 body, 1 hoof, 2 nose, 3 belly...)
  sub?: boolean;             // subtract (carve)
}
export interface MeshData {
  positions: Float32Array; normals: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array;
  regions: Float32Array; indices: Uint32Array;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function qrotInv(q: [number, number, number, number], x: number, y: number, z: number): V3 {
  // rotate by the conjugate quaternion
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

/** iq's round cone */
function sdRoundCone(px: number, py: number, pz: number, a: V3, b: V3, r1: number, r2: number) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = (pax * l2 - bax * y) ** 2 + (pay * l2 - bay * y) ** 2 + (paz * l2 - baz * y) ** 2;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * xx;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(xx + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(xx + y2) * il2 - r1;
  return (Math.sqrt(xx * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoid(x: number, y: number, z: number, r: V3) {
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  return k1 > 0 ? (k0 * (k0 - 1)) / k1 : -Math.min(r[0], r[1], r[2]);
}
function sdBox(x: number, y: number, z: number, r: V3, round: number) {
  const qx = Math.abs(x) - r[0] + round, qy = Math.abs(y) - r[1] + round, qz = Math.abs(z) - r[2] + round;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
}
export function primDist(p: Prim, x: number, y: number, z: number): number {
  if (p.type === 'cone') return sdRoundCone(x, y, z, p.a, p.b!, p.ra!, p.rb ?? p.ra!);
  let lx = x - p.a[0], ly = y - p.a[1], lz = z - p.a[2];
  if (p.rot) [lx, ly, lz] = qrotInv(p.rot, lx, ly, lz);
  if (p.type === 'ell') return sdEllipsoid(lx, ly, lz, p.r!);
  return sdBox(lx, ly, lz, p.r!, p.ra ?? 0);
}
function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return b + (a - b) * h - k * h * (1 - h);
}
function smax(a: number, b: number, k: number) { return -smin(-a, -b, k); }

interface Bounds { min: V3; max: V3 }
function primBounds(p: Prim): Bounds {
  const pad = (p.k ?? 0) + 0.01;
  if (p.type === 'cone') {
    const r = Math.max(p.ra!, p.rb ?? p.ra!) + pad;
    return { min: [Math.min(p.a[0], p.b![0]) - r, Math.min(p.a[1], p.b![1]) - r, Math.min(p.a[2], p.b![2]) - r], max: [Math.max(p.a[0], p.b![0]) + r, Math.max(p.a[1], p.b![1]) + r, Math.max(p.a[2], p.b![2]) + r] };
  }
  const m = Math.max(...p.r!) + pad + (p.ra ?? 0);
  return { min: [p.a[0] - m, p.a[1] - m, p.a[2] - m], max: [p.a[0] + m, p.a[1] + m, p.a[2] + m] };
}

export function evalSDF(prims: Prim[], bounds: Bounds[], x: number, y: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i < prims.length; i++) {
    const b = bounds[i], p = prims[i];
    if (x < b.min[0] || y < b.min[1] || z < b.min[2] || x > b.max[0] || y > b.max[1] || z > b.max[2]) {
      if (p.sub) continue;
      // outside the box: a cheap lower bound keeps the union correct far from this primitive
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0]), dy = Math.max(b.min[1] - y, 0, y - b.max[1]), dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
      const lb = Math.hypot(dx, dy, dz);
      if (lb > d) continue;
    }
    const pd = primDist(p, x, y, z);
    d = p.sub ? smax(d, -pd, p.k ?? 0.01) : i === 0 ? pd : smin(d, pd, p.k ?? 0);
  }
  return d;
}

/** Naive surface nets over a grid; returns a skinned triangle mesh. */
export function buildMesh(prims: Prim[], cell: number, boneCount: number): MeshData {
  const bounds = prims.map(primBounds);
  const mn: V3 = [1e9, 1e9, 1e9], mx: V3 = [-1e9, -1e9, -1e9];
  for (let i = 0; i < prims.length; i++) {
    if (prims[i].sub) continue;
    for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], bounds[i].min[a]); mx[a] = Math.max(mx[a], bounds[i].max[a]); }
  }
  const nx = Math.ceil((mx[0] - mn[0]) / cell) + 2, ny = Math.ceil((mx[1] - mn[1]) / cell) + 2, nz = Math.ceil((mx[2] - mn[2]) / cell) + 2;
  const ox = mn[0] - cell, oy = mn[1] - cell, oz = mn[2] - cell;
  const field = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    field[(k * ny + j) * nx + i] = evalSDF(prims, bounds, ox + i * cell, oy + j * cell, oz + k * cell);
  }
  const F = (i: number, j: number, k: number) => field[(k * ny + j) * nx + i];
  const vidx = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  // one vertex per cell that straddles the surface, at the mean of edge crossings
  const edges = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const e of edges) {
      const a = F(i + e[0], j + e[1], k + e[2]), b = F(i + e[3], j + e[4], k + e[5]);
      if ((a < 0) !== (b < 0)) {
        const t = a / (a - b);
        sx += e[0] + (e[3] - e[0]) * t; sy += e[1] + (e[4] - e[1]) * t; sz += e[2] + (e[5] - e[2]) * t; n++;
      }
    }
    if (!n) continue;
    vidx[(k * ny + j) * nx + i] = pos.length / 3;
    pos.push(ox + (i + sx / n) * cell, oy + (j + sy / n) * cell, oz + (k + sz / n) * cell);
  }
  const idx: number[] = [];
  const V = (i: number, j: number, k: number) => vidx[(k * ny + j) * nx + i];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s = F(i, j, k) < 0;
    // x edge
    if (s !== (F(i + 1, j, k) < 0)) {
      const a = V(i, j - 1, k - 1), b = V(i, j, k - 1), c = V(i, j, k), d = V(i, j - 1, k);
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) s ? idx.push(a, b, c, a, c, d) : idx.push(a, c, b, a, d, c);
    }
    if (s !== (F(i, j + 1, k) < 0)) {
      const a = V(i - 1, j, k - 1), b = V(i, j, k - 1), c = V(i, j, k), d = V(i - 1, j, k);
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) s ? idx.push(a, c, b, a, d, c) : idx.push(a, b, c, a, c, d);
    }
    if (s !== (F(i, j, k + 1) < 0)) {
      const a = V(i - 1, j - 1, k), b = V(i, j - 1, k), c = V(i, j, k), d = V(i - 1, j, k);
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) s ? idx.push(a, b, c, a, c, d) : idx.push(a, c, b, a, d, c);
    }
  }
  const nv = pos.length / 3;
  const positions = new Float32Array(pos);
  // a couple of Laplacian-free relaxation passes would shrink thin parts; instead project onto the surface
  for (let v = 0; v < nv; v++) {
    for (let it = 0; it < 2; it++) {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      const d = evalSDF(prims, bounds, x, y, z);
      const e = cell * 0.25;
      const gx = evalSDF(prims, bounds, x + e, y, z) - evalSDF(prims, bounds, x - e, y, z);
      const gy = evalSDF(prims, bounds, x, y + e, z) - evalSDF(prims, bounds, x, y - e, z);
      const gz = evalSDF(prims, bounds, x, y, z + e) - evalSDF(prims, bounds, x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      positions[v * 3] -= (gx / gl) * d; positions[v * 3 + 1] -= (gy / gl) * d; positions[v * 3 + 2] -= (gz / gl) * d;
    }
  }
  const normals = new Float32Array(nv * 3);
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), regions = new Float32Array(nv);
  const boneW = new Float32Array(boneCount);
  const regW = new Float32Array(16);
  for (let v = 0; v < nv; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    const e = cell * 0.3;
    const gx = evalSDF(prims, bounds, x + e, y, z) - evalSDF(prims, bounds, x - e, y, z);
    const gy = evalSDF(prims, bounds, x, y + e, z) - evalSDF(prims, bounds, x, y - e, z);
    const gz = evalSDF(prims, bounds, x, y, z + e) - evalSDF(prims, bounds, x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    normals[v * 3] = gx / gl; normals[v * 3 + 1] = gy / gl; normals[v * 3 + 2] = gz / gl;
    boneW.fill(0); regW.fill(0);
    for (let p = 0; p < prims.length; p++) {
      if (prims[p].sub) continue;
      const d = Math.max(0, primDist(prims[p], x, y, z));
      const w = 1 / Math.pow(d + 0.012, 4);
      boneW[prims[p].bone] += w;
      regW[prims[p].region ?? 0] += 1 / Math.pow(d + 0.004, 6);
    }
    // top four bones
    const top: [number, number][] = [];
    for (let b = 0; b < boneCount; b++) if (boneW[b] > 0) top.push([b, boneW[b]]);
    top.sort((a, b) => b[1] - a[1]);
    let sum = 0;
    for (let t = 0; t < 4 && t < top.length; t++) sum += top[t][1];
    for (let t = 0; t < 4; t++) {
      skinIndex[v * 4 + t] = t < top.length ? top[t][0] : 0;
      skinWeight[v * 4 + t] = t < top.length ? top[t][1] / sum : 0;
    }
    let br = 0, bw = -1;
    for (let r = 0; r < 16; r++) if (regW[r] > bw) { bw = regW[r]; br = r; }
    // soft region value: dominant region plus how strongly (lets shaders feather borders)
    let rs = 0; for (let r = 0; r < 16; r++) rs += regW[r];
    regions[v] = br + Math.min(0.99, bw / rs);
  }
  return { positions, normals, skinIndex, skinWeight, regions, indices: new Uint32Array(idx) };
}
