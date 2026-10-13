// The hand-authored geography of the realm: river, coast, settlements, roads, bridges.
// North is -z. Vanguardia lies west of the river, Ironreach east of it.

export const HM_N = 2560;            // heightmap samples per side
export const CELL = 3;               // metres between samples
export const WORLD = (HM_N - 1) * CELL; // 7677 m
export const HALF = WORLD / 2;
export const SEA = 0;

export type Kingdom = 'vanguardia' | 'ironreach' | 'river' | 'isles';
export type SiteKind = 'capital' | 'castle' | 'town' | 'village' | 'port';

export interface Site {
  id: string; name: string; kind: SiteKind; kingdom: Kingdom;
  x: number; z: number; r: number;   // flatten radius
  h?: number;                        // target plateau height (undefined = sample natural)
  walls?: boolean;
  dock?: { x: number; z: number; yaw: number };
  gateYaw?: number;                  // direction of the main gate (radians, 0 = +z/south)
}

export const SITES: Site[] = [
  // Vanguardia
  { id: 'aurelhold', name: 'Aurelhold', kind: 'capital', kingdom: 'vanguardia', x: -1250, z: 350, r: 260, h: 34, walls: true, gateYaw: Math.PI / 2 },
  { id: 'whitecrest', name: 'Castle Whitecrest', kind: 'castle', kingdom: 'vanguardia', x: -720, z: -1180, r: 95, h: 62, walls: true, gateYaw: Math.PI },
  { id: 'sunmere', name: 'Castle Sunmere', kind: 'castle', kingdom: 'vanguardia', x: -2480, z: -260, r: 95, h: 40, walls: true, gateYaw: Math.PI / 2 },
  { id: 'millbrook', name: 'Millbrook', kind: 'town', kingdom: 'vanguardia', x: -620, z: 940, r: 120, h: 14 },
  { id: 'harrowfield', name: 'Harrowfield', kind: 'town', kingdom: 'vanguardia', x: -1550, z: -1250, r: 120 },
  { id: 'saltmarsh', name: 'Saltmarsh', kind: 'port', kingdom: 'vanguardia', x: -1250, z: 2180, r: 150, h: 4, dock: { x: -1250, z: 2380, yaw: 0 } },
  { id: 'eastford', name: 'Eastford', kind: 'town', kingdom: 'vanguardia', x: -330, z: -420, r: 110 },
  // Ironreach
  { id: 'ironspire', name: 'Ironspire', kind: 'capital', kingdom: 'ironreach', x: 1480, z: -520, r: 250, h: 128, walls: true, gateYaw: -Math.PI / 2 },
  { id: 'ravenfall', name: 'Ravenfall Keep', kind: 'castle', kingdom: 'ironreach', x: 980, z: 1220, r: 90, h: 96, walls: true, gateYaw: -Math.PI / 2 },
  { id: 'blackcrag', name: 'Blackcrag Fortress', kind: 'castle', kingdom: 'ironreach', x: 1850, z: -1750, r: 95, h: 205, walls: true, gateYaw: 0 },
  { id: 'pinehollow', name: 'Pinehollow', kind: 'town', kingdom: 'ironreach', x: 640, z: -1480, r: 110 },
  { id: 'deepvein', name: 'Deepvein', kind: 'town', kingdom: 'ironreach', x: 2050, z: 420, r: 120, h: 150 },
  { id: 'greyford', name: 'Greyford', kind: 'town', kingdom: 'ironreach', x: 330, z: -380, r: 95 },
  // The contested river castle
  { id: 'bridgewatch', name: 'Bridgewatch Castle', kind: 'castle', kingdom: 'river', x: 330, z: 470, r: 85, h: 24, walls: true, gateYaw: -Math.PI / 2 },
  // Outer isles
  { id: 'gullrock', name: 'Gullrock', kind: 'port', kingdom: 'isles', x: 3120, z: 2380, r: 150, h: 9, dock: { x: 2640, z: 2380, yaw: -Math.PI / 2 } },
];
export const siteById = (id: string) => SITES.find((s) => s.id === id)!;

export const ISLANDS = [
  { x: 3100, z: 2380, r: 420, h: 48 },   // Gullrock
  { x: -3150, z: -2150, r: 360, h: 70 }, // Isle of Thorns
  { x: -520, z: 3350, r: 150, h: 26 },   // Lighthouse islet
  { x: 2500, z: -3150, r: 240, h: 40 },
];

// ---------------- River ----------------
export const RIVER_Z0 = -2300, RIVER_Z1 = 3000;
/** Centre-line x of the river at a given z (smooth meanders). */
export function riverX(z: number): number {
  return 60 + 140 * Math.sin(z / 610 + 0.4) + 55 * Math.sin(z / 233 + 1.3) + 18 * Math.sin(z / 97 + 2.1);
}
export function riverWidth(z: number): number {
  const t = (z - RIVER_Z0) / (RIVER_Z1 - RIVER_Z0);
  return 46 + 50 * Math.max(0, Math.min(1, t)) + 8 * Math.sin(z / 180);
}
/** Water surface height of the river (drops toward the sea in the south). */
export function riverLevel(z: number): number {
  const t = Math.max(0, Math.min(1, (z - RIVER_Z0) / (2700 - RIVER_Z0)));
  return 26 * (1 - t) * (1 - t * 0.35) + 0.15;
}
/** Flow direction (unit xz) along the river, pointing downstream (+z). */
export function riverDir(z: number): [number, number] {
  const dx = riverX(z + 1) - riverX(z - 1), dz = 2;
  const l = Math.hypot(dx, dz);
  return [dx / l, dz / l];
}

