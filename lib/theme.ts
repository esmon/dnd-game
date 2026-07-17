// Palette themes. Selected via `data-theme` on <html>; the token
// values live in app/globals.css. "classic" is the default (no
// attribute needed) so it maps to the bare :root block.
export const THEMES = [
  { id: "classic", label: "Classic" },
  { id: "prism", label: "Prism" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_STORAGE_KEY = "dnd-theme";
export const DEFAULT_THEME: ThemeId = "classic";

export function isThemeId(v: unknown): v is ThemeId {
  return THEMES.some((t) => t.id === v);
}

// Tiny external store so the switcher can read the DOM-held theme via
// useSyncExternalStore (correct across SSR/hydration, no setState in an
// effect). applyTheme notifies subscribers after mutating the DOM.
const listeners = new Set<() => void>();

export function subscribeTheme(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// The current theme from the DOM (set pre-hydration by the no-flash
// script in the layout), falling back to the default. Returns a
// primitive so useSyncExternalStore's snapshot is stable by value.
export function currentTheme(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const v = document.documentElement.dataset.theme;
  return isThemeId(v) ? v : DEFAULT_THEME;
}

// SSR snapshot — the server can't know localStorage, so it renders the
// default; the client reconciles from the DOM on hydration.
export function serverTheme(): ThemeId {
  return DEFAULT_THEME;
}

// Apply a theme to the document + persist it. Classic clears the
// attribute (it's the bare :root default) so the DOM stays clean.
export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === DEFAULT_THEME) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = id;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Private mode / storage blocked — theme still applies for the
    // session, just won't persist.
  }
  listeners.forEach((l) => l());
}
