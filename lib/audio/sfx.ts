// Procedural retro SFX via the Web Audio API — every sound is
// synthesized at call time, so there are no audio files to host and
// nothing copyrighted.
//
// The goal is *character*: each event uses a distinct synthesis method
// (metallic FM clangs, filtered-noise whooshes, low LFO growls, bell
// sparkles, real multi-note fanfares) so you can tell what happened
// with your eyes closed — not just slightly different blips.
//
// Browsers block audio until a user gesture, so the AudioContext is
// created lazily and resumed on the first pointer/key event. All of it
// is SSR-guarded and wrapped so audio can never break gameplay.

export type SfxName =
  | "attack"
  | "crit"
  | "miss"
  | "block"
  | "spell"
  | "spellMiss"
  | "heal"
  | "hurt"
  | "victory"
  | "defeat"
  | "flee"
  | "loot"
  | "levelUp"
  | "battleStart"
  | "monster";

// ── enabled preference (persisted) + tiny store for the toggle UI ──
const STORAGE_KEY = "dnd-sound";
let enabled = true;
let loaded = false;
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    enabled = localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // storage blocked — default on for the session
  }
}

export function isSoundEnabled(): boolean {
  ensureLoaded();
  return enabled;
}

export function serverSoundEnabled(): boolean {
  return true;
}

export function setSoundEnabled(next: boolean) {
  ensureLoaded();
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // ignore
  }
  if (next) void audio(); // unlock the context from this gesture
  listeners.forEach((l) => l());
}

export function subscribeSound(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ── audio context ──────────────────────────────────────────────────
let ctx: AudioContext | null = null;
let unlockBound = false;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function bindUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const unlock = () => void audio();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

// Master bus: everything runs through a gain + compressor so sounds
// can be loud and punchy without clipping when layers stack.
let masterNode: GainNode | null = null;
function bus(ac: AudioContext): AudioNode {
  if (!masterNode || masterNode.context !== ac) {
    masterNode = ac.createGain();
    masterNode.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    // Gentle + a slightly slower attack so the bright transient (the
    // "crack" of a hit) punches through before the compressor clamps —
    // fast, hard compression is what makes impacts sound dull.
    comp.threshold.value = -10;
    comp.knee.value = 24;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.15;
    masterNode.connect(comp).connect(ac.destination);
  }
  return masterNode;
}

// Cached distortion curves for a WaveShaper — a tanh saturator. Higher k
// hard-clips harder, folding the noise crunch into a fuzzy, distorted
// growl. The curves are static lookup tables, so cache them per k.
const distCurves = new Map<number, Float32Array<ArrayBuffer>>();
function distCurve(k: number): Float32Array<ArrayBuffer> {
  let c = distCurves.get(k);
  if (!c) {
    const n = 2048;
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x);
    }
    distCurves.set(k, c);
  }
  return c;
}

// ── synth primitives ───────────────────────────────────────────────
// Each takes a `start` offset (seconds) so a sound can layer notes.

