// Pure height/biome functions, run inside generation workers (one band of rows each).
import { Simplex, smoothstep, lerp, clamp } from '../core/noise';
import {
  SITES, ISLANDS, COAST_R, COAST_PINS, riverX, riverWidth, riverLevel, RIVER_Z0, HM_N, CELL, HALF,
} from './layout';

const S = new Simplex(1337);
const S2 = new Simplex(4242);

const pins = [
  ...COAST_PINS.map((p) => ({ ang: Math.atan2(p.z, p.x), r: Math.hypot(p.x, p.z) + p.off, cliff: p.cliff, width: p.width })),
  { ang: Math.atan2(2760, riverX(2760)), r: Math.hypot(riverX(2760), 2760) - 60, cliff: 0, width: 0.04 },
];

function angDiff(a: number, b: number) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

/** Coast radius and cliffiness for a direction. */
export function coastAt(x: number, z: number): { r: number; cliff: number } {
  const ang = Math.atan2(z, x);
  const wx = x + 300 * S2.fbm(x / 1500, z / 1500 + 7, 2), wz = z + 300 * S2.fbm(x / 1500 + 3, z / 1500, 2);
  let r = COAST_R + 380 * S.fbm(Math.cos(ang) * 1.3 + 7, Math.sin(ang) * 1.3, 4) + 170 * S.fbm(wx / 700, wz / 700, 4) + 40 * S.fbm(x / 150, z / 150, 2);
  let cliff = smoothstep(0.15, 0.45, S2.fbm(Math.cos(ang) * 2.2, Math.sin(ang) * 2.2 + 3, 3));
  for (const p of pins) {
    const w = Math.exp(-((angDiff(ang, p.ang) / p.width) ** 2));
    r = lerp(r, p.r, w); cliff = lerp(cliff, p.cliff, w);
  }
  return { r, cliff };
}

/** Natural terrain before settlements and the river are cut in. */
export function naturalHeight(x: number, z: number): number {
  // Vanguardia: rolling plains, a few soft hills
  const plains = 12 + 26 * (S.fbm(x / 1150, z / 1150, 4) * 0.5 + 0.5) + 6 * S.fbm(x / 260 + 3, z / 260, 4) + 1.2 * S.fbm(x / 60, z / 60, 3);
  // Ironreach: jagged ridged mountains rising east of the river
  const rx = riverX(z);
  const east = x - rx + 220 * S.fbm(x / 900 + 11, z / 900, 3);
  const mtn = smoothstep(120, 980, east);
  const wx = x + 380 * S2.fbm(x / 1700, z / 1700, 3), wz = z + 380 * S2.fbm(x / 1700 + 9, z / 1700 - 4, 3);
  const ridge = S.ridged(wx / 1500 + 5, wz / 1500 + 3, 8);
  const massif = S.fbm(x / 2600 + 1, z / 2600 - 2, 3) * 0.5 + 0.5;
  const peaks = 25 + 330 * Math.pow(ridge, 1.4) * (0.55 + 0.7 * massif) + 140 * massif + 34 * S.fbm(x / 380, z / 380, 4) + 7 * S.fbm(x / 70, z / 70, 3);
  // foothills on both sides of the transition
  const foot = 20 + 60 * Math.pow(S.ridged(x / 700, z / 700 + 9, 4), 2);
  let h = lerp(plains, lerp(foot, peaks, smoothstep(0.25, 1, mtn)), smoothstep(0, 0.4, mtn));
  // northern Vanguardia uplands (Whitecrest hills)
  const north = smoothstep(-300, -1500, z) * smoothstep(200, -400, x - rx);
  h += north * 30 * (S.fbm(x / 600 + 2, z / 600 - 4, 4) * 0.5 + 0.5);
  return h;
}

function shoreProfile(h: number, s: number, cliff: number): number {
  // s: signed distance from the coastline, positive inland
  if (s < 0) return Math.max(-45, -0.6 + s * lerp(0.05, 0.5, cliff));
  const beachLen = lerp(120, 6, cliff);
  const beach = 0.6 + Math.min(s, beachLen) * lerp(0.02, 0.4, cliff);
  const t = smoothstep(beachLen * 0.6, beachLen + lerp(380, 40, cliff), s);
  // cliffs rise to at least 14 m right behind the shore
  const top = cliff > 0.3 ? Math.max(h, lerp(h, 14 + h * 0.3, cliff)) : h;
  return lerp(beach, top, t);
}

export interface Sample { h: number; east: number; riverbed: number; wet: number; forest: number; flowers: number }

