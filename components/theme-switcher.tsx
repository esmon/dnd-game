"use client";

import { useSyncExternalStore } from "react";

import {
  applyTheme,
  currentTheme,
  serverTheme,
  subscribeTheme,
  THEMES,
  type ThemeId,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

// App-wide palette switcher. The active theme is set pre-hydration by
// the inline script in the layout (so no flash); this control reads it
// via an external store (correct across SSR/hydration) and changes it.
// Segmented style mirrors the in-app toggles (campaign picker, composer
// tabs).
export function ThemeSwitcher() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    serverTheme,
  );

  function choose(id: ThemeId) {
    applyTheme(id);
  }

  return (
    <div className="flex items-center gap-1 rounded-md border border-input bg-muted/30 p-0.5 font-mono text-xs uppercase tracking-widest">
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => choose(t.id)}
            aria-pressed={active}
            className={cn(
              // flex-1 so the options split the row evenly and fill it
              // — no trailing whitespace inside the menu.
              "flex-1 rounded-sm px-2.5 py-1 text-center transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