// Simple oscillator blip with an optional pitch sweep.
function tone(
  ac: AudioContext,
  o: {
    freq: number;
    type?: OscillatorType;
    start?: number;
    dur?: number;
    gain?: number;
    sweepTo?: number;
  },
) {
  const { freq, type = "square", start = 0, dur = 0.1, gain = 0.12 } = o;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (o.sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(bus(ac));
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// FM: a modulator detunes the carrier. High modulation index + an
// inharmonic ratio = metallic/bell timbres (clangs, coins, chimes).
// The index decays over the note so the attack is bright and the tail
// mellows — the signature of a struck metal sound.
function fm(
  ac: AudioContext,
  o: {
    freq: number;
    ratio?: number;
    index?: number;
    type?: OscillatorType;
    start?: number;
    dur?: number;
    gain?: number;
    sweepTo?: number;
  },
) {
  const {
    freq,
    ratio = 2,
    index = 120,
    type = "sine",
    start = 0,
    dur = 0.2,
    gain = 0.12,
  } = o;
  const t0 = ac.currentTime + start;
  const carrier = ac.createOscillator();
  const mod = ac.createOscillator();
  const modGain = ac.createGain();
  const g = ac.createGain();
  carrier.type = type;
  mod.type = "sine";
  carrier.frequency.setValueAtTime(freq, t0);
  mod.frequency.setValueAtTime(freq * ratio, t0);
  if (o.sweepTo) {
    carrier.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t0 + dur);
    mod.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo * ratio), t0 + dur);
  }
  modGain.gain.setValueAtTime(index * freq, t0);
  modGain.gain.exponentialRampToValueAtTime(Math.max(1, freq), t0 + dur);
  mod.connect(modGain).connect(carrier.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  carrier.connect(g).connect(bus(ac));
  carrier.start(t0);
  mod.start(t0);
  carrier.stop(t0 + dur + 0.05);
  mod.stop(t0 + dur + 0.05);
}

// A tone with an LFO on its pitch — vibrato at high freqs, a guttural
// growl at low freqs (monster, ominous rumble).
function wobble(
  ac: AudioContext,
  o: {
    freq: number;
    type?: OscillatorType;
    start?: number;
    dur?: number;
    gain?: number;
    lfoHz?: number;
    lfoDepth?: number;
    sweepTo?: number;
  },
) {
  const {
    freq,
    type = "sawtooth",
    start = 0,
    dur = 0.3,
    gain = 0.12,
    lfoHz = 16,
    lfoDepth = 18,
  } = o;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (o.sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.sweepTo), t0 + dur);
  }
  lfo.frequency.setValueAtTime(lfoHz, t0);
  lfoGain.gain.setValueAtTime(lfoDepth, t0);
  lfo.connect(lfoGain).connect(osc.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(bus(ac));
  osc.start(t0);
  lfo.start(t0);
  osc.stop(t0 + dur + 0.05);
  lfo.stop(t0 + dur + 0.05);
}

