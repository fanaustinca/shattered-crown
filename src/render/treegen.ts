// Procedural tree geometry: branching tubes + foliage cards with spherical normals,
// and canvas-painted leaf/needle cluster textures.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise';

export type Species = 'spruce' | 'pine' | 'oak' | 'birch' | 'beech' | 'bush';

export interface TreeParts { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; height: number; crownR: number }

class Builder {
  trunkVerts = -1;
  pos: number[] = []; nor: number[] = []; uv: number[] = []; wind: number[] = []; idx: number[] = []; ctr: number[] = [];
  vcount() { return this.pos.length / 3; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 2));
    if (this.ctr.length) g.setAttribute('aCenter', new THREE.Float32BufferAttribute(this.ctr, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const tmpQ = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);

/** A tapered, slightly curved tube along a polyline. */
function tube(b: Builder, pts: THREE.Vector3[], radii: number[], sides: number, windBase: number[], vScale: number) {
  const base = b.vcount();
  let vAcc = 0;
  let prevN = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dir = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])).normalize();
    // parallel-transport a frame along the curve so the bark texture doesn't twist
    let n = prevN.clone().sub(dir.clone().multiplyScalar(prevN.dot(dir)));
    if (n.lengthSq() < 1e-6) n = new THREE.Vector3(0, 0, 1).cross(dir);
    n.normalize(); prevN = n;
    const bn = dir.clone().cross(n).normalize();
    if (i > 0) vAcc += pts[i].distanceTo(pts[i - 1]);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const nx = n.x * Math.cos(a) + bn.x * Math.sin(a), ny = n.y * Math.cos(a) + bn.y * Math.sin(a), nz = n.z * Math.cos(a) + bn.z * Math.sin(a);
      b.pos.push(p.x + nx * radii[i], p.y + ny * radii[i], p.z + nz * radii[i]);
      b.nor.push(nx, ny, nz);
      b.uv.push(s / sides * Math.max(1, Math.round(radii[0] * 12)) / 2, vAcc * vScale);
      b.wind.push(windBase[i], 0);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * (sides + 1) + s, c = a + sides + 1;
    b.idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  if (b.trunkVerts < 0) b.trunkVerts = b.vcount();
}

