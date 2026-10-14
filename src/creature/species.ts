// Anatomy definitions: skeletons + SDF body primitives for every species.
// Models face +z, y up, x to the creature's left. Units are metres.
import type { Prim, V3 } from './sdf';
import { buildQuad, HORSE, DONKEY, COW, PIG } from './quads';

export interface BoneDef { name: string; parent: number; head: V3 }
export interface Anatomy {
  id: string;
  bones: BoneDef[];
  prims: Prim[];
  cell: number;
  /** bone indices for locomotion */
  legs?: { upper: number; lower: number; cannon: number; foot: number; side: number; front: boolean; pole?: V3 }[];
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
    k.cone('up' + nm, [x * 0.8, legTop + r * 0.8, z0], j1, r * 2.0, r * 1.15, 0.07 * S);
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
  k.cone('neck1', [0, neckBase[1] - 0.1 * S, neckBase[2] - 0.15 * S], neckMid, p.neckR * S * 1.55, p.neckR * S * 1.05, 0.12 * S);
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

export function horse(): Anatomy { return buildQuad(HORSE); }
export function donkey(): Anatomy { return buildQuad(DONKEY); }
export function cow(): Anatomy { return buildQuad(COW); }
export function pig(): Anatomy { return buildQuad(PIG); }

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

export interface HumanP { female: boolean; build: number; dress: boolean; beard: boolean; hairLong: boolean; armor?: boolean; clothSkirt?: boolean }
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
  const W = f ? 0.92 : 1;   // shoulder/chest width factor
  // ---- torso: pelvis, waist, ribcage, shoulders (built up from body masses, the tunic hugging them) ----
  // pelvis and seat
  // (under the tunic skirt: same cloth, so nothing of another colour pokes through it)
  const seat = p.clothSkirt ? R.cloth2 : R.cloth1;
  k.ell('hips', [0, 0.97, -0.005], [(f ? 0.165 : 0.15) * g, 0.11, 0.105 * g], 0.05, seat);
  for (const sd of [1, -1]) k.ell('hips', [sd * 0.06, 0.93, -0.055], [0.075 * g, 0.085, 0.07 * g], 0.05, seat); // buttocks
  // waist: narrower than chest and hips, a little deeper at the belly with build
  k.ell('spine', [0, 1.12, 0.005 + b * 0.015], [(f ? 0.12 : 0.135) * g, 0.1, (0.095 + b * 0.02) * g], 0.07, torsoR);
  // ribcage, wider at the top, flat-backed
  k.ell('chest', [0, 1.3, 0.0], [0.155 * W * g, 0.16, 0.11 * g], 0.07, torsoR);
  k.ell('chest', [0, 1.36, -0.03], [0.14 * W * g, 0.1, 0.085 * g], 0.06, torsoR);   // upper back / shoulder blades
  if (f) for (const sd of [1, -1]) k.ell('chest', [sd * 0.058, 1.31, 0.075], [0.06, 0.055, 0.045], 0.04, torsoR);
  else for (const sd of [1, -1]) k.ell('chest', [sd * 0.07, 1.34, 0.065], [0.075 * g, 0.055, 0.035], 0.05, torsoR);   // pectorals
  // trapezius: the slope from the neck down to the shoulders (what makes a body read as a person, not a doll)
  for (const sd of [1, -1]) k.cone('chest', [sd * 0.03, 1.49, -0.015], [sd * (sh - 0.045), 1.445, -0.005], 0.045 * g, 0.04 * g, 0.05, torsoR);
  // belt
  k.ell('hips', [0, 1.02, 0.0], [(f ? 0.145 : 0.148) * g, 0.022, 0.112 * g], 0.015, R.belt);
  k.box('hips', [0.0, 1.02, 0.112 * g], [0.025, 0.02, 0.006], 0.004, 0.006, R.boots); // buckle
  // skirt of the tunic / dress: an oval flare that clears the legs, with the hem just above the knee
  const hem = p.dress ? 0.1 : 0.66;
  if (p.clothSkirt) k.cone('hips', [0, 1.0, 0], [0, 0.9, -0.005], 0.16 * g, 0.175 * g, 0.03, R.cloth1);   // waistband; the skirt is cloth
  else if (p.dress) k.cone('hips', [0, 1.0, 0], [0, hem, -0.01], 0.155 * g, 0.29, 0.03, R.cloth1);
  else {
    const top = 0.99, mid = (top + hem) / 2;
    k.ell('hips', [0, mid, -0.005], [0.188 * g, (top - hem) / 2 + 0.02, 0.138 * g], 0.04, R.cloth1);
    k.box('hips', [0, hem + 0.012, -0.005], [0.18 * g, 0.012, 0.13 * g], 0.012, 0.03, R.cloth1); // hem edge
  }
  // ---- neck and head ----
  k.cone('neck', [0, 1.45, -0.01], [0, 1.575, 0.012], 0.06 * (f ? 0.88 : 1), 0.052 * (f ? 0.88 : 1), 0.035, R.skin);
  k.cone('neck', [0, 1.47, 0.02], [0, 1.56, 0.045], 0.018, 0.012, 0.03, R.skin);   // throat / Adam's apple line
  const hs = f ? 0.96 : 1;   // head scale
  const H = (x: number, y: number, z: number): V3 => [x * hs, 1.6 + (y - 1.6) * hs, z * hs];
  k.ell('head', H(0, 1.695, -0.005), [0.078 * hs, 0.1 * hs, 0.098 * hs], 0.02, R.skin);              // cranium
  k.ell('head', H(0, 1.64, 0.035), [0.064 * hs, 0.07 * hs, 0.075 * hs], 0.04, R.skin);               // jaw and cheeks
  k.ell('head', H(0, 1.6, 0.06), [(f ? 0.03 : 0.036) * hs, 0.026 * hs, 0.03 * hs], 0.03, R.skin);   // chin
  for (const sd of [1, -1]) k.ell('head', H(sd * 0.048, 1.665, 0.07), [0.026 * hs, 0.022 * hs, 0.02 * hs], 0.025, R.skin); // cheekbones
  k.cone('head', H(0, 1.705, 0.098), H(0, 1.66, 0.124), 0.011 * hs, 0.016 * hs, 0.02, R.skin);      // nose bridge to tip
  k.ell('head', H(0, 1.656, 0.118), [0.017 * hs, 0.011 * hs, 0.012 * hs], 0.01, R.skin);              // nostrils
  k.ell('head', H(0, 1.722, 0.088), [0.068 * hs, 0.014 * hs, 0.022 * hs], 0.018, R.skin);            // brow ridge
  k.ell('head', H(0, 1.628, 0.104), [0.024 * hs, 0.007 * hs, 0.009 * hs], 0.006, R.muzzle);          // lips
  for (const sd of [1, -1]) {
    k.sub('head', H(sd * 0.032, 1.697, 0.102), [0.019, 0.012, 0.013], 0.012);                        // eye sockets
    k.ell('head', H(sd * 0.082, 1.678, 0.0), [0.012, 0.03, 0.02], 0.01, R.skin);                      // ears
    k.ell('head', H(sd * 0.033, 1.718, 0.1), [0.02, 0.0045, 0.008], 0.004, R.hairH);                 // eyebrows
  }
  // hair
  k.ell('head', H(0, 1.748, -0.01), [0.084, 0.072, 0.1], 0.015, R.hairH);
  k.ell('head', H(0, 1.7, -0.06), [0.08, 0.07, 0.06], 0.02, R.hairH);   // back of the head
  if (p.hairLong) { k.ell('head', H(0, 1.6, -0.065), [0.088, 0.15, 0.055], 0.03, R.hairH); for (const sd of [1, -1]) k.ell('head', H(sd * 0.07, 1.62, -0.01), [0.025, 0.11, 0.05], 0.03, R.hairH); }
  if (p.beard) { k.ell('head', H(0, 1.605, 0.07), [0.058, 0.05, 0.04], 0.02, R.hairH); k.ell('head', H(0, 1.645, 0.112), [0.03, 0.006, 0.01], 0.008, R.hairH); }
  // ---- arms: deltoid, upper arm, elbow, forearm, wrist, hand with fingers and thumb ----
  for (const sd of [1, -1]) {
    const n = sd > 0 ? 'L' : 'R';
    const S0: V3 = [sd * sh, 1.44, 0], E0: V3 = [sd * (sh + 0.04), 1.16, -0.01], W0: V3 = [sd * (sh + 0.06), 0.93, 0.02];
    k.ell('arm' + n, [sd * (sh - 0.005), 1.415, 0], [0.058 * g, 0.07, 0.06 * g], 0.05, torsoR);                    // deltoid / shoulder cap
    k.cone('arm' + n, S0, E0, 0.047 * g, 0.037 * g, 0.04, torsoR);
    k.ell('arm' + n, [sd * (sh + 0.012), 1.3, -0.012], [0.04 * g, 0.075, 0.04 * g], 0.04, torsoR);               // biceps / triceps mass
    k.ell('fore' + n, E0, [0.035 * g, 0.035, 0.034 * g], 0.03, torsoR);                                         // elbow
    k.cone('fore' + n, E0, W0, 0.039 * g, 0.026, 0.03, p.armor ? R.cloth2 : R.cloth1);
    k.ell('fore' + n, [sd * (sh + 0.045), 1.1, 0.0], [0.038 * g, 0.06, 0.036 * g], 0.03, p.armor ? R.cloth2 : R.cloth1); // forearm muscle
    k.cone('fore' + n, [W0[0], W0[1] + 0.03, W0[2]], [W0[0], W0[1] - 0.005, W0[2]], 0.026, 0.024, 0.01, R.skin);           // wrist
    // hand: palm, fingers curled slightly toward the body, thumb in front
    k.box('hand' + n, [sd * (sh + 0.063), 0.875, 0.025], [0.014, 0.042, 0.038], 0.012, 0.012, R.skin);
    k.box('hand' + n, [sd * (sh + 0.06), 0.815, 0.03], [0.012, 0.035, 0.034], 0.011, 0.012, R.skin);
    k.cone('hand' + n, [sd * (sh + 0.055), 0.885, 0.06], [sd * (sh + 0.045), 0.84, 0.072], 0.011, 0.008, 0.01, R.skin);   // thumb
    // ---- legs: thigh, knee, calf, shin, ankle, shoe ----
    const Hp: V3 = [sd * hipW * 0.85, 0.94, 0], K0: V3 = [sd * hipW * 0.8, 0.52, 0.01], A0: V3 = [sd * hipW * 0.8, 0.11, -0.02];
    // the upper thigh is under the tunic: give it the tunic's cloth so it never shows through
    const Tm: V3 = [sd * hipW * 0.83, p.dress || p.clothSkirt ? 0.72 : 0.7, 0.005];
    k.cone('thigh' + n, Hp, Tm, 0.082 * g, 0.068 * g, 0.05, p.clothSkirt ? R.cloth2 : R.cloth1);
    k.cone('thigh' + n, Tm, K0, 0.068 * g, 0.054 * g, 0.05, R.cloth2);
    k.ell('thigh' + n, [sd * hipW * 0.88, 0.7, 0.012], [0.056 * g, 0.09, 0.058 * g], 0.05, R.cloth2);           // quadriceps
    k.ell('shin' + n, [K0[0], K0[1] - 0.005, K0[2] + 0.015], [0.048 * g, 0.048, 0.045 * g], 0.03, p.dress ? R.cloth2 : R.boots); // knee
    k.cone('shin' + n, K0, A0, 0.052 * g, 0.034, 0.03, p.dress ? R.cloth2 : R.boots);
    k.ell('shin' + n, [K0[0], 0.4, -0.025], [0.045 * g, 0.09, 0.042 * g], 0.04, p.dress ? R.cloth2 : R.boots);    // calf
    // shoe: heel, instep and a rounded toe
    k.ell('foot' + n, [A0[0], 0.05, -0.035], [0.038, 0.05, 0.045], 0.03, R.boots);
    k.box('foot' + n, [A0[0], 0.04, 0.045], [0.04, 0.04, 0.085], 0.035, 0.035, R.boots);
    k.ell('toe' + n, [A0[0], 0.03, 0.12], [0.04, 0.03, 0.045], 0.03, R.boots);
  }
  return {
    id: 'human', bones: k.bones, prims: k.prims, cell: 0.0085, kind: 'biped',
    eyes: [1, -1].map((sd) => ({ bone: k.i('head'), pos: [sd * 0.032 * (f ? 0.96 : 1), 1.6 + (1.698 - 1.6) * (f ? 0.96 : 1), 0.093 * (f ? 0.96 : 1)] as V3, r: 0.0125 })),
  };
}
export { mx, qx };
