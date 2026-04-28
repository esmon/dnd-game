import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/game/types";

export function CombatLog({ turns }: { turns: Turn[] }) {
  return (
    <ScrollArea className="h-80 w-full rounded-xl border bg-card p-3 ring-1 ring-foreground/10">
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
                "rounded-md px-3 py-1.5 text-sm font-semibold",
                turn.isPlayer
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                  : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
              )}
            >
              {turn.text}
            </li>
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}
