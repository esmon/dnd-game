import type { Weapon } from "@/lib/game/types";
import {
  mintWeapon,
  weaponsByTier,
  type WeaponBonus,
  type WeaponDef,
} from "@/lib/dnd/weapons";

const DROP_CHANCE = 0.3;

type Tier = 1 | 2 | 3 | 4;

function pickFromTiers(tiers: readonly Tier[]): WeaponDef | null {
  const pool: WeaponDef[] = [];
  for (const t of tiers) {
    pool.push(...weaponsByTier[t]);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickByCr(cr: number): { tiers: readonly Tier[]; bonus: WeaponBonus } {
  if (cr <= 0.25) {
    return { tiers: [1, 2], bonus: 0 };
  }
  if (cr <= 1) {
    const bonus: WeaponBonus = Math.random() < 0.1 ? 1 : 0;
    return { tiers: [2, 3], bonus };
  }
  if (cr <= 4) {
    const bonus: WeaponBonus = Math.random() < 0.4 ? 1 : 0;
    return { tiers: [3], bonus };
  }
  if (cr <= 9) {
    const r = Math.random();
    let bonus: WeaponBonus;
    // weighted toward +1; 15% chance of +2
    if (r < 0.15) bonus = 2;
    else if (r < 0.75) bonus = 1;
    else bonus = 0;
    return { tiers: [3, 4], bonus };
  }
  // CR >= 10: 40 / 40 / 20 split for +1 / +2 / +3
  const r = Math.random();
  let bonus: WeaponBonus;
  if (r < 0.4) bonus = 1;
  else if (r < 0.8) bonus = 2;
  else bonus = 3;
  return { tiers: [4], bonus };
}

export function rollLoot(monster: {
  challengeRating: number;
  xp: number;
}): Weapon | null {
  if (Math.random() >= DROP_CHANCE) return null;
  const { tiers, bonus } = pickByCr(monster.challengeRating);
  const def = pickFromTiers(tiers);
  if (!def) return null;
  return mintWeapon(def, bonus);
}
