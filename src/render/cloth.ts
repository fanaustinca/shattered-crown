// Real-time cloth: position-based (Verlet) particle grids with stretch, shear and bend constraints,
// pinned to bones or poles, colliding with the wearer's limbs (capsules) and the ground, pushed by the
// wind with turbulence. Dresses swing and fold around the legs, cloaks trail and lift, banners stream.
// The nearest cloths are simulated within a fixed particle budget; the rest ride rigidly on their
// bone in their rest drape (or hang still), which is also what you get with cloth physics turned off.
import * as THREE from 'three';
import { material } from '../props/palette';
import { sharedUniforms } from './pipeline';
import type { Rig } from '../creature/rig';

interface Capsule { a: THREE.Vector3; b: THREE.Vector3; r: number }
type Anchor = { kind: 'bone'; bone: THREE.Bone; inv: THREE.Matrix4 } | { kind: 'world'; obj: THREE.Object3D };

const _m = new THREE.Matrix4(), _wind = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _ab = new THREE.Vector3(), _ap = new THREE.Vector3();

export class Cloth {
  n: number;
  pos: Float32Array; prev: Float32Array;
  /** rest positions in the anchor's local frame */
  rest: Float32Array;
  pin: Uint8Array;
  cons: Int32Array; len: Float32Array; stiff: Float32Array;
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  simulated = false;
  colliders: Capsule[] = [];
  updateColliders: (() => void) | null = null;
  ground: (x: number, z: number) => number = () => -1e9;
  /** air drag / wind response (higher for light, broad cloth) */
  windK = 1;
  private posAttr: THREE.BufferAttribute;
  private worldOf = new THREE.Matrix4();
  constructor(public anchor: Anchor, rows: number, cols: number, restAt: (r: number, c: number, out: THREE.Vector3) => void, pinned: (r: number, c: number) => boolean, public tube: boolean, matKey: string, public owner: unknown) {
    const ccount = tube ? cols : cols;
    this.n = rows * ccount;
    this.pos = new Float32Array(this.n * 3); this.prev = new Float32Array(this.n * 3); this.rest = new Float32Array(this.n * 3);
    this.pin = new Uint8Array(this.n);
    const id = (r: number, c: number) => r * ccount + ((c % ccount) + ccount) % ccount;
    for (let r = 0; r < rows; r++) for (let c = 0; c < ccount; c++) {
      restAt(r, c, _v); this.rest.set([_v.x, _v.y, _v.z], id(r, c) * 3);
      this.pin[id(r, c)] = pinned(r, c) ? 1 : 0;
    }
    // constraints: structural (rows and columns), shear (diagonals), bend (skip one)
    const cons: number[] = [], stiff: number[] = [];
    const add = (a: number, b: number, k: number) => { cons.push(a, b); stiff.push(k); };
    const cmax = tube ? ccount : ccount - 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < ccount; c++) {
      if (c < cmax) add(id(r, c), id(r, c + 1), 1);
      if (r < rows - 1) add(id(r, c), id(r + 1, c), 1);
      if (r < rows - 1 && c < cmax) { add(id(r, c), id(r + 1, c + 1), 0.6); add(id(r, c + 1), id(r + 1, c), 0.6); }
      if (r < rows - 2) add(id(r, c), id(r + 2, c), 0.25);
      if (c < cmax - 1 || (tube && ccount > 4)) add(id(r, c), id(r, c + 2), 0.25);
    }
    this.cons = new Int32Array(cons); this.stiff = new Float32Array(stiff);
    this.len = new Float32Array(stiff.length);
    for (let k = 0; k < stiff.length; k++) {
      const a = this.cons[k * 2] * 3, b = this.cons[k * 2 + 1] * 3;
      this.len[k] = Math.hypot(this.rest[a] - this.rest[b], this.rest[a + 1] - this.rest[b + 1], this.rest[a + 2] - this.rest[b + 2]);
    }
    // render mesh (double-sided cloth)
    const idx: number[] = [], uv: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < ccount; c++) uv.push(c / (tube ? ccount : ccount - 1) * (tube ? 3 : 1), r / (rows - 1) * 1.5);
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cmax; c++) {
      const a = id(r, c), b = id(r, c + 1), d = id(r + 1, c), e = id(r + 1, c + 1);
      idx.push(a, d, b, b, d, e);
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material(matKey));
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.setRigid();
  }

  /** world matrix of the rest frame */
  private frame(out: THREE.Matrix4) {
    if (this.anchor.kind === 'bone') return out.multiplyMatrices(this.anchor.bone.matrixWorld, this.anchor.inv);
    return out.copy(this.anchor.obj.matrixWorld);
  }
  get worldPos() { this.frame(this.worldOf); return _w.setFromMatrixPosition(this.worldOf); }

  /** Ride on the anchor in the rest drape (no simulation). */
  setRigid() {
    this.simulated = false;
    (this.posAttr.array as Float32Array).set(this.rest);
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
    const parent = this.anchor.kind === 'bone' ? this.anchor.bone : this.anchor.obj;
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    if (this.anchor.kind === 'bone') this.mesh.matrix.copy(this.anchor.inv); else this.mesh.matrix.identity();
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrixWorldNeedsUpdate = true;
  }
  /** Start simulating from the current rest drape, in world space. */
  setSimulated(group: THREE.Object3D) {
    if (this.simulated) return;
    this.simulated = true;
    this.frame(this.worldOf);
    for (let i = 0; i < this.n; i++) {
      _v.fromArray(this.rest, i * 3).applyMatrix4(this.worldOf);
      _v.toArray(this.pos, i * 3); _v.toArray(this.prev, i * 3);
    }
    group.add(this.mesh);
    this.mesh.matrix.identity(); this.mesh.matrixWorld.identity();
    this.mesh.matrixAutoUpdate = false;
    (this.posAttr.array as Float32Array).set(this.pos);
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  step(dt: number, wind: THREE.Vector3, t: number, iters: number) {
    const P = this.pos, Q = this.prev, n = this.n;
    this.frame(this.worldOf);
    this.updateColliders?.();
    const nrm = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const N = nrm.array as Float32Array;
    const damp = 0.985, g = -9.81 * dt * dt;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (this.pin[i]) { _v.fromArray(this.rest, k).applyMatrix4(this.worldOf); Q[k] = P[k]; Q[k + 1] = P[k + 1]; Q[k + 2] = P[k + 2]; P[k] = _v.x; P[k + 1] = _v.y; P[k + 2] = _v.z; continue; }
      const vx = (P[k] - Q[k]) * damp, vy = (P[k + 1] - Q[k + 1]) * damp, vz = (P[k + 2] - Q[k + 2]) * damp;
      // wind pushes along the surface normal (a sail-like pressure) with gusty turbulence
      const turb = 0.6 + 0.4 * Math.sin(t * 2.3 + P[k] * 0.7 + P[k + 2] * 0.5) * Math.sin(t * 1.1 + P[k + 1] * 2.0);
      const rx = wind.x * turb - vx / dt, ry = -vy / dt * 0.3, rz = wind.z * turb - vz / dt;
      const pn = (N[k] * rx + N[k + 1] * ry + N[k + 2] * rz) * 0.6 * this.windK;
      const ax = N[k] * pn + rx * 0.05 * this.windK, ay = N[k + 1] * pn, az = N[k + 2] * pn + rz * 0.05 * this.windK;
      Q[k] = P[k]; Q[k + 1] = P[k + 1]; Q[k + 2] = P[k + 2];
      P[k] += vx + ax * dt * dt; P[k + 1] += vy + g + ay * dt * dt; P[k + 2] += vz + az * dt * dt;
    }
    const C = this.cons, L = this.len, S = this.stiff, m = C.length / 2;
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < m; c++) {
        const a = C[c * 2] * 3, b = C[c * 2 + 1] * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        // cloth barely stretches but compresses freely (it folds): weaker in compression
        let diff = (d - L[c]) / d * S[c];
        if (diff < 0) diff *= 0.35;
        const pa = this.pin[a / 3], pb = this.pin[b / 3];
        const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
        P[a] += dx * diff * wa; P[a + 1] += dy * diff * wa; P[a + 2] += dz * diff * wa;
        P[b] -= dx * diff * wb; P[b + 1] -= dy * diff * wb; P[b + 2] -= dz * diff * wb;
      }
      // collisions: the wearer's limbs and the ground (resolving them in the last passes is enough)
      if (it < iters - 2) continue;
      for (let i = 0; i < n; i++) {
        if (this.pin[i]) continue;
        const k = i * 3;
        for (const cap of this.colliders) {
          _ab.subVectors(cap.b, cap.a); _ap.set(P[k] - cap.a.x, P[k + 1] - cap.a.y, P[k + 2] - cap.a.z);
          const tt = THREE.MathUtils.clamp(_ap.dot(_ab) / Math.max(1e-6, _ab.lengthSq()), 0, 1);
          const cx = cap.a.x + _ab.x * tt, cy = cap.a.y + _ab.y * tt, cz = cap.a.z + _ab.z * tt;
          const ex = P[k] - cx, ey = P[k + 1] - cy, ez = P[k + 2] - cz;
          const dd = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (dd < cap.r && dd > 1e-6) { const f = cap.r / dd; P[k] = cx + ex * f; P[k + 1] = cy + ey * f; P[k + 2] = cz + ez * f; }
        }
        if (it === iters - 1) { const gy = this.ground(P[k], P[k + 2]) + 0.015; if (P[k + 1] < gy) { P[k + 1] = gy; Q[k] = P[k] * 0.4 + Q[k] * 0.6; Q[k + 2] = P[k + 2] * 0.4 + Q[k + 2] * 0.6; } }
      }
    }
  }
  /** Push the simulated positions to the GPU (once per frame). */
  publish() {
    (this.posAttr.array as Float32Array).set(this.pos);
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
  dispose() { this.mesh.removeFromParent(); this.geo.dispose(); }
}

