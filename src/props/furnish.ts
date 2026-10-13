// Instantiating furniture models into the scene: merged static meshes, pivoted movable parts
// (doors/drawers/lids that animate open), burning candles that melt down, and a pooled set of
// flickering point lights assigned to the nearest flames.
import * as THREE from 'three';
import { meshesFrom } from './palette';
import type { FurnitureModel, Movable } from './furniture';
import { material } from './palette';

const geoCache = new WeakMap<FurnitureModel, Map<string, THREE.BufferGeometry>>();
const movCache = new WeakMap<Movable, Map<string, THREE.BufferGeometry>>();

export interface MovableNode { def: Movable; node: THREE.Object3D; open: number; target: number; furniture: FurnitureNode; locked?: boolean }
export class Candle {
  wax: THREE.Mesh; flame: THREE.Mesh; pool: THREE.Mesh; node = new THREE.Group();
  lit = true;
  burn: number;          // 0..1 of the wax remaining
  constructor(public height: number, public radius: number, burned: number, public color = 0xf2e8d0) {
    this.burn = 1 - burned;
    this.wax = new THREE.Mesh(candleGeo(), material(`wax|c:${color.toString(16)}|in:1`));
    this.wax.scale.set(radius, height, radius);
    this.wax.castShadow = false; this.wax.receiveShadow = true;
    this.flame = new THREE.Mesh(flameGeo(), material('flame'));
    this.flame.layers.set(1);
    this.pool = new THREE.Mesh(poolGeo(), material(`wax|c:${color.toString(16)}`));
    this.pool.scale.set(radius * 1.2, radius * 0.4, radius * 1.2);
    this.node.add(this.wax, this.flame, this.pool);
    this.apply(0);
  }
  /** Burn for `hours` of game time; a 20cm taper lasts about 8 hours. */
  update(hours: number, t: number) {
    if (this.lit && this.burn > 0) {
      const rate = 0.04 / (this.height * Math.max(0.6, this.radius * 60));
      this.burn = Math.max(0, this.burn - hours * rate);
      if (this.burn <= 0.02) this.lit = false;
    }
    this.apply(t);
  }
  private apply(t: number) {
    const h = this.height * Math.max(0.05, this.burn);
    this.wax.scale.y = h;
    // the melted pool and drips spread as the candle burns down
    const used = 1 - this.burn;
    this.pool.scale.set(this.radius * (1.1 + used * 1.6), this.radius * (0.25 + used * 0.5), this.radius * (1.1 + used * 1.6));
    this.flame.visible = this.lit;
    this.flame.position.y = h + 0.012;
    const f = 1 + Math.sin(t * 13 + this.height * 50) * 0.08 + Math.sin(t * 31) * 0.05;
    this.flame.scale.set(0.009 * (0.9 + f * 0.1), 0.028 * f, 0.009);
  }
  get flameWorld() { return this.flame.getWorldPosition(new THREE.Vector3()); }
}
let _cg: THREE.BufferGeometry | null = null, _fg: THREE.BufferGeometry | null = null, _pg: THREE.BufferGeometry | null = null;
function candleGeo() {
  if (_cg) return _cg;
  // unit candle with a slightly melted, uneven rim and a wick
  const g = new THREE.CylinderGeometry(1, 1, 1, 14, 3, false);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.99) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, 0.97 + Math.sin(a * 3) * 0.02); }
  g.computeVertexNormals();
  return (_cg = g);
}
function flameGeo() {
  if (_fg) return _fg;
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.translate(0, 0.6, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); const s = Math.max(0, 1 - Math.max(0, y - 0.6) * 0.9); p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s); }
  return (_fg = g);
}
function poolGeo() {
  if (_pg) return _pg;
  const g = new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  return (_pg = g);
}

export class FurnitureNode {
  group = new THREE.Group();
  movables: MovableNode[] = [];
  candles: Candle[] = [];
  constructor(public model: FurnitureModel, burned = 0, waxColor = 0xf2e8d0, mergedStatic = false) {
    if (!mergedStatic) {
      let geos = geoCache.get(model);
      if (!geos) { geos = model.geo.build(); geoCache.set(model, geos); }
      for (const m of meshesFrom(geos, false, '|in:1')) this.group.add(m);
    }
    for (const mv of model.movables) {
      let mg = movCache.get(mv);
      if (!mg) { mg = mv.geo.build(); movCache.set(mv, mg); }
      const node = new THREE.Group();
      node.position.copy(mv.pivot);
      for (const m of meshesFrom(mg, false, '|in:1')) node.add(m);
      this.group.add(node);
      this.movables.push({ def: mv, node, open: 0, target: 0, furniture: this });
    }
    for (const c of model.candles ?? []) {
      const cd = new Candle(c.height, c.radius, burned, waxColor);
      cd.node.position.copy(c.pos);
      this.group.add(cd.node);
      this.candles.push(cd);
    }
    this.group.userData.furniture = this;
  }
  /** Animate doors/drawers/lids toward their targets (with a little overshoot for doors). */
  update(dt: number, hours: number, t: number) {
    for (const m of this.movables) {
      if (m.def.kind === 'curtain') continue;
      const speed = m.def.kind === 'drawer' ? 3 : 2.2;
      m.open += Math.sign(m.target - m.open) * Math.min(Math.abs(m.target - m.open), dt * speed);
      const v = m.open * m.def.range;
      if (m.def.kind === 'drawer') m.node.position.copy(m.def.pivot).addScaledVector(m.def.axis, v);
      else m.node.quaternion.setFromAxisAngle(m.def.axis, v);
    }
    for (const c of this.candles) c.update(hours, t);
  }
  toggle(m: MovableNode) { if (m.locked) return false; m.target = m.target > 0.5 ? 0 : 1; return true; }
}

/** A fixed pool of point lights that follow the closest lit flames (never changes the light count). */
export class LightPool {
  lights: THREE.PointLight[] = [];
  constructor(scene: THREE.Scene, n = 8) {
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffa858, 0, 7, 2);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
  }
  assign(sources: { pos: THREE.Vector3; intensity: number; color?: THREE.Color; range?: number }[], cam: THREE.Vector3, t: number) {
    sources.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    this.lights.forEach((l, i) => {
      const s = sources[i];
      if (!s) { l.intensity = 0; return; }
      l.position.copy(s.pos);
      const flick = 1 + Math.sin(t * 17 + i * 3) * 0.06 + Math.sin(t * 7.3 + i) * 0.05;
      l.intensity = s.intensity * flick;
      l.distance = s.range ?? 7;
      if (s.color) l.color.copy(s.color); else l.color.setRGB(1, 0.62, 0.32);
    });
  }
}
