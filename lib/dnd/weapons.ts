import type { DamageType, Weapon, WeaponCategory } from "@/lib/game/types";

export type WeaponDef = {
  baseId: string;
  name: string;
  damage: string;
  damageType: DamageType;
  finesse?: boolean;
  ranged?: boolean;
  tier: 1 | 2 | 3 | 4;
  // 5e proficiency tier. Required on definitions so the catalog is
  // canonical. Looked up at attack time to decide whether the
  // class's proficiency bonus applies.
  category: WeaponCategory;
  // Two-handed (PHB) — occupies both hands. The reducer blocks
  // shield + two-handed combos at equip time.
  twoHanded?: boolean;
};

// SRD weapon catalog. Damage types follow PHB; War Pick is piercing per PHB
// despite the name. Greatclub is technically 1d8 in PHB but listed in the
// "simple" group; we keep it in tier 3 alongside other 1d8 weapons.
// Categories follow PHB Weapons table — simple weapons are usable by every
// class; martial weapons require class proficiency for the PB on attacks.
export const WEAPONS: readonly WeaponDef[] = [
  { baseId: "club", name: "Club", damage: "1d4", damageType: "bludgeoning", tier: 1, category: "simple" },
  { baseId: "dagger", name: "Dagger", damage: "1d4", damageType: "piercing", finesse: true, tier: 1, category: "simple" },
  { baseId: "sickle", name: "Sickle", damage: "1d4", damageType: "slashing", tier: 1, category: "simple" },
  { baseId: "light-hammer", name: "Light Hammer", damage: "1d4", damageType: "bludgeoning", tier: 1, category: "simple" },
  { baseId: "whip", name: "Whip", damage: "1d4", damageType: "slashing", finesse: true, tier: 1, category: "martial" },
  { baseId: "dart", name: "Dart", damage: "1d4", damageType: "piercing", finesse: true, ranged: true, tier: 1, category: "simple" },

  { baseId: "mace", name: "Mace", damage: "1d6", damageType: "bludgeoning", tier: 2, category: "simple" },
  { baseId: "quarterstaff", name: "Quarterstaff", damage: "1d6", damageType: "bludgeoning", tier: 2, category: "simple" },
  { baseId: "spear", name: "Spear", damage: "1d6", damageType: "piercing", tier: 2, category: "simple" },
  { baseId: "handaxe", name: "Handaxe", damage: "1d6", damageType: "slashing", tier: 2, category: "simple" },
  { baseId: "shortsword", name: "Shortsword", damage: "1d6", damageType: "piercing", finesse: true, tier: 2, category: "martial" },
  { baseId: "scimitar", name: "Scimitar", damage: "1d6", damageType: "slashing", finesse: true, tier: 2, category: "martial" },
  { baseId: "trident", name: "Trident", damage: "1d6", damageType: "piercing", tier: 2, category: "martial" },
  { baseId: "hand-crossbow", name: "Hand Crossbow", damage: "1d6", damageType: "piercing", ranged: true, tier: 2, category: "martial" },
  { baseId: "shortbow", name: "Shortbow", damage: "1d6", damageType: "piercing", ranged: true, tier: 2, category: "simple" },
  { baseId: "sling", name: "Sling", damage: "1d4", damageType: "bludgeoning", ranged: true, tier: 2, category: "simple" },
  { baseId: "javelin", name: "Javelin", damage: "1d6", damageType: "piercing", tier: 2, category: "simple" },

  { baseId: "greatclub", name: "Greatclub", damage: "1d8", damageType: "bludgeoning", tier: 3, category: "simple" },
  { baseId: "light-crossbow", name: "Light Crossbow", damage: "1d8", damageType: "piercing", ranged: true, tier: 3, category: "simple" },
  { baseId: "battleaxe", name: "Battleaxe", damage: "1d8", damageType: "slashing", tier: 3, category: "martial" },
  { baseId: "flail", name: "Flail", damage: "1d8", damageType: "bludgeoning", tier: 3, category: "martial" },
  { baseId: "longsword", name: "Longsword", damage: "1d8", damageType: "slashing", tier: 3, category: "martial" },
  { baseId: "morningstar", name: "Morningstar", damage: "1d8", damageType: "piercing", tier: 3, category: "martial" },
  { baseId: "rapier", name: "Rapier", damage: "1d8", damageType: "piercing", finesse: true, tier: 3, category: "martial" },
  { baseId: "war-pick", name: "War Pick", damage: "1d8", damageType: "piercing", tier: 3, category: "martial" },
  { baseId: "warhammer", name: "Warhammer", damage: "1d8", damageType: "bludgeoning", tier: 3, category: "martial" },
  { baseId: "longbow", name: "Longbow", damage: "1d8", damageType: "piercing", ranged: true, tier: 3, category: "martial", twoHanded: true },

  { baseId: "glaive", name: "Glaive", damage: "1d10", damageType: "slashing", tier: 4, category: "martial", twoHanded: true },
  { baseId: "halberd", name: "Halberd", damage: "1d10", damageType: "slashing", tier: 4, category: "martial", twoHanded: true },
  { baseId: "pike", name: "Pike", damage: "1d10", damageType: "piercing", tier: 4, category: "martial", twoHanded: true },
  { baseId: "heavy-crossbow", name: "Heavy Crossbow", damage: "1d10", damageType: "piercing", ranged: true, tier: 4, category: "martial", twoHanded: true },
  { baseId: "lance", name: "Lance", damage: "1d12", damageType: "piercing", tier: 4, category: "martial", twoHanded: true },
  { baseId: "greataxe", name: "Greataxe", damage: "1d12", damageType: "slashing", tier: 4, category: "martial", twoHanded: true },
  { baseId: "greatsword", name: "Greatsword", damage: "2d6", damageType: "slashing", tier: 4, category: "martial", twoHanded: true },
  { baseId: "maul", name: "Maul", damage: "2d6", damageType: "bludgeoning", tier: 4, category: "martial", twoHanded: true },
];

export const weaponsByBaseId: Record<string, WeaponDef> = WEAPONS.reduce(
  (acc, def) => {
    acc[def.baseId] = def;
    return acc;
  },
  {} as Record<string, WeaponDef>,
);

export const weaponsByTier: Record<1 | 2 | 3 | 4, readonly WeaponDef[]> = {
  1: WEAPONS.filter((w) => w.tier === 1),
  2: WEAPONS.filter((w) => w.tier === 2),
  3: WEAPONS.filter((w) => w.tier === 3),
  4: WEAPONS.filter((w) => w.tier === 4),
};

export type WeaponBonus = 0 | 1 | 2 | 3;

export function applyBonus(
  def: WeaponDef,
  bonus: WeaponBonus,
): { name: string; damage: string; damageType: DamageType } {
  if (bonus === 0) {
    return { name: def.name, damage: def.damage, damageType: def.damageType };
  }
  return {
    name: `${def.name} +${bonus}`,
    damage: `${def.damage}+${bonus}`,
    damageType: def.damageType,
  };
}

export function mintWeapon(def: WeaponDef, bonus: WeaponBonus): Weapon {
  const { name, damage, damageType } = applyBonus(def, bonus);
  return {
    id: crypto.randomUUID(),
    baseId: def.baseId,
    name,
    damage,
    bonus,
    damageType,
    category: def.category,
    twoHanded: def.twoHanded,
  };
}
