// Procedural 3D audio: footsteps per surface, impacts, shattering ceramics, doors, drawers, eating,
// animal calls, birdsong by day and crickets by night, wind, river, surf, rain, fire crackle.
import * as THREE from 'three';
import { settings } from './settings';

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  noise!: AudioBuffer;
  amb: Record<string, { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode }> = {};
  listener = new THREE.Vector3();
  private last = new Map<string, number>();

  start() {
    if (this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = settings.volume;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.6 + b * 2; }
    for (const name of ['wind', 'river', 'surf', 'rain', 'fire', 'crowd']) this.ambLoop(name);
  }
  private ambLoop(name: string) {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = name === 'rain' ? 'highpass' : name === 'fire' ? 'bandpass' : 'lowpass';
    filter.frequency.value = { wind: 500, river: 900, surf: 400, rain: 2500, fire: 1800, crowd: 700 }[name] ?? 600;
    const gain = c.createGain(); gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(0, Math.random() * 2);
    this.amb[name] = { src, gain, filter };
  }
  setVolume(v: number) { if (this.master) this.master.gain.value = v; }
  /** Continuous ambience levels (0..1). */
  ambience(levels: Record<string, number>, wind = 0.5) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [k, v] of Object.entries(levels)) {
      const a = this.amb[k];
      if (!a) continue;
      a.gain.gain.setTargetAtTime(v * ({ wind: 0.25, river: 0.35, surf: 0.4, rain: 0.3, fire: 0.25, crowd: 0.15 }[k] ?? 0.2), t, 0.5);
      if (k === 'wind') a.filter.frequency.setTargetAtTime(300 + wind * 600 + Math.sin(t * 0.3) * 150, t, 1);
      if (k === 'surf') a.gain.gain.setTargetAtTime(v * 0.4 * (0.6 + 0.4 * Math.sin(t * 0.5)), t, 0.8);
      if (k === 'fire') a.filter.Q.value = 2 + Math.random() * 6;
    }
  }

  private out(pos: THREE.Vector3 | null, vol: number): AudioNode | null {
    const c = this.ctx;
    if (!c) return null;
    const g = c.createGain();
    let dist = 0;
    if (pos) dist = pos.distanceTo(this.listener);
    g.gain.value = vol / (1 + dist * dist * 0.02);
    if (g.gain.value < 0.003) return null;
    if (pos) {
      const p = c.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 0.6;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }
  setListener(cam: THREE.Camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    this.listener.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z; l.upX.value = u.x; l.upY.value = u.y; l.upZ.value = u.z; }
  }

  private burst(dest: AudioNode, dur: number, type: BiquadFilterType, freq: number, q: number, attack = 0.002, gain = 1, sweepTo?: number) {
    const c = this.ctx!, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  private tone(dest: AudioNode, f0: number, f1: number, dur: number, type: OscillatorType = 'sine', gain = 0.5, delay = 0) {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name: string, pos: THREE.Vector3 | null = null, vol = 1) {
    if (!this.ctx) return;
    // rate-limit identical sounds
    const now = performance.now(), k = name + (pos ? Math.round(pos.x) + ',' + Math.round(pos.z) : '');
    if ((this.last.get(k) ?? 0) > now - 40) return;
    this.last.set(k, now);
    const o = this.out(pos, vol);
    if (!o) return;
    switch (name) {
      case 'step:grass': this.burst(o, 0.12, 'lowpass', 1400, 0.7, 0.01, 0.5); break;
      case 'step:gravel': for (let i = 0; i < 4; i++) this.burst(o, 0.05 + i * 0.02, 'bandpass', 2500 + Math.random() * 2000, 2, 0.002, 0.35); break;
      case 'step:stone': this.burst(o, 0.07, 'bandpass', 900, 3, 0.001, 0.6); this.burst(o, 0.04, 'highpass', 3000, 1, 0.001, 0.2); break;
      case 'step:wood': this.burst(o, 0.1, 'bandpass', 380, 5, 0.002, 0.8); this.tone(o, 160, 110, 0.08, 'sine', 0.2); break;
      case 'step:water': this.burst(o, 0.25, 'bandpass', 900, 1.2, 0.01, 0.6, 400); break;
      case 'step:mud': this.burst(o, 0.18, 'lowpass', 500, 4, 0.02, 0.7, 250); break;
      case 'step:snow': for (let i = 0; i < 3; i++) this.burst(o, 0.09, 'bandpass', 1800 + Math.random() * 800, 1.5, 0.01, 0.35); break;
      case 'impact:wood': this.burst(o, 0.12, 'bandpass', 300 + Math.random() * 200, 6, 0.001, 0.9); break;
      case 'impact:ceramic': this.tone(o, 2200 + Math.random() * 800, 2000, 0.15, 'sine', 0.25); this.burst(o, 0.06, 'highpass', 2500, 1, 0.001, 0.4); break;
      case 'impact:metal': for (const f of [520, 1310, 2410]) this.tone(o, f * (0.9 + Math.random() * 0.2), f * 0.98, 0.6, 'sine', 0.18); break;
      case 'impact:soft': this.burst(o, 0.1, 'lowpass', 600, 1, 0.005, 0.6); break;
      case 'shatter': this.burst(o, 0.4, 'highpass', 2000, 0.7, 0.001, 1); for (let i = 0; i < 8; i++) this.tone(o, 2500 + Math.random() * 4000, 2000, 0.08 + Math.random() * 0.2, 'sine', 0.12, Math.random() * 0.25); break;
      case 'door': { const c = this.ctx!, t = c.currentTime; const os = c.createOscillator(); os.type = 'sawtooth'; os.frequency.setValueAtTime(140, t); os.frequency.linearRampToValueAtTime(220 + Math.random() * 80, t + 0.5); os.frequency.linearRampToValueAtTime(160, t + 0.9); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 8; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.1); g.gain.linearRampToValueAtTime(0, t + 0.95); os.connect(f).connect(g).connect(o); os.start(t); os.stop(t + 1); this.burst(o, 0.15, 'bandpass', 200, 4, 0.002, 0.5); break; }
      case 'creak': this.tone(o, 300, 420, 0.4, 'sawtooth', 0.04); break;
      case 'drawer': this.burst(o, 0.35, 'bandpass', 700, 2, 0.05, 0.4, 500); break;
      case 'locked': for (let i = 0; i < 3; i++) this.burst(o, 0.04, 'bandpass', 1800, 6, 0.001, 0.5); break;
      case 'eat': for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.burst(o, 0.08, 'bandpass', 1500 + Math.random() * 1500, 1.5, 0.002, 0.5), i * 160); break;
      case 'pickup': this.burst(o, 0.08, 'lowpass', 1800, 1, 0.01, 0.3); break;
      case 'flap': for (let i = 0; i < 5; i++) setTimeout(() => this.ctx && this.burst(o, 0.06, 'lowpass', 900, 1, 0.005, 0.4), i * 60); break;
      case 'splash': this.burst(o, 0.6, 'lowpass', 2500, 0.8, 0.005, 1, 300); break;
      case 'swing': this.burst(o, 0.25, 'bandpass', 600, 1.5, 0.05, 0.5, 2400); break;
      case 'hit:flesh': this.burst(o, 0.12, 'lowpass', 400, 2, 0.001, 1); this.tone(o, 90, 60, 0.15, 'sine', 0.4); break;
      case 'hit:block': for (const f of [700, 1700]) this.tone(o, f, f * 0.97, 0.35, 'triangle', 0.2); this.burst(o, 0.06, 'highpass', 3000, 1, 0.001, 0.5); break;
      case 'cannon': this.burst(o, 2.2, 'lowpass', 300, 0.7, 0.002, 1.6, 60); this.tone(o, 60, 30, 1.2, 'sine', 1.2); this.burst(o, 0.3, 'highpass', 1500, 0.5, 0.001, 0.8); break;
      case 'neigh': { this.tone(o, 900, 600, 0.6, 'sawtooth', 0.06); this.tone(o, 1200, 400, 1.0, 'sawtooth', 0.05, 0.2); break; }
      case 'moo': this.tone(o, 110, 95, 1.3, 'sawtooth', 0.14); this.tone(o, 220, 190, 1.3, 'sine', 0.08); break;
      case 'oink': for (let i = 0; i < 2; i++) { this.tone(o, 180, 120, 0.18, 'square', 0.06, i * 0.22); this.burst(o, 0.15, 'bandpass', 500, 3, 0.01, 0.4); } break;
      case 'cluck': for (let i = 0; i < 3; i++) this.tone(o, 700, 500, 0.08, 'square', 0.04, i * 0.13); break;
      case 'caw': this.tone(o, 900, 700, 0.3, 'sawtooth', 0.07); this.burst(o, 0.3, 'bandpass', 1300, 3, 0.02, 0.4); break;
      case 'chirp': { const base = 2800 + Math.random() * 2000; for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) this.tone(o, base, base * (1.2 + Math.random() * 0.5), 0.06, 'sine', 0.06, i * 0.09); break; }
      case 'cricket': for (let i = 0; i < 4; i++) this.tone(o, 4400, 4300, 0.03, 'square', 0.015, i * 0.05); break;
      case 'bell': for (const f of [440, 880, 1320, 1760]) this.tone(o, f, f, 2.5, 'sine', 0.08 / (f / 440)); break;
      case 'thunder': this.burst(o, 4, 'lowpass', 200, 0.5, 0.05, 1.5, 50); break;
      case 'shout': this.tone(o, 220, 180, 0.4, 'sawtooth', 0.08); this.burst(o, 0.4, 'bandpass', 800, 2, 0.02, 0.3); break;
      case 'coins': for (let i = 0; i < 5; i++) this.tone(o, 3000 + Math.random() * 2000, 2800, 0.12, 'sine', 0.08, i * 0.04); break;
      case 'sail': this.burst(o, 0.8, 'lowpass', 400, 0.8, 0.1, 0.6); break;
      case 'creak_ship': this.tone(o, 80 + Math.random() * 40, 120, 0.9, 'sawtooth', 0.03); break;
    }
  }
}
