// Landmark-based quadruped anatomy. Each species supplies skeletal landmarks (side view, metres)
// and muscle/volume radii; the builder lays down bones and ~50 SDF primitives that read as real
// anatomy: withers, croup, shoulder blades, chest, belly line, jowls, joints, flared hooves.
import type { Anatomy, BoneDef } from './species';
import type { Prim, V3 } from './sdf';
import { R } from './species';

export interface QuadLandmarks {
  id: string;
  width: number;               // half body width at the barrel
  // body (y, z) landmarks along the centre line
  croup: [number, number]; withers: [number, number]; back: [number, number]; belly: [number, number];
  buttock: [number, number]; pointShoulder: [number, number]; girth: [number, number];
  // neck & head
  neckBase: [number, number]; throat: [number, number]; poll: [number, number]; muzzle: [number, number];
  neckDepth: number; neckTopR: number; craniumR: number; jowlR: number; muzzleR: [number, number, number];
  ear: { len: number; w: number; tilt: number; out: number };
  // legs: front (elbow, knee, fetlock, hoof z) and hind (stifle, hock, fetlock, hoof z); x offset
  legX: number; hindX: number;
  front: { elbow: [number, number]; knee: [number, number]; fetlock: [number, number]; hoofZ: number };
  hind: { stifle: [number, number]; hock: [number, number]; fetlock: [number, number]; hoofZ: number };
  legR: { forearm: number; knee: number; cannon: number; fetlock: number; pastern: number; hoof: [number, number, number]; thigh: number; gaskin: number };
  tail: { base: [number, number]; len: number; r: number; hair: number; hairLen: number; curl?: boolean };
  mane?: number;
  extras?: (k: (p: Prim) => void, bone: (n: string) => number) => void;
  eyeR: number;
  hornLen?: number;
  dewlap?: boolean; udder?: boolean; snoutDisc?: boolean; hips?: boolean;
}

type Q = [number, number, number, number];
const qmul = (a: Q, b: Q): Q => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qX = (a: number): Q => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qZ = (a: number): Q => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

