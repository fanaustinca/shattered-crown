// Destruction. Round shot and gunpowder leave craters in the ground (a scorched bowl with a thrown-up rim
// of earth and clods; big blasts dent the terrain itself). Curtain walls are built in sections, each with
// its own strength: hits crack the masonry (cracks spread across both faces), loosen stones that fall from
// the parapet, and finally the section gives way — its blocks tumble down as real rigid bodies onto a
// rubble mound, leaving a breach with a ragged stump you can climb through.
import * as THREE from 'three';
import type { Game } from '../game';
import { RAPIER, groups, G_STATIC, G_DEBRIS, G_PROP, G_CHAR, ALL } from '../physics/physics';
import { GeoBuilder } from '../build/geom';
import { material, meshesFrom } from '../props/palette';
import { HM_N, CELL, HALF } from '../world/layout';
import { terrainUniforms } from '../render/terrain';
import type { BatchHandle } from '../render/batch';

export interface WallSection {
  geo: Map<string, THREE.BufferGeometry>; frame: THREE.Matrix4; xm: number; len: number; height: number; T: number;
  stone: string; cap: string; center: THREE.Vector3; half: THREE.Vector3; q: THREE.Quaternion;
  hp: number; handle: BatchHandle | null; collider: RAPIER.Collider | null; cracks: number; collapsed: boolean; site: string;
}

interface Debris { body: RAPIER.RigidBody; mesh: THREE.Mesh; t: number; frozen: boolean }
interface Fuse { prop: { obj: THREE.Object3D; def: { id: string } }; t: number }

export class Destruction {
  sections: WallSection[] = [];
  debris: Debris[] = [];
  private craters: THREE.Object3D[] = [];
  private crackMat = new THREE.MeshStandardMaterial({ color: 0x120e0b, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  fuses: Fuse[] = [];
  constructor(public game: Game) {}

  /** Register the wall sections the settlements built (each already in the building batch, with a collider). */
  adopt(list: WallSection[]) { this.sections.push(...list); }

  // ------------------------------------------------------------------ impacts
  /** Round shot struck at `at` with `power` (1 = a field gun's ball at short range). */
  impact(at: THREE.Vector3, power: number, ground: boolean) {
    const hitWall = this.damageWalls(at, power * 0.16, 3.2);
    if (ground && !hitWall) this.crater(at, 1.0 + power * 0.35, 0.25 * power, false);
  }
  /** A powder blast: a deep crater, walls smashed, everyone nearby thrown down or killed. */
  explode(at: THREE.Vector3, size = 1) {
    this.game.residents.alarm(at, 70 * size);
    const g = this.game;
    const r = 6 * size;
    g.particles.emit('cannon', at.clone().setY(at.y + 0.5), 60, new THREE.Vector3(0, 1, 0));
    g.particles.emit('fire', at, 40); g.particles.emit('spark', at, 60); g.particles.emit('smoke', at, 40); g.particles.emit('mud', at, 60); g.particles.emit('dust', at, 40);
    g.sound?.('cannon', at, 2.5); g.sound?.('thunder', at, 0.7);
    const dc = at.distanceTo(g.camera.position);
    if (dc < 120) g.shake = Math.max(g.shake, 1.4 * (1 - dc / 120));
    const onGround = at.y - g.world.heightAt(at.x, at.z) < 2.5;
    if (onGround) this.crater(at, 3.2 * size, 1.1 * size, true);
    this.damageWalls(at, 1.7 * size, r);
    for (const s of g.war.soldiers) { const d = s.st.pos.distanceTo(at); if (s.alive && d < r) s.hurt('torso', 160 * (1 - d / r), s); }
    for (const n of g.residents.live) { const d = n.st.pos.distanceTo(at); if (n.alive && d < r) n.hurt('torso', 160 * (1 - d / r), 'player'); }
    const dp = g.player.pos.distanceTo(at);
    if (dp < r) g.player.hurt('torso', 140 * (1 - dp / r), 'explosion', 1);
    for (const pr of g.props.props) { const d = pr.obj.position.distanceTo(at); if (d < r * 1.6 && !pr.stowedIn) { g.props.wake(pr); pr.body?.applyImpulse(pr.obj.position.clone().sub(at).setY(0.6).normalize().multiplyScalar(pr.mass * 18 * (1 - d / (r * 1.6))), true); } }
    for (const db of this.debris) { const p = db.body.translation(); const d = Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z); if (d < r) { if (db.frozen) { db.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true); db.frozen = false; db.t = 0; } db.body.applyImpulse({ x: (p.x - at.x) * 40, y: 120, z: (p.z - at.z) * 40 }, true); } }
    // a chain: other kegs nearby go up too
    for (const pr of g.props.props) if (pr.def.id === 'powder' && pr.obj.position.distanceTo(at) < r * 0.8 && !this.fuses.some((f) => f.prop === pr)) this.fuses.push({ prop: pr, t: 0.15 + Math.random() * 0.3 });
  }
  /** Blow a keg at once (struck by shot, dropped from a height, caught in another blast). */
  detonate(prop: Fuse['prop']) { const f = this.fuses.find((x) => x.prop === prop); if (f) f.t = Math.min(f.t, 0.05); else this.fuses.push({ prop, t: 0.05 }); }
  /** Light a keg's fuse (it hisses and blows in a few seconds). */
  light(prop: Fuse['prop']) { if (!this.fuses.some((f) => f.prop === prop)) { this.fuses.push({ prop, t: 4 }); this.game.hud.toast('The fuse hisses — run!'); } }

