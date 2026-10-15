// Geometry builder for architecture and furniture: boxes, cylinders, slabs and walls with openings,
// accumulated per material key with world-scaled UVs, then merged into a few meshes.
import * as THREE from 'three';

export interface Part { pos: number[]; nor: number[]; uv: number[]; idx: number[]; col?: number[]; cur?: number[] }

const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3();

export class GeoBuilder {
  parts = new Map<string, Part>();
  /** current transform applied to everything added */
  matrix = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];
  push(m?: THREE.Matrix4) { this.stack.push(this.matrix.clone()); if (m) this.matrix.multiply(m); return this; }
  pop() { this.matrix = this.stack.pop()!; return this; }
  translate(x: number, y: number, z: number) { this.matrix.multiply(_m.makeTranslation(x, y, z)); return this; }
  rotateY(a: number) { this.matrix.multiply(_m.makeRotationY(a)); return this; }
  rotateX(a: number) { this.matrix.multiply(_m.makeRotationX(a)); return this; }
  rotateZ(a: number) { this.matrix.multiply(_m.makeRotationZ(a)); return this; }
  scale(x: number, y: number, z: number) { this.matrix.multiply(_m.makeScale(x, y, z)); return this; }

  /** A key may carry '|vc:RRGGBB': the colour is baked per vertex and the part shares the '|vcol' material,
   *  so a street of differently painted houses is still one material (one draw batch). */
  part(key: string): Part {
    let col: number[] | null = null;
    const vi = key.indexOf('|vc:');
    if (vi >= 0) {
      const c = new THREE.Color(parseInt(key.slice(vi + 4, vi + 10), 16));
      col = [c.r, c.g, c.b];
      key = key.slice(0, vi) + key.slice(vi + 10) + '|vcol';
    }
    let p = this.parts.get(key);
    if (!p) { p = { pos: [], nor: [], uv: [], idx: [] }; this.parts.set(key, p); }
    if (col || p.col || key.endsWith('|vcol')) { GeoBuilder.padCol(p); p.cur = col ?? [1, 1, 1]; }
    return p;
  }
  private static padCol(p: Part) {
    p.col ??= [];
    const n = p.pos.length / 3, c = p.cur ?? [1, 1, 1];
    while (p.col.length / 3 < n) p.col.push(c[0], c[1], c[2]);
  }

  /** Add a quad (4 points, CCW from outside) with uv per unit length. */
  quad(key: string, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvs: [number, number][]) {
    const p = this.part(key);
    const base = p.pos.length / 3;
    _n.getNormalMatrix(this.matrix);
    const pa = a.clone().applyMatrix4(this.matrix), pb = b.clone().applyMatrix4(this.matrix), pc = c.clone().applyMatrix4(this.matrix), pd = d.clone().applyMatrix4(this.matrix);
    const n = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pd, pa)).normalize();
    for (const [v, uv] of [[pa, uvs[0]], [pb, uvs[1]], [pc, uvs[2]], [pd, uvs[3]]] as const) {
      p.pos.push(v.x, v.y, v.z); p.nor.push(n.x, n.y, n.z); p.uv.push(uv[0], uv[1]);
    }
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box centred at (x,y,z) in the current frame. uvScale: texture repeats per metre. */
  box(key: string, x: number, y: number, z: number, w: number, h: number, d: number, uvScale = 1, faces = 0b111111) {
    const p = this.part(key);
    _n.getNormalMatrix(this.matrix);
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const F: [number[], number[], number, number][] = [
      [[1, 0, 0], [0, 0, -1], d, h], [[-1, 0, 0], [0, 0, 1], d, h], [[0, 1, 0], [1, 0, 0], w, d],
      [[0, -1, 0], [1, 0, 0], w, d], [[0, 0, 1], [1, 0, 0], w, h], [[0, 0, -1], [-1, 0, 0], w, h],
    ];
    F.forEach(([nn, uu, su, sv], fi) => {
      if (!(faces & (1 << fi))) return;
      const nrm = new THREE.Vector3(...nn as [number, number, number]);
      const u = new THREE.Vector3(...uu as [number, number, number]);
      const v = new THREE.Vector3().crossVectors(nrm, u);
      const c = new THREE.Vector3(x + nrm.x * hw, y + nrm.y * hh, z + nrm.z * hd);
      const hu = (Math.abs(u.x) * hw + Math.abs(u.y) * hh + Math.abs(u.z) * hd);
      const hv = (Math.abs(v.x) * hw + Math.abs(v.y) * hh + Math.abs(v.z) * hd);
      const base = p.pos.length / 3;
      const wn = nrm.clone().applyMatrix3(_n).normalize();
      for (const [a, b2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        _v.copy(c).addScaledVector(u, a * hu).addScaledVector(v, b2 * hv).applyMatrix4(this.matrix);
        p.pos.push(_v.x, _v.y, _v.z); p.nor.push(wn.x, wn.y, wn.z);
        p.uv.push((a * 0.5 + 0.5) * su * uvScale + (x + z) * 0.37 * uvScale, (b2 * 0.5 + 0.5) * sv * uvScale + y * uvScale);
      }
      p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
  }

  /** Cylinder along local Y (bottom at y0). */
  cyl(key: string, x: number, y0: number, z: number, r0: number, r1: number, h: number, seg = 12, caps = true, uvScale = 1) {
    const p = this.part(key);
    _n.getNormalMatrix(this.matrix);
    const base = p.pos.length / 3;
    const slope = (r0 - r1) / h;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      for (const [r, y] of [[r0, y0], [r1, y0 + h]]) {
        _v.set(x + ca * r, y, z + sa * r).applyMatrix4(this.matrix);
        p.pos.push(_v.x, _v.y, _v.z);
        const nn = new THREE.Vector3(ca, slope, sa).normalize().applyMatrix3(_n).normalize();
        p.nor.push(nn.x, nn.y, nn.z);
        p.uv.push((i / seg) * Math.PI * 2 * Math.max(r0, r1) * uvScale, (y - y0) * uvScale);
      }
    }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; p.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    if (caps) for (const [r, y, up] of [[r0, y0, -1], [r1, y0 + h, 1]] as const) {
      if (r <= 0) continue;
      const c = p.pos.length / 3;
      const nn = new THREE.Vector3(0, up, 0).applyMatrix3(_n).normalize();
      _v.set(x, y, z).applyMatrix4(this.matrix); p.pos.push(_v.x, _v.y, _v.z); p.nor.push(nn.x, nn.y, nn.z); p.uv.push(0.5, 0.5);
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        _v.set(x + Math.cos(a) * r, y, z + Math.sin(a) * r).applyMatrix4(this.matrix);
        p.pos.push(_v.x, _v.y, _v.z); p.nor.push(nn.x, nn.y, nn.z); p.uv.push(Math.cos(a) * r * uvScale, Math.sin(a) * r * uvScale);
      }
      for (let i = 0; i < seg; i++) up > 0 ? p.idx.push(c, c + 2 + i, c + 1 + i) : p.idx.push(c, c + 1 + i, c + 2 + i);
    }
  }

  /** Superellipsoid (e<1 boxier: pillows, mattresses, cushions; e=1 sphere/ellipsoid). */
  ellipsoid(key: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, seg = 10, e = 1) {
    const p = this.part(key);
    _n.getNormalMatrix(this.matrix);
    const base = p.pos.length / 3, rings = Math.max(4, seg >> 1);
    const f = (t: number) => Math.sign(t) * Math.pow(Math.abs(t), e);
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI;
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        const sx = f(Math.sin(phi)) * f(Math.cos(th)), sy = f(Math.cos(phi)), sz = f(Math.sin(phi)) * f(Math.sin(th));
        _v.set(x + sx * rx, y + sy * ry, z + sz * rz).applyMatrix4(this.matrix);
        p.pos.push(_v.x, _v.y, _v.z);
        const nn = new THREE.Vector3(Math.sin(phi) * Math.cos(th) / rx, Math.cos(phi) / ry, Math.sin(phi) * Math.sin(th) / rz).normalize().applyMatrix3(_n).normalize();
        p.nor.push(nn.x, nn.y, nn.z); p.uv.push((i / seg) * 2 * Math.max(rx, rz) * 4, (j / rings) * ry * 4);
      }
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i, b = a + seg + 1;
      p.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  /**
   * A wall slab along local +x from 0..len, height h, thickness t (centred on z=0), with rectangular
   * openings [{x0, x1, y0, y1}]. Produces both faces, the top, and reveals inside openings.
   */
  wall(key: string, len: number, h: number, t: number, openings: { x0: number; x1: number; y0: number; y1: number }[], uvScale = 0.5, revealKey?: string, innerKey?: string) {
    // split into vertical strips between openings, and spans above/below each opening
    const xs = new Set<number>([0, len]);
    for (const o of openings) { xs.add(o.x0); xs.add(o.x1); }
    const sx = [...xs].sort((a, b) => a - b);
    const rect = (x0: number, x1: number, y0: number, y1: number) => {
      if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
      for (const [side, k] of [[1, key], [-1, innerKey ?? key]] as const) {
        const z = side * t / 2;
        const A = new THREE.Vector3(x0, y0, z), B = new THREE.Vector3(x1, y0, z), C = new THREE.Vector3(x1, y1, z), D = new THREE.Vector3(x0, y1, z);
        const uv: [number, number][] = [[x0 * uvScale, y0 * uvScale], [x1 * uvScale, y0 * uvScale], [x1 * uvScale, y1 * uvScale], [x0 * uvScale, y1 * uvScale]];
        if (side > 0) this.quad(k, A, B, C, D, uv); else this.quad(k, B, A, D, C, [uv[1], uv[0], uv[3], uv[2]]);
      }
    };
    for (let i = 0; i < sx.length - 1; i++) {
      const x0 = sx[i], x1 = sx[i + 1], xm = (x0 + x1) / 2;
      const cuts = openings.filter((o) => xm > o.x0 && xm < o.x1).sort((a, b) => a.y0 - b.y0);
      let y = 0;
      for (const o of cuts) { rect(x0, x1, y, o.y0); y = o.y1; }
      rect(x0, x1, y, h);
    }
    // top cap
    this.quad(key, new THREE.Vector3(0, h, t / 2), new THREE.Vector3(len, h, t / 2), new THREE.Vector3(len, h, -t / 2), new THREE.Vector3(0, h, -t / 2), [[0, 0], [len * uvScale, 0], [len * uvScale, t * uvScale], [0, t * uvScale]]);
    // reveals around each opening (window sills, door jambs)
    const rk = revealKey ?? key;
    for (const o of openings) {
      const z0 = -t / 2, z1 = t / 2;
      if (o.y0 > 0.001) this.quad(rk, new THREE.Vector3(o.x0, o.y0, z1), new THREE.Vector3(o.x1, o.y0, z1), new THREE.Vector3(o.x1, o.y0, z0), new THREE.Vector3(o.x0, o.y0, z0), [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]);
      this.quad(rk, new THREE.Vector3(o.x1, o.y1, z1), new THREE.Vector3(o.x0, o.y1, z1), new THREE.Vector3(o.x0, o.y1, z0), new THREE.Vector3(o.x1, o.y1, z0), [[0, 0], [1, 0], [1, 0.3], [0, 0.3]]);
      this.quad(rk, new THREE.Vector3(o.x0, o.y0, z1), new THREE.Vector3(o.x0, o.y0, z0), new THREE.Vector3(o.x0, o.y1, z0), new THREE.Vector3(o.x0, o.y1, z1), [[0, 0], [0.3, 0], [0.3, 1], [0, 1]]);
      this.quad(rk, new THREE.Vector3(o.x1, o.y0, z0), new THREE.Vector3(o.x1, o.y0, z1), new THREE.Vector3(o.x1, o.y1, z1), new THREE.Vector3(o.x1, o.y1, z0), [[0, 0], [0.3, 0], [0.3, 1], [0, 1]]);
    }
  }

  /** Bake into BufferGeometries keyed by material. */
  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const [k, p] of this.parts) {
      if (!p.idx.length) continue;
      if (p.pos.some((v) => !Number.isFinite(v))) { console.warn('GeoBuilder NaN in', k, new Error().stack?.split('\n').slice(2, 5).join(' | ')); for (let i = 0; i < p.pos.length; i++) if (!Number.isFinite(p.pos[i])) p.pos[i] = 0; }
      for (let i = 0; i < p.nor.length; i++) if (!Number.isFinite(p.nor[i])) p.nor[i] = i % 3 === 1 ? 1 : 0;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      if (p.col) { GeoBuilder.padCol(p); g.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3)); }
      g.setIndex(p.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(p.idx, 1) : new THREE.Uint16BufferAttribute(p.idx, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      out.set(k, g);
    }
    return out;
  }
  /** Append another builder's parts transformed by m. */
  merge(other: GeoBuilder, m: THREE.Matrix4) {
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (const [k, p] of other.parts) {
      const t = this.part(k);
      const base = t.pos.length / 3;
      if (p.col) { GeoBuilder.padCol(p); GeoBuilder.padCol(t); t.col!.push(...p.col); t.cur = p.cur; }
      for (let i = 0; i < p.pos.length; i += 3) {
        _v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]).applyMatrix4(m); t.pos.push(_v.x, _v.y, _v.z);
        _v.set(p.nor[i], p.nor[i + 1], p.nor[i + 2]).applyMatrix3(nm).normalize(); t.nor.push(_v.x, _v.y, _v.z);
      }
      t.uv.push(...p.uv);
      for (const ix of p.idx) t.idx.push(ix + base);
    }
  }
}
