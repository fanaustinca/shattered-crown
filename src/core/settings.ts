// Player-adjustable settings, quality presets, persistence.

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';
export interface Quality {
  name: QualityName;
  pixelRatio: number;
  msaa: number;
  shadowSize: number;
  cascades: number;
  shadowFar: number;
  shadowEvery: number;
  cloudSteps: number;
  godrays: boolean;
  bloom: boolean;
  grassRadius: number;      // metres of instanced grass blades around the camera
  grassDensity: number;     // blades per square metre (near ring)
  treeDistance: number;     // full-mesh trees within this range, impostors beyond
  terrainRange: number;     // finest terrain LOD range
  waterSSR: boolean;
  furShells: number;
  propDistance: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 0.75, msaa: 0, shadowSize: 1024, cascades: 2, shadowFar: 260, shadowEvery: 2, cloudSteps: 16, godrays: false, bloom: false, grassRadius: 28, grassDensity: 14, treeDistance: 120, terrainRange: 70, waterSSR: false, furShells: 0, propDistance: 70 },
  medium: { name: 'medium', pixelRatio: 1, msaa: 2, shadowSize: 2048, cascades: 3, shadowFar: 700, shadowEvery: 1, cloudSteps: 24, godrays: false, bloom: true, grassRadius: 45, grassDensity: 26, treeDistance: 220, terrainRange: 100, waterSSR: true, furShells: 6, propDistance: 110 },
  high: { name: 'high', pixelRatio: 1, msaa: 4, shadowSize: 2048, cascades: 4, shadowFar: 1400, shadowEvery: 1, cloudSteps: 40, godrays: true, bloom: true, grassRadius: 70, grassDensity: 44, treeDistance: 360, terrainRange: 120, waterSSR: true, furShells: 12, propDistance: 160 },
  ultra: { name: 'ultra', pixelRatio: 1, msaa: 4, shadowSize: 4096, cascades: 4, shadowFar: 2200, shadowEvery: 1, cloudSteps: 64, godrays: true, bloom: true, grassRadius: 95, grassDensity: 70, treeDistance: 520, terrainRange: 150, waterSSR: true, furShells: 18, propDistance: 220 },
};

export interface Settings {
  quality: QualityName;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  simRadius: number;        // the AI simulation "bubble" (metres)
  volume: number;
  thirdPerson: boolean;
  showFps: boolean;
}

const KEY = 'shattered-crown.settings.v1';
export const settings: Settings = {
  quality: 'high', fov: 72, sensitivity: 1, invertY: false, simRadius: 160, volume: 0.8, thirdPerson: false, showFps: false,
};
try {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  Object.assign(settings, s);
} catch { /* private mode */ }
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }

/** Pick a sensible default the first time: weak GPUs get medium, headless/software gets low. */
export function guessQuality(gl: WebGL2RenderingContext): QualityName {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  if (/swiftshader|llvmpipe|software/.test(name)) return 'low';
  if (/intel|mali|adreno|powervr|apple m1\b/.test(name)) return 'medium';
  if (/rtx 4|rtx 5|rx 7|rx 9|apple m[2-9]|gb10|rtx a|h100/.test(name)) return 'ultra';
  return 'high';
}
