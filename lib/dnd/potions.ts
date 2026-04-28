import type { Potion } from "@/lib/game/types";

export type PotionDef = {
  baseId:
    | "potion-of-healing"
    | "greater-healing"
    | "superior-healing"
    | "supreme-healing";
  name: string;
  healDice: string;
  rarity: Potion["rarity"];
};

export const POTIONS: readonly PotionDef[] = [
  { baseId: "potion-of-healing", name: "Potion of Healing", healDice: "2d4+2", rarity: "common" },
  { baseId: "greater-healing", name: "Potion of Greater Healing", healDice: "4d4+4", rarity: "uncommon" },
  { baseId: "superior-healing", name: "Potion of Superior Healing", healDice: "8d4+8", rarity: "rare" },
  { baseId: "supreme-healing", name: "Potion of Supreme Healing", healDice: "10d4+20", rarity: "very-rare" },
];

export const potionsByBaseId: Record<string, PotionDef> = POTIONS.reduce(
  (acc, def) => {
    acc[def.baseId] = def;
    return acc;
  },
  {} as Record<string, PotionDef>,
);

export function mintPotion(def: PotionDef): Potion {
  return {
    kind: "potion",
    id: crypto.randomUUID(),
    baseId: def.baseId,
    name: def.name,
    healDice: def.healDice,
    rarity: def.rarity,
  };
}