/** Manages every cloth: picks which to simulate (nearest first, within a particle budget). */
export class ClothSystem {
  cloths: Cloth[] = [];
  group = new THREE.Group();
  enabled = true;
  budget = 2000;       // particles simulated per frame
  simRadius = 32;
  private acc = 0;
  constructor(scene: THREE.Scene, public ground: (x: number, z: number) => number) {
    this.group.name = 'cloth';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);
  }
  setEnabled(on: boolean) { this.enabled = on; if (!on) for (const c of this.cloths) if (c.simulated) c.setRigid(); }
  add(c: Cloth) { c.ground = this.ground; this.cloths.push(c); return c; }
  remove(owner: unknown) {
    for (let i = this.cloths.length - 1; i >= 0; i--) if (this.cloths[i].owner === owner) { this.cloths[i].dispose(); this.cloths.splice(i, 1); }
  }

  /** Call after the scene graph has this frame's world matrices. */
  update(dt: number, cam: THREE.Vector3, t: number) {
    if (!this.enabled || !this.cloths.length) return;
    // choose the simulated set
    const scored = this.cloths.map((c) => ({ c, d: c.worldPos.distanceToSquared(cam) })).sort((a, b) => a.d - b.d);
    let used = 0;
    for (const { c, d } of scored) {
      const want = d < this.simRadius * this.simRadius * (c.simulated ? 1.3 : 1) && used + c.n <= this.budget && c.mesh.parent !== null;
      if (want) { used += c.n; c.setSimulated(this.group); } else if (c.simulated) c.setRigid();
    }
    const w = sharedUniforms.uWind.value;
    const wind = _wind.set(w.x * 6, 0, w.y * 6);
    // one step per frame, clamped to the range Verlet cloth stays stable in
    if (dt <= 0) return;
    const h = Math.min(1 / 30, Math.max(1 / 90, dt));
    void this.acc;
    for (const c of this.cloths) if (c.simulated) { c.step(h, wind, t, 4); c.publish(); }
  }

  // ---------------- garments ----------------
  /** A full skirt hanging from the hips, swinging around the legs. */
  skirt(rig: Rig, color: number, girth = 1, hem = 0.1, owner: unknown) {
    const hips = rig.byName.hips, sk = rig.mesh.skeleton;
    const inv = sk.boneInverses[sk.bones.indexOf(hips)].clone();
    const rows = 8, cols = 16, top = 0.99, r0 = 0.165 * girth + 0.012, r1 = 0.34;
    const c = new Cloth({ kind: 'bone', bone: hips, inv }, rows, cols, (r, cI, out) => {
      const t = r / (rows - 1), a = (cI / cols) * Math.PI * 2;
      const rad = r0 + (r1 - r0) * Math.pow(t, 0.8);
      out.set(Math.sin(a) * rad, top + (hem - top) * t, Math.cos(a) * rad * 0.92 - 0.005);
    }, (r) => r === 0, true, `cloth:linen|tint:${color.toString(16).padStart(6, '0')}|rep:2`, owner);
    c.windK = 0.6;
    this.legColliders(c, rig, 1);
    return this.add(c);
  }
  /** A cloak from the shoulders, behind the back. */
  cloak(rig: Rig, color: number, owner: unknown) {
    const chest = rig.byName.chest, sk = rig.mesh.skeleton;
    const inv = sk.boneInverses[sk.bones.indexOf(chest)].clone();
    const rows = 11, cols = 9;
    const c = new Cloth({ kind: 'bone', bone: chest, inv }, rows, cols, (r, cI, out) => {
      const t = r / (rows - 1), u = cI / (cols - 1) - 0.5;
      const wdt = 0.4 + t * 0.32;
      out.set(u * wdt, 1.47 - t * 0.98, -0.13 - t * 0.09 - Math.abs(u) * 0.02 + (1 - Math.abs(u) * 2) * 0.03);
    }, (r) => r === 0, false, `cloth:wool|tint:${color.toString(16).padStart(6, '0')}`, owner);
    c.windK = 1.1;
    this.legColliders(c, rig, 1.05, true);
    return this.add(c);
  }
  /** A banner on a pole (world-anchored), streaming in the wind. */
  banner(pole: THREE.Object3D, w: number, h: number, color: number, owner: unknown, matKey?: string) {
    const rows = 9, cols = 12;
    const c = new Cloth({ kind: 'world', obj: pole }, rows, cols, (r, cI, out) => out.set(cI / (cols - 1) * w, -r / (rows - 1) * h, 0),
      (r, cI) => cI === 0, false, matKey ?? `cloth:velvet|tint:${color.toString(16).padStart(6, '0')}`, owner);
    c.windK = 1.6;
    return this.add(c);
  }

  private legColliders(c: Cloth, rig: Rig, scale: number, torso = false) {
    const b = rig.byName;
    const caps: Capsule[] = [];
    const pairs: [string, string, number][] = [['thighL', 'shinL', 0.1], ['thighR', 'shinR', 0.1], ['shinL', 'footL', 0.07], ['shinR', 'footR', 0.07]];
    if (torso) pairs.push(['hips', 'chest', 0.18], ['spine', 'neck', 0.16]);
    for (const _ of pairs) caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0 });
    caps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0 }); // hips
    c.colliders = caps;
    c.updateColliders = () => {
      const s = rig.root.scale.x;
      pairs.forEach(([x, y, r], i) => { b[x].getWorldPosition(caps[i].a); b[y].getWorldPosition(caps[i].b); caps[i].r = r * scale * s; });
      const hc = caps[caps.length - 1];
      b.hips.getWorldPosition(hc.a); hc.b.copy(hc.a); hc.a.y += 0.05 * s; hc.b.y -= 0.12 * s; hc.r = 0.17 * scale * s;
    };
  }
}