export function buildQuad(L: QuadLandmarks): Anatomy {
  const bones: BoneDef[] = [];
  const idx = (n: string) => { const i = bones.findIndex((b) => b.name === n); if (i < 0) throw new Error(n); return i; };
  const b = (name: string, parent: string | null, head: V3) => { bones.push({ name, parent: parent ? idx(parent) : -1, head }); };
  const prims: Prim[] = [];
  const P = (p: Prim) => prims.push(p);
  const yz = (v: [number, number], x = 0): V3 => [x, v[0], v[1]];
  const mid = (a: [number, number], c: [number, number], t = 0.5): [number, number] => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
  const W = L.width;

  // ---- skeleton ----
  b('root', null, yz([L.croup[0] - 0.12, L.croup[1]]));
  b('spine', 'root', yz([L.back[0] - 0.1, L.back[1]]));
  b('chest', 'spine', yz([L.withers[0] - 0.15, L.withers[1]]));
  b('neck1', 'chest', yz(L.neckBase));
  b('neck2', 'neck1', yz(mid(L.neckBase, L.poll, 0.5)));
  b('head', 'neck2', yz(L.poll));
  b('jaw', 'head', yz(mid(L.poll, L.muzzle, 0.45)));
  const earBase: V3 = [L.craniumR * 0.55, L.poll[0] + L.craniumR * 0.55, L.poll[1] - 0.01];
  b('earL', 'head', earBase);
  b('earR', 'head', [-earBase[0], earBase[1], earBase[2]]);
  const tb = L.tail.base;
  b('tail1', 'root', yz(tb));
  b('tail2', 'tail1', [0, tb[0] - L.tail.len * 0.4, tb[1] - L.tail.len * 0.15]);
  b('tail3', 'tail2', [0, tb[0] - L.tail.len * 0.75, tb[1] - L.tail.len * 0.2]);
  const legs: NonNullable<Anatomy['legs']> = [];
  for (const front of [true, false]) for (const side of [1, -1]) {
    const nm = (front ? 'F' : 'H') + (side > 0 ? 'L' : 'R');
    const x = side * (front ? L.legX : L.hindX);
    const D = front ? L.front : L.hind;
    const a = front ? L.front.elbow : L.hind.stifle, j = front ? L.front.knee : L.hind.hock;
    b('up' + nm, front ? 'chest' : 'root', yz(a, x));
    b('lo' + nm, 'up' + nm, yz(j, x));
    b('ca' + nm, 'lo' + nm, yz(D.fetlock, x));
    b('ft' + nm, 'ca' + nm, [x, 0, D.hoofZ]);
    legs.push({ upper: idx('up' + nm), lower: idx('lo' + nm), cannon: idx('ca' + nm), foot: idx('ft' + nm), side, front, pole: front ? [0, 0, 1] : [0, 0, -1] });
  }

  // ---- torso ----
  const k = (n: string) => idx(n);
  const bodyLen = L.pointShoulder[1] - L.buttock[1];
  // barrel: the big rounded ribcage, deepest just behind the elbow
  P({ type: 'ell', bone: k('spine'), a: [0, (L.back[0] + L.belly[0]) / 2, L.back[1]], r: [W, (L.back[0] - L.belly[0]) / 2, bodyLen * 0.34], k: 0 });
  // girth/chest: deep in front
  P({ type: 'ell', bone: k('chest'), a: [0, (L.withers[0] + L.girth[0]) / 2 - 0.02, L.girth[1]], r: [W * 0.92, (L.withers[0] - L.girth[0]) / 2, bodyLen * 0.22], k: bodyLen * 0.12 });
  // belly: drops toward the middle and tucks up into the flank
  P({ type: 'ell', bone: k('spine'), a: [0, L.belly[0] + 0.12 * W / 0.3, L.belly[1]], r: [W * 0.85, 0.16 * W / 0.3, bodyLen * 0.3], k: bodyLen * 0.2, region: R.belly });
  // topline: withers, back, loin
  P({ type: 'ell', bone: k('chest'), a: yz([L.withers[0] - 0.08, L.withers[1]]), r: [W * 0.35, 0.1, bodyLen * 0.17], k: 0.12 });
  P({ type: 'ell', bone: k('spine'), a: yz([L.back[0] - 0.1, L.back[1]]), r: [W * 0.8, 0.12, bodyLen * 0.28], k: 0.14 });
  // croup and hindquarters: two big rounded muscle masses and the buttocks
  P({ type: 'ell', bone: k('root'), a: yz([L.croup[0] - 0.12, L.croup[1]]), r: [W * 0.85, 0.15, bodyLen * 0.17], k: 0.12 });
  for (const s of [1, -1]) {
    P({ type: 'ell', bone: k('root'), a: [s * W * 0.55, L.croup[0] - 0.3 * W / 0.3, L.croup[1] - bodyLen * 0.08], r: [W * 0.55, 0.3 * W / 0.3, bodyLen * 0.2], k: 0.1 });
    // shoulder blade sloping forward-down from the withers
    P({ type: 'ell', bone: k('chest'), a: [s * W * 0.6, (L.withers[0] + L.pointShoulder[0]) / 2, (L.withers[1] + L.pointShoulder[1]) / 2], r: [W * 0.32, (L.withers[0] - L.pointShoulder[0]) * 0.6, bodyLen * 0.12], rot: qX(-0.7), k: 0.08 });
    // upper arm / point of shoulder bulge
    P({ type: 'ell', bone: k('chest'), a: [s * W * 0.62, (L.pointShoulder[0] + L.front.elbow[0]) / 2, (L.pointShoulder[1] + L.front.elbow[1]) / 2], r: [W * 0.32, (L.pointShoulder[0] - L.front.elbow[0]) * 0.65, bodyLen * 0.1], k: 0.07 });
    // thigh down to the stifle
    P({ type: 'ell', bone: k('root'), a: [s * L.hindX, (L.croup[0] * 0.35 + L.hind.stifle[0] * 0.65) - 0.05, L.hind.stifle[1] - bodyLen * 0.06], r: [W * 0.42, (L.croup[0] - L.hind.stifle[0]) * 0.55, bodyLen * 0.15], k: 0.09 });
  }
  P({ type: 'ell', bone: k('root'), a: yz(L.buttock), r: [W * 0.8, 0.2 * W / 0.3, bodyLen * 0.1], k: 0.1 });
  P({ type: 'ell', bone: k('chest'), a: yz(L.pointShoulder), r: [W * 0.7, 0.16 * W / 0.3, bodyLen * 0.08], k: 0.1 });
  if (L.hips) for (const s of [1, -1]) P({ type: 'ell', bone: k('root'), a: [s * W * 0.82, L.croup[0] - 0.06, L.croup[1] + bodyLen * 0.06], r: [0.07, 0.06, 0.07], k: 0.06 });
  if (L.udder) {
    P({ type: 'ell', bone: k('root'), a: [0, L.belly[0] - 0.02, L.hind.stifle[1] + 0.05], r: [0.14, 0.11, 0.16], k: 0.07, region: R.muzzle });
    for (const s of [1, -1]) for (const f of [0.07, -0.05]) P({ type: 'cone', bone: k('root'), a: [s * 0.05, L.belly[0] - 0.08, L.hind.stifle[1] + 0.05 + f], b: [s * 0.05, L.belly[0] - 0.15, L.hind.stifle[1] + 0.05 + f], ra: 0.016, rb: 0.012, k: 0.01, region: R.muzzle });
  }

  // ---- neck ----
  const nb = L.neckBase, th = L.throat, pl = L.poll;
  P({ type: 'cone', bone: k('neck1'), a: yz([nb[0] - L.neckDepth * 0.3, nb[1] - 0.05]), b: yz(mid(th, pl, 0.2)), ra: L.neckDepth * 0.46, rb: L.neckDepth * 0.28, k: 0.12 });
  P({ type: 'cone', bone: k('neck2'), a: yz(mid(nb, pl, 0.45)), b: yz(th), ra: L.neckDepth * 0.34, rb: L.neckDepth * 0.25, k: 0.08 });
  // crest along the top line of the neck
  P({ type: 'cone', bone: k('neck1'), a: yz([L.withers[0] - 0.05, L.withers[1] - 0.05]), b: yz(mid(nb, pl, 0.55)), ra: L.neckTopR * 1.2, rb: L.neckTopR, k: 0.1 });
  P({ type: 'cone', bone: k('neck2'), a: yz(mid(nb, pl, 0.55)), b: yz([pl[0] - 0.03, pl[1] - 0.04]), ra: L.neckTopR, rb: L.neckTopR * 0.75, k: 0.06 });
  if (L.dewlap) P({ type: 'ell', bone: k('neck1'), a: [0, nb[0] - L.neckDepth * 0.65, nb[1] + 0.1], r: [0.06, L.neckDepth * 0.35, 0.18], k: 0.08 });
  if (L.mane) {
    P({ type: 'cone', bone: k('neck1'), a: yz([L.withers[0] + 0.04, L.withers[1] - 0.02]), b: yz([mid(nb, pl, 0.55)[0] + L.neckTopR * 0.8, mid(nb, pl, 0.55)[1]]), ra: L.mane, rb: L.mane, k: 0.03, region: R.hair });
    P({ type: 'cone', bone: k('neck2'), a: yz([mid(nb, pl, 0.55)[0] + L.neckTopR * 0.8, mid(nb, pl, 0.55)[1]]), b: yz([pl[0] + L.craniumR * 0.75, pl[1] + 0.02]), ra: L.mane, rb: L.mane * 0.8, k: 0.03, region: R.hair });
  }

  // ---- head ----
  const mz = L.muzzle;
  const dirY = mz[0] - pl[0], dirZ = mz[1] - pl[1], hl = Math.hypot(dirY, dirZ);
  // off > 0 moves toward the forehead / top line, off < 0 toward the throat
  const along = (t: number, off = 0): [number, number] => [pl[0] + dirY * t + (dirZ / hl) * off, pl[1] + dirZ * t - (dirY / hl) * off];
  P({ type: 'ell', bone: k('head'), a: yz(along(0.08, 0.02)), r: [L.craniumR * 0.95, L.craniumR, L.craniumR * 1.05], k: 0.04 });
  // forehead plane and the long face
  P({ type: 'cone', bone: k('head'), a: yz(along(0.12, 0.03)), b: yz(along(0.82, 0.02)), ra: L.craniumR * 0.85, rb: L.muzzleR[0] * 0.95, k: 0.06 });
  // jowls / cheeks: big rounded jaw bones behind the face
  for (const s of [1, -1]) P({ type: 'ell', bone: k('jaw'), a: [s * L.craniumR * 0.42, along(0.25, -L.jowlR * 0.9)[0], along(0.25, -L.jowlR * 0.9)[1]], r: [L.jowlR * 0.55, L.jowlR, L.jowlR * 1.05], k: 0.05 });
  // muzzle, nostrils, lips
  P({ type: 'ell', bone: k('head'), a: yz(along(0.96, -0.005)), r: L.muzzleR, k: 0.04, region: R.muzzle });
  P({ type: 'ell', bone: k('jaw'), a: yz(along(0.9, -L.muzzleR[1] * 0.8)), r: [L.muzzleR[0] * 0.7, L.muzzleR[1] * 0.45, L.muzzleR[2] * 0.75], k: 0.025, region: R.muzzle });
  if (L.snoutDisc) P({ type: 'cone', bone: k('head'), a: yz(along(0.95, 0)), b: yz(along(1.08, 0)), ra: L.muzzleR[0] * 0.9, rb: L.muzzleR[0] * 0.92, k: 0.015, region: R.muzzle });
  const tip = along(L.snoutDisc ? 1.08 : 1.0, 0);
  for (const s of [1, -1]) {
    P({ type: 'ell', bone: k('head'), a: [s * L.muzzleR[0] * 0.38, tip[0] + L.muzzleR[1] * 0.1, tip[1] - L.muzzleR[2] * 0.05], r: [L.muzzleR[0] * 0.16, L.muzzleR[1] * 0.25, L.muzzleR[2] * 0.3], k: 0.012, sub: true });
    // brow ridge over the eye
    P({ type: 'ell', bone: k('head'), a: [s * L.craniumR * 0.7, along(0.14, L.craniumR * 0.25)[0], along(0.14, L.craniumR * 0.25)[1]], r: [L.craniumR * 0.25, L.craniumR * 0.22, L.craniumR * 0.3], k: 0.03 });
  }
  // ears
  for (const [s, nm] of [[1, 'earL'], [-1, 'earR']] as const) {
    const e = s > 0 ? earBase : [-earBase[0], earBase[1], earBase[2]] as V3;
    const tipE: V3 = [e[0] + s * L.ear.len * Math.sin(L.ear.out), e[1] + L.ear.len * Math.cos(L.ear.out) * Math.cos(L.ear.tilt), e[2] - L.ear.len * Math.sin(L.ear.tilt)];
    const c: V3 = [(e[0] + tipE[0]) / 2, (e[1] + tipE[1]) / 2, (e[2] + tipE[2]) / 2];
    const rot = qmul(qZ(-s * L.ear.out), qX(-L.ear.tilt));
    P({ type: 'ell', bone: k(nm), a: c, r: [L.ear.w, L.ear.len * 0.55, L.ear.w * 0.5], rot, k: 0.02 });
    P({ type: 'ell', bone: k(nm), a: [c[0], c[1], c[2] + L.ear.w * 0.35], r: [L.ear.w * 0.6, L.ear.len * 0.4, L.ear.w * 0.3], rot, k: 0.005, sub: true });
  }
  if (L.hornLen) for (const s of [1, -1]) {
    const hb: V3 = [s * L.craniumR * 0.8, pl[0] + L.craniumR * 0.5, pl[1] + 0.02];
    P({ type: 'cone', bone: k('head'), a: hb, b: [hb[0] + s * L.hornLen * 0.85, hb[1] + L.hornLen * 0.45, hb[2] + L.hornLen * 0.15], ra: 0.03, rb: 0.01, k: 0.02, region: R.horn });
  }

  // ---- legs ----
  const r = L.legR;
  for (const front of [true, false]) for (const s of [1, -1]) {
    const nm = (front ? 'F' : 'H') + (s > 0 ? 'L' : 'R');
    const x = s * (front ? L.legX : L.hindX);
    const D = front ? L.front : L.hind;
    const top = front ? L.front.elbow : L.hind.stifle, j = front ? L.front.knee : L.hind.hock;
    const sock = L.id === 'horse' || L.id === 'donkey' ? R.sock : R.coat;
    if (front) {
      // forearm: muscular at the top, tapering to the knee
      P({ type: 'cone', bone: k('up' + nm), a: yz([top[0] + 0.05, top[1] - 0.01], x), b: yz(j, x), ra: r.forearm, rb: r.knee * 0.8, k: 0.05 });
    } else {
      // gaskin: the hind "calf" from stifle to hock, with the hock point behind
      P({ type: 'cone', bone: k('up' + nm), a: yz(top, x), b: yz(j, x), ra: r.gaskin, rb: r.knee * 0.85, k: 0.06 });
      P({ type: 'ell', bone: k('lo' + nm), a: yz([j[0] + 0.01, j[1] - r.knee * 0.6], x), r: [r.knee * 0.55, r.knee * 0.9, r.knee * 0.6], k: 0.02 });
    }
    P({ type: 'ell', bone: k('lo' + nm), a: yz(j, x), r: [r.knee * 0.85, r.knee * 1.1, r.knee], k: 0.025 });
    // cannon: flat, slim, with the tendon behind
    P({ type: 'cone', bone: k('lo' + nm), a: yz(j, x), b: yz(D.fetlock, x), ra: r.cannon, rb: r.cannon * 0.95, k: 0.02, region: sock });
    P({ type: 'cone', bone: k('lo' + nm), a: yz([j[0] - 0.05, j[1] - r.cannon * 0.6], x), b: yz([D.fetlock[0] + 0.03, D.fetlock[1] - r.cannon * 0.7], x), ra: r.cannon * 0.6, rb: r.cannon * 0.55, k: 0.02, region: sock });
    // fetlock joint, pastern, hoof
    P({ type: 'ell', bone: k('ca' + nm), a: yz([D.fetlock[0], D.fetlock[1] - 0.01], x), r: [r.fetlock * 0.9, r.fetlock, r.fetlock * 1.05], k: 0.02, region: sock });
    const hoofTop = r.hoof[2];
    P({ type: 'cone', bone: k('ca' + nm), a: yz(D.fetlock, x), b: [x, hoofTop * 0.9, D.hoofZ], ra: r.pastern, rb: r.pastern * 0.95, k: 0.015, region: sock });
    P({ type: 'cone', bone: k('ft' + nm), a: [x, hoofTop, D.hoofZ - 0.005], b: [x, r.hoof[1] * 0.5, D.hoofZ + 0.012], ra: r.hoof[0] * 0.8, rb: r.hoof[0], k: 0.006, region: R.hoof });
  }

  // ---- tail ----
  const t1 = bones[k('tail1')].head, t2 = bones[k('tail2')].head, t3 = bones[k('tail3')].head;
  P({ type: 'cone', bone: k('tail1'), a: t1, b: t2, ra: L.tail.r, rb: L.tail.r * 0.7, k: 0.05 });
  P({ type: 'cone', bone: k('tail2'), a: t2, b: t3, ra: L.tail.r * 0.7, rb: L.tail.r * 0.45, k: 0.02 });
  if (L.tail.hair > 0) {
    P({ type: 'cone', bone: k('tail2'), a: [0, t1[1] - 0.06, t1[2] - 0.03], b: t3, ra: L.tail.hair * 0.8, rb: L.tail.hair, k: 0.04, region: R.hair });
    P({ type: 'cone', bone: k('tail3'), a: t3, b: [0, t3[1] - L.tail.hairLen, t3[2] - 0.06], ra: L.tail.hair, rb: L.tail.hair * 0.55, k: 0.04, region: R.hair });
  }
  L.extras?.(P, k);
  // eyes sit in front of the brow, on the side of the head
  const eyePt = along(0.2, L.craniumR * 0.05);
  return {
    id: L.id, bones, prims, cell: Math.max(0.008, W * 0.06), legs, kind: 'quad',
    eyes: [1, -1].map((s) => ({ bone: k('head'), pos: [s * L.craniumR * 0.86, eyePt[0], eyePt[1]] as V3, r: L.eyeR })),
  };
}