// Filtered white noise with a moving band-pass — a whoosh/swish.
// Sweeping the filter down = a fading swoosh (miss); up = a rising one.
function whoosh(
  ac: AudioContext,
  o: {
    start?: number;
    dur?: number;
    gain?: number;
    fromFreq?: number;
    toFreq?: number;
    q?: number;
  },
) {
  const {
    start = 0,
    dur = 0.22,
    gain = 0.1,
    fromFreq = 5000,
    toFreq = 500,
    q = 0.9,
  } = o;
  const t0 = ac.currentTime + start;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.setValueAtTime(q, t0);
  bp.frequency.setValueAtTime(fromFreq, t0);
  bp.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), t0 + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(bus(ac));
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// short filtered-noise transient — an impact "chh" / low rumble
function noise(
  ac: AudioContext,
  o: { start?: number; dur?: number; gain?: number; filter?: number },
) {
  const { start = 0, dur = 0.06, gain = 0.06, filter = 1200 } = o;
  const t0 = ac.currentTime + start;
  const frames = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = filter;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(bus(ac));
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

// Gritty "chip" crunch — the character that generic white noise lacks. The
// wavetable is filled by the NES APU's *own* noise generator: a 15-bit LFSR
// in "short" mode (feedback from bits 0 and 6), the exact circuit behind
// every Dragon-Warrior-era crunch. Its 1-bit output is a hard, metallic
// buzz — not smooth random hiss — and looping it keeps that periodic grit.
// Sweeping playbackRate slides the pitch, giving the signature descending
// crunch of a hit. Base pitch ≈ sampleRate / seedLen · rate; a bandpass
// gives it a throat. This emulates the chip; it copies no actual sound.
function chip(
  ac: AudioContext,
  o: {
    start?: number;
    dur?: number;
    gain?: number;
    seedLen?: number;
    rate?: number;
    rateTo?: number;
    filter?: number;
    q?: number;
    drive?: number;
  },
) {
  const {
    start = 0,
    dur = 0.2,
    gain = 0.18,
    seedLen = 48,
    rate = 2,
    rateTo,
    filter = 3600,
    q = 1.2,
    drive = 0,
  } = o;
  const t0 = ac.currentTime + start;
  const buffer = ac.createBuffer(1, Math.max(2, seedLen), ac.sampleRate);
  const data = buffer.getChannelData(0);
  // 15-bit LFSR, short mode: fb = bit0 XOR bit6, shifted into bit14. The
  // 1-bit output is the real NES noise-channel texture.
  let reg = 1;
  for (let i = 0; i < data.length; i++) {
    const fb = (reg & 1) ^ ((reg >> 6) & 1);
    reg = (reg >> 1) | (fb << 14);
    data[i] = reg & 1 ? 0.9 : -0.9;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.setValueAtTime(rate, t0);
  if (rateTo) {
    src.playbackRate.exponentialRampToValueAtTime(Math.max(0.05, rateTo), t0 + dur);
  }
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = filter;
  bp.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  // Optional distortion: drive the noise hard into a tanh saturator for a
  // fuzzy, crunchy growl (used on melee attacks).
  let head: AudioNode = src;
  if (drive > 0) {
    const inGain = ac.createGain();
    inGain.gain.value = 1 + drive;
    const shaper = ac.createWaveShaper();
    shaper.curve = distCurve(2 + drive * 1.5);
    shaper.oversample = "2x";
    src.connect(inGain).connect(shaper);
    head = shaper;
  }
  head.connect(bp).connect(g).connect(bus(ac));
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

// Play a sequence of notes — an original little melody. Each note is
// { f: frequency, at: start offset, dur, gain, type }.
function melody(
  ac: AudioContext,
  notes: {
    f: number;
    at: number;
    dur?: number;
    gain?: number;
    type?: OscillatorType;
  }[],
) {
  for (const n of notes) {
    tone(ac, {
      freq: n.f,
      start: n.at,
      dur: n.dur ?? 0.14,
      gain: n.gain ?? 0.1,
      type: n.type ?? "square",
    });
  }
}

// ── the sounds — each a distinct timbre ────────────────────────────
const SOUNDS: Record<SfxName, (ac: AudioContext) => void> = {
  // weapon hit: a bright steel strike, not a woody thud. A sharp high edge
  // transient (the bite of the blade), a gritty chip crunch that stays up in
  // the steel range as it sweeps, a thin square edge, and only a light low
  // tap — so the energy lives up top where a blade lives, with just enough
  // body to land.
  attack: (ac) => {
    // dense noisy onset — the tall spike cluster at the attack
    noise(ac, { dur: 0.03, gain: 0.15, filter: 5200 });
    // body: a driven NES crunch whose pitch sweeps *down* as it decays, so
    // the cycles spread apart and fade out — matching the reference wave
    chip(ac, { dur: 0.42, gain: 0.19, seedLen: 40, rate: 3.4, rateTo: 0.34, filter: 3200, q: 1.2, drive: 2.6 });
    // a descending sawtooth reinforces the clean periodic spikes
    tone(ac, { freq: 300, type: "sawtooth", dur: 0.4, gain: 0.1, sweepTo: 62 });
    // a light low tap for a bit of body
    tone(ac, { freq: 190, type: "triangle", dur: 0.16, gain: 0.1, sweepTo: 92 });
  },
  // critical: the same descending-crunch shape as a normal hit, but bigger —
  // longer, a deeper downward sweep, a second crunch layer behind it, and
  // heavier distortion so a crit clearly hits harder.
  crit: (ac) => {
    noise(ac, { dur: 0.035, gain: 0.17, filter: 6000 });
    chip(ac, { dur: 0.5, gain: 0.2, seedLen: 36, rate: 3.8, rateTo: 0.3, filter: 3400, q: 1.3, drive: 3.4 });
    chip(ac, { start: 0.06, dur: 0.34, gain: 0.13, seedLen: 56, rate: 2.6, rateTo: 0.4, filter: 2400, q: 1.2, drive: 3.0 });
    tone(ac, { freq: 340, type: "sawtooth", dur: 0.46, gain: 0.1, sweepTo: 55 });
    tone(ac, { freq: 210, type: "triangle", dur: 0.2, gain: 0.11, sweepTo: 80 });
  },
  // miss: a long airy swipe — the weapon whistling through empty air.
  // High and breathy so it never reads as an impact.
  miss: (ac) => {
    whoosh(ac, { dur: 0.48, gain: 0.2, fromFreq: 6000, toFreq: 520, q: 0.7 });
    whoosh(ac, { start: 0.05, dur: 0.34, gain: 0.12, fromFreq: 9000, toFreq: 1400, q: 1.6 });
  },
  // block/parry: a short, bright gritty "tink" of steel turning steel — a
  // high chip crunch that barely sweeps (a quick clip, not a long crash), a
  // square ping, and a small thump. Brighter and snappier than the attack,
  // so a deflection is unmistakable.
  block: (ac) => {
    chip(ac, { dur: 0.13, gain: 0.2, seedLen: 22, rate: 3.0, rateTo: 1.6, filter: 5200, q: 1.5 });
    tone(ac, { freq: 540, type: "square", dur: 0.07, gain: 0.12, sweepTo: 300 });
    tone(ac, { freq: 180, type: "triangle", dur: 0.18, gain: 0.14, sweepTo: 82 });
  },
  // spellcast: arcane, not cheerful. A rising whoosh of gathering energy,
  // a low mystical drone for dungeon gravity, an eerie detuned shimmer a
  // *hollow fifth* apart (ancient/ominous — no bright major third), and a
  // single soft mote of magic dust. Never a bell arpeggio.
  spell: (ac) => {
    whoosh(ac, { dur: 0.36, gain: 0.09, fromFreq: 240, toFreq: 3400, q: 1.4 });
    wobble(ac, { freq: 130, type: "triangle", dur: 0.44, gain: 0.1, lfoHz: 6, lfoDepth: 5, sweepTo: 175 });
    wobble(ac, { freq: 494, type: "triangle", start: 0.05, dur: 0.36, gain: 0.08, lfoHz: 17, lfoDepth: 24, sweepTo: 740 });
    wobble(ac, { freq: 742, type: "sine", start: 0.08, dur: 0.32, gain: 0.05, lfoHz: 22, lfoDepth: 30, sweepTo: 988 });
    fm(ac, { freq: 1480, ratio: 2.7, index: 4, type: "sine", start: 0.16, dur: 0.26, gain: 0.05 });
  },
  // spell fizzle: the gathered energy collapses — a wavering, detuned
  // downward whir, a low sputter of dissipating magic, and a soft airy
  // whiff past. The descending, unstable contour is the inverse of the
  // rising cast, so a miss reads instantly — and it stays arcane, not
  // like a cartoon "wah-wah".
  spellMiss: (ac) => {
    wobble(ac, { freq: 620, type: "triangle", dur: 0.32, gain: 0.11, lfoHz: 18, lfoDepth: 30, sweepTo: 165 });
    wobble(ac, { freq: 930, type: "sine", start: 0.02, dur: 0.26, gain: 0.05, lfoHz: 24, lfoDepth: 24, sweepTo: 220 });
    noise(ac, { start: 0.04, dur: 0.16, gain: 0.05, filter: 1200 });
    whoosh(ac, { start: 0.05, dur: 0.24, gain: 0.08, fromFreq: 3400, toFreq: 480, q: 1.1 });
  },
  // heal: a warm restorative glow — a soft low swell that rises a little,
  // two gentle sine tones a fourth apart, and a faint shimmer of light.
  // Soothing and mystical rather than a chirpy ascending arpeggio.
  heal: (ac) => {
    wobble(ac, { freq: 196, type: "triangle", dur: 0.5, gain: 0.09, lfoHz: 5, lfoDepth: 4, sweepTo: 262 }); // G3→C4
    fm(ac, { freq: 392, ratio: 2, index: 1.2, type: "sine", start: 0.08, dur: 0.42, gain: 0.09 }); // G4
    fm(ac, { freq: 523, ratio: 2, index: 1.2, type: "sine", start: 0.2, dur: 0.42, gain: 0.08 }); // C5 (fourth)
    wobble(ac, { freq: 784, type: "sine", start: 0.14, dur: 0.36, gain: 0.04, lfoHz: 14, lfoDepth: 16 });
  },
  // taking a hit: a gritty, *distorted crunch* of the blow tearing into you —
  // a noisy contact bite, a driven chip crunch (this is the crunch; it was a
  // dull thud before), and only a light low grunt underneath for the "oof".
  // Lower and harsher than your own steel strike, so it reads as the monster
  // hurting you rather than a clean weapon hit.
  hurt: (ac) => {
    noise(ac, { dur: 0.03, gain: 0.14, filter: 3600 });
    chip(ac, { dur: 0.3, gain: 0.2, seedLen: 60, rate: 2.3, rateTo: 0.4, filter: 2600, q: 1.2, drive: 2.8 });
    tone(ac, { freq: 180, type: "sawtooth", dur: 0.2, gain: 0.13, sweepTo: 58 });
    tone(ac, { freq: 140, type: "triangle", dur: 0.2, gain: 0.11, sweepTo: 56 });
  },
  // victory: a grim, heroic war-horn fanfare — a rising D-minor arpeggio on
  // brass-like sawtooth in a low register, over a D root drone, resolving to
  // a held octave with an *open fifth* pad (epic and ancient, not a bright
  // major level-clear jingle).
  victory: (ac) => {
    tone(ac, { freq: 147, type: "triangle", dur: 1.05, gain: 0.09 }); // D3 root drone
    melody(ac, [
      { f: 220, at: 0, dur: 0.16, type: "sawtooth", gain: 0.11 }, // A3
      { f: 294, at: 0.16, dur: 0.16, type: "sawtooth", gain: 0.11 }, // D4
      { f: 349, at: 0.32, dur: 0.16, type: "sawtooth", gain: 0.11 }, // F4 (minor 3rd)
      { f: 440, at: 0.48, dur: 0.24, type: "sawtooth", gain: 0.12 }, // A4
      { f: 587, at: 0.74, dur: 0.5, type: "sawtooth", gain: 0.12 }, // D5 (held)
    ]);
    tone(ac, { freq: 294, type: "triangle", start: 0.74, dur: 0.5, gain: 0.06 }); // D4
    tone(ac, { freq: 440, type: "triangle", start: 0.74, dur: 0.5, gain: 0.05 }); // A4 (fifth)
  },
  // defeat: a slow descending, wobbly "game over" wah
  defeat: (ac) => {
    [330, 294, 247, 185].forEach((f, i) =>
      wobble(ac, {
        freq: f,
        type: "sawtooth",
        start: i * 0.15,
        dur: 0.24,
        gain: 0.11,
        lfoHz: 6,
        lfoDepth: 7,
        sweepTo: f * 0.93,
      }),
    );
  },
  // slip away: a hurried, tense retreat — a low dash-away whoosh and a quick
  // *descending* minor scurry (nervous footsteps fading into the dark), not
  // a cheerful rising run.
  flee: (ac) => {
    whoosh(ac, { dur: 0.26, gain: 0.08, fromFreq: 2400, toFreq: 400, q: 1 });
    [523, 440, 349, 294].forEach((f, i) =>
      tone(ac, { freq: f, type: "triangle", start: i * 0.05, dur: 0.055, gain: 0.08 }),
    );
  },
  // loot: the heft of found treasure — a low metallic "chunk" of gold, then
  // a mysterious minor-third chime in a mid register. Darker and heavier
  // than a bright arcade coin blip.
  loot: (ac) => {
    fm(ac, { freq: 320, ratio: 2.2, index: 5, type: "sawtooth", dur: 0.1, gain: 0.13 });
    noise(ac, { dur: 0.05, gain: 0.05, filter: 900 });
    fm(ac, { freq: 622, ratio: 2, index: 3, type: "sine", start: 0.07, dur: 0.16, gain: 0.1 }); // D#5
    fm(ac, { freq: 740, ratio: 2, index: 3, type: "sine", start: 0.13, dur: 0.26, gain: 0.1 }); // F#5 (minor 3rd)
  },
  // level up: a heroic E-minor ascent on brass-like sawtooth over an E root
  // drone, resolving to a held octave with an open-fifth pad and a single
  // shimmering mote to mark the growth. Epic and modal, not a 1-up jingle.
  levelUp: (ac) => {
    tone(ac, { freq: 165, type: "triangle", dur: 1.1, gain: 0.08 }); // E3 root drone
    melody(ac, [
      { f: 247, at: 0, dur: 0.12, type: "sawtooth", gain: 0.1 }, // B3
      { f: 330, at: 0.12, dur: 0.12, type: "sawtooth", gain: 0.1 }, // E4
      { f: 392, at: 0.24, dur: 0.12, type: "sawtooth", gain: 0.11 }, // G4 (minor 3rd)
      { f: 494, at: 0.36, dur: 0.12, type: "sawtooth", gain: 0.11 }, // B4
      { f: 659, at: 0.48, dur: 0.5, type: "sawtooth", gain: 0.12 }, // E5 (held)
    ]);
    tone(ac, { freq: 330, type: "triangle", start: 0.48, dur: 0.5, gain: 0.06 }); // E4
    tone(ac, { freq: 494, type: "triangle", start: 0.48, dur: 0.5, gain: 0.05 }); // B4 (fifth)
    fm(ac, { freq: 1319, ratio: 2.6, index: 4, type: "sine", start: 0.5, dur: 0.4, gain: 0.05 });
  },
  // battle begins: a grim war-horn call — a low sub rumble and a heavy
  // opening thud under two low sawtooth horn blasts a martial fourth apart,
  // the second sagging slightly for menace. Ominous, not a chirpy alarm.
  battleStart: (ac) => {
    wobble(ac, { freq: 82, type: "sawtooth", dur: 0.5, gain: 0.11, lfoHz: 7, lfoDepth: 10 });
    noise(ac, { dur: 0.12, gain: 0.05, filter: 300 });
    tone(ac, { freq: 165, type: "sawtooth", start: 0.05, dur: 0.2, gain: 0.12 }); // E3
    tone(ac, { freq: 220, type: "sawtooth", start: 0.24, dur: 0.3, gain: 0.12, sweepTo: 208 }); // A3, sagging
  },
  // new monster: an ominous descending three-note motif, then a low
  // guttural growl + subterranean rumble under the final note
  monster: (ac) => {
    melody(ac, [
      { f: 233, at: 0, dur: 0.14, type: "sawtooth", gain: 0.12 },
      { f: 220, at: 0.16, dur: 0.14, type: "sawtooth", gain: 0.12 },
      { f: 165, at: 0.32, dur: 0.34, type: "sawtooth", gain: 0.13 },
    ]);
    wobble(ac, { freq: 120, type: "sawtooth", start: 0.32, dur: 0.42, gain: 0.11, lfoHz: 17, lfoDepth: 24, sweepTo: 70 });
    noise(ac, { start: 0.34, dur: 0.34, gain: 0.04, filter: 220 });
  },
};

// Play a sound by name. No-op when muted, on the server, or when the
// browser has no Web Audio.
export function playSfx(name: SfxName) {
  bindUnlock();
  if (!isSoundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  try {
    SOUNDS[name](ac);
  } catch {
    // never let audio break gameplay
  }
}
