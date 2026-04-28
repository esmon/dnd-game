import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/game/types";

export function CombatLog({ turns }: { turns: Turn[] }) {
  return (
    <ScrollArea className="h-80 w-full rounded-md border-2 border-zinc-900 bg-card p-3">
      {turns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          The arena is silent... for now.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {turns.map((turn) => (
            <li
              key={turn.id}
              className={cn(
                "rounded-md px-3 py-1.5 font-mono text-sm font-semibold",
                turn.kind === "levelup"
                  ? "border-2 border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                  : turn.kind === "loot"
                    ? "border-2 border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                    : turn.isPlayer
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                      : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
              )}
            >
              {turn.kind === "levelup"
                ? `LEVEL UP — ${turn.text}`
                : turn.kind === "loot"
                  ? `LOOT — ${turn.text}`
                  : turn.text}
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}
