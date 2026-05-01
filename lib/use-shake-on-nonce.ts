import { useEffect, useRef } from "react";

// Recoil shake offsets (px). One displacement table for every hit —
// damage-scaled shakes used to dampen low-damage hits down to a
// barely-visible jiggle, which read as "did anything happen?" The
// fixed shake is the same kick every time so the player always sees
// the cue clearly.
const SHAKE_OFFSETS = [-5, 5, -2];

// Returns a ref to attach to an element. Each time `nonce` changes, the
// element fires a recoil shake via the Web Animations API. We use WAAPI
// rather than React state + a CSS class because the false→true flip can
// batch and skip the class removal, leaving the animation un-restarted.
export function useShakeOnNonce<T extends HTMLElement = HTMLDivElement>(
  nonce: number,
  durationMs = 350,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const prev = useRef(nonce);
  useEffect(() => {
    if (nonce === prev.current) return;
    prev.current = nonce;
    const [a, b, c] = SHAKE_OFFSETS;
    ref.current?.animate(
      [
        { transform: "translateX(0)" },
        { transform: `translateX(${a}px)`, offset: 0.25 },
        { transform: `translateX(${b}px)`, offset: 0.55 },
        { transform: `translateX(${c}px)`, offset: 0.8 },
        { transform: "translateX(0)" },
      ],
      { duration: durationMs, easing: "ease-in-out" },
    );
  }, [nonce, durationMs]);
  return ref;
}
