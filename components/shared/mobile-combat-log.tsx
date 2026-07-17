import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { PanelLabel } from "@/components/shared/panel-label";
import { TurnLine } from "@/components/shared/turn-line";
import { cn } from "@/lib/utils";
import type { Turn } from "@/lib/game/types";

const COLLAPSED_COUNT = 2;

export function MobileCombatLog({
  turns,
  expanded,
  onToggle,
  className,
  emptyMessage = "The arena is silent... for now.",
}: {
  turns: Turn[];
  expanded: boolean;
  onToggle: (expanded: boolean) => void;
  className?: string;
  emptyMessage?: string;
}) {
  const visible = expanded ? turns : turns.slice(0, COLLAPSED_COUNT);
  const canExpand = turns.length > COLLAPSED_COUNT;

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-md border-2 border-foreground bg-card p-3 md:hidden",
        className,
      )}
    >
      <PanelLabel>Logs</PanelLabel>
      {turns.length === 0 ? (
        <p className="text-center text-sm">{emptyMessage}</p>
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
          className="h-auto min-h-12 w-full"
          onClick={() => onToggle(!expanded)}
        >
          {expanded ? "COLLAPSE LOG" : `SHOW ALL (${turns.length})`}
        </Button>
      ) : null}
    </div>
  );
}