// ---------------- Coast ----------------
export const COAST_R = 2750;
/** Places where the coastline is pinned: ports get deep water at their docks, Sunmere sits on a sea cliff. */
export const COAST_PINS: { x: number; z: number; off: number; cliff: number; width: number }[] = [
  { x: -1250, z: 2380, off: -30, cliff: 0, width: 0.09 },   // Saltmarsh harbour
  { x: -2480, z: -260, off: 120, cliff: 1, width: 0.07 },   // Sunmere sea cliff
  { x: 380, z: 2900, off: 0, cliff: 0, width: 0.05 },        // river mouth
];

// ---------------- Bridges ----------------
export interface Bridge { z: number; x: number; len: number; yaw: number; deck: number; name: string }
export function makeBridges(): Bridge[] {
  return [
    { z: -1020, name: 'North Span' },
    { z: 470, name: 'Bridgewatch Bridge' },
    { z: 1560, name: "King's Crossing" },
  ].map((b) => {
    const x = riverX(b.z), w = riverWidth(b.z);
    const [dx, dz] = riverDir(b.z);
    // bridge axis is perpendicular to the flow
    const yaw = Math.atan2(dx, dz); // local +x (bridge axis) = (dz, -dx), perpendicular to the flow
    return { ...b, x, len: w + 46, yaw, deck: riverLevel(b.z) + 7.5 };
  });
}

// ---------------- Roads ----------------
// Waypoint lists; the generator smooths them into splines and flattens the terrain under them.
// Waypoints are [x,z] or references: 'S:<siteId>' (site centre), 'B<i>w' / 'B<i>e' (west/east end of bridge i).
export type RoadPt = [number, number] | string;
export const ROADS: { pts: RoadPt[]; kind: 'road' | 'track' }[] = [
  { kind: 'road', pts: ['S:aurelhold', [-1000, 600], [-760, 840], 'S:millbrook'] },
  { kind: 'road', pts: ['S:millbrook', [-820, 1400], [-1080, 1850], 'S:saltmarsh'] },
  { kind: 'road', pts: ['S:aurelhold', [-1100, -200], [-900, -700], 'S:whitecrest'] },
  { kind: 'road', pts: [[-900, -700], [-1200, -1000], 'S:harrowfield'] },
  { kind: 'road', pts: ['S:aurelhold', [-1650, 150], [-1950, -150], 'S:sunmere'] },
  { kind: 'road', pts: [[-1100, -200], [-700, -330], 'S:eastford'] },
  // Vanguardia approaches to the three bridges
  { kind: 'road', pts: ['S:eastford', [-250, -760], 'B0w'] },
  { kind: 'road', pts: [[-1000, 600], [-500, 520], 'B1w'] },
  { kind: 'road', pts: ['S:millbrook', [-300, 1250], 'B2w'] },
  // Ironreach
  { kind: 'road', pts: ['S:greyford', [700, -420], [1100, -480], 'S:ironspire'] },
  { kind: 'road', pts: ['S:ironspire', [1150, -900], [860, -1250], 'S:pinehollow'] },
  { kind: 'road', pts: ['S:pinehollow', [300, -1150], 'B0e'] },
  { kind: 'road', pts: ['S:ironspire', [1650, -950], [1780, -1350], 'S:blackcrag'] },
  { kind: 'road', pts: ['S:ironspire', [1750, -200], [1950, 150], 'S:deepvein'] },
  { kind: 'road', pts: ['S:ironspire', [1350, 0], [1150, 600], 'S:ravenfall'] },
  { kind: 'road', pts: ['B1e', 'S:bridgewatch', [600, 520], [1000, 450], [1350, 0]] },
  { kind: 'road', pts: ['S:ravenfall', [600, 1450], 'B2e'] },
  { kind: 'track', pts: ['S:harrowfield', [-1900, -900], 'S:sunmere'] },
  { kind: 'track', pts: ['S:millbrook', [-1000, 1150], [-1500, 1300], [-1900, 1200]] },
];

export function resolveRoadPt(p: RoadPt, bridges: Bridge[]): [number, number] {
  if (typeof p !== 'string') return p;
  if (p.startsWith('S:')) { const s = siteById(p.slice(2)); return [s.x, s.z]; }
  const b = bridges[+p[1]], sgn = p[2] === 'w' ? -1 : 1;
  // bridge axis points from west bank to east bank
  const ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
  const e = (b.len / 2 + 6) * sgn * (ax >= 0 ? 1 : -1);
  return [b.x + ax * e, b.z + az * e];
}

/** Which kingdom owns a point (for law, prices, soldiers). */
export function kingdomAt(x: number, z: number): Kingdom {
  const r = Math.hypot(x, z);
  if (r > COAST_R + 200) return 'isles';
  const d = x - riverX(z);
  if (Math.abs(d) < riverWidth(z) * 0.5 + 30) return 'river';
  return d < 0 ? 'vanguardia' : 'ironreach';
}

export function nearestSite(x: number, z: number): { site: Site; d: number } {
  let best = SITES[0], bd = Infinity;
  for (const s of SITES) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  return { site: best, d: bd };
}
