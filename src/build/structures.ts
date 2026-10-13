// Fortifications (curtain walls with walkways and crenellations, round towers, gatehouses),
// stone arch bridges, and timber docks. Each returns geometry builders + physics boxes.
import * as THREE from 'three';
import { GeoBuilder } from './geom';
import type { WallPlan } from '../world/towns';
import type { Bridge } from '../world/layout';

export interface StructModel { geo: GeoBuilder; colliders: { c: THREE.Vector3; h: THREE.Vector3; q?: THREE.Quaternion }[]; gates: { pos: THREE.Vector3; yaw: number; w: number; h: number }[]; torches: THREE.Vector3[] }

const q = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

export function buildWalls(plan: WallPlan, ground: (x: number, z: number) => number): StructModel {
  const g = new GeoBuilder();
  const out: StructModel = { geo: g, colliders: [], gates: [], torches: [] };
  const stone = plan.style === 'dark' ? 'mat:castle_wall_slates' : 'mat:castle_brick_02_white';
  const cap = plan.style === 'dark' ? 'mat:medieval_blocks_02|tint:8a8a90' : 'mat:white_sandstone_blocks_02';
  const H = plan.height, T = 2.6;
  const n = plan.pts.length;
  const cx = plan.pts.reduce((s, p) => s + p[0], 0) / n, cz = plan.pts.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const a = plan.pts[i], b = plan.pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
    // find ground under the segment (walls step down slopes)
    const gy = Math.min(ground(a[0], a[1]), ground(b[0], b[1]), ground(mx, mz)) - 1.5;
    const ang = Math.atan2(mz - cz, mx - cx);
    const isGate = plan.gates.some((ga) => Math.abs(Math.atan2(Math.sin(ga - ang), Math.cos(ga - ang))) < Math.PI / n + 0.01);
    g.push().translate(mx, gy, mz).rotateY(-yaw);
    // the wall runs along local x; local +z points outward? compute side
    const totalH = H + 1.5 + (ground(mx, mz) - 1.5 - gy);
    if (isGate) {
      // gatehouse: two flanking blocks and an arch over a 5 m wide passage
      const gw = 5.5;
      g.box(stone, -len / 4 - gw / 4, totalH / 2, 0, len / 2 - gw / 2, totalH, T, 0.25);
      g.box(stone, len / 4 + gw / 4, totalH / 2, 0, len / 2 - gw / 2, totalH, T, 0.25);
      const archY = gy < 0 ? 0 : 0;
      const passH = 6.5 + (ground(mx, mz) - gy);
      g.box(stone, 0, (passH + totalH + 3) / 2, 0, gw, totalH + 3 - passH, T + 3, 0.25);
      for (const s of [-1, 1]) {
        g.box(stone, s * (gw / 2 + 2.2), (totalH + 4) / 2, 0, 4.4, totalH + 4, T + 4, 0.25);
        crenels(g, cap, s * (gw / 2 + 2.2), totalH + 4, 4.4, T + 4);
      }
      crenels(g, cap, 0, totalH + 3, gw, T + 3);
      void archY;
      const gp = new THREE.Vector3(0, ground(mx, mz), 0).applyMatrix4(g.matrix);
      out.gates.push({ pos: gp, yaw: -yaw + Math.PI / 2, w: gw, h: 6.5 });
      out.torches.push(new THREE.Vector3(-gw / 2 - 0.3, ground(mx, mz) - gy + 3.5, T / 2 + 1.6).applyMatrix4(g.matrix), new THREE.Vector3(gw / 2 + 0.3, ground(mx, mz) - gy + 3.5, T / 2 + 1.6).applyMatrix4(g.matrix));
      const wq = q(-yaw);
      for (const s of [-1, 1]) {
        const c = new THREE.Vector3(s * (len / 4 + gw / 4 + 1.1), totalH / 2, 0).applyMatrix4(g.matrix);
        out.colliders.push({ c, h: new THREE.Vector3(len / 4 - gw / 4 + 1.1, totalH / 2, T / 2 + 1.5), q: wq });
      }
      const top = new THREE.Vector3(0, (passH + totalH + 3) / 2, 0).applyMatrix4(g.matrix);
      out.colliders.push({ c: top, h: new THREE.Vector3(gw / 2, (totalH + 3 - passH) / 2, (T + 3) / 2), q: wq });
    } else {
      g.box(stone, 0, totalH / 2, 0, len + 0.4, totalH, T, 0.25);
      crenels(g, cap, 0, totalH, len, T);
      // wall-walk planks and the inner parapet
      out.colliders.push({ c: new THREE.Vector3(0, totalH / 2, 0).applyMatrix4(g.matrix), h: new THREE.Vector3(len / 2 + 0.2, totalH / 2, T / 2), q: q(-yaw) });
    }
    g.pop();
    // round tower at the vertex
    const ty = ground(a[0], a[1]) - 1.5;
    const tr = plan.style === 'dark' ? 3.4 : 3.8, th = H + 6 + 1.5;
    g.cyl(stone, a[0], ty, a[1], tr + 0.3, tr, th, 24, false, 0.25);
    g.cyl(cap, a[0], ty + th, a[1], tr + 0.5, tr + 0.5, 0.6, 24, true, 0.4);
    for (let k = 0; k < 12; k++) { const ca = (k / 12) * Math.PI * 2; g.push().translate(a[0] + Math.cos(ca) * (tr + 0.2), ty + th + 0.6 + 0.6, a[1] + Math.sin(ca) * (tr + 0.2)).rotateY(-ca); g.box(cap, 0, 0, 0, 0.6, 1.2, 1.2, 0.5); g.pop(); }
    // conical roof on every other tower
    if (i % 2 === 0) g.cyl('mat:roof_slates_02', a[0], ty + th + 0.6, a[1], tr + 0.7, 0.05, tr * 1.6, 24, false, 0.5);
    out.colliders.push({ c: new THREE.Vector3(a[0], ty + th / 2, a[1]), h: new THREE.Vector3(tr * 0.85, th / 2, tr * 0.85), q: q(0) });
    // arrow slits as dark recesses
    for (let k = 0; k < 4; k++) { const ca = (k / 4) * Math.PI * 2 + 0.4; g.push().translate(a[0] + Math.cos(ca) * (tr + 0.31), ty + th * 0.6, a[1] + Math.sin(ca) * (tr + 0.31)).rotateY(-ca + Math.PI / 2); g.box('color:080808', 0, 0, 0, 0.15, 1.4, 0.05); g.pop(); }
  }
  return out;
}
function crenels(g: GeoBuilder, key: string, x: number, y: number, len: number, t: number) {
  const n = Math.max(2, Math.floor(len / 1.2));
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const px = x - len / 2 + (i + 0.5) * len / n;
    g.box(key, px, y + 0.6, t / 2 - 0.3, len / n, 1.2, 0.6, 0.5);
    g.box(key, px, y + 0.5, -t / 2 + 0.25, len / n, 1.0, 0.5, 0.5);
  }
  g.box(key, x, y + 0.05, 0, len, 0.1, t, 0.4);
}