  // ------------------------------------------------------------------ craters
  /** Dig a crater: a scorched bowl and a rim of turned earth; deep ones dent the terrain itself. */
  crater(at: THREE.Vector3, radius: number, depth: number, dent: boolean) {
    const g = this.game, w = g.world;
    if (w.waterLevelAt(at.x, at.z) > w.heightAt(at.x, at.z) || (w.heightAt(at.x, at.z) < 0.5 && w.waterLevelAt(at.x, at.z) === 0)) return;
    if (dent) this.dent(at.x, at.z, radius, depth);
    this.bareEarth(at.x, at.z, radius * 1.5);
    // the bowl: a disc that follows the (dented) ground, sunk in the middle, with a raised rim
    const seg = 20, rings = 5;
    const P: number[] = [], C: number[] = [], I: number[] = [];
    const h0 = w.heightAt(at.x, at.z);
    for (let r = 0; r <= rings; r++) for (let s = 0; s < seg; s++) {
      const rr = (r / rings) * radius * 1.45 * (0.9 + 0.2 * Math.sin(s * 2.7 + r));
      const a = (s / seg) * Math.PI * 2;
      const x = at.x + Math.cos(a) * rr, z = at.z + Math.sin(a) * rr;
      const u = rr / radius;
      // a bowl inside the radius, a rim just outside it, feathering into the ground
      const prof = u < 1 ? -depth * (1 - u * u) * (dent ? 0.35 : 1) : depth * 0.35 * Math.exp(-((u - 1.12) ** 2) / 0.03);
      P.push(x, w.heightAt(x, z) + prof + 0.04, z);
      const scorch = Math.max(0, 1 - u * 0.9);
      C.push(0.36 - scorch * 0.26, 0.29 - scorch * 0.22, 0.22 - scorch * 0.17);
    }
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
      const a = r * seg + s, b = r * seg + (s + 1) % seg, c = (r + 1) * seg + s, d = (r + 1) * seg + (s + 1) % seg;
      I.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setIndex(I); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.dirtMat());
    m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    // clods of earth thrown out around it
    const cg = new GeoBuilder();
    for (let k = 0; k < 10 + radius * 6; k++) {
      const a = Math.random() * Math.PI * 2, rr = radius * (1.0 + Math.random() * 0.9);
      const x = at.x + Math.cos(a) * rr, z = at.z + Math.sin(a) * rr, s = 0.06 + Math.random() * 0.12 * Math.min(2, radius);
      cg.ellipsoid('mat:clay_floor_001|tint:4a3a2a', x, w.heightAt(x, z) + s * 0.4, z, s, s * 0.7, s * 1.1, 5, 0.8);
    }
    for (const mm of meshesFrom(cg.build(), false)) grp.add(mm);
    g.scene.add(grp);
    this.craters.push(grp);
    if (this.craters.length > 80) { const old = this.craters.shift()!; old.removeFromParent(); old.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
    g.particles.emit('mud', at, Math.round(20 * radius));
  }
  private _dirt: THREE.Material | null = null;
  private dirtMat() {
    if (!this._dirt) {
      const base = material('mat:clay_floor_001') as THREE.MeshStandardMaterial;
      const m = base.clone(); m.vertexColors = true; m.color.setRGB(1.5, 1.4, 1.3); m.roughness = 1;
      m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1;
      this.game.lighting.prep(m);
      this._dirt = m;
    }
    return this._dirt;
  }
  /** Blasted ground: no grass, raw earth (the terrain's track channel), sent to the GPU. */
  private bareEarth(x: number, z: number, radius: number) {
    const w = this.game.world, A = w.ctrlA;
    const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL), rc = Math.ceil(radius / CELL) + 1;
    const i0 = Math.max(0, ci - rc), i1 = Math.min(HM_N - 1, ci + rc), j0 = Math.max(0, cj - rc), j1 = Math.min(HM_N - 1, cj + rc);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const u = Math.hypot(i * CELL - HALF - x, j * CELL - HALF - z) / radius;
      if (u < 1) { const k = (j * HM_N + i) * 4; A[k] = Math.max(A[k], Math.round(255 * Math.min(1, (1 - u) * 1.6))); }
    }
    const tex = terrainUniforms.tCtrlA.value as THREE.DataTexture | null;
    if (!tex) return;
    const ww = i1 - i0 + 1, hh = j1 - j0 + 1, patch = new Uint8Array(ww * hh * 4);
    for (let j = 0; j < hh; j++) patch.set(A.subarray(((j0 + j) * HM_N + i0) * 4, ((j0 + j) * HM_N + i0 + ww) * 4), j * ww * 4);
    this.upload(tex, i0, j0, ww, hh, patch, true);
  }
  private upload(tex: THREE.Texture, x: number, y: number, w: number, h: number, data: ArrayBufferView, rgba8: boolean) {
    const r = this.game.renderer, gl = r.getContext() as WebGL2RenderingContext;
    const props = r.properties.get(tex) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) return;
    r.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, rgba8 ? 4 : 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    if (rgba8) { gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data); gl.generateMipmap(gl.TEXTURE_2D); }
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.FLOAT, data);
  }
  /** Lower the terrain heightmap in a bowl and send the changed patch to the GPU. */
  private dent(x: number, z: number, radius: number, depth: number) {
    const w = this.game.world, H = w.heights;
    const ci = Math.round((x + HALF) / CELL), cj = Math.round((z + HALF) / CELL), rc = Math.ceil(radius / CELL) + 1;
    const i0 = Math.max(1, ci - rc), i1 = Math.min(HM_N - 2, ci + rc), j0 = Math.max(1, cj - rc), j1 = Math.min(HM_N - 2, cj + rc);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i * CELL - HALF - x, dz = j * CELL - HALF - z, u = Math.hypot(dx, dz) / radius;
      if (u < 1) H[j * HM_N + i] -= depth * (1 - u * u);
    }
    const tex = terrainUniforms.tHeight.value as THREE.DataTexture | null;
    if (!tex) return;
    const r = this.game.renderer, gl = r.getContext() as WebGL2RenderingContext;
    const props = r.properties.get(tex) as { __webglTexture?: WebGLTexture };
    if (!props.__webglTexture) return;
    const ww = i1 - i0 + 1, hh = j1 - j0 + 1, patch = new Float32Array(ww * hh);
    for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) patch[j * ww + i] = H[(j0 + j) * HM_N + i0 + i];
    r.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4); gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, i0, j0, ww, hh, gl.RED, gl.FLOAT, patch);
  }

  // ------------------------------------------------------------------ walls
  private obbDist(s: WallSection, p: THREE.Vector3) {
    const l = p.clone().sub(s.center).applyQuaternion(s.q.clone().invert());
    const dx = Math.max(0, Math.abs(l.x) - s.half.x), dy = Math.max(0, Math.abs(l.y) - s.half.y), dz = Math.max(0, Math.abs(l.z) - s.half.z);
    return { d: Math.hypot(dx, dy, dz), l };
  }
  /** Damage every wall section within `radius`; returns true if a wall took the hit. */
  damageWalls(at: THREE.Vector3, power: number, radius: number) {
    let hit = false;
    for (const s of this.sections) {
      if (s.collapsed) continue;
      if (Math.abs(s.center.x - at.x) > s.half.x + radius + 4 || Math.abs(s.center.z - at.z) > s.half.x + radius + 4) continue;
      const { d, l } = this.obbDist(s, at);
      if (d > radius) continue;
      hit = true;
      const before = s.hp;
      s.hp -= power * (1 - d / radius * 0.7);
      this.game.particles.emit('dust', at, 14); this.game.sound?.('impact:wood', at, 1.2);
      if (before > 0.72 && s.hp <= 0.72) this.crack(s, l, 1);
      if (before > 0.4 && s.hp <= 0.4) { this.crack(s, l, 2); this.dropStones(s, 3 + Math.floor(Math.random() * 4)); }
      if (s.hp <= 0) this.collapse(s, at);
    }
    return hit;
  }
  /** Jagged cracks spreading over both faces from the point of impact (local wall space). */
  private crack(s: WallSection, at: THREE.Vector3, level: number) {
    const g = new GeoBuilder();
    const lx = THREE.MathUtils.clamp(s.xm + at.x, s.xm - s.len / 2 + 0.3, s.xm + s.len / 2 - 0.3);
    const ly = THREE.MathUtils.clamp(at.y + s.height / 2, 0.8, s.height - 0.6);
    for (const face of [1, -1]) {
      const z = face * (s.T / 2 + 0.012);
      const branches = 3 + level * 3;
      for (let b = 0; b < branches; b++) {
        let x = lx + (Math.random() - 0.5) * 0.6, y = ly + (Math.random() - 0.5) * 0.6;
        let ang = Math.random() * Math.PI * 2;
        const steps = 6 + Math.floor(Math.random() * 8) * level;
        let wd = 0.07 + 0.03 * level;
        for (let k = 0; k < steps; k++) {
          ang += (Math.random() - 0.5) * 1.1;
          const segL = 0.25 + Math.random() * 0.35;
          const nx = THREE.MathUtils.clamp(x + Math.cos(ang) * segL, s.xm - s.len / 2, s.xm + s.len / 2), ny = THREE.MathUtils.clamp(y + Math.sin(ang) * segL, 0.1, s.height);
          const px = -(ny - y), py = nx - x, pl = Math.hypot(px, py) || 1;
          const ox = px / pl * wd / 2, oy = py / pl * wd / 2;
          const A = new THREE.Vector3(x - ox, y - oy, z), B = new THREE.Vector3(nx - ox * 0.6, ny - oy * 0.6, z), C = new THREE.Vector3(nx + ox * 0.6, ny + oy * 0.6, z), D = new THREE.Vector3(x + ox, y + oy, z);
          if (face > 0) g.quad('crack', A, B, C, D, [[0, 0], [1, 0], [1, 1], [0, 1]]); else g.quad('crack', B, A, D, C, [[0, 0], [1, 0], [1, 1], [0, 1]]);
          x = nx; y = ny; wd *= 0.86;
        }
      }
    }
    const geo = g.build().get('crack');
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, this.crackMat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(s.frame).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0));
    mesh.userData.section = s;
    this.game.scene.add(mesh);
    (s as WallSection & { crackMeshes?: THREE.Mesh[] }).crackMeshes = [...((s as WallSection & { crackMeshes?: THREE.Mesh[] }).crackMeshes ?? []), mesh];
    s.cracks = level;
  }
  /** Loose stones fall from the parapet. */
  private dropStones(s: WallSection, n: number) {
    for (let k = 0; k < n; k++) {
      const lx = s.xm + (Math.random() - 0.5) * s.len * 0.8;
      const p = new THREE.Vector3(lx, s.height - 0.4, (Math.random() < 0.5 ? 1 : -1) * (s.T / 2 + 0.2)).applyMatrix4(s.frame);
      this.spawnBlock(p, 0.3 + Math.random() * 0.3, s.stone, new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
    }
  }
  /** The section gives way: a breach, a ragged stump, and the blocks thundering down onto a rubble mound. */
  private collapse(s: WallSection, at: THREE.Vector3) {
    const g = this.game, sett = g.settlements;
    s.collapsed = true;
    if (s.handle) { sett.shells.remove(s.handle); s.handle = null; }
    if (s.collider) { g.physics.world.removeCollider(s.collider, true); s.collider = null; }
    for (const m of (s as WallSection & { crackMeshes?: THREE.Mesh[] }).crackMeshes ?? []) m.removeFromParent();
    // the stump: what's left standing, with a jagged top
    const stump = new GeoBuilder();
    stump.matrix.copy(s.frame);
    const cols = Math.max(3, Math.round(s.len / 0.9));
    const baseH = s.height * (0.22 + Math.random() * 0.12);
    for (let c = 0; c < cols; c++) {
      const x0 = s.xm - s.len / 2 + (c / cols) * s.len, cw = s.len / cols;
      const hh = baseH + Math.random() * s.height * 0.18 + (c === 0 || c === cols - 1 ? s.height * 0.35 : 0);
      stump.box(s.stone, x0 + cw / 2, hh / 2, 0, cw + 0.02, hh, s.T * (0.85 + Math.random() * 0.15), 0.38);
    }
    s.handle = sett.shells.add(stump.build(), new THREE.Matrix4());
    const col = RAPIER.ColliderDesc.cuboid(s.half.x, baseH / 2, s.half.z).setTranslation(...new THREE.Vector3(s.xm, baseH / 2, 0).applyMatrix4(s.frame).toArray() as [number, number, number]).setRotation(s.q).setCollisionGroups(groups(G_STATIC, ALL));
    s.collider = g.physics.world.createCollider(col, g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    // rubble mound on both sides of the breach: a slope you can scramble over
    const rub = new GeoBuilder();
    rub.matrix.copy(s.frame);
    const toward0 = at.clone().sub(s.center).applyQuaternion(s.q.clone().invert()).z > 0 ? 1 : -1;
    for (let k = 0; k < 44; k++) {
      const sz = 0.4 + Math.random() * 1.0;
      const side = Math.random() < 0.75 ? toward0 : -toward0;
      const out = Math.random() * 4.5;
      rub.push().translate(s.xm + (Math.random() - 0.5) * s.len * 1.1, sz * 0.3 + Math.max(0, baseH * 0.7 - out * 0.4) * Math.random(), side * (s.T / 2 + out)).rotateY(Math.random() * 3).rotateX((Math.random() - 0.5) * 0.8);
      rub.box(s.stone, 0, 0, 0, sz, sz * 0.7, sz * 0.9, 0.5);
      rub.pop();
    }
    sett.shells.add(rub.build(), new THREE.Matrix4());
    for (const sd of [1, -1]) {
      const c = new THREE.Vector3(s.xm, baseH * 0.35, sd * (s.T / 2 + 1.3)).applyMatrix4(s.frame);
      const q = s.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sd * 0.45));
      g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(s.half.x, 0.3, 1.6).setTranslation(c.x, c.y, c.z).setRotation(q).setCollisionGroups(groups(G_STATIC, ALL)), g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
    }
    // the falling masonry: real blocks tumbling from the wall face and the parapet
    // a breached wall spills outward, toward the guns, into the slope the attackers climb
    const toward = at.clone().sub(s.center).applyQuaternion(s.q.clone().invert()).z > 0 ? 1 : -1;
    const n = Math.min(70, Math.round(s.len * s.height * 0.55));
    for (let k = 0; k < n; k++) {
      const lp = new THREE.Vector3(s.xm + (Math.random() - 0.5) * s.len * 0.95, baseH + Math.random() * (s.height - baseH), (Math.random() - 0.5) * s.T * 0.9);
      const p = lp.applyMatrix4(s.frame);
      const dirZ = Math.random() < 0.78 ? toward : -toward;
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.5, -0.5 + Math.random(), dirZ * (1.5 + Math.random() * 3.5)).applyQuaternion(s.q);
      this.spawnBlock(p, 0.35 + Math.random() * 0.55, s.stone, v);
    }
    // the shock cracks the neighbouring sections
    for (const o of this.sections) if (o !== s && !o.collapsed && o.center.distanceTo(s.center) < s.len * 1.3) { const before = o.hp; o.hp = Math.min(o.hp, Math.max(0.05, o.hp - 0.3)); const { l } = this.obbDist(o, s.center); if (before > 0.72 && o.hp <= 0.72) this.crack(o, l.clamp(o.half.clone().negate(), o.half), 1); }
    g.particles.emit('dust', s.center, 90); g.particles.emit('smoke', s.center, 30);
    g.sound?.('thunder', s.center, 0.9); g.sound?.('shatter', s.center, 0.6);
    const dc = s.center.distanceTo(g.camera.position);
    if (dc < 150) g.shake = Math.max(g.shake, 0.8 * (1 - dc / 150));
    g.hud.toast('The wall comes down!');
  }
  private spawnBlock(p: THREE.Vector3, size: number, key: string, vel: THREE.Vector3) {
    const g = this.game;
    const sx = size, sy = size * (0.55 + Math.random() * 0.3), sz = size * (0.7 + Math.random() * 0.4);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 0.4, Math.random() * 3, Math.random() * 0.4));
    const body = g.physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(q).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4 }).setCcdEnabled(true));
    g.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setDensity(2300).setFriction(0.9).setRestitution(0.05).setCollisionGroups(groups(G_DEBRIS, G_STATIC | G_DEBRIS | G_PROP | G_CHAR)), body);
    const mesh = new THREE.Mesh(this.boxGeo, material(key.split('|')[0] + '|wx:1'));
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.scene.add(mesh);
    this.debris.push({ body, mesh, t: 0, frozen: false });
    if (this.debris.length > 600) { const d = this.debris.shift()!; g.physics.removeBody(d.body); d.mesh.removeFromParent(); }
  }

  update(dt: number) {
    const g = this.game;
    for (const d of this.debris) {
      if (d.frozen) continue;
      d.t += dt;
      const p = d.body.translation(), q = d.body.rotation();
      d.mesh.position.set(p.x, p.y, p.z); d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      d.mesh.updateMatrix();
      // settled blocks become part of the landscape (no more simulation)
      if (d.t > 12 && (d.body.isSleeping() || d.t > 25)) { d.body.setBodyType(RAPIER.RigidBodyType.Fixed, false); d.frozen = true; }
      // a stone falling on someone hurts
      const v = d.body.linvel();
      if (Math.abs(v.y) > 5) {
        if (g.player.pos.distanceTo(d.mesh.position) < 1.0) g.player.hurt('head', Math.abs(v.y) * 4, 'masonry', 0.3);
        for (const s of g.war.soldiers) if (s.alive && s.st.pos.distanceTo(d.mesh.position) < 1.0) s.hurt('head', Math.abs(v.y) * 6, s);
      }
    }
    for (let i = this.fuses.length - 1; i >= 0; i--) {
      const f = this.fuses[i];
      f.t -= dt;
      if (Math.random() < dt * 20) g.particles.emit('spark', f.prop.obj.position.clone().setY(f.prop.obj.position.y + 0.35), 1);
      if (f.t <= 0) {
        this.fuses.splice(i, 1);
        const at = f.prop.obj.position.clone();
        g.props.destroy(f.prop as never);
        this.explode(at, 1);
      }
    }
  }
}
