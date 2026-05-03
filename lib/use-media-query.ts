"use client";

import { useEffect, useState } from "react";

// Lightweight matchMedia hook. Returns true once the query matches —
// SSR-safe (starts false, hydrates to the real value after mount).
// Use Tailwind's breakpoint values for the query string so the hook
// stays in sync with class-based responsive styling.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}
