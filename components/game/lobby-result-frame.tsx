import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Shared frame for the lobby's middle-column result panels (DefeatPanel,
// VictoryPanel). Keeps border/padding/font/center-vertical layout in one
// place; callers add variant-specific layout (e.g. items-center for the
// defeat content, full-width loot rows for victory) via `className`.
export function LobbyResultFrame({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-center rounded-md border-2 border-zinc-900 bg-card px-4 py-6 font-mono",
        className,
      )}
    >
      {children}
    </div>
  );
}
