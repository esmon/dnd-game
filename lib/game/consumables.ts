import type { Consumable } from "@/lib/game/types";

export type ConsumableGroup = {
  key: string;
  ids: string[];
  representative: Consumable;
};

// Collapse stacks of identical consumables (same scroll spell+level, or
// same potion baseId) so the inventory and command panel can show a single
// row with a count instead of N duplicates.
export function groupConsumables(consumables: Consumable[]): ConsumableGroup[] {
  const groups = new Map<string, ConsumableGroup>();
  for (const c of consumables) {
    const key =
      c.kind === "scroll"
        ? `scroll:${c.spellName}:${c.spellLevel}`
        : `potion:${c.baseId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(c.id);
    } else {
      groups.set(key, { key, ids: [c.id], representative: c });
    }
  }
  return Array.from(groups.values());
}
