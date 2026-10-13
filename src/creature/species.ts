// Anatomy definitions: skeletons + SDF body primitives for every species.
// Models face +z, y up, x to the creature's left. Units are metres.
import type { Prim, V3 } from './sdf';

export interface BoneDef { name: string; parent: number; head: V3 }
export interface Anatomy {
  id: string;
  bones: BoneDef[];
  prims: Prim[];
  cell: number;
  /** bone indices for locomotion */
  legs?: { upper: number; lower: number; cannon: number; foot: number; side: number; front: boolean }[];
  eyes?: { bone: number; pos: V3; r: number }[];
  kind: 'quad' | 'biped' | 'bird' | 'hopper';
}

class Sk {
  bones: BoneDef[] = [];
  prims: Prim[] = [];
  b(name: string, parent: string | null, head: V3) { this.bones.push({ name, parent: parent ? this.i(parent) : -1, head }); return this.bones.length - 1; }
  i(name: string) { const k = this.bones.findIndex((b) => b.name === name); if (k < 0) throw new Error('bone ' + name); return k; }
  cone(bone: string, a: V3, b: V3, ra: number, rb: number, k = 0.04, region = 0) { this.prims.push({ type: 'cone', bone: this.i(bone), a, b, ra, rb, k, region }); }
  ell(bone: string, c: V3, r: V3, k = 0.05, region = 0, rot?: [number, number, number, number]) { this.prims.push({ type: 'ell', bone: this.i(bone), a: c, r, k, region, rot }); }
  box(bone: string, c: V3, r: V3, round: number, k = 0.01, region = 0) { this.prims.push({ type: 'box', bone: this.i(bone), a: c, r, ra: round, k, region }); }
  sub(bone: string, c: V3, r: V3, k = 0.01) { this.prims.push({ type: 'ell', bone: this.i(bone), a: c, r, k, sub: true }); }
}
const mx = (v: V3, s: number): V3 => [v[0] * s, v[1], v[2]];
const qx = (a: number): [number, number, number, number] => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];

export const R = { coat: 0, hoof: 1, muzzle: 2, belly: 3, hair: 4, inner: 6, sock: 7, horn: 8, beak: 9, cloth1: 10, cloth2: 11, boots: 12, skin: 13, hairH: 14, belt: 15 };

interface QuadP {
  id: string; s: number;         // overall scale
  back: number; bellyR: number; bodyLen: number; bodyW: number;
  neckLen: number; neckUp: number; neckR: number; headLen: number; headR: number; muzzleR: number; headDrop: number;
  earLen: number; earW: number; earUp: number;
  legLen: number; legR: number; hoof: number;
  tailLen: number; tailHair: boolean; mane: boolean; horns?: boolean; snout?: boolean; udder?: boolean;
}

