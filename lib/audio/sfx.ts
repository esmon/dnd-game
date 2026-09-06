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
  | "spell"
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
  osc.connect(g).connect(ac.destination);
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
  carrier.connect(g).connect(ac.destination);
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
  osc.connect(g).connect(ac.destination);
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
  src.connect(bp).connect(g).connect(ac.destination);
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
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
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
  // sword clang: inharmonic metallic FM hit + a swing "chh"
  attack: (ac) => {
    noise(ac, { dur: 0.04, gain: 0.06, filter: 3200 });
    fm(ac, { freq: 760, ratio: 1.6, index: 6, type: "sawtooth", dur: 0.11, gain: 0.14 });
  },
  // critical: two rising metallic clangs — bigger, brighter
  crit: (ac) => {
    noise(ac, { dur: 0.05, gain: 0.08, filter: 4200 });
    fm(ac, { freq: 820, ratio: 1.5, index: 7, type: "sawtooth", dur: 0.1, gain: 0.14 });
    fm(ac, { freq: 1320, ratio: 2, index: 6, type: "sawtooth", start: 0.09, dur: 0.18, gain: 0.14 });
  },
  // miss: an airy filtered-noise swoosh, no tone
  miss: (ac) => {
    whoosh(ac, { dur: 0.24, gain: 0.11, fromFreq: 5200, toFreq: 480, q: 0.7 });
  },
  // spellcast: a rising FM bell + a high shimmering vibrato sparkle
  spell: (ac) => {
    fm(ac, { freq: 520, ratio: 3.5, index: 4, type: "sine", dur: 0.32, gain: 0.11, sweepTo: 1040 });
    wobble(ac, { freq: 1250, type: "triangle", start: 0.05, dur: 0.28, gain: 0.05, lfoHz: 24, lfoDepth: 30 });
  },
  // heal: three warm, soft ascending bells
  heal: (ac) => {
    [440, 587, 784].forEach((f, i) =>
      fm(ac, { freq: f, ratio: 2, index: 1.5, type: "sine", start: i * 0.09, dur: 0.34, gain: 0.1 }),
    );
  },
  // taking a hit: a low downward buzzy "oof" + a dull thump
  hurt: (ac) => {
    tone(ac, { freq: 220, type: "sawtooth", dur: 0.16, gain: 0.14, sweepTo: 80 });
    noise(ac, { dur: 0.07, gain: 0.05, filter: 380 });
  },
  // victory: an original rising fanfare melody landing on a held chord
  victory: (ac) => {
    melody(ac, [
      { f: 523, at: 0, dur: 0.12 },
      { f: 659, at: 0.12, dur: 0.12 },
      { f: 784, at: 0.24, dur: 0.12 },
      { f: 1047, at: 0.36, dur: 0.14 },
      { f: 784, at: 0.52, dur: 0.1 },
      { f: 1047, at: 0.62, dur: 0.42 },
    ]);
    [523, 659].forEach((f) =>
      tone(ac, { freq: f, type: "triangle", start: 0.62, dur: 0.42, gain: 0.06 }),
    );
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
  // slip away: a quick rising swoosh + light scampering blips
  flee: (ac) => {
    whoosh(ac, { dur: 0.2, gain: 0.06, fromFreq: 500, toFreq: 3200, q: 1 });
    [660, 880, 1100].forEach((f, i) =>
      tone(ac, { freq: f, type: "triangle", start: i * 0.05, dur: 0.05, gain: 0.07 }),
    );
  },
  // loot: a bright two-note metallic coin "cha-ching"
  loot: (ac) => {
    fm(ac, { freq: 1180, ratio: 2, index: 3, type: "square", dur: 0.07, gain: 0.11 });
    fm(ac, { freq: 1560, ratio: 2, index: 3, type: "square", start: 0.07, dur: 0.16, gain: 0.11 });
  },
  // level up: an original ascending run resolving on a held high chord
  levelUp: (ac) => {
    melody(ac, [
      { f: 392, at: 0, dur: 0.1 },
      { f: 523, at: 0.1, dur: 0.1 },
      { f: 659, at: 0.2, dur: 0.1 },
      { f: 784, at: 0.3, dur: 0.1 },
      { f: 880, at: 0.4, dur: 0.1 },
      { f: 1047, at: 0.5, dur: 0.4 },
    ]);
    [659, 784].forEach((f) =>
      tone(ac, { freq: f, type: "triangle", start: 0.5, dur: 0.4, gain: 0.06 }),
    );
  },
  // battle begins: a low ominous rumble under a rising two-tone alarm
  battleStart: (ac) => {
    wobble(ac, { freq: 90, type: "sawtooth", dur: 0.36, gain: 0.1, lfoHz: 8, lfoDepth: 12 });
    tone(ac, { freq: 440, type: "square", start: 0.06, dur: 0.12, gain: 0.09, sweepTo: 660 });
    tone(ac, { freq: 660, type: "square", start: 0.2, dur: 0.16, gain: 0.1, sweepTo: 880 });
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
