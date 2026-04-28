import { rollDice } from "@/lib/game/dice";

export function weaponAttackBonus(classId: string, level: number): number {
  const id = classId.toLowerCase();
  if (id === "barbarian") {
    if (level >= 16) return 4;
    if (level >= 9) return 3;
    return 2;
  }
  if (id === "monk") {
    if (level >= 17) return 4;
    if (level >= 11) return 3;
    if (level >= 5) return 2;
    return 1;
  }
  return 0;
}

export function weaponAttackBonusDice(classId: string, level: number): string {
  if (classId.toLowerCase() !== "rogue") return "";
  const dice = Math.max(1, Math.ceil(level / 2));
  return `${dice}d6`;
}

export function weaponAttackMultiplier(classId: string, level: number): number {
  if (classId.toLowerCase() !== "fighter") return 1;
  if (level >= 20) return 4;
  if (level >= 11) return 3;
  if (level >= 5) return 2;
  return 1;
}

export function computeWeaponAttackDamage(
  classId: string,
  level: number,
  weaponDice: string,
): number {
  const base = rollDice(weaponDice);
  const bonusDice = weaponAttackBonusDice(classId, level);
  const extra = bonusDice ? rollDice(bonusDice) : 0;
  const flat = weaponAttackBonus(classId, level);
  const multiplier = weaponAttackMultiplier(classId, level);
  return Math.max(0, (base + extra + flat) * multiplier);
}

// Short label describing the active class feature affecting weapon attacks,
// for the combat log. Returns "" when no class feature is active.
export function classFeatureLabel(classId: string, level: number): string {
  const id = classId.toLowerCase();
  if (id === "barbarian") return `Rage +${weaponAttackBonus(id, level)}`;
  if (id === "monk") return `Martial Arts +${weaponAttackBonus(id, level)}`;
  if (id === "rogue") return `Sneak Attack +${weaponAttackBonusDice(id, level)}`;
  if (id === "fighter") {
    const m = weaponAttackMultiplier(id, level);
    return m > 1 ? `Extra Attack ×${m}` : "";
  }
  return "";
}