function quadruped(p: QuadP): Anatomy {
  const S = p.s, k = new Sk();
  const H = p.back * S, L = p.bodyLen * S, W = p.bodyW * S;
  const hipZ = -L * 0.42, chestZ = L * 0.42;
  const legTop = H - p.bellyR * S * 0.8;
  k.b('root', null, [0, H - 0.05 * S, hipZ]);
  k.b('spine', 'root', [0, H, 0]);
  k.b('chest', 'spine', [0, H - 0.02 * S, chestZ]);
  const neckBase: V3 = [0, H - 0.05 * S, chestZ + 0.25 * S];
  const neckDir: V3 = [0, Math.sin(p.neckUp), Math.cos(p.neckUp)];
  const neckMid: V3 = [0, neckBase[1] + neckDir[1] * p.neckLen * S * 0.5, neckBase[2] + neckDir[2] * p.neckLen * S * 0.5];
  const headBase: V3 = [0, neckBase[1] + neckDir[1] * p.neckLen * S, neckBase[2] + neckDir[2] * p.neckLen * S];
  k.b('neck1', 'chest', neckBase);
  k.b('neck2', 'neck1', neckMid);
  k.b('head', 'neck2', headBase);
  const snoutTip: V3 = [0, headBase[1] - p.headDrop * S, headBase[2] + p.headLen * S];
  k.b('jaw', 'head', [0, headBase[1] - p.headR * S * 0.6, headBase[2] + p.headLen * S * 0.25]);
  k.b('earL', 'head', [p.headR * S * 0.55, headBase[1] + p.headR * S * 0.7, headBase[2] - 0.02 * S]);
  k.b('earR', 'head', [-p.headR * S * 0.55, headBase[1] + p.headR * S * 0.7, headBase[2] - 0.02 * S]);
  const tailBase: V3 = [0, H - 0.04 * S, hipZ - p.bellyR * S * 0.95];
  k.b('tail1', 'root', tailBase);
  k.b('tail2', 'tail1', [0, tailBase[1] - p.tailLen * S * 0.35, tailBase[2] - p.tailLen * S * 0.12]);
  k.b('tail3', 'tail2', [0, tailBase[1] - p.tailLen * S * 0.7, tailBase[2] - p.tailLen * S * 0.16]);
  const legs: Anatomy['legs'] = [];
  const LL = p.legLen * S;
  for (const front of [true, false]) for (const side of [1, -1]) {
    const nm = (front ? 'F' : 'H') + (side > 0 ? 'L' : 'R');
    const z0 = front ? chestZ + 0.04 * S : hipZ + 0.02 * S;
    const x = side * W * 0.62;
    const top: V3 = [x, legTop, z0];
    // front: elbow -> knee -> fetlock; hind: stifle -> hock -> fetlock (hock sits high and back)
    const j1: V3 = front ? [x, legTop - LL * 0.45, z0 - 0.02 * S] : [x, legTop - LL * 0.38, z0 - 0.14 * S];
    const j2: V3 = [x, LL * 0.13, front ? z0 + 0.01 * S : z0 - 0.06 * S];
    const foot: V3 = [x, 0.0, front ? z0 + 0.05 * S : z0 - 0.02 * S];
    const par = front ? 'chest' : 'root';
    const u = k.b('up' + nm, par, top), l = k.b('lo' + nm, 'up' + nm, j1), c = k.b('ca' + nm, 'lo' + nm, j2), f = k.b('ft' + nm, 'ca' + nm, foot);
    legs.push({ upper: u, lower: l, cannon: c, foot: f, side, front });
    const r = p.legR * S;
    // thick upper leg blending into the body, slim lower leg, distinct hoof/foot
    k.cone('up' + nm, [x * 0.8, legTop + r * 0.8, z0], j1, r * 1.7, r * 1.05, 0.06 * S);
    k.cone('lo' + nm, j1, j2, r * 1.0, r * 0.62, 0.03 * S);
    k.cone('ca' + nm, j2, [foot[0], foot[1] + p.hoof * S * 0.9, foot[2]], r * 0.72, r * 0.75, 0.02 * S, p.id === 'horse' || p.id === 'donkey' ? R.sock : R.coat);
    k.box('ft' + nm, [foot[0], foot[1] + p.hoof * S * 0.45, foot[2] + 0.01 * S], [r * 0.85, p.hoof * S * 0.45, r * 0.95], r * 0.4, 0.015 * S, R.hoof);
  }
  // torso: hindquarters, barrel, chest
  k.ell('root', [0, H - p.bellyR * S * 0.55, hipZ], [W * 0.95, p.bellyR * S * 0.98, p.bellyR * S * 1.0], 0.06 * S);
  k.ell('spine', [0, H - p.bellyR * S * 0.62, 0], [W, p.bellyR * S, L * 0.48], 0.12 * S);
  k.ell('spine', [0, H - p.bellyR * S * 1.15, 0], [W * 0.75, p.bellyR * S * 0.55, L * 0.36], 0.12 * S, R.belly);
  k.ell('chest', [0, H - p.bellyR * S * 0.6, chestZ], [W * 0.9, p.bellyR * S * 1.0, p.bellyR * S * 0.85], 0.1 * S);
  if (p.udder) k.ell('root', [0, H - p.bellyR * S * 1.75, hipZ + 0.22 * S], [0.12 * S, 0.09 * S, 0.14 * S], 0.06 * S, R.muzzle);
  // neck and head
  k.cone('neck1', [0, neckBase[1] - 0.04 * S, neckBase[2] - 0.12 * S], neckMid, p.neckR * S * 1.25, p.neckR * S, 0.1 * S);
  k.cone('neck2', neckMid, headBase, p.neckR * S, p.neckR * S * 0.78, 0.05 * S);
  k.ell('head', [0, headBase[1] + 0.01 * S, headBase[2] + p.headR * S * 0.2], [p.headR * S * 0.9, p.headR * S, p.headR * S * 1.05], 0.05 * S);
  k.cone('head', [0, headBase[1], headBase[2] + p.headR * S * 0.4], snoutTip, p.headR * S * 0.8, p.muzzleR * S, 0.06 * S);
  k.ell('head', [0, snoutTip[1] - 0.005 * S, snoutTip[2] - p.muzzleR * S * 0.3], [p.muzzleR * S * 1.05, p.muzzleR * S * 0.95, p.muzzleR * S * 0.8], 0.03 * S, R.muzzle);
  if (p.snout) k.cone('head', [0, snoutTip[1], snoutTip[2] - 0.02 * S], [0, snoutTip[1], snoutTip[2] + 0.05 * S], p.muzzleR * S * 0.95, p.muzzleR * S * 0.95, 0.015 * S, R.muzzle);
  // nostrils
  k.sub('head', [p.muzzleR * S * 0.35, snoutTip[1] + p.muzzleR * S * 0.1, snoutTip[2] + (p.snout ? 0.05 : 0.0) * S + p.muzzleR * S * 0.45], [p.muzzleR * S * 0.13, p.muzzleR * S * 0.2, p.muzzleR * S * 0.25], 0.01 * S);
  k.sub('head', [-p.muzzleR * S * 0.35, snoutTip[1] + p.muzzleR * S * 0.1, snoutTip[2] + (p.snout ? 0.05 : 0.0) * S + p.muzzleR * S * 0.45], [p.muzzleR * S * 0.13, p.muzzleR * S * 0.2, p.muzzleR * S * 0.25], 0.01 * S);
  k.cone('jaw', [0, headBase[1] - p.headR * S * 0.5, headBase[2] + p.headR * S * 0.1], [0, snoutTip[1] - p.muzzleR * S * 0.55, snoutTip[2] - p.muzzleR * S * 0.4], p.headR * S * 0.55, p.muzzleR * S * 0.6, 0.04 * S);
  // ears
  for (const [sd, nm] of [[1, 'earL'], [-1, 'earR']] as const) {
    const e = k.bones[k.i(nm)].head;
    const tip: V3 = [e[0] + sd * p.earLen * S * Math.cos(p.earUp), e[1] + p.earLen * S * Math.sin(p.earUp), e[2] - 0.03 * S];
    k.ell(nm, [(e[0] + tip[0]) / 2, (e[1] + tip[1]) / 2, (e[2] + tip[2]) / 2], [p.earW * S, p.earLen * S * 0.5, p.earW * S * 0.45], 0.015 * S, R.coat,
      [0, 0, Math.sin((-sd * (Math.PI / 2 - p.earUp)) / 2), Math.cos((-sd * (Math.PI / 2 - p.earUp)) / 2)]);
  }
  if (p.horns) for (const sd of [1, -1]) k.cone('head', [sd * p.headR * S * 0.6, headBase[1] + p.headR * S * 0.75, headBase[2] + 0.02 * S], [sd * p.headR * S * 1.5, headBase[1] + p.headR * S * 1.15, headBase[2] - 0.02 * S], 0.035 * S, 0.012 * S, 0.02 * S, R.horn);
  // tail
  const t1 = k.bones[k.i('tail1')].head, t2 = k.bones[k.i('tail2')].head, t3 = k.bones[k.i('tail3')].head;
  k.cone('tail1', t1, t2, 0.05 * S, 0.035 * S, 0.04 * S);
  k.cone('tail2', t2, t3, 0.035 * S, 0.025 * S, 0.02 * S, p.tailHair ? R.hair : R.coat);
  if (p.tailHair) k.cone('tail3', t3, [0, t3[1] - p.tailLen * S * 0.45, t3[2] - 0.05 * S], 0.07 * S, 0.04 * S, 0.04 * S, R.hair);
  else k.ell('tail3', t3, [0.04 * S, 0.07 * S, 0.04 * S], 0.02 * S, R.hair);
  if (p.mane) k.cone('neck2', [0, neckBase[1] + p.neckR * S * 0.9, neckBase[2] - 0.05 * S], [0, headBase[1] + p.headR * S * 0.85, headBase[2] - 0.05 * S], 0.045 * S, 0.04 * S, 0.05 * S, R.hair);
  const eyeZ = headBase[2] + p.headR * S * 0.35, eyeY = headBase[1] + p.headR * S * 0.3;
  return {
    id: p.id, bones: k.bones, prims: k.prims, cell: 0.022 * S, legs, kind: 'quad',
    eyes: [1, -1].map((sd) => ({ bone: k.i('head'), pos: [sd * p.headR * S * 0.78, eyeY, eyeZ] as V3, r: 0.022 * S * (p.id === 'pig' ? 0.6 : 1) })),
  };
}

