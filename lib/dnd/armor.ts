import type { Armor, ArmorCategory } from "@/lib/game/types";

export type ArmorDef = {
  baseId: string;
  name: string;
  category: ArmorCategory;
  acBase: number;
  // DEX cap added to AC when computing total. Light armor has no
  // cap (undefined), medium armor caps at 2, heavy armor blocks
  // DEX entirely (0). Shields don't apply DEX themselves.
  dexCap?: number;
  stealthDisadvantage?: boolean;
  // Heavy armor strength requirement (PHB). Worn under STR threshold
  // gives a 10ft speed penalty in 5e RAW; we don't model speed yet
  // but plumb the field so the catalog stays faithful.
  strRequirement?: number;
  // Loot drop tier — same scale as weapons. Higher tier drops
  // happen at higher CR encounters via the loot pool weighting.
  tier: 1 | 2 | 3 | 4;
};

// Curated 5e armor set — two pieces per category plus a shield.
// Skipping niche entries (Padded, Hide, Ring Mail, Splint) we don't
// need yet; easy to add later without reshuffling the schema.
export const ARMOR: readonly ArmorDef[] = [
  // Light: armor.acBase + DEX mod, no cap.
  { baseId: "leather", name: "Leather Armor", category: "light", acBase: 11, tier: 1 },
  { baseId: "studded-leather", name: "Studded Leather", category: "light", acBase: 12, tier: 2 },

  // Medium: armor.acBase + min(DEX mod, 2).
  { baseId: "chain-shirt", name: "Chain Shirt", category: "medium", acBase: 13, dexCap: 2, tier: 2 },
  { baseId: "half-plate", name: "Half Plate", category: "medium", acBase: 15, dexCap: 2, stealthDisadvantage: true, tier: 3 },

  // Heavy: armor.acBase only (DEX excluded).
  { baseId: "chain-mail", name: "Chain Mail", category: "heavy", acBase: 16, dexCap: 0, strRequirement: 13, stealthDisadvantage: true, tier: 3 },
  { baseId: "plate", name: "Plate Armor", category: "heavy", acBase: 18, dexCap: 0, strRequirement: 15, stealthDisadvantage: true, tier: 4 },

  // Shield: applies a flat +2 in playerAC; acBase is intentionally 0
  // since the bonus is composed at AC time, not on the row.
  { baseId: "shield", name: "Shield", category: "shield", acBase: 0, tier: 1 },
];

export const armorByBaseId: Record<string, ArmorDef> = ARMOR.reduce(
  (acc, def) => {
    acc[def.baseId] = def;
    return acc;
  },
  {} as Record<string, ArmorDef>,
);

export const armorByTier: Record<1 | 2 | 3 | 4, readonly ArmorDef[]> = {
  1: ARMOR.filter((a) => a.tier === 1),
  2: ARMOR.filter((a) => a.tier === 2),
  3: ARMOR.filter((a) => a.tier === 3),
  4: ARMOR.filter((a) => a.tier === 4),
};

// Mint a wearable Armor from a definition. Mirrors mintWeapon's
// shape so the loot pool can call either path with the same idea
// (catalog def → unique row with a fresh id).
export function mintArmor(def: ArmorDef): Armor {
  return {
    id: crypto.randomUUID(),
    baseId: def.baseId,
    name: def.name,
    category: def.category,
    acBase: def.acBase,
    dexCap: def.dexCap,
    stealthDisadvantage: def.stealthDisadvantage,
    strRequirement: def.strRequirement,
  };
}

// Helper to mint a starting armor / shield from a class's
// startingArmor field. Returns null when the class has no starting
// armor (Wizard / Sorcerer / Monk).
export function mintArmorByBaseId(baseId: string | undefined): Armor | null {
  if (!baseId) return null;
  const def = armorByBaseId[baseId];
  if (!def) return null;
  return mintArmor(def);
}
