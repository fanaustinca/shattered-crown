// CPU-simulated billboard particles: cannon and chimney smoke, campfire flames and sparks, dust,
// splashes, blood, mud. Two instanced batches (soft alpha smoke/dust, additive fire).
import * as THREE from 'three';
import { LAYER_WATER, sharedUniforms } from './pipeline';

interface P { pos: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; size: number; grow: number; color: THREE.Color; alpha: number; drag: number; grav: number; spin: number; rot: number }

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  // a little noise so smoke puffs aren't perfect discs
  const id = g.getImageData(0, 0, 64, 64);
  for (let i = 0; i < id.data.length; i += 4) id.data[i + 3] *= 0.75 + Math.random() * 0.25;
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return t;
}

class Batch {
  ps: P[] = [];
  mesh: THREE.Mesh;
  attr: THREE.InstancedBufferAttribute;
  col: THREE.InstancedBufferAttribute;
  constructor(scene: THREE.Scene, public max: number, additive: boolean, tex: THREE.Texture) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.attr.setUsage(THREE.DynamicDrawUsage);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.col.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.attr); g.setAttribute('aC', this.col);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uSun: sharedUniforms.uSunColor, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: /* glsl */ `attribute vec4 aP; attribute vec4 aC; varying vec2 vUv; varying vec4 vC;
        void main() {
          vUv = uv; vC = aC;
          vec4 mv = viewMatrix * vec4(aP.xyz, 1.0);
          float s = aP.w;
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `uniform sampler2D map; uniform vec3 uSun; uniform float uAdd; varying vec2 vUv; varying vec4 vC;
        void main() { float a = texture2D(map, vUv).a * vC.a; if (a < 0.003) discard;
          vec3 lit = uAdd > 0.5 ? vC.rgb : vC.rgb * (0.25 + 0.35 * dot(uSun, vec3(0.33)));
          gl_FragColor = vec4(lit, a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_WATER);
    this.mesh.renderOrder = additive ? 10 : 9;
    scene.add(this.mesh);
  }
  update(dt: number, wind: THREE.Vector2) {
    let n = 0;
    const a = this.attr.array as Float32Array, c = this.col.array as Float32Array;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i];
      p.life += dt;
      if (p.life >= p.max) { this.ps.splice(i, 1); continue; }
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += wind.x * dt * 0.6 * p.drag; p.pos.z += wind.y * dt * 0.6 * p.drag;
    }
    for (const p of this.ps) {
      if (n >= this.max) break;
      const t = p.life / p.max;
      a[n * 4] = p.pos.x; a[n * 4 + 1] = p.pos.y; a[n * 4 + 2] = p.pos.z; a[n * 4 + 3] = p.size + p.grow * p.life;
      c[n * 4] = p.color.r; c[n * 4 + 1] = p.color.g; c[n * 4 + 2] = p.color.b; c[n * 4 + 3] = p.alpha * Math.min(1, t * 8) * (1 - t);
      n++;
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.attr.needsUpdate = true; this.col.needsUpdate = true;
  }
}

