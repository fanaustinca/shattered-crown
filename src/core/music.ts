// Generative ambient score in the spirit of quiet open-world soundtracks: short pieces, then a few minutes
// of silence. Each piece is composed on the spot from the mood of the moment and played by one of several
// ensembles: felt piano and pads, harp and wooden flute, lute, a cello with a drone, a wordless choir, or
// war drums and low horns near a battle. Bright and pastoral by day in the lowlands, modal and cold in the
// mountains, slow and minor at night, sparse and grey in rain, a lute jig in the tavern. Nothing repeats.
import { settings } from './settings';

export type Mood = 'day' | 'dusk' | 'night' | 'mountain' | 'sea' | 'rain' | 'town' | 'tavern' | 'battle' | 'hall';
type Ensemble = 'piano' | 'harp' | 'lute' | 'cello' | 'choir' | 'drums' | 'musicbox';
interface MoodDef { root: number; scale: number[]; tempo: number; density: number; pad: number; bright: number; chords: number[][] }

// scale degrees in semitones; chords as scale-degree triads/sevenths (0-based into the scale)
const MOODS: Record<Mood, MoodDef> = {
  day: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 1.0, density: 0.55, pad: 0.35, bright: 1, chords: [[0, 2, 4], [3, 0, 2], [4, 1, 3], [2, 4, 1]] },
  dusk: { root: 57, scale: [0, 2, 4, 6, 7, 9, 11], tempo: 0.8, density: 0.4, pad: 0.55, bright: 0.7, chords: [[0, 2, 4, 6], [5, 0, 2], [3, 5, 0], [4, 6, 1]] },
  night: { root: 57, scale: [0, 2, 3, 5, 7, 8, 10], tempo: 0.62, density: 0.3, pad: 0.7, bright: 0.45, chords: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [6, 1, 3]] },
  mountain: { root: 55, scale: [0, 2, 3, 5, 7, 9, 10], tempo: 0.72, density: 0.38, pad: 0.6, bright: 0.6, chords: [[0, 2, 4], [6, 1, 3], [3, 5, 0], [4, 6, 1]] },
  sea: { root: 62, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.7, density: 0.35, pad: 0.65, bright: 0.65, chords: [[0, 2, 4], [3, 5, 0], [5, 0, 2], [4, 6, 1]] },
  rain: { root: 58, scale: [0, 3, 5, 7, 10], tempo: 0.6, density: 0.28, pad: 0.75, bright: 0.4, chords: [[0, 1, 2], [3, 0, 2], [2, 4, 1], [1, 3, 0]] },
  town: { root: 62, scale: [0, 2, 4, 5, 7, 9, 10], tempo: 1.05, density: 0.6, pad: 0.3, bright: 0.9, chords: [[0, 2, 4], [6, 1, 3], [3, 5, 0], [4, 6, 1]] },
  tavern: { root: 62, scale: [0, 2, 3, 5, 7, 9, 10], tempo: 1.55, density: 0.8, pad: 0.1, bright: 1, chords: [[0, 2, 4], [6, 1, 3], [0, 2, 4], [4, 6, 1]] },
  battle: { root: 50, scale: [0, 2, 3, 5, 7, 8, 10], tempo: 1.2, density: 0.5, pad: 0.6, bright: 0.6, chords: [[0, 2, 4], [5, 0, 2], [6, 1, 3], [4, 6, 1]] },
  hall: { root: 55, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.55, density: 0.25, pad: 0.9, bright: 0.5, chords: [[0, 2, 4], [3, 5, 0], [4, 6, 1], [5, 0, 2]] },
};
// which ensembles may play each mood (picked at random per piece, weighted by repetition)
const ENSEMBLES: Record<Mood, Ensemble[]> = {
  day: ['piano', 'harp', 'harp', 'lute', 'piano'],
  dusk: ['piano', 'cello', 'harp', 'choir'],
  night: ['piano', 'musicbox', 'cello', 'piano'],
  mountain: ['cello', 'harp', 'choir', 'piano'],
  sea: ['harp', 'cello', 'piano', 'choir'],
  rain: ['piano', 'cello', 'piano', 'musicbox'],
  town: ['lute', 'harp', 'piano', 'lute'],
  tavern: ['lute'],
  battle: ['drums'],
  hall: ['choir', 'choir', 'cello'],
};
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  enabled = true;
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private wet!: GainNode;
  private bus!: GainNode;
  private silence = 25 + Math.random() * 35;   // first piece comes fairly soon
  private playingUntil = 0;
  private mood: Mood = 'day';
  /** the game sets this each frame */
  moodHint: () => Mood = () => 'day';
  /** quieter during fights, silent in a battle */
  duck = 0;

  attach(ctx: AudioContext, dest: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = settings.music ?? 0.6;
    // a long, soft hall: generated impulse response (decaying filtered noise, slightly different per ear)
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 4.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += (Math.random() * 2 - 1 - lp) * (0.35 - t * 0.25); d[i] = lp * Math.pow(1 - t, 2.4) * (i < 400 ? i / 400 : 1); }
    }
    conv.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    const dry = ctx.createGain(); dry.gain.value = 0.6;
    const bus = ctx.createGain();
    bus.connect(dry).connect(this.out);
    bus.connect(conv).connect(this.wet).connect(this.out);
    this.out.connect(dest);
    this.bus = bus;
  }

  update(dt: number) {
    const c = this.ctx;
    if (!c) return;
    const target = this.enabled ? (settings.music ?? 0.6) * (1 - this.duck * 0.85) : 0;
    this.out.gain.setTargetAtTime(target, c.currentTime, 1.2);
    if (c.currentTime < this.playingUntil) return;
    this.silence -= dt;
    const hint = this.moodHint();
    // a battle breaking out nearby brings the drums in soon
    if (hint === 'battle' && this.mood !== 'battle') this.silence = Math.min(this.silence, 6);
    if (this.silence > 0 || !this.enabled || (this.duck > 0.6 && hint !== 'battle')) return;
    this.mood = hint;
    const len = this.compose(this.mood, c.currentTime + 0.3);
    this.playingUntil = c.currentTime + len + 4;
    // the quiet between pieces is part of the music (shorter in a tavern or a battle)
    this.silence = this.mood === 'tavern' ? 8 + Math.random() * 20 : this.mood === 'battle' ? 15 + Math.random() * 30 : 70 + Math.random() * 140;
  }

  /** Compose and schedule one piece; returns its length in seconds. */
  private ens: Ensemble = 'piano';
  private lastEns: Ensemble | null = null;
  private compose(mood: Mood, t0: number): number {
    const M = MOODS[mood], rnd = Math.random;
    const pool = ENSEMBLES[mood];
    let e = pool[Math.floor(rnd() * pool.length)];
    if (e === this.lastEns && pool.length > 1) e = pool[Math.floor(rnd() * pool.length)];
    this.ens = this.lastEns = e;
    if (e === 'drums') return this.composeWar(M, t0);
    if (e === 'lute' && (mood === 'tavern' || mood === 'town')) return this.composeJig(M, t0);
    const beat = 0.75 / M.tempo;                  // seconds per beat
    const bars = 8 + Math.floor(rnd() * 6);       // 4 beats per bar
    const order = [0];
    for (let i = 1; i < bars; i++) order.push(rnd() < 0.55 ? (order[i - 1] + 1) % M.chords.length : Math.floor(rnd() * M.chords.length));
    order[bars - 1] = 0;
    const note = (deg: number, oct: number) => M.root + 12 * (oct + Math.floor(deg / M.scale.length)) + M.scale[((deg % M.scale.length) + M.scale.length) % M.scale.length];
    // a short motif that recurs with small changes
    const motif: { deg: number; at: number; len: number }[] = [];
    let at = 0;
    for (let i = 0; i < 3 + Math.floor(rnd() * 3); i++) { motif.push({ deg: Math.floor(rnd() * 7) - 1, at, len: [1, 1, 2, 1.5, 3][Math.floor(rnd() * 5)] }); at += motif[motif.length - 1].len; }
    for (let b = 0; b < bars; b++) {
      const tb = t0 + b * 4 * beat;
      const ch = M.chords[order[b]];
      const E = this.ens;
      // accompaniment: a low root, then the chord rolled gently upward (harp/lute arpeggiate it;
      // the cello holds the bass; the choir sings the chord)
      if (E === 'choir') this.choir(ch.map((d) => note(d, 0) - (d === ch[0] ? 12 : 0)), tb, 4 * beat * 1.1, 0.07);
      else if (E === 'cello') { this.bowed(note(ch[0], -1) - 12, tb, 4 * beat * 1.02, 0.11); if (rnd() < 0.5) this.bowed(note(ch[2] ?? ch[1], -1), tb + 2 * beat, 2 * beat, 0.05); }
      else {
        const acc = E === 'piano' ? this.piano.bind(this) : E === 'musicbox' ? this.bell.bind(this) : this.pluck.bind(this);
        acc(note(ch[0], E === 'musicbox' ? 0 : -1), tb, E === 'piano' ? 0.32 : 0.28, 5.5 * beat, M.bright);
        const roll = E === 'harp' ? 6 : 3;
        for (let i = 0; i < roll; i++) { const d = ch[i % ch.length] + (i >= ch.length ? M.scale.length : 0); if (rnd() < 0.85) acc(note(d, E === 'musicbox' ? 1 : 0), tb + (i + 1) * beat * (E === 'harp' ? 0.5 : 0.5 + rnd() * 0.25), 0.17, 4 * beat, M.bright); }
      }
      // pad under the harmony
      if (rnd() < M.pad && E !== 'choir') this.pad(ch.map((d) => note(d, 0) - 12), tb, 4 * beat * 1.05, 0.05 * M.pad);
      // melody: the motif every other phrase, otherwise sparse wandering notes
      const mel = (m: number, t: number, v: number, dur: number) => {
        if (E === 'harp' || E === 'cello' || E === 'choir') this.flute(m + (E === 'cello' ? -12 : 0), t, v * 0.55, dur * 0.7);
        else if (E === 'lute') this.pluck(m, t, v, dur, M.bright);
        else if (E === 'musicbox') this.bell(m + 12, t, v * 0.8, dur, M.bright);
        else this.piano(m, t, v, dur, M.bright);
      };
      if (b % 4 === 1 || b % 4 === 2) {
        const shift = b % 4 === 2 ? (rnd() < 0.5 ? 1 : -1) : 0;
        for (const m of motif) if (m.at < 4) mel(note(m.deg + shift + ch[0], 1), tb + m.at * beat + rnd() * 0.03, 0.2, m.len * beat * 2.5);
      } else {
        for (let k = 0; k < 4; k++) if (rnd() < M.density) mel(note(ch[Math.floor(rnd() * ch.length)] + (rnd() < 0.3 ? 2 : 0), 1), tb + k * beat + rnd() * 0.05, 0.14 + rnd() * 0.06, 3 * beat);
      }
    }
    // a final held chord to close
    const tEnd = t0 + bars * 4 * beat;
    if (this.ens === 'choir') this.choir(M.chords[0].map((d) => note(d, 0)), tEnd, 7, 0.07);
    else if (this.ens === 'cello') this.bowed(note(M.chords[0][0], -1) - 12, tEnd, 7, 0.1);
    else {
      const fin = this.ens === 'piano' ? this.piano.bind(this) : this.ens === 'musicbox' ? this.bell.bind(this) : this.pluck.bind(this);
      for (const d of M.chords[0]) fin(note(d, 0), tEnd + rnd() * 0.08, 0.16, 7, M.bright);
      fin(note(M.chords[0][0], -1), tEnd, 0.25, 8, M.bright);
    }
    return bars * 4 * beat + 8;
  }

  /** A lively lute jig in 6/8 (taverns, market towns): bass on the beat, a running melody of quavers. */
  private composeJig(M: MoodDef, t0: number): number {
    const rnd = Math.random, q = 0.5 / M.tempo * 0.75;     // one quaver
    const bars = 8 + 4 * Math.floor(rnd() * 2);
    const note = (deg: number, oct: number) => M.root + 12 * (oct + Math.floor(deg / M.scale.length)) + M.scale[((deg % M.scale.length) + M.scale.length) % M.scale.length];
    // an A phrase of 2 bars, repeated with variations: AABA
    const phrase: number[] = [];
    let d = 4;
    for (let i = 0; i < 12; i++) { d += [-2, -1, -1, 1, 1, 2, 0][Math.floor(rnd() * 7)]; d = Math.max(0, Math.min(9, d)); phrase.push(d); }
    for (let b = 0; b < bars; b++) {
      const tb = t0 + b * 6 * q;
      const ch = M.chords[b % 4 === 3 ? 3 : (b >> 1) % 2 ? 1 : 0];
      this.pluck(note(ch[0], -1), tb, 0.3, 3 * q, 0.8);
      this.pluck(note(ch[0], -1) + 7, tb + 3 * q, 0.22, 3 * q, 0.8);
      const part = (b >> 1) % 4 === 2 ? phrase.map((x) => x + 2) : phrase;
      for (let k = 0; k < 6; k++) {
        if (k % 3 === 2 && rnd() < 0.25) continue;
        const deg = part[(b % 2) * 6 + k] + (b === bars - 1 && k === 5 ? 0 : 0);
        this.pluck(note(deg, 1), tb + k * q + (rnd() - 0.5) * 0.012, k % 3 === 0 ? 0.24 : 0.17, 2 * q, 1);
      }
      // a frame drum keeps the lilt
      this.drum(tb, 0.18, 110); if (rnd() < 0.7) this.drum(tb + 3 * q, 0.12, 140);
    }
    const tEnd = t0 + bars * 6 * q;
    this.pluck(note(0, -1), tEnd, 0.3, 4, 0.8); this.pluck(note(0, 1), tEnd, 0.22, 4, 1);
    return bars * 6 * q + 4;
  }

  /** War: slow, heavy drums and a low horn call over a drone. */
  private composeWar(M: MoodDef, t0: number): number {
    const rnd = Math.random, beat = 0.75 / M.tempo;
    const bars = 6 + Math.floor(rnd() * 4);
    const note = (deg: number, oct: number) => M.root + 12 * (oct + Math.floor(deg / M.scale.length)) + M.scale[((deg % M.scale.length) + M.scale.length) % M.scale.length];
    this.bowed(note(0, -1), t0, bars * 4 * beat + 2, 0.08);
    for (let b = 0; b < bars; b++) {
      const tb = t0 + b * 4 * beat;
      this.drum(tb, 0.5, 60); this.drum(tb + 1.5 * beat, 0.25, 70); this.drum(tb + 2 * beat, 0.4, 60);
      if (b % 2) { this.drum(tb + 3 * beat, 0.2, 90); this.drum(tb + 3.5 * beat, 0.25, 90); }
      if (b % 4 === 1) { const ch = M.chords[(b >> 2) % M.chords.length]; this.horn(note(ch[0], 0), tb, 2.5 * beat, 0.08); this.horn(note(ch[2], 0), tb + 2.5 * beat, 1.5 * beat, 0.07); }
      if (b % 4 === 3) this.horn(note(4, 0), tb, 3.5 * beat, 0.08);
    }
    return bars * 4 * beat + 4;
  }

  /** Plucked string (harp/lute): Karplus-Strong rendered once per pitch and cached. */
  private plucks = new Map<number, AudioBuffer>();
  private pluck(midi: number, t: number, vel: number, dur: number, bright: number) {
    const c = this.ctx!;
    let buf = this.plucks.get(midi);
    if (!buf) {
      const sr = c.sampleRate, f = hz(midi), len = Math.floor(sr * Math.min(4, 1.2 + 300 / f));
      buf = c.createBuffer(1, len, sr);
      const out = buf.getChannelData(0), P = sr / f, N = Math.floor(P), frac = P - N;
      const line = new Float32Array(N + 2);
      for (let i = 0; i < line.length; i++) line[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin((i / N) * Math.PI));
      let idx = 0, last = 0;
      const decay = 0.996 - Math.min(0.006, f / 200000);
      for (let i = 0; i < len; i++) {
        const a = line[idx], b2 = line[(idx + 1) % line.length];
        const v = a + (b2 - a) * frac;
        const nv = (v + last) * 0.5 * decay;
        last = v;
        out[i] = v;
        line[idx] = nv;
        idx = (idx + 1) % (N + 1);
      }
      this.plucks.set(midi, buf);
    }
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vel * 0.9, t);
    g.gain.setTargetAtTime(0, t + Math.max(0.3, dur), 0.4);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800 + bright * 4000;
    src.connect(lp).connect(g).connect(this.bus);
    src.start(t); src.stop(t + dur + 2);
  }

  /** Music box / bells: bright inharmonic partials, long ring. */
  private bell(midi: number, t: number, vel: number, dur: number, _bright: number) {
    const c = this.ctx!, f = hz(midi);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vel * 0.5, t + 0.004); env.gain.setTargetAtTime(0, t + 0.01, Math.max(0.4, dur / 4));
    env.connect(this.bus);
    for (const [m, a] of [[1, 1], [2.76, 0.3], [5.4, 0.12], [8.93, 0.05]]) {
      const o = c.createOscillator(); o.frequency.value = f * m; const g = c.createGain(); g.gain.value = a;
      o.connect(g).connect(env); o.start(t); o.stop(t + dur + 3);
    }
  }

  /** Wooden flute: a breathy sine with a little second harmonic, delayed vibrato and a soft chiff. */
  private flute(midi: number, t: number, vel: number, dur: number) {
    const c = this.ctx!, f = hz(midi);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vel, t + 0.08); env.gain.setValueAtTime(vel, t + Math.max(0.1, dur - 0.2)); env.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    env.connect(this.bus);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 5.2; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.006, t + 0.6);
    vib.connect(vg);
    for (const [m, a] of [[1, 1], [2, 0.18], [3, 0.06]]) {
      const o = c.createOscillator(); o.frequency.value = f * m; vg.connect(o.frequency);
      const g = c.createGain(); g.gain.value = a; o.connect(g).connect(env); o.start(t); o.stop(t + dur + 0.4);
    }
    vib.start(t); vib.stop(t + dur + 0.4);
    // breath noise
    const n = c.createBufferSource(); n.buffer = this.noise(); n.loop = true; const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 2; bp.Q.value = 2;
    const ng = c.createGain(); ng.gain.setValueAtTime(vel * 0.25, t); ng.gain.setTargetAtTime(vel * 0.05, t + 0.06, 0.1); ng.gain.linearRampToValueAtTime(0, t + dur + 0.25);
    n.connect(bp).connect(ng).connect(this.bus); n.start(t); n.stop(t + dur + 0.4);
  }

  /** Bowed string (cello/viol): saw through a body filter, slow bow attack, vibrato. */
  private bowed(midi: number, t: number, dur: number, vol: number) {
    const c = this.ctx!, f = hz(midi);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol, t + Math.min(0.5, dur * 0.3)); env.gain.setValueAtTime(vol, t + dur * 0.8); env.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(2500, f * 6); lp.Q.value = 0.7;
    const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 280; body.gain.value = 5; body.Q.value = 1.2;
    env.connect(lp).connect(body).connect(this.bus);
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 4.8; vg.gain.value = f * 0.005; vib.connect(vg);
    for (const det of [-4, 5]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; vg.connect(o.frequency); const g = c.createGain(); g.gain.value = 0.5; o.connect(g).connect(env); o.start(t); o.stop(t + dur + 0.5); }
    vib.start(t); vib.stop(t + dur + 0.5);
  }

  /** Wordless choir: detuned voices per note through "ah" formants, slow swell. */
  private choir(notes: number[], t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol, t + dur * 0.3); env.gain.linearRampToValueAtTime(vol * 0.85, t + dur * 0.8); env.gain.linearRampToValueAtTime(0, t + dur * 1.2);
    const mix = c.createGain(); mix.gain.value = 1;
    for (const [fq, q, gn] of [[800, 6, 1], [1150, 7, 0.6], [2900, 9, 0.25]]) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fq; bp.Q.value = q;
      const g = c.createGain(); g.gain.value = gn * 3;
      mix.connect(bp).connect(g).connect(env);
    }
    env.connect(this.bus);
    for (const m of notes) for (const det of [-9, 0, 8]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det + (Math.random() - 0.5) * 4;
      const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 4.5 + Math.random(); vg.gain.value = hz(m) * 0.004; vib.connect(vg).connect(o.frequency);
      const g = c.createGain(); g.gain.value = 0.25 / notes.length;
      o.connect(g).connect(mix); o.start(t); o.stop(t + dur * 1.25); vib.start(t); vib.stop(t + dur * 1.25);
    }
  }

  /** Low horn: a mellow brass tone with a slow swell. */
  private horn(midi: number, t: number, dur: number, vol: number) {
    const c = this.ctx!, f = hz(midi);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol, t + 0.25); env.gain.setValueAtTime(vol, t + dur * 0.85); env.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * 2, t); lp.frequency.linearRampToValueAtTime(f * 4.5, t + 0.3); lp.Q.value = 1;
    env.connect(lp).connect(this.bus);
    for (const det of [-3, 3]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(env); o.start(t); o.stop(t + dur + 0.4); }
  }

  /** Frame drum / war drum: a pitched thump with a skin slap. */
  private drum(t: number, vel: number, f0: number) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.frequency.setValueAtTime(f0 * 1.8, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(this.bus); o.start(t); o.stop(t + 0.7);
    const n = c.createBufferSource(); n.buffer = this.noise(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f0 * 6; bp.Q.value = 1;
    const ng = c.createGain(); ng.gain.setValueAtTime(vel * 0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    n.connect(bp).connect(ng).connect(this.bus); n.start(t); n.stop(t + 0.15);
  }
  private noiseBuf: AudioBuffer | null = null;
  private noise() {
    if (!this.noiseBuf) { const c = this.ctx!; this.noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return this.noiseBuf;
  }

  /** Felt-piano voice: a few inharmonic partials with fast-then-slow decay and a hammer thump. */
  private piano(midi: number, t: number, vel: number, dur: number, bright: number) {
    const c = this.ctx!, f = hz(midi);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.012);
    env.gain.setTargetAtTime(vel * 0.35, t + 0.012, 0.25);
    env.gain.setTargetAtTime(0, t + 0.3, Math.max(0.6, dur / 3));
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(9000, f * (5 + bright * 6)), t);
    lp.frequency.setTargetAtTime(f * 2.2, t + 0.05, 0.9);
    lp.Q.value = 0.3;
    env.connect(lp).connect(this.bus);
    const parts = [[1, 1], [2.003, 0.45], [3.009, 0.18], [4.02, 0.08], [5.04, 0.04]];
    for (const [mul, a] of parts) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      o.detune.value = (Math.random() - 0.5) * 4;
      const g = c.createGain(); g.gain.value = a;
      o.connect(g).connect(env);
      o.start(t); o.stop(t + dur + 4);
    }
  }

  /** Warm pad: detuned saws through a slowly opening low-pass, long swell in and out. */
  private pad(notes: number[], t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const env = c.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    env.gain.linearRampToValueAtTime(vol * 0.8, t + dur * 0.8);
    env.gain.linearRampToValueAtTime(0, t + dur * 1.25);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.5); lp.Q.value = 0.5;
    env.connect(lp).connect(this.bus);
    for (const m of notes) for (const det of [-7, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      const g = c.createGain(); g.gain.value = 0.18 / notes.length;
      o.connect(g).connect(env);
      o.start(t); o.stop(t + dur * 1.3);
    }
  }
}
