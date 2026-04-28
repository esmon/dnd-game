import { Button } from "@/components/ui/button";
import { MAX_LEVEL, xpProgressInLevel } from "@/lib/dnd/leveling";
import type { Player } from "@/lib/game/types";

export function PlayerPanel({
  player,
  onOpenInventory,
}: {
  player: Player;
  onOpenInventory: () => void;
}) {
  const atMax = player.level >= MAX_LEVEL;
  const { inLevel, needed } = xpProgressInLevel(player.xp, player.level);

  return (
    <div className="flex h-full flex-col gap-1 rounded-md border-2 border-zinc-900 bg-card px-4 py-3 font-mono">
      <p className="mb-2 truncate text-center text-sm font-bold uppercase tracking-widest">
        {player.name}
      </p>
      <StatRow label="LV" value={String(player.level)} />
      <StatRow label="HP" value={`${player.health}/${player.maxHealth}`} />
      <StatRow
        label="XP"
        value={atMax ? "MAX" : `${inLevel}/${needed}`}
      />
      <Button
        size="sm"
        variant="outline"
        className="mt-3 w-full text-xs font-bold uppercase tracking-widest"
        onClick={onOpenInventory}
      >
        Inventory
      </Button>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
