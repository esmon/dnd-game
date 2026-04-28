import { HealthBar } from "@/components/game/health-bar";
import { MAX_LEVEL, xpThresholdForLevel } from "@/lib/dnd/leveling";
import type { Player } from "@/lib/game/types";

export function PlayerPanel({ player }: { player: Player }) {
  const atMax = player.level >= MAX_LEVEL;
  const nextThreshold = atMax ? null : xpThresholdForLevel(player.level + 1);

  return (
    <div className="flex h-full flex-col gap-1 rounded-md border-2 border-zinc-900 bg-card px-4 py-3 font-mono">
      <p className="mb-2 truncate text-center text-sm font-bold uppercase tracking-widest">
        {player.name}
      </p>
      <StatRow label="LV" value={String(player.level)} />
      <StatRow label="HP" value={`${player.health}/${player.maxHealth}`} />
      <HealthBar
        current={player.health}
        max={player.maxHealth}
        className="h-2"
      />
      <StatRow
        label="XP"
        value={atMax ? "MAX" : `${player.xp}/${nextThreshold}`}
      />
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
