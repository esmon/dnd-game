import { CharacterAvatar } from "@/components/shared/character-avatar";
import { HealthBar } from "@/components/shared/health-bar";
import { PanelLabel } from "@/components/shared/panel-label";
import { StatRow } from "@/components/arena/stat-row";
import { findClass } from "@/lib/dnd/classes";
import { formatDrvi, playerAC } from "@/lib/dnd/combat";
import { MAX_LEVEL, xpThresholdForLevel } from "@/lib/dnd/leveling";
import { RACES } from "@/lib/dnd/races";
import { useShakeOnNonce } from "@/lib/use-shake-on-nonce";
import { cn } from "@/lib/utils";
import type { Player } from "@/lib/game/types";

export function PlayerPanel({
  player,
  attackNonce = 0,
  className,
  onAvatarUpload,
}: {
  player: Player;
  attackNonce?: number;
  className?: string;
  // Wiring the avatar to a callback turns the slot into a clickable
  // "change avatar" affordance. Omit (e.g. mid-fight) for a read-only
  // display. Anonymous callers should also omit since they have no
  // Supabase row to attach an upload to.
  onAvatarUpload?: (file: File) => Promise<void>;
}) {
  // Shake when the monster lands an attack — fixed kick regardless
  // of damage so even a 1-HP nibble registers visibly.
  const shakeRef = useShakeOnNonce(attackNonce);
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
  const ac = playerAC(
    klass ?? null,
    player.abilityScores,
    player.equippedArmor ?? null,
    player.equippedShield ?? null,
  );
  // Inline the equipped armor + shield names next to the AC number
  // so the player can see what's contributing without a separate
  // row — keeps the panel from outgrowing the monster card.
  const armorBits = [
    player.equippedArmor?.name,
    player.equippedShield?.name,
  ].filter((n): n is string => typeof n === "string" && n.length > 0);
  const acValue =
    armorBits.length > 0 ? `${ac} (${armorBits.join(" + ")})` : String(ac);
  const drviParts = formatDrvi(
    race?.damageResistances,
    race?.damageVulnerabilities,
    race?.damageImmunities,
  );

  return (
    <div
      ref={shakeRef}
      className={cn(
        "relative flex h-full flex-col gap-1 rounded-md border-2 border-foreground bg-card px-4 py-3 font-mono",
        className,
      )}
    >
      <PanelLabel>{player.name}</PanelLabel>
      <div className="mx-auto mb-1">
        <CharacterAvatar
          src={player.avatar}
          name={player.name}
          size="lg"
          onUpload={onAvatarUpload}
        />
      </div>
      {race || klass ? (
        <p className="mb-2 text-center text-xs uppercase tracking-widest">
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
      <StatRow label="AC" value={acValue} />
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
        <div className="mt-2 flex flex-col gap-0.5 text-center text-[10px] tracking-wide">
          {drviParts.map((part, i) => (
            <p key={i}>{part}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

