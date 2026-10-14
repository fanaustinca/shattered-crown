// Fortifications (curtain walls with walkways and crenellations, round towers, gatehouses),
// stone arch bridges, and timber docks. Each returns geometry builders + physics boxes.
import * as THREE from 'three';
import { GeoBuilder } from './geom';
import type { WallPlan } from '../world/towns';
import type { Bridge } from '../world/layout';

export interface StructModel { geo: GeoBuilder; colliders: { c: THREE.Vector3; h: THREE.Vector3; q?: THREE.Quaternion }[]; gates: { pos: THREE.Vector3; yaw: number; w: number; h: number }[]; torches: THREE.Vector3[]; flags?: { pos: THREE.Vector3; style: 'stone' | 'dark' | 'palisade' }[] }

const q = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

export function buildWalls(plan: WallPlan, ground: (x: number, z: number) => number): StructModel {
  const g = new GeoBuilder();
  const out: StructModel = { geo: g, colliders: [], gates: [], torches: [] };
  // several stones mixed along the circuit (walls were rebuilt piecemeal over centuries)
  const pal = plan.style === 'dark'
    ? ['mat:castle_wall_slates|wx:1', 'mat:castle_wall_slates|tint:c8c8cc|wx:1.2', 'mat:castle_wall_slates|tint:a8a4a0|wx:1', 'mat:castle_wall_varriation|tint:9a9ca0|wx:0.9']
    : ['mat:castle_brick_02_white|wx:1', 'mat:castle_brick_02_white|tint:f0e8dc|wx:1', 'mat:castle_brick_02_white|tint:e4dccf|wx:1.2', 'mat:white_sandstone_blocks_02|tint:f4eee4|wx:1', 'mat:castle_brick_02_white|tint:ece2d2|wx:0.9'];
  const plinthK = plan.style === 'dark' ? 'mat:stacked_stone_wall|tint:707074|wx:1.5' : 'mat:stacked_stone_wall|tint:c8beb0|wx:1.5';
  const cap = plan.style === 'dark' ? 'mat:medieval_blocks_02|tint:8a8a90|wx:1' : 'mat:white_sandstone_blocks_02|wx:0.6';
  let stone = pal[0];
  const H = plan.height, T = 2.6;
  const n = plan.pts.length;
  const cx = plan.center?.[0] ?? plan.pts.reduce((s, p) => s + p[0], 0) / n, cz = plan.center?.[1] ?? plan.pts.reduce((s, p) => s + p[1], 0) / n;
  for (let i = 0; i < n; i++) {
    const a = plan.pts[i], b = plan.pts[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]);
    // find ground under the segment (walls step down slopes)
    const gy = Math.min(ground(a[0], a[1]), ground(b[0], b[1]), ground(mx, mz)) - 1.5;
    const ang = Math.atan2(mz - cz, mx - cx);
    const isGate = plan.gates.some((ga) => Math.abs(Math.atan2(Math.sin(ga - ang), Math.cos(ga - ang))) < Math.PI / n + 0.01);
    stone = pal[(i * 7 + (i >> 2)) % pal.length];
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
      g.box(stone, 0, totalH / 2, 0, len + 0.4, totalH, T, 0.38);
      // battered stone footing, a string course, and buttresses along long runs
      const footH = 1.5 + (ground(mx, mz) - gy) + 1.2;
      g.box(plinthK, 0, footH / 2, 0, len + 0.5, footH, T + 0.9, 0.5);
      g.box(cap, 0, totalH * 0.62, 0, len + 0.45, 0.35, T + 0.25, 0.6);
      const nb = Math.floor(len / 11);
      for (let k = 1; k <= nb; k++) for (const s of [-1, 1]) g.box(stone, -len / 2 + k * len / (nb + 1), totalH * 0.35, s * (T / 2 + 0.45), 1.6, totalH * 0.7, 0.9, 0.38);
      crenels(g, cap, 0, totalH, len, T);
      // wall-walk planks and the inner parapet
      out.colliders.push({ c: new THREE.Vector3(0, totalH / 2, 0).applyMatrix4(g.matrix), h: new THREE.Vector3(len / 2 + 0.2, totalH / 2, T / 2), q: q(-yaw) });
    }
    g.pop();
    // round tower at the vertex
    const ty = ground(a[0], a[1]) - 1.5;
    const tr = plan.style === 'dark' ? 3.4 : 3.8, th = H + 6 + 1.5;
    const tStone = pal[(i * 3 + 1) % pal.length];
    g.cyl(plinthK, a[0], ty, a[1], tr + 1.0, tr + 0.35, 3.5, 24, false, 0.5);
    g.cyl(tStone, a[0], ty, a[1], tr + 0.3, tr, th, 24, false, 0.38);
    g.cyl(cap, a[0], ty + th * 0.66, a[1], tr + 0.45, tr + 0.45, 0.4, 24, false, 0.6);
    // corbelled machicolation ring under the parapet
    for (let k = 0; k < 16; k++) { const ca = (k / 16) * Math.PI * 2; g.push().translate(a[0] + Math.cos(ca) * (tr + 0.25), ty + th - 0.5, a[1] + Math.sin(ca) * (tr + 0.25)).rotateY(-ca); g.box(cap, 0, 0, 0, 0.5, 0.7, 0.35, 0.6); g.pop(); }
    g.cyl(cap, a[0], ty + th, a[1], tr + 0.5, tr + 0.5, 0.6, 24, true, 0.4);
    for (let k = 0; k < 12; k++) { const ca = (k / 12) * Math.PI * 2; g.push().translate(a[0] + Math.cos(ca) * (tr + 0.2), ty + th + 0.6 + 0.6, a[1] + Math.sin(ca) * (tr + 0.2)).rotateY(-ca); g.box(cap, 0, 0, 0, 0.6, 1.2, 1.2, 0.5); g.pop(); }
    // conical roof on every other tower; a flagpole with the kingdom's banner on the rest
    if (i % 2 === 0) g.cyl('mat:roof_slates_02', a[0], ty + th + 0.6, a[1], tr + 0.7, 0.05, tr * 1.6, 24, false, 0.5);
    else {
      g.cyl('wood:dark|stain:ebony|fin:oiled', a[0], ty + th + 0.6, a[1], 0.07, 0.05, 5.5, 8, true, 1);
      (out.flags ??= []).push({ pos: new THREE.Vector3(a[0], ty + th + 6.0, a[1]), style: plan.style });
    }
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