export class Particles {
  smoke: Batch; fire: Batch;
  emitters: { pos: THREE.Vector3; kind: 'chimney' | 'campfire' | 'torch'; acc: number }[] = [];
  constructor(scene: THREE.Scene) {
    const t = softTex();
    this.smoke = new Batch(scene, 5000, false, t);
    this.fire = new Batch(scene, 2500, true, t);
  }
  emit(kind: 'smoke' | 'cannon' | 'dust' | 'splash' | 'blood' | 'fire' | 'spark' | 'chimney' | 'mud' | 'steam', pos: THREE.Vector3, n = 1, dir?: THREE.Vector3) {
    for (let i = 0; i < n; i++) {
      const rnd = () => (Math.random() - 0.5);
      const p: P = { pos: pos.clone(), vel: new THREE.Vector3(rnd(), Math.random(), rnd()), life: 0, max: 2, size: 0.3, grow: 0.3, color: new THREE.Color(0.6, 0.6, 0.6), alpha: 0.5, drag: 1, grav: 0, spin: 0, rot: 0 };
      switch (kind) {
        case 'cannon': p.vel.copy(dir ?? new THREE.Vector3()).multiplyScalar(8 + Math.random() * 10).add(new THREE.Vector3(rnd() * 3, Math.random() * 2, rnd() * 3)); p.max = 6 + Math.random() * 6; p.size = 0.8; p.grow = 1.4; p.color.setRGB(0.82, 0.8, 0.76); p.alpha = 0.75; p.drag = 1.6; p.grav = -0.15; break;
        case 'smoke': p.vel.multiplyScalar(1.5); p.max = 4; p.size = 0.6; p.grow = 0.9; p.color.setRGB(0.4, 0.4, 0.4); p.alpha = 0.5; break;
        case 'chimney': p.vel.set(rnd() * 0.3, 0.9 + Math.random() * 0.5, rnd() * 0.3); p.max = 10 + Math.random() * 6; p.size = 0.5; p.grow = 0.45; p.color.setRGB(0.55, 0.55, 0.56); p.alpha = 0.32; p.drag = 0.4; p.grav = -0.05; break;
        case 'dust': p.vel.multiplyScalar(2).setY(Math.random() * 1.5); p.max = 2.5; p.size = 0.3; p.grow = 0.8; p.color.setRGB(0.55, 0.47, 0.36); p.alpha = 0.45; p.drag = 2; break;
        case 'mud': p.vel.multiplyScalar(3).setY(1 + Math.random() * 2.5); p.max = 0.9; p.size = 0.06; p.grow = 0; p.color.setRGB(0.18, 0.13, 0.08); p.alpha = 1; p.drag = 0.3; p.grav = 9.8; break;
        case 'splash': p.vel.set(rnd() * 3, 2 + Math.random() * 3, rnd() * 3); p.max = 0.9; p.size = 0.1; p.grow = 0.2; p.color.setRGB(0.85, 0.9, 0.95); p.alpha = 0.7; p.drag = 0.5; p.grav = 9.8; break;
        case 'blood': p.vel.set(rnd() * 2, Math.random() * 2, rnd() * 2); p.max = 0.7; p.size = 0.05; p.grow = 0.05; p.color.setRGB(0.35, 0.02, 0.02); p.alpha = 1; p.drag = 0.4; p.grav = 9.8; break;
        case 'steam': p.vel.set(rnd() * 0.3, 0.6, rnd() * 0.3); p.max = 3; p.size = 0.3; p.grow = 0.6; p.color.setRGB(0.9, 0.9, 0.9); p.alpha = 0.25; break;
        case 'fire': p.vel.set(rnd() * 0.3, 0.8 + Math.random() * 0.7, rnd() * 0.3); p.max = 0.5 + Math.random() * 0.5; p.size = 0.35; p.grow = -0.3; p.color.setRGB(3.5, 1.4, 0.35); p.alpha = 0.8; p.drag = 0.5; p.grav = -1; this.fire.ps.push(p); continue;
        case 'spark': p.vel.set(rnd() * 1.5, 1.5 + Math.random() * 2.5, rnd() * 1.5); p.max = 0.8 + Math.random(); p.size = 0.03; p.grow = 0; p.color.setRGB(6, 3, 0.8); p.alpha = 1; p.drag = 0.6; p.grav = 1.5; this.fire.ps.push(p); continue;
      }
      if (this.smoke.ps.length < this.smoke.max) this.smoke.ps.push(p);
    }
  }
  update(dt: number, cam: THREE.Vector3) {
    for (const e of this.emitters) {
      const d = e.pos.distanceTo(cam);
      if (d > 600) continue;
      e.acc += dt;
      const rate = e.kind === 'chimney' ? 0.35 : e.kind === 'campfire' ? 0.04 : 0.08;
      while (e.acc > rate) {
        e.acc -= rate;
        if (e.kind === 'chimney') this.emit('chimney', e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3)));
        else if (d < 120) { this.emit('fire', e.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * (e.kind === 'torch' ? 0.1 : 0.5), 0, (Math.random() - 0.5) * (e.kind === 'torch' ? 0.1 : 0.5)))); if (Math.random() < 0.2) this.emit('spark', e.pos.clone()); if (e.kind === 'campfire' && Math.random() < 0.3) this.emit('smoke', e.pos.clone().setY(e.pos.y + 0.8)); }
      }
    }
    this.smoke.update(dt, sharedUniforms.uWind.value);
    this.fire.update(dt, sharedUniforms.uWind.value);
  }
}
