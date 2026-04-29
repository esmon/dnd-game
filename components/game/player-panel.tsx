import { HealthBar } from "@/components/game/health-bar";
import { StatRow } from "@/components/game/stat-row";
import { findClass } from "@/lib/dnd/classes";
import { formatDrvi, playerAC } from "@/lib/dnd/combat";
import { MAX_LEVEL, xpThresholdForLevel } from "@/lib/dnd/leveling";
import { RACES } from "@/lib/dnd/races";
import { shakeIntensity, useShakeOnNonce } from "@/lib/use-shake-on-nonce";
import { cn } from "@/lib/utils";
import type { Player } from "@/lib/game/types";

export function PlayerPanel({
  player,
  attackNonce = 0,
  attackDamage = 0,
  className,
}: {
  player: Player;
  attackNonce?: number;
  attackDamage?: number;
  className?: string;
}) {
  // Shake when the monster lands an attack (incoming hit feedback).
  // Intensity scales with damage / max HP.
  const shakeRef = useShakeOnNonce(
    attackNonce,
    shakeIntensity(attackDamage, player.maxHealth),
  );
  const atMax = player.level >= MAX_LEVEL;
  const currentFloor = xpThresholdForLevel(player.level);
  const nextThreshold = atMax ? null : xpThresholdForLevel(player.level + 1);
  const xpPct =
    !atMax && nextThreshold
      ? Math.max(
          0,
          Math.min(
            100,
            ((player.xp - currentFloor) / (nextThreshold - currentFloor)) * 100,
          ),
        )
      : 100;
  const race = RACES.find((r) => r.id === player.raceId);
  const klass = findClass(player.classId);
  const ac = playerAC(klass ?? null, player.abilityScores);
  const drviParts = formatDrvi(
    race?.damageResistances,
    race?.damageVulnerabilities,
    race?.damageImmunities,
  );

  return (
    <div
      ref={shakeRef}
      className={cn(
        "flex h-full flex-col gap-1 rounded-md border-2 border-zinc-900 bg-card px-4 py-3 font-mono",
        className,
      )}
    >
      <p className="truncate text-center text-sm font-bold uppercase tracking-widest">
        {player.name}
      </p>
      {race || klass ? (
        <p className="mb-2 text-center text-xs uppercase tracking-widest text-muted-foreground">
          <span className="block md:inline">
            {race?.name ?? player.raceId}
          </span>
          <span className="hidden md:inline"> · </span>
          <span className="block md:inline">
            {klass?.name ?? player.classId}
          </span>
        </p>
      ) : null}
      <StatRow label="HP" value={`${player.health}/${player.maxHealth}`} />
      <HealthBar
        current={player.health}
        max={player.maxHealth}
        className="h-2"
      />
      <StatRow label="AC" value={String(ac)} />
      <StatRow label="LV" value={String(player.level)} />
      <StatRow
        label="XP"
        value={atMax ? "MAX" : `${player.xp}/${nextThreshold}`}
      />
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10">
        <div
          className="h-full bg-amber-500 transition-[width] duration-500"
          style={{ width: `${xpPct}%` }}
        />
      </div>
      {drviParts.length > 0 ? (
        <p className="mt-2 text-center text-[10px] tracking-wide text-muted-foreground">
          {drviParts.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