/** A foliage card: quad centred at p, oriented by quaternion, with normals bent away from the crown centre. */
function card(b: Builder, p: THREE.Vector3, size: number, q: THREE.Quaternion, crown: THREE.Vector3, wind: number, flutter: number, atlasCell: number, cells: number, bendN = 0.75) {
  const base = b.vcount();
  const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
  const out = p.clone().sub(crown).normalize();
  const fn = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const n = fn.clone().lerp(out, bendN).normalize();
  const cu = (atlasCell % cells) / cells, cv = Math.floor(atlasCell / cells) / cells;
  for (const [x, y] of corners) {
    const v = new THREE.Vector3(x * size, (y - 0.15) * size, 0).applyQuaternion(q).add(p);
    b.pos.push(v.x, v.y, v.z);
    b.nor.push(n.x, n.y, n.z);
    b.uv.push(cu + (x + 0.5) / cells, cv + y / cells);
    b.wind.push(wind, flutter);
    b.ctr.push(p.x, p.y + size * 0.35, p.z);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A long foliage card starting at origin along dir (a whole branch with its needles). */
function branchCard(b: Builder, origin: THREE.Vector3, dir: THREE.Vector3, across: THREE.Vector3, len: number, width: number, crown: THREE.Vector3, atlasCell: number, wind: number) {
  const base = b.vcount();
  const cells = 2;
  const cu = (atlasCell % cells) / cells, cv = Math.floor(atlasCell / cells) / cells;
  const tip = origin.clone().addScaledVector(dir, len);
  tip.y -= len * 0.12; // a little sag at the tip
  const corners: [THREE.Vector3, number, number][] = [
    [origin.clone().addScaledVector(across, -width * 0.5), 0, 0],
    [origin.clone().addScaledVector(across, width * 0.5), 1, 0],
    [tip.clone().addScaledVector(across, width * 0.5), 1, 1],
    [tip.clone().addScaledVector(across, -width * 0.5), 0, 1],
  ];
  const fn = new THREE.Vector3().crossVectors(across, dir).normalize();
  if (fn.y < 0) fn.negate();
  for (const [p, u, v] of corners) {
    const out = p.clone().sub(crown).normalize();
    const n = fn.clone().lerp(out, 0.55).normalize();
    b.pos.push(p.x, p.y, p.z); b.nor.push(n.x, n.y, n.z);
    b.uv.push(cu + u / cells, cv + v / cells);
    b.wind.push(wind * (0.6 + v * 0.6), v * 0.6);
    b.ctr.push(origin.x + dir.x * len * 0.5, origin.y + dir.y * len * 0.5, origin.z + dir.z * len * 0.5);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function curvePts(start: THREE.Vector3, dir: THREE.Vector3, len: number, segs: number, rnd: () => number, gravity: number, wiggle: number) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const step = len / segs;
  const p = start.clone();
  for (let i = 0; i < segs; i++) {
    d.x += (rnd() - 0.5) * wiggle; d.z += (rnd() - 0.5) * wiggle; d.y += (rnd() - 0.5) * wiggle * 0.5 - gravity;
    d.normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
  }
  return pts;
}

export function generateTree(species: Species, seed: number): TreeParts {
  const rnd = mulberry32(seed * 7919 + species.length * 31);
  const wood = new Builder(), leaves = new Builder();
  const H = { spruce: 17, pine: 19, oak: 13, birch: 15, beech: 16, bush: 1.6 }[species] * (0.8 + rnd() * 0.4);
  let crownR = 3;
  const crown = new THREE.Vector3(0, H * 0.65, 0);
  if (species === 'spruce') {
    const trunk = curvePts(new THREE.Vector3(0, -0.4, 0), up, H + 0.4, 10, rnd, 0, 0.02);
    tube(wood, trunk, trunk.map((_, i) => 0.34 * (1 - i / trunk.length) + 0.03), 7, trunk.map((_, i) => i / trunk.length * 0.25), 0.5);
    crownR = H * 0.24;
    crown.set(0, H * 0.42, 0);
    // whorls of whole-branch cards: long and drooping at the bottom, short and upswept at the top
    const whorls = 24;
    for (let w = 0; w < whorls; w++) {
      const t = 0.1 + (w / whorls) * 0.86;
      const y = H * t + (rnd() - 0.5) * 0.3;
      const len = (1 - t) * H * 0.3 + 0.7;
      const nb = 5 + Math.floor(rnd() * 2);
      for (let k = 0; k < nb; k++) {
        const a = (k / nb) * Math.PI * 2 + w * 2.39 + rnd() * 0.5;
        const pitch = -0.35 + t * 0.55 + (rnd() - 0.5) * 0.2;   // droop low, sweep up near the top
        const dir = new THREE.Vector3(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), Math.sin(a) * Math.cos(pitch)).normalize();
        if (t < 0.7) {
          const bp = [new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y, 0).addScaledVector(dir, len * 0.9)];
          tube(wood, bp, [0.045, 0.012], 4, [0.25, 0.25 + 0.5 * t], 1);
        }
        const across = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
        const roll = (rnd() - 0.5) * 0.7;
        const n0 = new THREE.Vector3().crossVectors(across, dir).normalize();
        const acr = across.clone().multiplyScalar(Math.cos(roll)).addScaledVector(n0, Math.sin(roll));
        const origin = new THREE.Vector3(0, y, 0).addScaledVector(dir, 0.15);
        branchCard(leaves, origin, dir, acr, len, len * 0.62, crown, Math.floor(rnd() * 4), 0.35 + t * 0.4);
        // a second, steeper card gives the branch depth when seen edge-on
        const acr2 = across.clone().multiplyScalar(0.35).addScaledVector(n0, 0.94).normalize();
        branchCard(leaves, origin.clone().addScaledVector(dir, len * 0.1), dir, acr2, len * 0.8, len * 0.42, crown, Math.floor(rnd() * 4), 0.35 + t * 0.4);
      }
    }
    // the leader at the top
    for (let c = 0; c < 3; c++) {
      const a = c * 2.1;
      branchCard(leaves, new THREE.Vector3(0, H - 1.6, 0), new THREE.Vector3(Math.cos(a) * 0.12, 1, Math.sin(a) * 0.12).normalize(), new THREE.Vector3(Math.cos(a + 1.57), 0, Math.sin(a + 1.57)), 1.9, 0.9, crown, 1, 0.9);
    }
  } else if (species === 'pine') {
    // Scots pine: tall bare orange-brown trunk, flat irregular crown of clumps
    const trunk = curvePts(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3((rnd() - 0.5) * 0.1, 1, (rnd() - 0.5) * 0.1), H + 0.4, 12, rnd, 0, 0.06);
    tube(wood, trunk, trunk.map((_, i) => 0.36 * Math.pow(1 - i / trunk.length, 0.8) + 0.04), 8, trunk.map((_, i) => i / trunk.length * 0.3), 0.45);
    crownR = H * 0.22;
    crown.set(trunk[trunk.length - 1].x, H * 0.82, trunk[trunk.length - 1].z);
    const nb = 9 + Math.floor(rnd() * 5);
    for (let k = 0; k < nb; k++) {
      const t = 0.62 + rnd() * 0.36;
      const tp = trunk[Math.floor(t * (trunk.length - 1))];
      const a = rnd() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0.35 + rnd() * 0.5, Math.sin(a));
      const len = (1.15 - t) * H * 0.42 + 0.8;
      const bp = curvePts(tp, dir, len, 4, rnd, -0.02, 0.35);
      tube(wood, bp, bp.map((_, i) => 0.09 * (1 - i / bp.length) + 0.015), 5, bp.map((_, i) => 0.35 + i / bp.length * 0.5), 1);
      // clumps at the branch ends
      for (let i = 2; i < bp.length; i++) for (let c = 0; c < 5; c++) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + (rnd() - 0.5) * 1.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.8));
        card(leaves, bp[i].clone().add(new THREE.Vector3((rnd() - 0.5) * 1.2, (rnd() - 0.3) * 0.6, (rnd() - 0.5) * 1.2)), 1.5 + rnd() * 0.6, q, crown, 0.7, 0.6, Math.floor(rnd() * 4), 2, 0.7);
      }
    }
  } else if (species === 'bush') {
    crownR = 1.0;
    crown.set(0, 0.6, 0);
    for (let c = 0; c < 26; c++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.9;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 1.6, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.6));
      card(leaves, new THREE.Vector3(Math.cos(a) * r, 0.15 + rnd() * 0.9, Math.sin(a) * r), 0.9 + rnd() * 0.4, q, crown, 0.5, 0.8, Math.floor(rnd() * 4), 2, 0.85);
    }
  } else {
    // broadleaf: oak (wide, gnarled), birch (slender, white), beech (tall, smooth grey)
    const isOak = species === 'oak', isBirch = species === 'birch';
    const trunkH = H * (isOak ? 0.32 : isBirch ? 0.45 : 0.4);
    const lean = new THREE.Vector3((rnd() - 0.5) * (isBirch ? 0.25 : 0.12), 1, (rnd() - 0.5) * (isBirch ? 0.25 : 0.12));
    const trunk = curvePts(new THREE.Vector3(0, -0.4, 0), lean, trunkH + 0.4, 6, rnd, 0, isOak ? 0.12 : 0.05);
    const R0 = isOak ? 0.55 : isBirch ? 0.2 : 0.38;
    tube(wood, trunk, trunk.map((_, i) => R0 * (1 - i / trunk.length * 0.35) * (i === 0 ? 1.35 : 1)), 9, trunk.map((_, i) => i / trunk.length * 0.15), 0.4);
    crownR = H * (isOak ? 0.42 : isBirch ? 0.24 : 0.32);
    crown.set(0, trunkH + (H - trunkH) * 0.5, 0);
    const top = trunk[trunk.length - 1];
    const limbs = isOak ? 4 + Math.floor(rnd() * 2) : isBirch ? 3 : 4;
    const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
      const segs = Math.max(2, Math.round(len / 1.2));
      const pts = curvePts(start, dir, len, segs, rnd, isBirch ? 0.04 : 0.015, isOak ? 0.4 : 0.22);
      tube(wood, pts, pts.map((_, i) => r * (1 - i / pts.length * 0.6)), depth === 0 ? 7 : 5, pts.map((_, i) => 0.2 + depth * 0.2 + i / pts.length * 0.2), 0.6);
      if (depth >= (isOak ? 3 : 2)) {
        // leaf clusters around the twig
        const n = isBirch ? 7 : 9;
        for (let c = 0; c < n; c++) {
          const p = pts[Math.max(1, Math.floor(rnd() * pts.length))].clone().add(new THREE.Vector3((rnd() - 0.5) * 1.8, (rnd() - 0.2) * 1.3, (rnd() - 0.5) * 1.8));
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 2.4, rnd() * Math.PI * 2, (rnd() - 0.5) * 2.4));
          card(leaves, p, (isBirch ? 1.6 : 2.3) + rnd() * 0.8, q, crown, 0.6 + depth * 0.1, 1.0, Math.floor(rnd() * 4), 2, 0.8);
        }
        return;
      }
      const kids = depth === 0 ? 3 : 3 + Math.floor(rnd() * 2);
      for (let k = 0; k < kids; k++) {
        const at = pts[Math.min(pts.length - 1, Math.floor((0.45 + rnd() * 0.55) * pts.length))];
        const a = rnd() * Math.PI * 2;
        const spread = isOak ? 0.9 : isBirch ? 0.5 : 0.65;
        const nd = dir.clone().normalize().multiplyScalar(1 - spread).add(new THREE.Vector3(Math.cos(a) * spread, 0.25 + rnd() * 0.3, Math.sin(a) * spread)).normalize();
        grow(at, nd, len * (0.55 + rnd() * 0.2), r * 0.55, depth + 1);
      }
    };
    for (let l = 0; l < limbs; l++) {
      const a = (l / limbs) * Math.PI * 2 + rnd() * 0.6;
      const spread = isOak ? 0.75 : isBirch ? 0.3 : 0.45;
      const dir = new THREE.Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
      grow(top, dir, (H - trunkH) * (isOak ? 0.55 : 0.6), R0 * 0.6, 0);
    }
    // fill the crown shell so the silhouette reads as a full canopy
    const shell = isBirch ? 50 : 90;
    const cr = new THREE.Vector3(crownR, (H - trunkH) * 0.5, crownR);
    for (let c = 0; c < shell; c++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = 0.7 + rnd() * 0.3;
      const sx = Math.sqrt(1 - u * u) * Math.cos(th), sz = Math.sqrt(1 - u * u) * Math.sin(th);
      if (u < -0.55) continue; // keep the underside open
      const p = new THREE.Vector3(crown.x + sx * cr.x * rr, crown.y + u * cr.y * rr, crown.z + sz * cr.z * rr);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 2.4, rnd() * Math.PI * 2, (rnd() - 0.5) * 2.4));
      card(leaves, p, (isBirch ? 1.8 : 2.6) + rnd() * 0.8, q, crown, 0.8, 1.0, Math.floor(rnd() * 4), 2, 0.85);
    }
  }
  const wg = wood.geometry();
  wg.userData.trunkVerts = Math.max(0, wood.trunkVerts);
  return { wood: wg, leaves: leaves.geometry(), height: H, crownR };
}