export function horse(): Anatomy {
  return quadruped({ id: 'horse', s: 1, back: 1.5, bellyR: 0.36, bodyLen: 1.55, bodyW: 0.3, neckLen: 0.78, neckUp: 0.85, neckR: 0.16, headLen: 0.52, headR: 0.13, muzzleR: 0.085, headDrop: 0.32, earLen: 0.14, earW: 0.035, earUp: 1.35, legLen: 1.1, legR: 0.075, hoof: 0.09, tailLen: 0.8, tailHair: true, mane: true });
}
export function donkey(): Anatomy {
  return quadruped({ id: 'donkey', s: 0.82, back: 1.42, bellyR: 0.4, bodyLen: 1.42, bodyW: 0.31, neckLen: 0.62, neckUp: 0.7, neckR: 0.17, headLen: 0.55, headR: 0.15, muzzleR: 0.1, headDrop: 0.3, earLen: 0.3, earW: 0.055, earUp: 1.25, legLen: 1.0, legR: 0.07, hoof: 0.08, tailLen: 0.75, tailHair: false, mane: true });
}
export function cow(): Anatomy {
  return quadruped({ id: 'cow', s: 1, back: 1.42, bellyR: 0.46, bodyLen: 1.75, bodyW: 0.38, neckLen: 0.5, neckUp: 0.35, neckR: 0.22, headLen: 0.48, headR: 0.15, muzzleR: 0.11, headDrop: 0.18, earLen: 0.16, earW: 0.06, earUp: 0.15, legLen: 0.82, legR: 0.08, hoof: 0.08, tailLen: 0.95, tailHair: false, mane: false, horns: true, udder: true });
}
export function pig(): Anatomy {
  return quadruped({ id: 'pig', s: 0.62, back: 1.25, bellyR: 0.5, bodyLen: 1.65, bodyW: 0.42, neckLen: 0.22, neckUp: 0.1, neckR: 0.32, headLen: 0.48, headR: 0.24, muzzleR: 0.12, headDrop: 0.12, earLen: 0.2, earW: 0.09, earUp: 0.6, legLen: 0.52, legR: 0.085, hoof: 0.08, tailLen: 0.3, tailHair: false, mane: false, snout: true });
}