/** The deck's height along the bridge (local x from -len/2 to len/2): it meets the ground on both banks and
 *  rises in a gentle curve to clear the water, whatever the banks do. Also updates b.deck (mid-span height). */
export function bridgeProfile(b: Bridge, ground: (x: number, z: number) => number, waterY: number) {
  const L = b.len, ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
  const endH = (s: number) => ground(b.x + ax * s * L / 2, b.z + az * s * L / 2) + 0.1;
  const h0 = endH(-1), h1 = endH(1);
  const lin = (t: number) => h0 + (h1 - h0) * t;
  // clear the water by ~7 m at mid-span (barges and ships' boats pass under)
  const bump = Math.max(1.5, waterY + 7 - lin(0.5));
  const f = (xl: number) => { const t = THREE.MathUtils.clamp((xl + L / 2) / L, 0, 1); return lin(t) + bump * Math.pow(Math.sin(Math.PI * t), 0.75); };
  b.deck = f(0);
  return f;
}

export function buildBridge(b: Bridge, ground: (x: number, z: number) => number, waterY: number): StructModel {
  const g = new GeoBuilder();
  const out: StructModel = { geo: g, colliders: [], gates: [], torches: [] };
  const stone = 'mat:medieval_blocks_02|wx:1.2', stone2 = 'mat:medieval_blocks_02|tint:d8d0c4|wx:1', coping = 'mat:white_sandstone_blocks_02|tint:c8c0b4|wx:0.6', deck = 'mat:cobblestone_floor_01';
  const L = b.len, W = 7.5;
  const ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
  const deckY = bridgeProfile(b, ground, waterY);
  const gAt = (xl: number) => ground(b.x + ax * xl, b.z + az * xl);
  g.push().translate(b.x, 0, b.z).rotateY(b.yaw);
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
  // ---- deck: sloped segments that follow the profile (no steps), parapets with a coping stone ----
  const segs = Math.ceil(L / 4);
  for (let i = 0; i < segs; i++) {
    const x0 = -L / 2 + (i / segs) * L, x1 = -L / 2 + ((i + 1) / segs) * L, xm = (x0 + x1) / 2;
    const y0 = deckY(x0), y1 = deckY(x1), ym = (y0 + y1) / 2;
    const len = Math.hypot(x1 - x0, y1 - y0), slope = Math.atan2(y1 - y0, x1 - x0);
    g.push().translate(xm, ym, 0).rotateZ(slope);
    g.box(deck, 0, -0.3, 0, len + 0.04, 0.6, W, 0.35);
    for (const sd of [1, -1]) {
      g.box(stone2, 0, 0.45, sd * (W / 2 - 0.25), len + 0.04, 0.9, 0.5, 0.4);
      g.box(coping, 0, 0.95, sd * (W / 2 - 0.25), len + 0.04, 0.12, 0.62, 0.6);
    }
    g.pop();
    const qq = yawQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), slope));
    out.colliders.push({ c: new THREE.Vector3(xm, ym - 0.3, 0).applyMatrix4(g.matrix), h: new THREE.Vector3(len / 2 + 0.05, 0.3, W / 2), q: qq });
    for (const sd of [1, -1]) out.colliders.push({ c: new THREE.Vector3(xm, ym + 0.5, sd * (W / 2 - 0.25)).applyMatrix4(g.matrix), h: new THREE.Vector3(len / 2 + 0.05, 0.5, 0.28), q: qq });
  }
  // ---- piers wherever the deck stands well clear of the ground, spans of ~16 m ----
  const piers: number[] = [];
  const nSpan = Math.max(2, Math.round((L - 8) / 16));
  for (let i = 0; i <= nSpan; i++) {
    const px = -L / 2 + 4 + (i / nSpan) * (L - 8);
    if (deckY(px) - gAt(px) > 1.2) piers.push(px);
  }
  // abutments: where the deck leaves the bank, a solid stone ramp down to the ground with wing walls
  for (const s of [-1, 1]) {
    const xe = s * L / 2;
    let xin = xe;
    for (let k = 0; k < 40; k++) { const xx = xe - s * k; if (deckY(xx) - gAt(xx) > 1.2) break; xin = xx; }
    const xa = Math.min(xe, xin), xb = Math.max(xe, xin), mid = (xa + xb) / 2;
    const lo = Math.min(gAt(xa), gAt(xb), gAt(mid)) - 1.5, hi = deckY(mid) - 0.55;
    if (xb - xa > 0.5 && hi > lo) {
      g.box(stone, mid, (lo + hi) / 2, 0, xb - xa + 0.5, hi - lo, W - 0.3, 0.3);
      for (const sd of [1, -1]) { g.push().translate(xe - s * 2, 0, sd * (W / 2 + 1.2)).rotateY(sd * s * 0.5); g.box(stone, 0, (lo + deckY(xe) + 0.6) / 2, 0, 5, deckY(xe) + 0.6 - lo, 0.7, 0.3); g.pop(); }
    }
  }
  for (const px of piers) {
    const gy = gAt(px) - 2.5, top = deckY(px) - 0.6;
    g.box(stone, px, (gy + top) / 2, 0, 3.0, top - gy, W - 0.3, 0.3);
    // cutwaters up- and downstream, pointed, rising to just above the high-water mark
    const cwTop = Math.min(top, waterY + 2.5);
    if (cwTop > gy + 0.5) for (const sd of [1, -1]) { g.push().translate(px, (gy + cwTop) / 2, sd * (W / 2 - 0.15)).rotateY(Math.PI / 4); g.box(stone, 0, 0, 0, 2.1, cwTop - gy, 2.1, 0.3); g.pop(); }
    out.colliders.push({ c: new THREE.Vector3(px, (gy + top) / 2, 0).applyMatrix4(g.matrix), h: new THREE.Vector3(1.5, (top - gy) / 2, W / 2 - 0.15), q: q(b.yaw) });
  }
  // ---- segmental arches between neighbouring piers, below the deck; spandrel fill up to the road ----
  for (let i = 0; i + 1 < piers.length; i++) {
    const p0 = piers[i] + 1.5, p1 = piers[i + 1] - 1.5;
    const span = p1 - p0, cxm = (p0 + p1) / 2;
    if (span < 2) continue;
    const crown = deckY(cxm) - 1.0;
    const floor = Math.max(gAt(p0), gAt(p1), waterY + 0.6);
    const rise = Math.min(span * 0.42, crown - floor - 0.3);
    if (rise < 0.8) { g.box(stone, cxm, crown, 0, span, 0.9, W - 0.3, 0.3); continue; }
    const c = span / 2, R = (c * c + rise * rise) / (2 * rise), cy = crown - R, th = Math.asin(Math.min(1, c / R));
    const nv = Math.max(9, Math.round(span * 1.2));
    for (let k = 0; k < nv; k++) {
      const a = -th + (2 * th) * ((k + 0.5) / nv);
      g.push().translate(cxm + R * Math.sin(a), cy + R * Math.cos(a), 0).rotateZ(-a);
      g.box(k % 2 ? stone : stone2, 0, 0, 0, (2 * th * R) / nv + 0.04, 0.75, W - 0.3, 0.4);
      g.pop();
    }
    // spandrel: solid masonry between the arch's back and the road, in vertical slices
    const ns = Math.max(6, Math.round(span / 1.5));
    for (let k = 0; k < ns; k++) {
      const xa = p0 + (k / ns) * span, xb = p0 + ((k + 1) / ns) * span, xm = (xa + xb) / 2;
      const u = (xm - cxm) / R;
      const archTop = cy + Math.sqrt(Math.max(0, R * R - (xm - cxm) ** 2)) + 0.3;
      const top = deckY(xm) - 0.55;
      if (top - archTop > 0.05) g.box(stone, xm, (archTop + top) / 2, 0, xb - xa + 0.05, top - archTop, W - 0.3, 0.3);
      void u;
    }
  }
  // lamp posts at each end
  for (const s of [-1, 1]) out.torches.push(new THREE.Vector3(s * (L / 2 - 1.5), deckY(s * (L / 2 - 1.5)) + 2.4, W / 2 - 0.25).applyMatrix4(g.matrix));
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