// ---------------- foliage textures ----------------
function leafShape(g: CanvasRenderingContext2D, kind: Species, len: number) {
  g.beginPath();
  if (kind === 'oak') {
    // lobed oak leaf
    const lobes = 4;
    g.moveTo(0, 0);
    for (let i = 0; i <= lobes; i++) {
      const t = i / lobes, y = -len * (0.15 + t * 0.85), w = len * 0.32 * Math.sin(Math.PI * (0.15 + t * 0.75));
      g.quadraticCurveTo(w * 1.25, y + len * 0.08, w * 0.7, y);
    }
    for (let i = lobes; i >= 0; i--) {
      const t = i / lobes, y = -len * (0.15 + t * 0.85), w = len * 0.32 * Math.sin(Math.PI * (0.15 + t * 0.75));
      g.quadraticCurveTo(-w * 1.25, y + len * 0.08, -w * 0.7, y);
    }
  } else {
    const w = kind === 'birch' ? 0.42 : 0.36;
    g.moveTo(0, 0);
    g.bezierCurveTo(len * w, -len * 0.25, len * w * 0.8, -len * 0.75, 0, -len);
    g.bezierCurveTo(-len * w * 0.8, -len * 0.75, -len * w, -len * 0.25, 0, 0);
  }
  g.closePath();
}

