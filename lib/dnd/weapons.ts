import type { Weapon } from "@/lib/game/types";

export type WeaponDef = {
  baseId: string;
  name: string;
  damage: string;
  tier: 1 | 2 | 3 | 4;
};

// SRD weapon catalog. Greatclub is technically 1d8 in PHB but listed in the
// "simple" group; we keep it in tier 3 alongside other 1d8 weapons.
export const WEAPONS: readonly WeaponDef[] = [
  { baseId: "club", name: "Club", damage: "1d4", tier: 1 },
  { baseId: "dagger", name: "Dagger", damage: "1d4", tier: 1 },
  { baseId: "sickle", name: "Sickle", damage: "1d4", tier: 1 },
  { baseId: "light-hammer", name: "Light Hammer", damage: "1d4", tier: 1 },
  { baseId: "whip", name: "Whip", damage: "1d4", tier: 1 },
  { baseId: "dart", name: "Dart", damage: "1d4", tier: 1 },

  { baseId: "mace", name: "Mace", damage: "1d6", tier: 2 },
  { baseId: "quarterstaff", name: "Quarterstaff", damage: "1d6", tier: 2 },
  { baseId: "spear", name: "Spear", damage: "1d6", tier: 2 },
  { baseId: "handaxe", name: "Handaxe", damage: "1d6", tier: 2 },
  { baseId: "shortsword", name: "Shortsword", damage: "1d6", tier: 2 },
  { baseId: "scimitar", name: "Scimitar", damage: "1d6", tier: 2 },
  { baseId: "trident", name: "Trident", damage: "1d6", tier: 2 },
  { baseId: "hand-crossbow", name: "Hand Crossbow", damage: "1d6", tier: 2 },
  { baseId: "shortbow", name: "Shortbow", damage: "1d6", tier: 2 },
  { baseId: "sling", name: "Sling", damage: "1d4", tier: 2 },
  { baseId: "javelin", name: "Javelin", damage: "1d6", tier: 2 },

  { baseId: "greatclub", name: "Greatclub", damage: "1d8", tier: 3 },
  { baseId: "light-crossbow", name: "Light Crossbow", damage: "1d8", tier: 3 },
  { baseId: "battleaxe", name: "Battleaxe", damage: "1d8", tier: 3 },
  { baseId: "flail", name: "Flail", damage: "1d8", tier: 3 },
  { baseId: "longsword", name: "Longsword", damage: "1d8", tier: 3 },
  { baseId: "morningstar", name: "Morningstar", damage: "1d8", tier: 3 },
  { baseId: "rapier", name: "Rapier", damage: "1d8", tier: 3 },
  { baseId: "war-pick", name: "War Pick", damage: "1d8", tier: 3 },
  { baseId: "warhammer", name: "Warhammer", damage: "1d8", tier: 3 },
  { baseId: "longbow", name: "Longbow", damage: "1d8", tier: 3 },

  { baseId: "glaive", name: "Glaive", damage: "1d10", tier: 4 },
  { baseId: "halberd", name: "Halberd", damage: "1d10", tier: 4 },
  { baseId: "pike", name: "Pike", damage: "1d10", tier: 4 },
  { baseId: "heavy-crossbow", name: "Heavy Crossbow", damage: "1d10", tier: 4 },
  { baseId: "lance", name: "Lance", damage: "1d12", tier: 4 },
  { baseId: "greataxe", name: "Greataxe", damage: "1d12", tier: 4 },
  { baseId: "greatsword", name: "Greatsword", damage: "2d6", tier: 4 },
  { baseId: "maul", name: "Maul", damage: "2d6", tier: 4 },
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
): { name: string; damage: string } {
  if (bonus === 0) {
    return { name: def.name, damage: def.damage };
  }
  return {
    name: `${def.name} +${bonus}`,
    damage: `${def.damage}+${bonus}`,
  };
}

export function mintWeapon(def: WeaponDef, bonus: WeaponBonus): Weapon {
  const { name, damage } = applyBonus(def, bonus);
  return {
    id: crypto.randomUUID(),
    baseId: def.baseId,
    name,
    damage,
    bonus,
  };
}
