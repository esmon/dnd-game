"use client";

import { useEffect, useSyncExternalStore } from "react";

// Tiny module-level store so battle screens can request the global
// AuthButton hide itself without a context provider higher up the
// tree (layout.tsx is a server component, so wrapping AuthButton in
// a context is awkward). Counter, not a boolean: nested callers
// (e.g. solo and coop battle screens both mounted via Fast Refresh)
// can each request hide and the button only shows when no one is
// holding a request.

let hideCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return hideCount;
}

// SSR snapshot must be stable; the button always renders on the
// server (count=0) and the hide kicks in after hydration.
function getServerSnapshot(): number {
  return 0;
}

export function useAuthButtonHidden(): boolean {
  return (
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) > 0
  );
}

// Pass `true` to hide the AuthButton while this component is mounted.
// Call unconditionally — the boolean controls whether the effect
// actually increments the counter. Pairs cleanly with status flags
// like `status === "fighting"`.
export function useHideAuthButton(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    hideCount++;
    emit();
    return () => {
      hideCount--;
      emit();
    };
  }, [active]);
}
