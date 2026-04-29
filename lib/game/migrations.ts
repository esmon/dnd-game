// Bootstrap-time migration helpers. Older characters in Supabase / the
// localStorage cache may have weapons without a baseId or without a
// damageType (predating those fields), so we backfill from the SRD catalog
// before anything reads them.
import { WEAPONS, weaponsByBaseId } from "@/lib/dnd/weapons";
import type { Weapon } from "@/lib/game/types";

// Legacy weapons stored as { name, damage } only. Map by case-insensitive
// name to a SRD baseId; default to slashing if the name doesn't match.
export function legacyWeaponToWeapon(w: {
  name: string;
  damage: string;
}): Weapon {
  const match = WEAPONS.find(
    (def) => def.name.toLowerCase() === w.name.toLowerCase(),
  );
  return {
    id: crypto.randomUUID(),
    baseId: match?.baseId ?? "",
    name: w.name,
    damage: w.damage,
    bonus: 0,
    damageType: match?.damageType ?? "slashing",
  };
}

export function isFullyShapedWeapon(w: unknown): boolean {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.baseId === "string" &&
    typeof o.bonus === "number"
  );
}

// Pre-DRVI weapons exist on disk without a damageType field. Backfill from
// the catalog (or default to slashing) so all in-memory Weapons satisfy
// the type.
export function ensureDamageType(w: Weapon): Weapon {
  if (typeof w.damageType === "string" && w.damageType.length > 0) return w;
  const def = weaponsByBaseId[w.baseId];
  return { ...w, damageType: def?.damageType ?? "slashing" };
}

export function needsDamageTypeBackfill(weapons: Weapon[]): boolean {
  return weapons.some(
    (w) => typeof w.damageType !== "string" || w.damageType.length === 0,
  );
}
