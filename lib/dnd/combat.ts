import type { AbilityScores } from "@/lib/db/schema";
import type { Armor, Weapon } from "@/lib/game/types";
import type { DnDClass } from "@/lib/dnd/classes";
import { abilityModifier } from "@/lib/dnd/derive";
import { weaponsByBaseId } from "@/lib/dnd/weapons";

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

// Expected value of a dice notation like "8d6+4" or "100" — used by the UI
// to pre-rank attack options by likely damage against the current monster.
export function averageDamage(notation: string): number {
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (match) {
    const n = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    const mod = match[3] ? parseInt(match[3], 10) : 0;
    return (n * (1 + sides)) / 2 + mod;
  }
  const flat = Number(notation);
  return Number.isFinite(flat) ? flat : 0;
}

// Ranged → DEX, finesse → max(STR, DEX), else STR.
export function weaponAttackAbility(
  weapon: Weapon,
  scores: AbilityScores,
): "str" | "dex" {
  const def = weaponsByBaseId[weapon.baseId];
  if (def?.ranged) return "dex";
  if (def?.finesse) {
    return abilityModifier(scores.dex) > abilityModifier(scores.str)
      ? "dex"
      : "str";
  }
  return "str";
}

// Player AC. Layers, in PHB order:
//
//   1. Body armor (light / medium / heavy) wins over class Unarmored
//      Defense — wearing armor turns those features off in 5e.
//      Light: acBase + DEX. Medium: acBase + min(DEX, dexCap=2).
//      Heavy: acBase + min(DEX, dexCap=0). The dexCap on the row is
//      authoritative; the defaults are just a safety net for rows
//      that pre-date the field.
//   2. No body armor → Barbarian / Monk Unarmored Defense if the
//      class qualifies. Barbarian still gets the bonus while wielding
//      a shield (RAW); Monk loses Unarmored Defense the moment a
//      shield is wielded.
//   3. Otherwise the bare 10 + DEX baseline.
//   4. Shield adds a flat +2 on top of whatever the body-armor /
//      Unarmored Defense layer produced.
export function playerAC(
  klass: DnDClass | null,
  scores: AbilityScores,
  equippedArmor?: Armor | null,
  equippedShield?: Armor | null,
): number {
  const dexMod = abilityModifier(scores.dex);
  const conMod = abilityModifier(scores.con);
  const wisMod = abilityModifier(scores.wis);
  const id = klass?.id.toLowerCase() ?? "";
  const shieldBonus = equippedShield ? 2 : 0;

  if (equippedArmor && equippedArmor.category !== "shield") {
    // Wearing body armor — class Unarmored Defense doesn't apply.
    const dexAddition =
      equippedArmor.category === "light"
        ? dexMod
        : Math.min(
            dexMod,
            equippedArmor.dexCap ??
              (equippedArmor.category === "medium" ? 2 : 0),
          );
    return equippedArmor.acBase + dexAddition + shieldBonus;
  }

  // No body armor: try class Unarmored Defense, then bare AC.
  if (id === "barbarian") {
    // Barb Unarmored Defense works with shield.
    return 10 + dexMod + conMod + shieldBonus;
  }
  if (id === "monk") {
    // Monk Unarmored Defense requires no shield AND no armor.
    if (!equippedShield) return 10 + dexMod + wisMod;
    return 10 + dexMod + shieldBonus;
  }
  return 10 + dexMod + shieldBonus;
}

export type DamageMultiplier = {
  mult: 0 | 0.5 | 1 | 2;
  label: "" | "immune" | "resisted" | "vulnerable";
};

// Some dnd5eapi entries are full phrases like
// "bludgeoning, piercing, and slashing from nonmagical attacks". Any list
// entry that contains the damage type as a substring counts as a match.
function matchesType(type: string, list: string[]): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  for (const entry of list) {
    if (entry.toLowerCase().includes(t)) return true;
  }
  return false;
}

// Order of precedence: immunity > vulnerability > resistance.
export function damageMultiplier(
  type: string,
  resistances: string[],
  immunities: string[],
  vulnerabilities: string[],
): DamageMultiplier {
  if (matchesType(type, immunities)) return { mult: 0, label: "immune" };
  if (matchesType(type, vulnerabilities)) {
    return { mult: 2, label: "vulnerable" };
  }
  if (matchesType(type, resistances)) return { mult: 0.5, label: "resisted" };
  return { mult: 1, label: "" };
}

export type AttackResult = {
  d20: number;
  total: number;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
};

// 5e: nat 20 always crits/hits, nat 1 always fumbles/misses, regardless of
// modifier vs AC.
export function rollAttack(modifier: number, targetAC: number): AttackResult {
  const d20 = rollD20();
  const total = d20 + modifier;
  if (d20 === 20) {
    return { d20, total, hit: true, crit: true, fumble: false };
  }
  if (d20 === 1) {
    return { d20, total, hit: false, crit: false, fumble: true };
  }
  return {
    d20,
    total,
    hit: total >= targetAC,
    crit: false,
    fumble: false,
  };
}

export function applyDamageMultiplier(
  raw: number,
  m: DamageMultiplier,
): number {
  return Math.floor(raw * m.mult);
}

// Build the labeled DRVI parts shared by player and monster panels. Empty
// categories are skipped so callers can `.join(" · ")` directly.
export function formatDrvi(
  resistances: readonly string[] | undefined,
  vulnerabilities: readonly string[] | undefined,
  immunities: readonly string[] | undefined,
): string[] {
  const parts: string[] = [];
  if (resistances && resistances.length > 0) {
    parts.push(`Resists: ${resistances.join(", ")}`);
  }
  if (vulnerabilities && vulnerabilities.length > 0) {
    parts.push(`Vuln: ${vulnerabilities.join(", ")}`);
  }
  if (immunities && immunities.length > 0) {
    parts.push(`Imm: ${immunities.join(", ")}`);
  }
  return parts;
}
