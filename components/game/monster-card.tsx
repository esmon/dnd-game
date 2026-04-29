import Image from "next/image";

import { HealthBar } from "@/components/game/health-bar";
import type { Monster } from "@/lib/game/types";

function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

function formatList(values: string[]): string {
  return values.join(", ");
}

export function MonsterCard({ monster }: { monster: Monster }) {
  const drviParts: string[] = [];
  if (monster.damageResistances.length > 0) {
    drviParts.push(`Resists: ${formatList(monster.damageResistances)}`);
  }
  if (monster.damageVulnerabilities.length > 0) {
    drviParts.push(`Vuln: ${formatList(monster.damageVulnerabilities)}`);
  }
  if (monster.damageImmunities.length > 0) {
    drviParts.push(`Imm: ${formatList(monster.damageImmunities)}`);
  }
  return (
    <div className="flex h-full flex-col gap-1 rounded-md border-2 border-zinc-900 bg-card px-4 py-3 font-mono">
      <p className="mb-2 truncate text-center text-sm font-bold uppercase tracking-widest">
        {monster.name}
      </p>
      <div
        className="mx-auto mb-1 flex size-24 items-center justify-center overflow-hidden rounded-md"
        style={{
          background:
            "radial-gradient(circle, rgba(213,233,233,1) 0%, rgba(88,218,223,1) 100%)",
        }}
      >
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
          <span className="text-3xl">??</span>
        )}
      </div>
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
        <p className="mt-2 text-center text-[10px] tracking-wide text-muted-foreground">
          {drviParts.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