export function bunny(): Anatomy {
  const k = new Sk();
  k.b('root', null, [0, 0.12, -0.08]);
  k.b('spine', 'root', [0, 0.16, 0.0]);
  k.b('chest', 'spine', [0, 0.14, 0.08]);
  k.b('head', 'chest', [0, 0.2, 0.13]);
  k.b('earL', 'head', [0.025, 0.26, 0.12]);
  k.b('earR', 'head', [-0.025, 0.26, 0.12]);
  k.b('tail1', 'root', [0, 0.12, -0.16]);
  const legs: Anatomy['legs'] = [];
  for (const sd of [1, -1]) {
    const nm = sd > 0 ? 'L' : 'R';
    const u = k.b('upF' + nm, 'chest', [sd * 0.035, 0.1, 0.1]), l = k.b('loF' + nm, 'upF' + nm, [sd * 0.035, 0.05, 0.11]);
    const c = k.b('caF' + nm, 'loF' + nm, [sd * 0.035, 0.015, 0.12]), f = k.b('ftF' + nm, 'caF' + nm, [sd * 0.035, 0.0, 0.135]);
    legs.push({ upper: u, lower: l, cannon: c, foot: f, side: sd, front: true });
    k.cone('upF' + nm, [sd * 0.035, 0.1, 0.1], [sd * 0.035, 0.05, 0.11], 0.018, 0.012, 0.015);
    k.cone('loF' + nm, [sd * 0.035, 0.05, 0.11], [sd * 0.035, 0.012, 0.125], 0.011, 0.01, 0.006);
    k.ell('ftF' + nm, [sd * 0.035, 0.008, 0.135], [0.012, 0.008, 0.02], 0.006);
    const u2 = k.b('upH' + nm, 'root', [sd * 0.05, 0.1, -0.08]), l2 = k.b('loH' + nm, 'upH' + nm, [sd * 0.055, 0.06, -0.03]);
    const c2 = k.b('caH' + nm, 'loH' + nm, [sd * 0.055, 0.02, -0.12]), f2 = k.b('ftH' + nm, 'caH' + nm, [sd * 0.055, 0.0, -0.04]);
    legs.push({ upper: u2, lower: l2, cannon: c2, foot: f2, side: sd, front: false });
    k.ell('upH' + nm, [sd * 0.05, 0.09, -0.06], [0.03, 0.045, 0.055], 0.03);
    k.cone('caH' + nm, [sd * 0.055, 0.02, -0.11], [sd * 0.055, 0.008, -0.02], 0.014, 0.011, 0.01);
  }
  k.ell('root', [0, 0.11, -0.07], [0.07, 0.07, 0.08], 0.03);
  k.ell('spine', [0, 0.12, 0.0], [0.06, 0.065, 0.09], 0.04);
  k.ell('spine', [0, 0.085, 0.0], [0.045, 0.035, 0.07], 0.04, R.belly);
  k.ell('chest', [0, 0.12, 0.08], [0.05, 0.055, 0.05], 0.03);
  k.ell('head', [0, 0.2, 0.15], [0.038, 0.04, 0.05], 0.025);
  k.ell('head', [0, 0.19, 0.19], [0.026, 0.025, 0.025], 0.015, R.muzzle);
  k.ell('earL', [0.03, 0.29, 0.11], [0.014, 0.055, 0.007], 0.01, R.coat, [0, 0, -0.1, 0.995]);
  k.ell('earR', [-0.03, 0.29, 0.11], [0.014, 0.055, 0.007], 0.01, R.coat, [0, 0, 0.1, 0.995]);
  k.ell('tail1', [0, 0.13, -0.17], [0.022, 0.022, 0.02], 0.012, R.belly);
  return { id: 'bunny', bones: k.bones, prims: k.prims, cell: 0.0045, legs, kind: 'hopper', eyes: [1, -1].map((sd) => ({ bone: k.i('head'), pos: [sd * 0.03, 0.21, 0.165] as V3, r: 0.008 })) };
}