export function buildBridge(b: Bridge, ground: (x: number, z: number) => number): StructModel {
  const g = new GeoBuilder();
  const out: StructModel = { geo: g, colliders: [], gates: [], torches: [] };
  const stone = 'mat:medieval_blocks_02', deck = 'mat:cobblestone_floor_01';
  const L = b.len, W = 7.5;
  const ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
  g.push().translate(b.x, 0, b.z).rotateY(b.yaw);
  // deck slightly humped in the middle
  const segs = 16;
  for (let i = 0; i < segs; i++) {
    const x0 = -L / 2 + (i / segs) * L, x1 = -L / 2 + ((i + 1) / segs) * L, xm = (x0 + x1) / 2;
    const hump = Math.cos((xm / L) * Math.PI) * 1.2;
    const y = b.deck + hump;
    g.box(deck, xm, y - 0.25, 0, (x1 - x0) + 0.05, 0.5, W, 0.35);
    g.box(stone, xm, y + 0.5, W / 2 - 0.25, (x1 - x0) + 0.05, 1.0, 0.5, 0.4);
    g.box(stone, xm, y + 0.5, -W / 2 + 0.25, (x1 - x0) + 0.05, 1.0, 0.5, 0.4);
    const slope = Math.atan2(-Math.sin((xm / L) * Math.PI) * 1.2 * Math.PI / L, 1);
    const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), slope));
    const c = new THREE.Vector3(xm, y - 0.25, 0).applyMatrix4(g.matrix);
    out.colliders.push({ c, h: new THREE.Vector3((x1 - x0) / 2 + 0.1, 0.25, W / 2), q: qq });
    for (const s of [1, -1]) out.colliders.push({ c: new THREE.Vector3(xm, y + 0.5, s * (W / 2 - 0.25)).applyMatrix4(g.matrix), h: new THREE.Vector3((x1 - x0) / 2 + 0.1, 0.5, 0.25), q: qq });
  }
  // piers and arches
  const piers = 3;
  for (let i = 0; i <= piers; i++) {
    const px = -L / 2 + 6 + (i / piers) * (L - 12);
    const wx = b.x + ax * px, wz = b.z + az * px;
    const gy = ground(wx, wz) - 2;
    const top = b.deck + Math.cos((px / L) * Math.PI) * 1.2 - 0.5;
    g.box(stone, px, (gy + top) / 2, 0, 3.0, top - gy, W - 0.4, 0.3);
    // cutwaters
    g.push().translate(px, gy, 0).rotateY(Math.PI / 4); g.box(stone, 0, (top - gy) * 0.35, 0, 2.2, (top - gy) * 0.7, 2.2, 0.3); g.pop();
    out.colliders.push({ c: new THREE.Vector3(px, (gy + top) / 2, 0).applyMatrix4(g.matrix), h: new THREE.Vector3(1.5, (top - gy) / 2, W / 2 - 0.2), q: q(b.yaw) });
    if (i < piers) {
      // arch: a ring of blocks between this pier and the next
      const nx = -L / 2 + 6 + ((i + 1) / piers) * (L - 12);
      const span = nx - px - 3, cxm = (px + nx) / 2, rr = span / 2;
      const base = b.deck - 3.2;
      for (let k = 0; k <= 10; k++) {
        const a = Math.PI * (k / 10);
        g.push().translate(cxm - Math.cos(a) * rr, base + Math.sin(a) * rr * 0.8, 0).rotateZ(-a + Math.PI / 2);
        g.box(stone, 0, 0, 0, 0.7, span / 10 + 0.3, W - 0.4, 0.4);
        g.pop();
      }
      // spandrel fill
      g.box(stone, cxm, base + rr * 0.8 + (b.deck - 0.5 - base - rr * 0.8) / 2, 0, span * 0.7, Math.max(0.2, b.deck - 0.5 - base - rr * 0.8), W - 0.4, 0.3);
    }
  }
  // lamp posts at each end
  for (const s of [-1, 1]) out.torches.push(new THREE.Vector3(s * (L / 2 - 1), b.deck + 2.4, W / 2 - 0.25).applyMatrix4(g.matrix));
  g.pop();
  return out;
}