/** Full height including the river, coast, islands and settlement plateaus. */
export function sampleTerrain(x: number, z: number, out: Sample): Sample {
  let h = naturalHeight(x, z);
  const r = Math.hypot(x, z);
  const coast = coastAt(x, z);
  h = shoreProfile(h, coast.r - r, coast.cliff);

  // islands
  for (const is of ISLANDS) {
    const d = Math.hypot(x - is.x, z - is.z) + 60 * S.fbm(x / 160, z / 160, 3);
    if (d < is.r * 1.4) {
      const m = smoothstep(is.r, is.r * 0.25, d);
      const ih = shoreProfile(is.h * Math.pow(m, 0.8) + 14 * S.fbm(x / 120 + 9, z / 120, 4) * m, (is.r * 0.9 - d), 0.2);
      h = Math.max(h, ih);
    }
  }

  // river valley
  let riverbed = 0, wet = 0;
  const rf = smoothstep(RIVER_Z0 - 40, RIVER_Z0 + 160, z) * smoothstep(-30, 40, coast.r - r);
  if (rf > 0 && z < 3200) {
    const w = riverWidth(z) * 0.5, L = riverLevel(z);
    const d = Math.abs(x - riverX(z)) + 6 * S.fbm(x / 50, z / 50, 2);
    const W2 = 260;
    if (d < w + W2) {
      let hv: number;
      if (d < w) {
        const t = d / w;
        hv = L - 4.6 * (1 - t * t) - 0.6 + 0.4 * S.fbm(x / 9, z / 9, 2);
        riverbed = 1;
      } else {
        const bank = L + 0.9 + Math.min(2.4, (d - w) * 0.12) + (d - w) * 0.01;
        const t = smoothstep(0, W2, d - w);
        hv = lerp(bank, Math.max(h, bank), t * t);
        riverbed = 1 - smoothstep(0, 10, d - w);
        wet = 1 - smoothstep(0, 40, d - w);
      }
      h = lerp(h, hv, rf);
      riverbed *= rf; wet *= rf;
    }
  }
  // source lake in the northern mountains
  {
    const lx = riverX(RIVER_Z0 + 40), lz = RIVER_Z0 - 40;
    const d = Math.hypot(x - lx, (z - lz) * 1.3) + 25 * S.fbm(x / 90, z / 90, 2);
    const L = riverLevel(RIVER_Z0);
    if (d < 330) {
      const bowl = d < 170 ? L - 6 * (1 - (d / 170) ** 2) - 0.5 : lerp(L + 1, h, smoothstep(170, 330, d));
      h = bowl;
      if (d < 175) riverbed = Math.max(riverbed, 1 - smoothstep(160, 175, d));
    }
  }

  // settlement plateaus
  for (const s of SITES) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d > s.r * 1.9) continue;
    const target = (s.h ?? siteNatural(s)) + 0.6 * S.fbm(x / 70, z / 70, 2);
    const wgt = 1 - smoothstep(s.r * 0.9, s.r * 1.9, d);
    h = lerp(h, target, wgt * wgt * (3 - 2 * wgt));
  }

  const east = smoothstep(-60, 260, x - riverX(z) + 120 * S.fbm(x / 500, z / 500 + 5, 3));
  // forests: dense pine in Ironreach, groves of broadleaf in Vanguardia
  const fn = S2.fbm(x / 520, z / 520, 4) * 0.5 + 0.5 + 0.15 * S2.fbm(x / 90, z / 90, 2);
  const land = smoothstep(2, 6, h);
  const forest = land * (east > 0.5 ? smoothstep(0.42, 0.6, fn) : smoothstep(0.62, 0.74, fn));
  const flowers = smoothstep(0.55, 0.75, S.fbm(x / 140 + 40, z / 140, 3) * 0.5 + 0.5);
  out.h = h; out.east = east; out.riverbed = riverbed; out.wet = wet; out.forest = forest; out.flowers = flowers;
  return out;
}

const siteNat = new Map<string, number>();
function siteNatural(s: { id: string; x: number; z: number }) {
  let v = siteNat.get(s.id);
  if (v === undefined) {
    let acc = 0, n = 0;
    for (let a = 0; a < 8; a++) for (const rr of [0, 40, 80]) {
      acc += naturalHeight(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr); n++;
    }
    v = Math.max(3, acc / n);
    siteNat.set(s.id, v);
  }
  return v;
}

/** Generate rows [r0, r1) of the heightmap and the per-sample biome bytes. */
export function generateRows(r0: number, r1: number) {
  const n = (r1 - r0) * HM_N;
  const heights = new Float32Array(n);
  const bio = new Uint8Array(n * 4); // east, riverbed, forest, flowers
  const wet = new Uint8Array(n);
  const s: Sample = { h: 0, east: 0, riverbed: 0, wet: 0, forest: 0, flowers: 0 };
  for (let j = r0; j < r1; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < HM_N; i++) {
      const x = -HALF + i * CELL;
      sampleTerrain(x, z, s);
      const k = (j - r0) * HM_N + i;
      heights[k] = s.h;
      bio[k * 4] = clamp(s.east * 255, 0, 255);
      bio[k * 4 + 1] = clamp(s.riverbed * 255, 0, 255);
      bio[k * 4 + 2] = clamp(s.forest * 255, 0, 255);
      bio[k * 4 + 3] = clamp(s.flowers * 255, 0, 255);
      wet[k] = clamp(s.wet * 255, 0, 255);
    }
  }
  return { heights, bio, wet };
}