export const HORSE: QuadLandmarks = {
  id: 'horse', width: 0.32,
  croup: [1.56, -0.6], withers: [1.62, 0.55], back: [1.5, 0.05], belly: [0.8, 0.05],
  buttock: [1.32, -0.86], pointShoulder: [1.2, 0.86], girth: [0.92, 0.5],
  neckBase: [1.34, 0.8], throat: [1.66, 1.1], poll: [2.0, 1.2], muzzle: [1.48, 1.6],
  neckDepth: 0.6, neckTopR: 0.115, craniumR: 0.13, jowlR: 0.155, muzzleR: [0.085, 0.1, 0.1],
  ear: { len: 0.16, w: 0.045, tilt: 0.25, out: 0.25 },
  legX: 0.18, hindX: 0.19,
  front: { elbow: [1.02, 0.68], knee: [0.54, 0.7], fetlock: [0.18, 0.69], hoofZ: 0.74 },
  hind: { stifle: [1.0, -0.42], hock: [0.6, -0.74], fetlock: [0.18, -0.7], hoofZ: -0.66 },
  legR: { forearm: 0.11, knee: 0.068, cannon: 0.048, fetlock: 0.062, pastern: 0.046, hoof: [0.068, 0.075, 0.105], thigh: 0.19, gaskin: 0.115 },
  tail: { base: [1.48, -0.86], len: 0.42, r: 0.06, hair: 0.11, hairLen: 0.78 },
  mane: 0.055, eyeR: 0.024,
};
export const DONKEY: QuadLandmarks = {
  ...HORSE, id: 'donkey', width: 0.27,
  croup: [1.18, -0.48], withers: [1.15, 0.42], back: [1.12, 0.0], belly: [0.62, 0.0],
  buttock: [1.0, -0.68], pointShoulder: [0.9, 0.68], girth: [0.7, 0.38],
  neckBase: [1.0, 0.6], throat: [1.25, 0.88], poll: [1.5, 0.98], muzzle: [1.08, 1.32],
  neckDepth: 0.42, neckTopR: 0.075, craniumR: 0.11, jowlR: 0.12, muzzleR: [0.08, 0.085, 0.09],
  ear: { len: 0.27, w: 0.055, tilt: 0.3, out: 0.3 },
  legX: 0.14, hindX: 0.15,
  front: { elbow: [0.78, 0.52], knee: [0.42, 0.53], fetlock: [0.13, 0.52], hoofZ: 0.56 },
  hind: { stifle: [0.75, -0.32], hock: [0.45, -0.57], fetlock: [0.13, -0.53], hoofZ: -0.5 },
  legR: { forearm: 0.08, knee: 0.05, cannon: 0.036, fetlock: 0.045, pastern: 0.036, hoof: [0.048, 0.055, 0.075], thigh: 0.14, gaskin: 0.085 },
  tail: { base: [1.12, -0.66], len: 0.55, r: 0.04, hair: 0.04, hairLen: 0.15 },
  mane: 0.03, eyeR: 0.02,
};
export const COW: QuadLandmarks = {
  id: 'cow', width: 0.36,
  croup: [1.42, -0.72], withers: [1.38, 0.55], back: [1.4, -0.05], belly: [0.68, 0.0],
  buttock: [1.2, -0.95], pointShoulder: [1.02, 0.8], girth: [0.75, 0.48],
  neckBase: [1.18, 0.78], throat: [1.25, 1.1], poll: [1.42, 1.22], muzzle: [0.98, 1.48],
  neckDepth: 0.6, neckTopR: 0.12, craniumR: 0.15, jowlR: 0.13, muzzleR: [0.11, 0.1, 0.09],
  ear: { len: 0.17, w: 0.06, tilt: 0.1, out: 1.35 },
  legX: 0.2, hindX: 0.21,
  front: { elbow: [0.78, 0.66], knee: [0.42, 0.67], fetlock: [0.12, 0.66], hoofZ: 0.7 },
  hind: { stifle: [0.8, -0.55], hock: [0.48, -0.84], fetlock: [0.12, -0.8], hoofZ: -0.76 },
  legR: { forearm: 0.115, knee: 0.07, cannon: 0.055, fetlock: 0.064, pastern: 0.052, hoof: [0.068, 0.075, 0.075], thigh: 0.2, gaskin: 0.12 },
  tail: { base: [1.42, -0.94], len: 0.85, r: 0.035, hair: 0.045, hairLen: 0.18 },
  eyeR: 0.022, hornLen: 0.16, dewlap: true, udder: true, hips: true,
};
export const PIG: QuadLandmarks = {
  id: 'pig', width: 0.24,
  croup: [0.74, -0.42], withers: [0.72, 0.32], back: [0.76, -0.05], belly: [0.3, -0.02],
  buttock: [0.6, -0.6], pointShoulder: [0.52, 0.5], girth: [0.35, 0.3],
  neckBase: [0.62, 0.48], throat: [0.55, 0.62], poll: [0.7, 0.66], muzzle: [0.46, 0.96],
  neckDepth: 0.46, neckTopR: 0.14, craniumR: 0.13, jowlR: 0.12, muzzleR: [0.075, 0.07, 0.06],
  ear: { len: 0.14, w: 0.075, tilt: -0.6, out: 0.45 },
  legX: 0.13, hindX: 0.13,
  front: { elbow: [0.32, 0.38], knee: [0.18, 0.39], fetlock: [0.06, 0.39], hoofZ: 0.41 },
  hind: { stifle: [0.33, -0.38], hock: [0.18, -0.48], fetlock: [0.06, -0.46], hoofZ: -0.44 },
  legR: { forearm: 0.055, knee: 0.04, cannon: 0.032, fetlock: 0.035, pastern: 0.03, hoof: [0.035, 0.04, 0.04], thigh: 0.14, gaskin: 0.07 },
  tail: { base: [0.7, -0.62], len: 0.18, r: 0.018, hair: 0, hairLen: 0 },
  eyeR: 0.012, snoutDisc: true,
};
