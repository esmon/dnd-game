import type { AbilityScores } from "@/lib/db/schema";
import type { DnDClass } from "@/lib/dnd/classes";
import type { Race } from "@/lib/dnd/races";

export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

export const ABILITY_KEYS: ReadonlyArray<keyof AbilityScores> = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
];

export const ABILITY_LABELS: Record<keyof AbilityScores, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export const ABILITY_DESCRIPTIONS: Record<keyof AbilityScores, string> = {
  str: "Physical power. Drives melee weapon attacks and damage, athletics, and carrying capacity.",
  dex: "Agility and reflexes. Drives ranged attacks, finesse weapons, AC, initiative, and stealth.",
  con: "Health and stamina. Adds to HP at every level and powers concentration saves.",
  int: "Reasoning and memory. Spellcasting ability for Wizards. Used for Arcana, History, and Investigation.",
  wis: "Awareness and intuition. Spellcasting ability for Clerics, Druids, and Rangers. Used for Perception and Insight.",
  cha: "Force of personality. Spellcasting ability for Bards, Sorcerers, Warlocks, and Paladins. Used for Persuasion and Deception.",
};

export function applyRaceASI(
  base: AbilityScores,
  race: Race,
): AbilityScores {
  return {
    str: base.str + (race.asi.str ?? 0),
    dex: base.dex + (race.asi.dex ?? 0),
    con: base.con + (race.asi.con ?? 0),
    int: base.int + (race.asi.int ?? 0),
    wis: base.wis + (race.asi.wis ?? 0),
    cha: base.cha + (race.asi.cha ?? 0),
  };
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function computeMaxHp(klass: DnDClass, conScore: number): number {
  return klass.hitDie + abilityModifier(conScore);
}
