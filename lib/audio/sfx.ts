// Procedural retro SFX via the Web Audio API — every sound is
// synthesized from oscillators + noise at call time, so there are no
// audio files to host and nothing copyrighted. Fits the game's 8-bit /
// mono aesthetic.
//
// Browsers block audio until a user gesture, so the AudioContext is
// created lazily and resumed on the first pointer/key event (and again
// whenever a sound plays from within a gesture). All of it is guarded
// for SSR.

export type SfxName =
  | "attack"
  | "crit"
  | "spell"
  | "heal"
  | "hurt"
  | "victory"
  | "defeat"
  | "flee"
  | "loot"
  | "levelUp";

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

// Resume the context on the first user gesture so effect-driven sounds
// (a won fight, a level-up) can play even though they don't originate
// from a click themselves.
function bindUnlock() {
  if (unlockBound || typeof window === "undefined") return;
  unlockBound = true;
  const unlock = () => void audio();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}

// ── synth primitives ───────────────────────────────────────────────
function tone(
  ac: AudioContext,
  opts: {
    freq: number;
    type?: OscillatorType;
    start?: number;
    dur?: number;
    gain?: number;
    sweepTo?: number;
  },
) {
  const { freq, type = "square", start = 0, dur = 0.1, gain = 0.12 } = opts;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.sweepTo) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, opts.sweepTo),
      t0 + dur,
    );
  }
  // quick attack, exponential decay — the classic blip envelope
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noiseBurst(
  ac: AudioContext,
  opts: { start?: number; dur?: number; gain?: number; filter?: number },
) {
  const { start = 0, dur = 0.08, gain = 0.08, filter = 1200 } = opts;
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

// ── the sounds ─────────────────────────────────────────────────────
const SOUNDS: Record<SfxName, (ac: AudioContext) => void> = {
  // sword swing: a short downward zap + a little impact noise
  attack: (ac) => {
    tone(ac, { freq: 240, type: "square", dur: 0.08, gain: 0.12, sweepTo: 120 });
    noiseBurst(ac, { start: 0.02, dur: 0.06, gain: 0.07, filter: 900 });
  },
  // crit: two stacked hits, brighter
  crit: (ac) => {
    tone(ac, { freq: 300, type: "square", dur: 0.07, gain: 0.13, sweepTo: 150 });
    tone(ac, { freq: 500, type: "square", start: 0.06, dur: 0.1, gain: 0.13, sweepTo: 260 });
    noiseBurst(ac, { start: 0.02, dur: 0.09, gain: 0.09, filter: 1600 });
  },
  // spellcast: a bright rising triangle arpeggio
  spell: (ac) => {
    [523, 659, 784].forEach((f, i) =>
      tone(ac, { freq: f, type: "triangle", start: i * 0.05, dur: 0.13, gain: 0.1 }),
    );
  },
  // heal / potion: soft warm rise
  heal: (ac) => {
    [440, 587, 740].forEach((f, i) =>
      tone(ac, { freq: f, type: "sine", start: i * 0.06, dur: 0.16, gain: 0.11 }),
    );
  },
  // taking a hit: a low sawtooth thud
  hurt: (ac) => {
    tone(ac, { freq: 180, type: "sawtooth", dur: 0.14, gain: 0.12, sweepTo: 70 });
    noiseBurst(ac, { dur: 0.05, gain: 0.05, filter: 500 });
  },
  // victory fanfare: rising major run
  victory: (ac) => {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(ac, { freq: f, type: "square", start: i * 0.1, dur: 0.18, gain: 0.12 }),
    );
  },
  // defeat: descending minor tones
  defeat: (ac) => {
    [392, 330, 262, 196].forEach((f, i) =>
      tone(ac, { freq: f, type: "sawtooth", start: i * 0.12, dur: 0.2, gain: 0.12 }),
    );
  },
  // slip away: two quick soft blips
  flee: (ac) => {
    tone(ac, { freq: 660, type: "triangle", dur: 0.06, gain: 0.09 });
    tone(ac, { freq: 440, type: "triangle", start: 0.07, dur: 0.1, gain: 0.09 });
  },
  // loot pickup: coin sparkle
  loot: (ac) => {
    tone(ac, { freq: 988, type: "square", dur: 0.05, gain: 0.1 });
    tone(ac, { freq: 1319, type: "square", start: 0.05, dur: 0.11, gain: 0.1 });
  },
  // level up: bright ascending run
  levelUp: (ac) => {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(ac, { freq: f, type: "square", start: i * 0.07, dur: 0.15, gain: 0.11 }),
    );
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