export function bird(variant: 'sparrow' | 'crow' | 'pigeon' | 'chicken'): Anatomy {
  const s = variant === 'crow' ? 1.5 : variant === 'pigeon' ? 1.25 : variant === 'chicken' ? 2.6 : 0.7;
  const k = new Sk();
  const h = variant === 'chicken' ? 0.11 : 0.06;
  k.b('body', null, [0, h * s, 0]);
  k.b('neck', 'body', [0, (h + 0.03) * s, 0.04 * s]);
  k.b('head', 'neck', [0, (h + 0.06) * s, 0.055 * s]);
  k.b('tail1', 'body', [0, (h + 0.005) * s, -0.06 * s]);
  for (const sd of [1, -1]) {
    const nm = sd > 0 ? 'L' : 'R';
    k.b('w1' + nm, 'body', [sd * 0.03 * s, (h + 0.025) * s, 0.025 * s]);
    k.b('w2' + nm, 'w1' + nm, [sd * 0.08 * s, (h + 0.025) * s, 0.015 * s]);
    k.b('w3' + nm, 'w2' + nm, [sd * 0.14 * s, (h + 0.025) * s, 0.0]);
    k.b('leg' + nm, 'body', [sd * 0.018 * s, (h - 0.02) * s, 0.0]);
    k.b('foot' + nm, 'leg' + nm, [sd * 0.018 * s, 0.003 * s, 0.005 * s]);
    // folded wings lie along the body; flapping rotates them out
    k.ell('w1' + nm, [sd * 0.035 * s, (h + 0.012) * s, -0.0 * s], [0.012 * s, 0.022 * s, 0.045 * s], 0.008 * s, R.coat);
    k.ell('w2' + nm, [sd * 0.038 * s, (h + 0.01) * s, -0.035 * s], [0.009 * s, 0.018 * s, 0.045 * s], 0.006 * s, R.hair);
    k.cone('leg' + nm, [sd * 0.018 * s, (h - 0.02) * s, 0], [sd * 0.018 * s, 0.006 * s, 0.003 * s], 0.006 * s, 0.003 * s, 0.006 * s, R.beak);
    k.box('foot' + nm, [sd * 0.018 * s, 0.002 * s, 0.01 * s], [0.006 * s, 0.002 * s, 0.014 * s], 0.002 * s, 0.002 * s, R.beak);
  }
  k.ell('body', [0, h * s, -0.005 * s], [0.032 * s, 0.032 * s, 0.055 * s], 0.01 * s);
  k.ell('body', [0, (h - 0.012) * s, 0.01 * s], [0.026 * s, 0.024 * s, 0.04 * s], 0.02 * s, R.belly);
  k.cone('neck', [0, (h + 0.015) * s, 0.03 * s], [0, (h + 0.055) * s, 0.05 * s], 0.022 * s, 0.017 * s, 0.015 * s);
  k.ell('head', [0, (h + 0.065) * s, 0.058 * s], [0.019 * s, 0.02 * s, 0.022 * s], 0.012 * s);
  const beakL = variant === 'crow' ? 0.035 : variant === 'chicken' ? 0.018 : 0.016;
  k.cone('head', [0, (h + 0.062) * s, 0.072 * s], [0, (h + 0.056) * s, (0.075 + beakL) * s], 0.007 * s, 0.0015 * s, 0.004 * s, R.beak);
  if (variant === 'chicken') {
    k.ell('head', [0, (h + 0.088) * s, 0.06 * s], [0.004 * s, 0.012 * s, 0.016 * s], 0.006 * s, R.muzzle);
    k.ell('head', [0, (h + 0.045) * s, 0.07 * s], [0.004 * s, 0.01 * s, 0.006 * s], 0.005 * s, R.muzzle);
  }
  k.box('tail1', [0, (h + 0.008) * s, -0.085 * s], [0.022 * s, 0.004 * s, 0.035 * s], 0.003 * s, 0.01 * s, R.hair);
  return { id: variant, bones: k.bones, prims: k.prims, cell: 0.0022 * s, kind: 'bird', eyes: [1, -1].map((sd) => ({ bone: k.i('head'), pos: [sd * 0.016 * s, (h + 0.07) * s, 0.064 * s] as V3, r: 0.0045 * s })) };
}

