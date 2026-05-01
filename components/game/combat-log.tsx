import { ScrollArea } from "@/components/ui/scroll-area";
import { PanelLabel } from "@/components/game/panel-label";
import { TurnLine } from "@/components/game/turn-line";
import type { Turn } from "@/lib/game/types";

export function CombatLog({ turns }: { turns: Turn[] }) {
  return (
    <div className="relative h-80 w-full rounded-md border-2 border-zinc-900 bg-card">
      <PanelLabel>Logs</PanelLabel>
      <ScrollArea className="h-full w-full p-3">
        {turns.length === 0 ? (
          <p className="text-center text-sm">
            The arena is silent... for now.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {turns.map((turn) => (
              <TurnLine key={turn.id} turn={turn} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