export function buildDock(x: number, z: number, yaw: number, len: number, ground: (x: number, z: number) => number): StructModel {
  const g = new GeoBuilder();
  const out: StructModel = { geo: g, colliders: [], gates: [], torches: [] };
  const plank = 'wood:weathered|stain:natural|fin:raw', post = 'mat:pine_bark';
  const W = 4, deckY = 1.4;
  g.push().translate(x, 0, z).rotateY(yaw);
  for (let i = 0; i < Math.floor(len / 0.3); i++) g.box(plank, (Math.sin(i * 7.3) * 0.03), deckY, -len / 2 + i * 0.3 + 0.15, W + Math.sin(i * 3.1) * 0.1, 0.08, 0.28, 1.5);
  for (const s of [-1, 1]) g.box(plank, s * (W / 2 - 0.1), deckY - 0.18, 0, 0.2, 0.25, len, 1.5);
  for (let i = 0; i <= Math.floor(len / 3); i++) for (const s of [-1, 1]) {
    const pz = -len / 2 + i * 3;
    const wp = new THREE.Vector3(s * (W / 2 + 0.1), 0, pz).applyMatrix4(g.matrix);
    const gy = Math.min(ground(wp.x, wp.z), -0.5) - 1;
    g.cyl(post, s * (W / 2 + 0.1), gy, pz, 0.16, 0.15, deckY + 0.7 - gy, 10, true, 1);
    // mooring bollard tops
  }
  const qq = q(yaw);
  out.colliders.push({ c: new THREE.Vector3(0, deckY, 0).applyMatrix4(g.matrix), h: new THREE.Vector3(W / 2, 0.06, len / 2), q: qq });
  out.torches.push(new THREE.Vector3(W / 2, deckY + 1.6, len / 2 - 0.5).applyMatrix4(g.matrix));
  g.pop();
  return out;
}
