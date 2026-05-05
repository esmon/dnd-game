import type { Armor, Potion, Scroll, Weapon } from "@/lib/game/types";
import {
  armorByTier,
  mintArmor,
  type ArmorBonus,
  type ArmorDef,
} from "@/lib/dnd/armor";
import {
  mintWeapon,
  weaponsByTier,
  type WeaponBonus,
  type WeaponDef,
} from "@/lib/dnd/weapons";
import { SPELLS, type SpellDef } from "@/lib/dnd/spells";
import { potionsByBaseId, type PotionDef } from "@/lib/dnd/potions";

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
    if (r < 0.15) bonus = 2;
    else if (r < 0.75) bonus = 1;
    else bonus = 0;
    return { tiers: [3, 4], bonus };
  }
  const r = Math.random();
  let bonus: WeaponBonus;
  if (r < 0.4) bonus = 1;
  else if (r < 0.8) bonus = 2;
  else bonus = 3;
  return { tiers: [4], bonus };
}

// Filter spell pool by spell-level band scaled to monster CR. Stronger
// monsters drop scrolls of higher-level spells.
function spellLevelBandForCr(cr: number): readonly number[] {
  if (cr <= 0.25) return [0, 1];
  if (cr <= 1) return [0, 1];
  if (cr <= 4) return [1, 2];
  if (cr <= 9) return [2, 3, 4];
  return [3, 4, 5, 6];
}

function pickSpell(cr: number): SpellDef | null {
  const allowed = spellLevelBandForCr(cr);
  const pool = SPELLS.filter((s) => allowed.includes(s.level));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function potionForCr(cr: number): PotionDef {
  if (cr <= 0.25) return potionsByBaseId["potion-of-healing"];
  if (cr <= 4) return potionsByBaseId["greater-healing"];
  if (cr <= 10) return potionsByBaseId["superior-healing"];
  return potionsByBaseId["supreme-healing"];
}

function rollWeapon(cr: number): Weapon | null {
  const { tiers, bonus } = pickByCr(cr);
  const def = pickFromTiers(tiers);
  if (!def) return null;
  return mintWeapon(def, bonus);
}

function rollScroll(cr: number): Scroll | null {
  const def = pickSpell(cr);
  if (!def) return null;
  return {
    kind: "scroll",
    id: crypto.randomUUID(),
    spellName: def.name,
    spellLevel: def.level,
    damage: def.damage,
    damageType: def.damageType,
  };
}

// Pick an armor definition + magic bonus matching the CR band.
// Body and shield are split: body armor follows the CR-banded tier
// pool (low CR → light, high CR → unlocks Plate); shields are
// rolled separately (~20% of armor drops) so they remain available
// at every CR — they live in tier 1 but every class benefits from
// a shield, and excluding them at high CR meant a Plate-wearing
// fighter could never find a Shield +1 / +2 to upgrade.
function pickArmorRoll(
  cr: number,
): { def: ArmorDef; bonus: ArmorBonus } | null {
  let bonus: ArmorBonus;
  if (cr <= 0.25) bonus = 0;
  else if (cr <= 1) bonus = Math.random() < 0.1 ? 1 : 0;
  else if (cr <= 4) bonus = Math.random() < 0.4 ? 1 : 0;
  else if (cr <= 9) {
    const r = Math.random();
    if (r < 0.15) bonus = 2;
    else if (r < 0.75) bonus = 1;
    else bonus = 0;
  } else {
    const r = Math.random();
    if (r < 0.4) bonus = 1;
    else if (r < 0.8) bonus = 2;
    else bonus = 3;
  }

  // 20% of the time, drop a shield (always-available); otherwise
  // roll body armor from the CR-banded tier pool.
  const isShieldRoll = Math.random() < 0.2;
  if (isShieldRoll) {
    const def = armorByTier[1].find((a) => a.category === "shield");
    if (def) return { def, bonus };
  }

  let bodyTiers: readonly Tier[];
  if (cr <= 0.25) bodyTiers = [1];
  else if (cr <= 1) bodyTiers = [1, 2];
  else if (cr <= 4) bodyTiers = [2, 3];
  else if (cr <= 9) bodyTiers = [3, 4];
  else bodyTiers = [4];
  const pool: ArmorDef[] = [];
  for (const t of bodyTiers) {
    for (const a of armorByTier[t]) {
      if (a.category !== "shield") pool.push(a);
    }
  }
  if (pool.length === 0) return null;
  const def = pool[Math.floor(Math.random() * pool.length)];
  return { def, bonus };
}

function rollArmor(cr: number): Armor | null {
  const roll = pickArmorRoll(cr);
  if (!roll) return null;
  return mintArmor(roll.def, roll.bonus);
}

function rollPotion(cr: number): Potion {
  const def = potionForCr(cr);
  return {
    kind: "potion",
    id: crypto.randomUUID(),
    baseId: def.baseId,
    name: def.name,
    healDice: def.healDice,
    rarity: def.rarity,
  };
}

export function rollLoot(monster: {
  challengeRating: number;
  xp: number;
}): Weapon | Scroll | Potion | Armor | null {
  if (Math.random() >= DROP_CHANCE) return null;
  const cr = monster.challengeRating;
  const r = Math.random();
  // Bands: 0–0.5 weapon, 0.5–0.7 armor, 0.7–0.85 scroll, 0.85–1 potion.
  // Armor is the rarest equipable category; gear matters less per
  // drop than weapons (you swap one piece, not a whole table) so
  // 20% strikes a balance between "feels possible" and "doesn't
  // flood the inventory."
  if (r < 0.5) {
    const w = rollWeapon(cr);
    if (w) return w;
    return rollArmor(cr) ?? rollScroll(cr) ?? rollPotion(cr);
  }
  if (r < 0.7) {
    const a = rollArmor(cr);
    if (a) return a;
    return rollScroll(cr) ?? rollPotion(cr);
  }
  if (r < 0.85) {
    const s = rollScroll(cr);
    if (s) return s;
    return rollPotion(cr);
  }
  return rollPotion(cr);
}
