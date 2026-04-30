import { useEffect, useRef } from "react";

// Base displacements (px) at intensity = 1. Caller-supplied intensity
// scales these — small damage = subtle shake, big damage = chunky shake.
const SHAKE_OFFSETS = [-5, 5, -2];

// Returns a ref to attach to an element. Each time `nonce` changes, the
// element fires a recoil shake via the Web Animations API, scaled by
// `intensity`. We use WAAPI rather than React state + a CSS class because
// the false→true flip can batch and skip the class removal, leaving the
// animation un-restarted.
export function useShakeOnNonce<T extends HTMLElement = HTMLDivElement>(
  nonce: number,
  intensity = 1,
  durationMs = 350,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(nonce);
  // Keep the latest intensity in a ref so the effect (which only re-runs
  // when `nonce` changes) reads the current scale at fire time.
  const intensityRef = useRef(intensity);
  intensityRef.current = intensity;
  useEffect(() => {
    if (nonce === prev.current) return;
    prev.current = nonce;
    const scale = intensityRef.current;
    const [a, b, c] = SHAKE_OFFSETS;
    ref.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: `translateX(${a * scale}px)`, offset: 0.25 },
        { transform: `translateX(${b * scale}px)`, offset: 0.55 },
        { transform: `translateX(${c * scale}px)`, offset: 0.8 },
        { transform: "translateX(0)" },
      ],
      { duration: durationMs, easing: "ease-in-out" },
    );
  }, [nonce, durationMs]);
  return ref;
}

// Map a damage number to a shake intensity multiplier. Tunes so a typical
// hit feels around 1.0 and huge hits don't get absurd. Misses (0 damage)
// still register as a small visual cue.
export function shakeIntensity(damage: number, maxHealth: number): number {
  if (maxHealth <= 0) return 1;
  const ratio = damage / maxHealth;
  const scaled = ratio * 5;
  return Math.max(0.3, Math.min(2, scaled || 0.3));
}