/** 2x2 atlas of foliage clusters for a species (sRGB colour with alpha). */
export function foliageTexture(kind: Species, seed = 1): THREE.CanvasTexture {
  const S = 1024, C = S / 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(seed + kind.length * 101);
  const palette: Record<string, [number, number, number][]> = {
    oak: [[48, 72, 22], [62, 88, 28], [38, 60, 20], [78, 98, 34], [55, 80, 30]],
    beech: [[60, 90, 25], [75, 105, 30], [50, 78, 22], [88, 112, 38]],
    birch: [[86, 118, 34], [104, 132, 42], [72, 104, 30], [118, 140, 50]],
    bush: [[44, 70, 24], [58, 84, 30], [36, 58, 20]],
    spruce: [[22, 42, 22], [28, 52, 26], [18, 36, 20], [34, 58, 30]],
    pine: [[38, 62, 30], [48, 74, 36], [30, 52, 26]],
  };
  const pal = palette[kind];
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = Math.floor(cell / 2) * C;
    g.save();
    g.beginPath(); g.rect(ox, oy, C, C); g.clip();
    if (kind === 'spruce') {
      // a whole spruce branch: stem from the bottom centre, alternating branchlets, dense short needles
      const x0 = ox + C * 0.5, y0 = oy + C * 0.99, L = C * 0.95;
      const tipX = x0 + (rnd() - 0.5) * C * 0.08;
      const drawNeedles = (px: number, py: number, ang: number, len: number, n: number, light: number) => {
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const qx = px + Math.cos(ang) * len * t, qy = py + Math.sin(ang) * len * t;
          for (let k = 0; k < 4; k++) {
            const na = ang + (k < 2 ? -1 : 1) * (0.5 + rnd() * 0.9) + (rnd() - 0.5) * 0.4;
            const nl = 7 + rnd() * 7;
            const col = pal[Math.floor(rnd() * pal.length)];
            const kk = (0.7 + rnd() * 0.5) * (1 + light * t * 0.9);
            g.strokeStyle = `rgb(${Math.min(255, col[0] * kk * (1 + light * t * 0.6)) | 0},${Math.min(255, col[1] * kk * (1 + light * t * 0.5)) | 0},${col[2] * kk | 0})`;
            g.lineWidth = 2.2;
            g.beginPath(); g.moveTo(qx, qy); g.lineTo(qx + Math.cos(na) * nl, qy + Math.sin(na) * nl); g.stroke();
          }
        }
      };
      g.strokeStyle = 'rgb(62,44,28)'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(tipX, y0 - L); g.stroke();
      const nb = 16;
      for (let i = 0; i < nb; i++) {
        const t = 0.06 + (i / nb) * 0.9;
        const px = x0 + (tipX - x0) * t, py = y0 - L * t;
        const side = i % 2 ? 1 : -1;
        const ang = -Math.PI / 2 + side * (0.85 + rnd() * 0.3);
        const len = C * 0.36 * Math.sin(Math.PI * (0.15 + t * 0.8)) * (0.8 + rnd() * 0.3);
        g.strokeStyle = 'rgb(70,50,32)'; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len); g.stroke();
        drawNeedles(px, py, ang, len, Math.max(6, Math.round(len / 4)), 0.5);
      }
      drawNeedles(x0, y0, -Math.PI / 2 + (tipX - x0) / L, L, 120, 0.7);
    } else if (kind === 'pine') {
      // tufts of long paired needles at twig ends (Scots pine)
      const tufts = 5;
      for (let s2 = 0; s2 < tufts; s2++) {
        const cx = ox + C * (0.25 + rnd() * 0.5), cy = oy + C * (0.3 + rnd() * 0.4);
        g.strokeStyle = 'rgb(80,55,35)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(ox + C * 0.5, oy + C * 0.98); g.lineTo(cx, cy); g.stroke();
        for (let i = 0; i < 70; i++) {
          const na = rnd() * Math.PI * 2, nl = 40 + rnd() * 70;
          const col = pal[Math.floor(rnd() * pal.length)];
          const kk = 0.7 + rnd() * 0.6;
          g.strokeStyle = `rgb(${col[0] * kk | 0},${col[1] * kk | 0},${col[2] * kk | 0})`; g.lineWidth = 2;
          g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(na) * nl * 0.5, cy + Math.sin(na) * nl * 0.5 - 6, cx + Math.cos(na) * nl, cy + Math.sin(na) * nl); g.stroke();
        }
      }
    } else {
      // twigs carrying leaves, densest toward the middle of the cell
      const twigs = kind === 'bush' ? 7 : 6;
      for (let tw = 0; tw < twigs; tw++) {
        const x0 = ox + C * (0.5 + (rnd() - 0.5) * 0.2), y0 = oy + C * 0.97;
        const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.5;
        const L = C * (0.6 + rnd() * 0.3);
        g.strokeStyle = 'rgb(60,45,30)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L); g.stroke();
        const n = kind === 'birch' ? 22 : 18;
        for (let i = 0; i < n; i++) {
          const t = 0.2 + (i / n) * 0.85;
          const px = x0 + Math.cos(ang) * L * t, py = y0 + Math.sin(ang) * L * t;
          const la = ang + (i % 2 ? 1 : -1) * (0.6 + rnd() * 0.6);
          const len = (kind === 'birch' ? 46 : kind === 'oak' ? 78 : 64) * (0.75 + rnd() * 0.5);
          const col = pal[Math.floor(rnd() * pal.length)];
          const k = 0.8 + rnd() * 0.4;
          g.save();
          g.translate(px, py); g.rotate(la + Math.PI / 2);
          leafShape(g, kind, len);
          const grd = g.createLinearGradient(-len * 0.3, 0, len * 0.3, 0);
          grd.addColorStop(0, `rgb(${col[0] * k * 0.8 | 0},${col[1] * k * 0.8 | 0},${col[2] * k * 0.8 | 0})`);
          grd.addColorStop(0.5, `rgb(${col[0] * k * 1.1 | 0},${col[1] * k * 1.1 | 0},${col[2] * k * 1.05 | 0})`);
          grd.addColorStop(1, `rgb(${col[0] * k * 0.75 | 0},${col[1] * k * 0.75 | 0},${col[2] * k * 0.7 | 0})`);
          g.fillStyle = grd; g.fill();
          g.strokeStyle = `rgba(${col[0] * 1.4 | 0},${col[1] * 1.4 | 0},${col[2] * 1.2 | 0},0.5)`; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.92); g.stroke();
          g.restore();
        }
      }
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** White birch bark with dark lenticels. */
export function birchBark(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(5);
  g.fillStyle = '#d9d6cc'; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${150 + rnd() * 60},${145 + rnd() * 55},${130 + rnd() * 50},0.25)`; g.fillRect(rnd() * 256, rnd() * 512, 20 + rnd() * 60, 2 + rnd() * 6); }
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(30,28,25,${0.5 + rnd() * 0.5})`;
    const w = 6 + rnd() * 40, h = 1.5 + rnd() * 4;
    g.beginPath(); g.ellipse(rnd() * 256, rnd() * 512, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(25,22,20,0.8)'; g.fillRect(rnd() * 256, rnd() * 512, 30 + rnd() * 50, 10 + rnd() * 20); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
