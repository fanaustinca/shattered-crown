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
    setTime(h: number) { game.hours = h; game.lighting.adapt = 1; game.lighting.forceShadows = true; game.renderFrame(); game.lighting.adapt = 0.03; },
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
    /** Count visible meshes per top-level group (perf QA). */
    census() {
      const out: Record<string, number> = {};
      game.scene.traverseVisible((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        let p: THREE.Object3D | null = o, k = 'other';
        while (p) { if (['exterior', 'interior'].includes(p.name)) { k = p.name; break; } if (p.userData?.prop) { k = 'prop'; break; } if (p.userData?.furniture) { k = 'furnNode'; } if (p.userData?.door) { k = 'door'; break; } p = p.parent; }
        out[k] = (out[k] ?? 0) + 1;
      });
      return out;
    },
    /** Hand control back to the player camera. */
    play() { game.freeCam = false; },
    /** Studio: one creature on flat ground, driven at a speed/action for t seconds; camera at a given angle. */
    studio(id: string, speed: number, action: string, t: number, camAng: number, camDist: number, camH = 0.5, coatSeed = 0.3) {
      const g = game as any;
      if (g.__studio) { game.scene.remove(g.__studio.rig.root); }
      for (const m of game.grass.meshes) m.visible = false;
      const x0 = -1250, z0 = 330;
      const sp = id.startsWith('human') ? 'human' : id;
      const coat = sp === 'human' ? { coat: 0, cloth1: 0x7a3020, cloth2: 0x4a4436, boots: 0x3a2a1a, skin: 0xd8a888, hair: 0x4a2a14, belt: 0x2a1a0a } : (window as any).__coatFor(sp, () => coatSeed);
      const rig = game.creatures.instance(id, coat);
      game.scene.add(rig.root);
      const A = (window as any).__anim;
      const ground = (x: number, z: number) => game.world.heightAt(x, z);
      const anim = sp === 'human' ? new A.BipedAnimator(rig, ground) : ['sparrow', 'crow', 'pigeon', 'chicken'].includes(sp) ? new A.BirdAnimator(rig) : new A.QuadAnimator(rig, ground);
      g.__studio = { rig, anim };
      const st = { pos: new THREE.Vector3(x0, ground(x0, z0), z0), yaw: Math.PI / 2, speed, turn: 0, vel: new THREE.Vector3(), action, look: null };
      const dt = 1 / 60;
      for (let k = 0; k < t / dt; k++) {
        st.pos.x += Math.sin(st.yaw) * speed * dt; st.pos.z += Math.cos(st.yaw) * speed * dt; st.pos.y = ground(st.pos.x, st.pos.z);
        if (anim instanceof A.BirdAnimator) anim.update(dt, st.pos.clone().setY(st.pos.y + (speed > 0 ? 1.5 : 0)), st.yaw, 0, speed > 0, 8, action === 'graze');
        else anim.update(dt, st);
      }
      rig.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rig.mesh);
      const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
      const d = size * camDist;
      game.freeCam = true;
      game.camera.position.set(c.x + Math.sin(camAng) * d, c.y + size * camH * 0.3, c.z + Math.cos(camAng) * d);
      game.camera.lookAt(c);
      game.camera.updateMatrixWorld();
      return { size: box.getSize(new THREE.Vector3()).toArray() };
    },
    /** Simulate residents around a town and report who is stuck. */
    npcTest(siteId: string, hours: number, seconds: number) {
      const plan = game.towns.plans.find((p) => p.site.id === siteId)!;
      game.player.spawn(plan.plaza.x + 3, plan.plaza.z + 3);
      api.stream(plan.plaza.x, plan.plaza.z);
      game.hours = hours;
      const dt = 1 / 30;
      for (let t = 0; t < 2; t += dt) game.step(dt);
      const start = new Map(game.residents.live.map((n) => [n, n.st.pos.clone()]));
      const moved = new Map<unknown, number>();
      for (let t = 0; t < seconds; t += dt) { game.step(dt); for (const n of game.residents.live) moved.set(n, Math.max(moved.get(n) ?? 0, n.st.pos.distanceTo(start.get(n) ?? n.st.pos))); }
      const live = game.residents.live;
      const withPath = live.filter((n) => n.path.length > 0);
      const inside = live.filter((n) => game.settlements.inside(n.st.pos));
      const stuck = withPath.filter((n) => (moved.get(n) ?? 0) < 1.5);
      return { live: live.length, withPath: withPath.length, inside: inside.length, stuck: stuck.length,
        stuckInfo: stuck.slice(0, 8).map((n) => ({ block: (() => { const a = n.st.pos.clone().setY(n.st.pos.y + 0.9); const b = (n.path[0] ?? a).clone().setY(a.y); const d = b.clone().sub(a); const len = d.length(); if (len < 0.01) return 'none'; const h = game.physics.ray(a, d.normalize(), len, undefined, n.collider); return h ? (h.owner?.kind ?? '?') + '@' + h.toi.toFixed(2) + '' : 'clear'; })(), plen: n.path.length, who: n.name + ' ' + n.activity, at: n.st.pos.toArray().map((v) => +v.toFixed(1)), next: n.path[0]?.toArray().map((v) => +v.toFixed(1)), inB: game.settlements.inside(n.st.pos)?.placed.spec.type ?? null })) };
    },
    /** Synchronously stream in all buildings near (x,z). */
    stream(x: number, z: number) { const v = new THREE.Vector3(x, 0, z); for (let k = 0; k < 3; k++) game.settlements.update(v, 0); return game.settlements.live.size; },
    site(id: string) { return game.towns.plans.find((p) => p.site.id === id); },
    /** View from inside a building of a town: camera in the ground-floor room looking at the back wall. */
    interior(siteId: string, idx = 0, floor = 0) {
      const plan = game.towns.plans.find((p) => p.site.id === siteId)!;
      const homes = plan.buildings.filter((b) => b.household && b.spec.floors > floor);
      const b = homes[idx % homes.length];
      api.stream(b.x, b.z);
      const live = game.settlements.live.get(b.id)!;
      const rm = live.model.rooms.find((r) => r.floor === floor)!;
      const c = new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y + 1.65, rm.max.y - 0.4).applyMatrix4(live.root.matrixWorld);
      const t = new THREE.Vector3((rm.min.x + rm.max.x) / 2, rm.y + 0.9, rm.min.y).applyMatrix4(live.root.matrixWorld);
      game.freeCam = true;
      game.camera.position.copy(c); game.camera.lookAt(t); game.camera.updateMatrixWorld();
      return { type: b.spec.type, room: rm.kind, w: b.spec.w, d: b.spec.d, family: b.household?.family, members: b.household?.members.map((m) => m.name + ' (' + m.role + ')') };
    },
    /** Lay out furniture variants of a category in a grid on open ground (QA). */
    showroom(cat: string, n = 12, x0 = -1250, z0 = 330, perRow = 6, spacing = 2.6) {
      const F = (window as any).__furn;
      const g = game as any;
      if (g.__show) game.scene.remove(g.__show);
      for (const m of game.grass.meshes) m.visible = false;
      const grp = new THREE.Group(); g.__show = grp;
      const designs = Object.keys(F.CATALOG[cat]);
      for (let i = 0; i < n; i++) {
        const design = designs[i % designs.length];
        const mods = F.modsFor(i * 7919 + cat.length);
        const model = F.makeFurniture(cat, design, mods);
        const node = new F.FurnitureNode(model, (i % 4) * 0.25);
        const x = x0 + (i % perRow) * spacing, z = z0 + Math.floor(i / perRow) * spacing;
        node.group.position.set(x, game.world.heightAt(x, z), z);
        // open a few drawers/doors so the working parts show
        node.movables.forEach((mv: any, k: number) => { if ((k + i) % 2 === 0) { mv.target = 1; mv.open = 1; } });
        node.update(0, 0, 0);
        grp.add(node.group);
      }
      game.scene.add(grp);
      return { designs: designs.length, catalog: F.enumerateCatalog().length, designCount: F.DESIGN_COUNT };
    },
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