export interface HumanP { female: boolean; build: number; dress: boolean; beard: boolean; hairLong: boolean; armor?: boolean }
export function human(p: HumanP): Anatomy {
  const k = new Sk();
  const f = p.female, b = p.build;
  const sh = f ? 0.17 : 0.2 + b * 0.02, hipW = f ? 0.12 : 0.105;
  k.b('hips', null, [0, 0.97, 0]);
  k.b('spine', 'hips', [0, 1.12, 0]);
  k.b('chest', 'spine', [0, 1.3, 0]);
  k.b('neck', 'chest', [0, 1.5, 0.0]);
  k.b('head', 'neck', [0, 1.6, 0.01]);
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    k.b('clav' + n, 'chest', [sd * 0.04, 1.44, 0.02]);
    k.b('arm' + n, 'clav' + n, [sd * sh, 1.44, 0]);
    k.b('fore' + n, 'arm' + n, [sd * (sh + 0.04), 1.16, -0.01]);
    k.b('hand' + n, 'fore' + n, [sd * (sh + 0.06), 0.92, 0.02]);
    k.b('thigh' + n, 'hips', [sd * hipW * 0.85, 0.94, 0]);
    k.b('shin' + n, 'thigh' + n, [sd * hipW * 0.8, 0.52, 0.01]);
    k.b('foot' + n, 'shin' + n, [sd * hipW * 0.8, 0.085, -0.02]);
    k.b('toe' + n, 'foot' + n, [sd * hipW * 0.8, 0.02, 0.12]);
  }
  const g = 1 + b * 0.12; // girth
  const torsoR = p.armor ? R.cloth2 : R.cloth1;
  // torso and tunic
  k.ell('hips', [0, 0.98, 0], [hipW * 1.45 * g, 0.13, 0.12 * g], 0.05, f && p.dress ? R.cloth1 : R.cloth2);
  k.ell('spine', [0, 1.14, 0.0], [0.14 * g, 0.13, 0.11 * g], 0.07, torsoR);
  k.ell('chest', [0, 1.31, 0.005], [sh * 0.82, 0.15, 0.12 * g], 0.07, torsoR);
  if (f) for (const sd of [1, -1]) k.ell('chest', [sd * 0.055, 1.3, 0.085], [0.055, 0.05, 0.04], 0.04, torsoR);
  k.ell('hips', [0, 1.0, 0.0], [hipW * 1.5 * g, 0.03, 0.125 * g], 0.02, R.belt);
  // skirt of the tunic / dress
  const hem = p.dress ? 0.12 : 0.72;
  k.cone('hips', [0, 1.0, 0], [0, hem, -0.01], 0.17 * g, p.dress ? 0.3 : 0.2 * g, 0.03, R.cloth1);
  // neck and head
  k.cone('neck', [0, 1.46, 0.0], [0, 1.58, 0.015], 0.055, 0.05, 0.03, R.skin);
  k.ell('head', [0, 1.69, 0.015], [0.082, 0.105, 0.098], 0.02, R.skin);
  k.ell('head', [0, 1.63, 0.045], [0.07, 0.06, 0.07], 0.04, R.skin);   // jaw
  k.cone('head', [0, 1.685, 0.1], [0, 1.65, 0.125], 0.012, 0.014, 0.02, R.skin); // nose
  k.ell('head', [0, 1.72, 0.085], [0.07, 0.016, 0.025], 0.02, R.skin);    // brow
  for (const sd of [1, -1]) {
    k.sub('head', [sd * 0.032, 1.695, 0.1], [0.018, 0.012, 0.014], 0.012);  // eye sockets
    k.ell('head', [sd * 0.085, 1.68, 0.0], [0.012, 0.028, 0.02], 0.01, R.skin); // ears
  }
  // hair
  k.ell('head', [0, 1.745, -0.005], [0.088, 0.075, 0.1], 0.015, R.hairH);
  if (p.hairLong) k.ell('head', [0, 1.6, -0.06], [0.09, 0.15, 0.06], 0.03, R.hairH);
  if (p.beard) k.ell('head', [0, 1.6, 0.075], [0.06, 0.055, 0.04], 0.02, R.hairH);
  // arms
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    k.ell('arm' + n, [sd * (sh - 0.02), 1.42, 0], [0.06 * g, 0.06, 0.06 * g], 0.05, torsoR);
    k.cone('arm' + n, [sd * sh, 1.42, 0], [sd * (sh + 0.04), 1.16, -0.01], 0.05 * g, 0.042 * g, 0.04, torsoR);
    k.cone('fore' + n, [sd * (sh + 0.04), 1.16, -0.01], [sd * (sh + 0.06), 0.94, 0.02], 0.042 * g, 0.033, 0.02, p.armor ? R.cloth2 : R.cloth1);
    k.ell('hand' + n, [sd * (sh + 0.065), 0.87, 0.025], [0.025, 0.05, 0.04], 0.02, R.skin);
    k.cone('hand' + n, [sd * (sh + 0.055), 0.86, 0.06], [sd * (sh + 0.055), 0.8, 0.07], 0.012, 0.009, 0.01, R.skin); // thumb
    // legs
    k.cone('thigh' + n, [sd * hipW * 0.85, 0.94, 0], [sd * hipW * 0.8, 0.52, 0.01], 0.085 * g, 0.058 * g, 0.05, R.cloth2);
    k.cone('shin' + n, [sd * hipW * 0.8, 0.52, 0.01], [sd * hipW * 0.8, 0.12, -0.02], 0.058 * g, 0.042, 0.03, p.dress ? R.cloth2 : R.boots);
    k.box('foot' + n, [sd * hipW * 0.8, 0.045, 0.04], [0.045, 0.045, 0.11], 0.03, 0.03, R.boots);
  }
  return {
    id: 'human', bones: k.bones, prims: k.prims, cell: 0.0085, kind: 'biped',
    eyes: [1, -1].map((sd) => ({ bone: k.i('head'), pos: [sd * 0.032, 1.697, 0.094] as V3, r: 0.0125 })),
  };
}
export { mx, qx };