/** Post-and-rail fence around a rectangle (yaw in three.js convention), with a gate gap on the front. */
export function fenceRect(out: StructModel, x: number, z: number, w: number, d: number, yaw: number, ground: (x: number, z: number) => number, wood = 'wood:weathered|stain:natural|fin:raw', gap = 2.4) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const toW = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
  const corners: [number, number][] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  for (let e = 0; e < 4; e++) {
    const [u0, v0] = corners[e], [u1, v1] = corners[(e + 1) % 4];
    const len = Math.hypot(u1 - u0, v1 - v0), n = Math.max(1, Math.round(len / 2.4));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      // the gate gap: middle of the front (+v) edge
      if (e === 2 && Math.abs((t0 + t1) / 2 - 0.5) * len < gap / 2) continue;
      const [ax, az] = toW(u0 + (u1 - u0) * t0, v0 + (v1 - v0) * t0), [bx, bz] = toW(u0 + (u1 - u0) * t1, v0 + (v1 - v0) * t1);
      const ay = ground(ax, az), by = ground(bx, bz);
      out.geo.cyl(wood, ax, ay - 0.2, az, 0.06, 0.05, 1.45, 6, true, 2);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2, sl = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(-(bz - az), bx - ax), rz = Math.atan2(by - ay, sl);
      for (const h of [0.55, 1.05]) { out.geo.push().translate(mx, my + h, mz).rotateY(ry).rotateZ(rz); out.geo.box(wood, 0, 0, 0, sl + 0.1, 0.09, 0.05, 2); out.geo.pop(); }
      out.colliders.push({ c: new THREE.Vector3(mx, my + 0.6, mz), h: new THREE.Vector3(sl / 2, 0.6, 0.06), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry) });
    }
  }
}
export function well(out: StructModel, x: number, z: number, ground: (x: number, z: number) => number) {
  const y = ground(x, z), g = out.geo;
  g.cyl('mat:stacked_stone_wall|wx:1.2', x, y - 0.3, z, 1.0, 1.0, 1.15, 20, false, 0.6);
  g.cyl('mat:stacked_stone_wall|wx:1.2', x, y - 0.3, z, 0.78, 0.78, 1.12, 20, false, 0.6);
  g.cyl('mat:medieval_blocks_02', x, y + 0.82, z, 1.05, 1.05, 0.08, 20, false, 0.6);
  g.cyl('color:0a1014|r:0.05', x, y + 0.45, z, 0.78, 0.78, 0.01, 20, true);
  for (const s of [-1, 1]) g.box('wood:dark|stain:walnut|fin:raw', x + s * 0.95, y + 1.6, z, 0.12, 2.0, 0.12, 2);
  g.push().translate(x, y + 2.5, z).rotateZ(Math.PI / 2); g.cyl('wood:dark|stain:walnut|fin:raw', 0, -1.05, 0, 0.07, 0.07, 2.1, 8); g.pop();
  for (const s of [-1, 1]) { g.push().translate(x, y + 2.95, z + s * 0.6).rotateX(s * 0.75); g.box('mat:roof_slates_02', 0, 0, 0, 2.5, 0.06, 1.5, 0.6); g.pop(); }
  g.cyl('wood:planks|stain:honey|fin:raw', x + 0.1, y + 1.6, z, 0.16, 0.13, 0.28, 12);
  g.cyl('color:2a2018|r:1', x + 0.1, y + 1.88, z, 0.008, 0.008, 0.62, 4);
  out.colliders.push({ c: new THREE.Vector3(x, y + 0.4, z), h: new THREE.Vector3(1.0, 0.6, 1.0) });
}
const GOODS: Record<string, string[]> = {
  fruit: ['color:b02a18|r:0.4', 'color:d8b030|r:0.4', 'color:6a9a2a|r:0.4'], bread: ['mat:flour|tint:a06a38'], cloth: ['cloth:wool|dye:woad', 'cloth:wool|dye:madder', 'cloth:wool|dye:weld'],
  pottery: ['ceramic|c:a86a48|glaze:1', 'ceramic|c:506070|glaze:1'], meat: ['color:8a2a22|r:0.45'], cheese: ['wax|c:d8a030'], weapons: ['iron'], fish: ['silver'], candles: ['wax|c:f2e8d0'], tools: ['iron', 'wood:planks|stain:honey|fin:raw'],
};
export function stall(out: StructModel, x: number, z: number, yaw: number, goods: string, ground: (x: number, z: number) => number, seed: number) {
  const y = ground(x, z), g = out.geo;
  g.push().translate(x, y, z).rotateY(yaw);
  const wood = 'wood:weathered|stain:walnut|fin:raw';
  for (const [px, pz] of [[-1.4, -0.8], [1.4, -0.8], [-1.4, 0.8], [1.4, 0.8]]) g.box(wood, px, 1.2, pz, 0.1, 2.4 + (pz < 0 ? 0.3 : 0), 0.1, 2);
  g.box(wood, 0, 0.9, 0.4, 2.9, 0.08, 0.9, 1.5);
  g.box(wood, 0, 0.45, 0.82, 2.9, 0.9, 0.04, 1.5);
  const dye = ['madder', 'woad', 'weld', 'moss', 'cream'][seed % 5];
  for (let i = 0; i < 6; i++) g.box(`cloth:canvas|dye:${i % 2 ? 'cream' : dye}`, -1.25 + i * 0.5, 2.55, 0, 0.5, 0.03, 1.9, 1);
  g.push().translate(0, 2.55, 0).rotateX(-0.25); g.pop();
  // the wares, heaped in baskets and crates
  const keys = GOODS[goods] ?? GOODS.tools;
  for (let i = 0; i < 18; i++) {
    const k = keys[i % keys.length], gx = -1.2 + (i % 6) * 0.48, gz = 0.15 + Math.floor(i / 6) * 0.25;
    if (goods === 'cloth') g.box(k, gx, 1.0, gz, 0.36, 0.12, 0.2, 2);
    else if (goods === 'weapons' || goods === 'tools') { g.push().translate(gx, 1.0, gz).rotateZ(1.4); g.box(k, 0, 0, 0, 0.04, 0.6, 0.06, 2); g.pop(); }
    else if (goods === 'candles') g.cyl(k, gx, 0.94, gz, 0.025, 0.025, 0.2, 8);
    else if (goods === 'cheese') g.cyl(k, gx, 0.94, gz, 0.1, 0.1, 0.08, 14);
    else if (goods === 'bread') g.ellipsoid(k, gx, 0.99, gz, 0.12, 0.06, 0.07, 10, 0.8);
    else for (let q = 0; q < 5; q++) g.ellipsoid(k, gx + (q % 3 - 1) * 0.09, 0.98 + Math.floor(q / 3) * 0.06, gz + (q % 2) * 0.06, 0.045, 0.045, 0.045, 8);
  }
  g.pop();
  out.colliders.push({ c: new THREE.Vector3(x, y + 0.5, z), h: new THREE.Vector3(1.45, 0.5, 0.9), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) });
}
export function haystack(out: StructModel, x: number, z: number, ground: (x: number, z: number) => number, s: number) {
  const y = ground(x, z);
  out.geo.ellipsoid('straw', x, y + 1.0 * s, z, 1.7 * s, 1.5 * s, 1.7 * s, 14, 0.9);
  out.geo.cyl('straw', x, y + 2.2 * s, z, 0.9 * s, 0.05, 0.9 * s, 12, false, 0.8);
  out.colliders.push({ c: new THREE.Vector3(x, y + 1.0 * s, z), h: new THREE.Vector3(1.3 * s, 1.0 * s, 1.3 * s) });
}
export function lampPost(out: StructModel, x: number, z: number, ground: (x: number, z: number) => number) {
  const y = ground(x, z);
  out.geo.cyl('wood:dark|stain:ebony|fin:raw', x, y - 0.2, z, 0.09, 0.07, 3.2, 8, true, 2);
  out.geo.box('iron', x + 0.25, y + 2.9, z, 0.5, 0.05, 0.05, 2);
  out.geo.cyl('iron', x + 0.45, y + 2.6, z, 0.07, 0.11, 0.3, 8, true);
  out.torches.push(new THREE.Vector3(x + 0.45, y + 2.95, z));
  out.colliders.push({ c: new THREE.Vector3(x, y + 1.4, z), h: new THREE.Vector3(0.1, 1.6, 0.1) });
}
