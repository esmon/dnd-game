import type { Spell } from "@/lib/game/types";

export type SpellDef = {
  baseId: string;
  name: string;
  level: number;
  damage: string;
  damageType: string;
  school: string;
};

// SRD damage spells. We flatten multi-roll spells (Magic Missile, Scorching
// Ray, Ice Storm) to a single dice expression so combat resolution stays a
// single rollDice call.
export const SPELLS: readonly SpellDef[] = [
  { baseId: "fire-bolt", name: "Fire Bolt", level: 0, damage: "1d10", damageType: "fire", school: "evocation" },
  { baseId: "sacred-flame", name: "Sacred Flame", level: 0, damage: "1d8", damageType: "radiant", school: "evocation" },
  { baseId: "eldritch-blast", name: "Eldritch Blast", level: 0, damage: "1d10", damageType: "force", school: "evocation" },
  { baseId: "ray-of-frost", name: "Ray of Frost", level: 0, damage: "1d8", damageType: "cold", school: "evocation" },
  { baseId: "poison-spray", name: "Poison Spray", level: 0, damage: "1d12", damageType: "poison", school: "conjuration" },
  { baseId: "acid-splash", name: "Acid Splash", level: 0, damage: "1d6", damageType: "acid", school: "conjuration" },
  { baseId: "toll-the-dead", name: "Toll the Dead", level: 0, damage: "1d8", damageType: "necrotic", school: "necromancy" },

  { baseId: "magic-missile", name: "Magic Missile", level: 1, damage: "3d4+3", damageType: "force", school: "evocation" },
  { baseId: "burning-hands", name: "Burning Hands", level: 1, damage: "3d6", damageType: "fire", school: "evocation" },
  { baseId: "guiding-bolt", name: "Guiding Bolt", level: 1, damage: "4d6", damageType: "radiant", school: "evocation" },
  { baseId: "inflict-wounds", name: "Inflict Wounds", level: 1, damage: "3d10", damageType: "necrotic", school: "necromancy" },
  { baseId: "witch-bolt", name: "Witch Bolt", level: 1, damage: "1d12", damageType: "lightning", school: "evocation" },

  { baseId: "scorching-ray", name: "Scorching Ray", level: 2, damage: "6d6", damageType: "fire", school: "evocation" },
  { baseId: "shatter", name: "Shatter", level: 2, damage: "3d8", damageType: "thunder", school: "evocation" },
  { baseId: "flaming-sphere", name: "Flaming Sphere", level: 2, damage: "2d6", damageType: "fire", school: "conjuration" },

  { baseId: "fireball", name: "Fireball", level: 3, damage: "8d6", damageType: "fire", school: "evocation" },
  { baseId: "lightning-bolt", name: "Lightning Bolt", level: 3, damage: "8d6", damageType: "lightning", school: "evocation" },

  { baseId: "ice-storm", name: "Ice Storm", level: 4, damage: "4d6", damageType: "cold", school: "evocation" },

  { baseId: "cone-of-cold", name: "Cone of Cold", level: 5, damage: "8d8", damageType: "cold", school: "evocation" },
  { baseId: "flame-strike", name: "Flame Strike", level: 5, damage: "4d6", damageType: "fire", school: "evocation" },

  { baseId: "disintegrate", name: "Disintegrate", level: 6, damage: "10d6+40", damageType: "force", school: "transmutation" },
  { baseId: "chain-lightning", name: "Chain Lightning", level: 6, damage: "10d8", damageType: "lightning", school: "evocation" },

  { baseId: "finger-of-death", name: "Finger of Death", level: 7, damage: "7d8+30", damageType: "necrotic", school: "necromancy" },
  { baseId: "delayed-blast-fireball", name: "Delayed Blast Fireball", level: 7, damage: "12d6", damageType: "fire", school: "evocation" },

  { baseId: "sunburst", name: "Sunburst", level: 8, damage: "12d6", damageType: "radiant", school: "evocation" },
  { baseId: "incendiary-cloud", name: "Incendiary Cloud", level: 8, damage: "10d8", damageType: "fire", school: "conjuration" },

  { baseId: "meteor-swarm", name: "Meteor Swarm", level: 9, damage: "40d6", damageType: "fire", school: "evocation" },
  { baseId: "psychic-scream", name: "Psychic Scream", level: 9, damage: "14d6", damageType: "psychic", school: "enchantment" },
];

export const spellsByBaseId: Record<string, SpellDef> = SPELLS.reduce(
  (acc, def) => {
    acc[def.baseId] = def;
    return acc;
  },
  {} as Record<string, SpellDef>,
);

export function mintSpell(def: SpellDef): Spell {
  return {
    id: crypto.randomUUID(),
    baseId: def.baseId,
    name: def.name,
    level: def.level,
    damage: def.damage,
    damageType: def.damageType,
    school: def.school,
  };
}

// SLOT_TABLE[level] = available slots by spell level. Half-casters are folded
// into this table for simplicity (slight buff vs PHB).
export const SLOT_TABLE: readonly Record<string, number>[] = [
  {}, // index 0 unused
  { "1": 2 },
  { "1": 3 },
  { "1": 4, "2": 2 },
  { "1": 4, "2": 3 },
  { "1": 4, "2": 3, "3": 2 },
  { "1": 4, "2": 3, "3": 3 },
  { "1": 4, "2": 3, "3": 3, "4": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 2 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1, "8": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1, "8": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 2, "6": 1, "7": 1, "8": 1, "9": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 1, "7": 1, "8": 1, "9": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2, "7": 1, "8": 1, "9": 1 },
  { "1": 4, "2": 3, "3": 3, "4": 3, "5": 3, "6": 2, "7": 2, "8": 1, "9": 1 },
];

export function slotsForLevel(level: number): Record<string, number> {
  const clamped = Math.max(1, Math.min(20, level));
  return { ...SLOT_TABLE[clamped] };
}
