import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/game/types";

const COLLAPSED_COUNT = 2;

export function MobileCombatLog({
  turns,
  expanded,
  onToggle,
  className,
}: {
  turns: Turn[];
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  className?: string;
}) {
  const visible = expanded ? turns : turns.slice(0, COLLAPSED_COUNT);
  const canExpand = turns.length > COLLAPSED_COUNT;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3 md:hidden",
        className,
      )}
    >
      {turns.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          The arena is silent... for now.
        </p>
      ) : expanded ? (
        <ScrollArea className="h-64">
          <ul className="space-y-1.5 pr-2">
            {visible.map((turn) => (
              <TurnLine key={turn.id} turn={turn} />
            ))}
          </ul>
        </ScrollArea>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((turn) => (
            <TurnLine key={turn.id} turn={turn} />
          ))}
        </ul>
      )}
      {canExpand ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onToggle(!expanded)}
        >
          {expanded ? "COLLAPSE LOG" : `SHOW ALL (${turns.length})`}
        </Button>
      ) : null}
    </div>
  );
}

function TurnLine({ turn }: { turn: Turn }) {
  return (
    <li
      className={cn(
        "rounded-md px-3 py-1.5 font-mono text-sm font-semibold",
        turn.kind === "levelup"
          ? "border-2 border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
          : turn.kind === "loot"
            ? "border-2 border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
            : turn.kind === "crit"
              ? "border-2 border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
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
  );
}
