// window.SC: a scripting/testing API used by the headless QA suite and the dev console.
import * as THREE from 'three';
import type { Game } from './game';

export function installDebugApi(game: Game) {
  const api = {
    game,
    THREE,
    get ready() { return game.ready; },
    /** Place the camera at (x,y,z) looking at (tx,ty,tz). y/ty may be 'g+N' strings meaning N metres above ground. */
    view(x: number, y: number | string, z: number, tx: number, ty: number | string, tz: number) {
      const gy = (v: number | string, px: number, pz: number) => typeof v === 'string' ? game.world.heightAt(px, pz) + parseFloat(v.slice(2)) : v;
      game.freeCam = true;
      game.camera.position.set(x, gy(y, x, z), z);
      game.camera.lookAt(tx, gy(ty, tx, tz), tz);
      game.camera.updateMatrixWorld();
    },
    setTime(h: number) { game.hours = h; game.lighting.adapt = 1; game.renderFrame(); game.lighting.adapt = 0.03; },
    setOvercast(v: number) { game.overcast = v; },
    /** Advance the simulation by n fixed steps and render once. */
    advance(seconds: number, dt = 1 / 30) {
      for (let t = 0; t < seconds; t += dt) game.step(dt);
      game.renderFrame();
    },
    render(times = 1) { for (let i = 0; i < times; i++) game.renderFrame(); return { calls: game.pipeline.stats.calls, tris: game.pipeline.stats.tris, ms: game.frameMs }; },
    /** Read HDR pixels (linear, pre-tonemap) from the main target and the post target at uv points. */
    probe(points: [number, number][]) {
      const pl = game.pipeline, out: Record<string, number[][]> = { main: [], atmo: [] };
      const buf = new Uint16Array(4);
      const f16 = (h: number) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; return e === 0 ? s * m * 2 ** -24 : e === 31 ? NaN : s * (1 + m / 1024) * 2 ** (e - 15); };
      for (const [u, v] of points) {
        for (const [k, rt] of [['main', pl.rtMain], ['atmo', pl.rtA]] as const) {
          game.renderer.readRenderTargetPixels(rt, Math.floor(u * rt.width), Math.floor(v * rt.height), 1, 1, buf);
          out[k].push([...buf].slice(0, 3).map((x) => +f16(x).toFixed(3)));
        }
      }
      return { out, exposure: game.lighting.exposure, sun: game.lighting.sunColor.toArray(), envI: game.scene.environmentIntensity };
    },
    height(x: number, z: number) { return game.world.heightAt(x, z); },
    /** Hand control back to the player camera. */
    play() { game.freeCam = false; },
    /** Line up every species in bind pose at (x,z) for visual QA. */
    gallery(x: number, z: number, ids?: string[]) {
      const list = ids ?? [...game.creatures.anatomies.keys()];
      const g = new THREE.Group(); g.name = 'gallery';
      let off = 0;
      const rnd = () => 0.3;
      for (const id of list) {
        const sp = id.startsWith('human') ? 'human' : id;
        const coat = sp === 'human' ? { coat: 0, cloth1: 0x6a2a20, cloth2: 0x4a4436, boots: 0x3a2a1a, skin: 0xd8a888, hair: 0x4a2a14, belt: 0x2a1a0a } : (window as any).__coatFor(sp, rnd);
        const r = game.creatures.instance(id, coat);
        const w = sp === 'horse' || sp === 'cow' ? 2.4 : sp === 'donkey' || sp === 'pig' ? 1.6 : sp === 'human' ? 0.9 : 0.6;
        off += w / 2;
        const px = x + off, pz = z;
        r.root.position.set(px, game.world.heightAt(px, pz), pz);
        r.root.rotation.y = Math.PI / 2;
        g.add(r.root);
        off += w / 2;
      }
      game.scene.add(g);
      return off;
    },
    /** Hold keys for `seconds` of simulated time, e.g. SC.hold(['KeyW'], 2). */
    hold(keys: string[], seconds: number, dt = 1 / 60) {
      for (const k of keys) game.input.simDown(k);
      for (let t = 0; t < seconds; t += dt) { game.step(dt); for (const k of keys) game.input.down.add(k); }
      for (const k of keys) game.input.simUp(k);
      game.renderFrame();
    },
    tap(key: string) { game.input.simTap(key); game.step(1 / 60); },
    player() { const p = game.player; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, ground: game.world.heightAt(p.pos.x, p.pos.z), mode: p.mode, grounded: p.grounded, stamina: p.stamina, yaw: p.yaw }; },
    teleport(x: number, z: number, yaw = 0) { game.player.spawn(x, z, yaw); game.freeCam = false; },
    stats() {
      const H = game.world.heights; let mn = Infinity, mx = -Infinity, nan = 0;
      for (let i = 0; i < H.length; i++) { const v = H[i]; if (Number.isNaN(v)) nan++; else { if (v < mn) mn = v; if (v > mx) mx = v; } }
      return { mn, mx, nan };
    },
    /** A top-down shaded relief map of the world (data URL), for QA. */
    mapImage(size = 768) {
      const w = game.world, c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d')!, img = g.createImageData(size, size);
      const half = 7677 / 2;
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const x = -half + (i + 0.5) / size * half * 2, z = -half + (j + 0.5) / size * half * 2;
        const h = w.heightAt(x, z), n = w.normalAt(x, z);
        const shade = Math.max(0, n.x * -0.5 + n.y * 0.7 + n.z * -0.5);
        let r, gg, b;
        const wl = w.waterLevelAt(x, z);
        if (h < wl) { r = 30; gg = 70; b = 110; }
        else if (h < 3) { r = 200; gg = 190; b = 140; }
        else if (h > 320) { r = 240; gg = 240; b = 245; }
        else if (h > 90) { r = 120; gg = 110; b = 95; }
        else { r = 90 + h; gg = 130 + h * 0.5; b = 60; }
        if (w.roadAt(x, z) > 0.4) { r = 160; gg = 120; b = 80; }
        if (w.fieldAt(x, z) > 0.4) { r = 210; gg = 180; b = 80; }
        if (w.forestAt(x, z) > 0.5) { r *= 0.6; gg *= 0.8; b *= 0.6; }
        const k = (j * size + i) * 4;
        img.data[k] = r * (0.4 + shade * 0.8); img.data[k + 1] = gg * (0.4 + shade * 0.8); img.data[k + 2] = b * (0.4 + shade * 0.8); img.data[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    },
  };
  (window as unknown as { SC: typeof api }).SC = api;
  return api;
}
