import Image from "next/image";

import { HealthBar } from "@/components/shared/health-bar";
import { PanelLabel } from "@/components/shared/panel-label";
import { StatRow } from "@/components/arena/stat-row";
import { formatDrvi } from "@/lib/dnd/combat";
import { useShakeOnNonce } from "@/lib/use-shake-on-nonce";
import type { Monster } from "@/lib/game/types";

function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

export function MonsterCard({
  monster,
  attackNonce = 0,
}: {
  monster: Monster;
  attackNonce?: number;
}) {
  // Shake when the player swings/casts — fixed kick regardless of
  // damage so chip hits still register visibly.
  const shakeRef = useShakeOnNonce(attackNonce);

  const drviParts = formatDrvi(
    monster.damageResistances,
    monster.damageVulnerabilities,
    monster.damageImmunities,
  );
  return (
    <div
      ref={shakeRef}
      className="relative flex h-full flex-col gap-1 rounded-md border-2 border-foreground bg-card px-4 py-3 font-mono"
    >
      <PanelLabel>{monster.name}</PanelLabel>
      <div className="mx-auto mb-1 flex size-24 items-center justify-center overflow-hidden rounded-md bg-foreground">
        {monster.avatar ? (
          <Image
            src={monster.avatar}
            alt={monster.name}
            width={96}
            height={96}
            className="size-full object-contain"
            unoptimized
          />
        ) : (
          <span className="text-3xl text-white">??</span>
        )}
      </div>
      {/* Mirrors PlayerPanel's race · class subhead so the HP / AC /
          DMG rows below line up between the two cards. Two lines on
          mobile, one inline line on desktop. Falls back to a hidden
          placeholder for legacy snapshots so alignment still holds. */}
      {monster.size || monster.type ? (
        <p className="mb-2 text-center text-xs uppercase tracking-widest">
          <span className="block md:inline">{monster.size ?? ""}</span>
          {monster.size && monster.type ? (
            <span className="hidden md:inline"> · </span>
          ) : null}
          <span className="block md:inline">{monster.type ?? ""}</span>
        </p>
      ) : (
        <p
          aria-hidden
          className="invisible mb-2 text-center text-xs uppercase tracking-widest"
        >
          <span className="block md:inline">·</span>
          <span className="hidden md:inline"> · </span>
          <span className="block md:inline">·</span>
        </p>
      )}
      <StatRow label="HP" value={`${monster.health}/${monster.maxHealth}`} />
      <HealthBar
        current={monster.health}
        max={monster.maxHealth}
        className="h-2"
      />
      <StatRow label="CR" value={`${formatCr(monster.challengeRating)} · ${monster.xp} XP`} />
      <StatRow label="AC" value={String(monster.ac)} />
      <StatRow
        label="DMG"
        value={`${monster.damageDice} ${monster.damageType}`}
      />
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

