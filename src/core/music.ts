// Generative ambient score in the spirit of quiet open-world soundtracks: a soft felt piano and warm pads
// play short pieces, then fall silent for a few minutes. Each piece is composed on the spot from the mood
// of the moment: bright and pastoral by day in the lowlands, modal and cold in the mountains, slow and
// minor at night, sparse and grey in rain. Nothing repeats exactly.
import { settings } from './settings';

type Mood = 'day' | 'dusk' | 'night' | 'mountain' | 'sea' | 'rain';
interface MoodDef { root: number; scale: number[]; tempo: number; density: number; pad: number; bright: number; chords: number[][] }

// scale degrees in semitones; chords as scale-degree triads/sevenths (0-based into the scale)
const MOODS: Record<Mood, MoodDef> = {
  day: { root: 60, scale: [0, 2, 4, 7, 9], tempo: 1.0, density: 0.55, pad: 0.35, bright: 1, chords: [[0, 2, 4], [3, 0, 2], [4, 1, 3], [2, 4, 1]] },
  dusk: { root: 57, scale: [0, 2, 4, 6, 7, 9, 11], tempo: 0.8, density: 0.4, pad: 0.55, bright: 0.7, chords: [[0, 2, 4, 6], [5, 0, 2], [3, 5, 0], [4, 6, 1]] },
  night: { root: 57, scale: [0, 2, 3, 5, 7, 8, 10], tempo: 0.62, density: 0.3, pad: 0.7, bright: 0.45, chords: [[0, 2, 4], [5, 0, 2], [3, 5, 0], [6, 1, 3]] },
  mountain: { root: 55, scale: [0, 2, 3, 5, 7, 9, 10], tempo: 0.72, density: 0.38, pad: 0.6, bright: 0.6, chords: [[0, 2, 4], [6, 1, 3], [3, 5, 0], [4, 6, 1]] },
  sea: { root: 62, scale: [0, 2, 4, 5, 7, 9, 11], tempo: 0.7, density: 0.35, pad: 0.65, bright: 0.65, chords: [[0, 2, 4], [3, 5, 0], [5, 0, 2], [4, 6, 1]] },
  rain: { root: 58, scale: [0, 3, 5, 7, 10], tempo: 0.6, density: 0.28, pad: 0.75, bright: 0.4, chords: [[0, 1, 2], [3, 0, 2], [2, 4, 1], [1, 3, 0]] },
};
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  enabled = true;
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private wet!: GainNode;
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
    (this as unknown as { bus: GainNode }).bus = bus;
  }
  private get bus() { return (this as unknown as { bus: GainNode }).bus; }

  update(dt: number) {
    const c = this.ctx;
    if (!c) return;
    const target = this.enabled ? (settings.music ?? 0.6) * (1 - this.duck * 0.85) : 0;
    this.out.gain.setTargetAtTime(target, c.currentTime, 1.2);
    if (c.currentTime < this.playingUntil) return;
    this.silence -= dt;
    if (this.silence > 0 || !this.enabled || this.duck > 0.6) return;
    this.mood = this.moodHint();
    const len = this.compose(this.mood, c.currentTime + 0.3);
    this.playingUntil = c.currentTime + len + 4;
    // the quiet between pieces is part of the music
    this.silence = 70 + Math.random() * 140;
  }

  /** Compose and schedule one piece; returns its length in seconds. */
  private compose(mood: Mood, t0: number): number {
    const M = MOODS[mood], rnd = Math.random;
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
      // left hand: a low root, then the chord rolled gently upward
      this.piano(note(ch[0], -1), tb, 0.32, 5.5 * beat, M.bright);
      ch.forEach((d, i) => { if (rnd() < 0.85) this.piano(note(d, 0), tb + (i + 1) * beat * (0.5 + rnd() * 0.25), 0.17, 4 * beat, M.bright); });
      // pad under the harmony
      if (rnd() < M.pad) this.pad(ch.map((d) => note(d, 0) - 12), tb, 4 * beat * 1.05, 0.05 * M.pad);
      // right hand: the motif every other phrase, otherwise sparse wandering notes
      if (b % 4 === 1 || b % 4 === 2) {
        const shift = b % 4 === 2 ? (rnd() < 0.5 ? 1 : -1) : 0;
        for (const m of motif) if (m.at < 4) this.piano(note(m.deg + shift + ch[0], 1), tb + m.at * beat + rnd() * 0.03, 0.2, m.len * beat * 2.5, M.bright);
      } else {
        for (let k = 0; k < 4; k++) if (rnd() < M.density) this.piano(note(ch[Math.floor(rnd() * ch.length)] + (rnd() < 0.3 ? 2 : 0), 1), tb + k * beat + rnd() * 0.05, 0.14 + rnd() * 0.06, 3 * beat, M.bright);
      }
    }
    // a final held chord to close
    const tEnd = t0 + bars * 4 * beat;
    for (const d of M.chords[0]) this.piano(note(d, 0), tEnd + rnd() * 0.08, 0.16, 7, M.bright);
    this.piano(note(M.chords[0][0], -1), tEnd, 0.25, 8, M.bright);
    return bars * 4 * beat + 8;
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
