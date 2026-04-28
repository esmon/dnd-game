import type { AbilityScores } from "@/lib/db/schema";
import type { Weapon } from "@/lib/game/types";

export type DnDClass = {
  id: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  primaryAbility: keyof AbilityScores;
  weapons: Weapon[];
  description: string;
};

export const CLASSES: readonly DnDClass[] = [
  {
    id: "barbarian",
    name: "Barbarian",
    hitDie: 12,
    primaryAbility: "str",
    weapons: [
      { name: "Greataxe", damage: "1d12" },
      { name: "Handaxe", damage: "1d6" },
    ],
    description: "A fierce warrior of primitive background who can enter a battle rage.",
  },
  {
    id: "bard",
    name: "Bard",
    hitDie: 8,
    primaryAbility: "cha",
    weapons: [
      { name: "Rapier", damage: "1d8" },
      { name: "Dagger", damage: "1d4" },
    ],
    description: "An inspiring magician whose power echoes the music of creation.",
  },
  {
    id: "cleric",
    name: "Cleric",
    hitDie: 8,
    primaryAbility: "wis",
    weapons: [
      { name: "Mace", damage: "1d6" },
      { name: "Light Crossbow", damage: "1d8" },
    ],
    description: "A priestly champion who wields divine magic in service of a higher power.",
  },
  {
    id: "druid",
    name: "Druid",
    hitDie: 8,
    primaryAbility: "wis",
    weapons: [
      { name: "Scimitar", damage: "1d6" },
      { name: "Quarterstaff", damage: "1d6" },
    ],
    description: "A priest of the Old Faith, wielding the powers of nature and adopting animal forms.",
  },
  {
    id: "fighter",
    name: "Fighter",
    hitDie: 10,
    primaryAbility: "str",
    weapons: [
      { name: "Longsword", damage: "1d8" },
      { name: "Light Crossbow", damage: "1d8" },
    ],
    description: "A master of martial combat, skilled with a variety of weapons and armor.",
  },
  {
    id: "monk",
    name: "Monk",
    hitDie: 8,
    primaryAbility: "dex",
    weapons: [
      { name: "Shortsword", damage: "1d6" },
      { name: "Dart", damage: "1d4" },
    ],
    description: "A master of martial arts, harnessing the power of the body in pursuit of perfection.",
  },
  {
    id: "paladin",
    name: "Paladin",
    hitDie: 10,
    primaryAbility: "str",
    weapons: [
      { name: "Longsword", damage: "1d8" },
      { name: "Javelin", damage: "1d6" },
    ],
    description: "A holy warrior bound to a sacred oath.",
  },
  {
    id: "ranger",
    name: "Ranger",
    hitDie: 10,
    primaryAbility: "dex",
    weapons: [
      { name: "Longsword", damage: "1d8" },
      { name: "Shortbow", damage: "1d6" },
    ],
    description: "A warrior who combats threats on the edges of civilization.",
  },
  {
    id: "rogue",
    name: "Rogue",
    hitDie: 8,
    primaryAbility: "dex",
    weapons: [
      { name: "Shortsword", damage: "1d6" },
      { name: "Shortbow", damage: "1d6" },
    ],
    description: "A scoundrel who uses stealth and trickery to overcome obstacles and enemies.",
  },
  {
    id: "sorcerer",
    name: "Sorcerer",
    hitDie: 6,
    primaryAbility: "cha",
    weapons: [
      { name: "Dagger", damage: "1d4" },
      { name: "Light Crossbow", damage: "1d8" },
    ],
    description: "A spellcaster who draws on inherent magic from a gift or bloodline.",
  },
  {
    id: "warlock",
    name: "Warlock",
    hitDie: 8,
    primaryAbility: "cha",
    weapons: [
      { name: "Light Crossbow", damage: "1d8" },
      { name: "Dagger", damage: "1d4" },
    ],
    description: "A wielder of magic derived from a bargain with an extraplanar entity.",
  },
  {
    id: "wizard",
    name: "Wizard",
    hitDie: 6,
    primaryAbility: "int",
    weapons: [
      { name: "Quarterstaff", damage: "1d6" },
      { name: "Dagger", damage: "1d4" },
    ],
    description: "A scholarly magic-user capable of manipulating the structures of reality.",
  },
];
