import type { AbilityScores } from "@/lib/db/schema";

export type ClassWeaponRef = {
  baseId: string;
  bonus: 0 | 1 | 2 | 3;
};

export type DnDClass = {
  id: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  primaryAbility: keyof AbilityScores;
  weapons: ClassWeaponRef[];
  description: string;
  isCaster: boolean;
  spellcastingAbility?: keyof AbilityScores;
  spellsByLevel?: Record<number, string[]>;
  // True if the class has any in-combat self-heal in 5e: divine casters with
  // Cure Wounds / Healing Word, Paladin Lay on Hands, Fighter Second Wind.
  // Pure martials and arcane-only casters get nothing self-targeting in a fight.
  canSelfHealInCombat: boolean;
  // Earliest level at which HEAL is available. Default 1; Ranger is 2 because
  // it's a half-caster with no slots at level 1.
  healMinLevel?: number;
  // True for spell-based heals (Cure Wounds / Healing Word) that consume a
  // spell slot. Paladin (Lay on Hands) and Fighter (Second Wind) heal via
  // class features, not slots.
  healCostsSlot?: boolean;
};

export const CLASSES: readonly DnDClass[] = [
  {
    id: "barbarian",
    name: "Barbarian",
    hitDie: 12,
    primaryAbility: "str",
    weapons: [
      { baseId: "greataxe", bonus: 0 },
      { baseId: "handaxe", bonus: 0 },
    ],
    description: "A fierce warrior of primitive background who can enter a battle rage.",
    isCaster: false,
    canSelfHealInCombat: false,
  },
  {
    id: "bard",
    name: "Bard",
    hitDie: 8,
    primaryAbility: "cha",
    weapons: [
      { baseId: "rapier", bonus: 0 },
      { baseId: "dagger", bonus: 0 },
    ],
    description: "An inspiring magician whose power echoes the music of creation.",
    isCaster: true,
    spellcastingAbility: "cha",
    spellsByLevel: {
      1: ["toll-the-dead", "magic-missile", "witch-bolt"],
      3: ["shatter"],
      5: ["lightning-bolt"],
      7: ["ice-storm"],
      9: ["cone-of-cold"],
      11: ["chain-lightning"],
      13: ["finger-of-death"],
      15: ["psychic-scream"],
    },
    canSelfHealInCombat: true,
    healCostsSlot: true,
  },
  {
    id: "cleric",
    name: "Cleric",
    hitDie: 8,
    primaryAbility: "wis",
    weapons: [
      { baseId: "mace", bonus: 0 },
      { baseId: "light-crossbow", bonus: 0 },
    ],
    description: "A priestly champion who wields divine magic in service of a higher power.",
    isCaster: true,
    spellcastingAbility: "wis",
    spellsByLevel: {
      1: ["sacred-flame", "guiding-bolt", "inflict-wounds"],
      3: ["shatter"],
      5: ["fireball"],
      7: ["ice-storm"],
      9: ["flame-strike"],
      11: ["chain-lightning"],
      13: ["finger-of-death"],
      15: ["sunburst"],
    },
    canSelfHealInCombat: true,
    healCostsSlot: true,
  },
  {
    id: "druid",
    name: "Druid",
    hitDie: 8,
    primaryAbility: "wis",
    weapons: [
      { baseId: "scimitar", bonus: 0 },
      { baseId: "quarterstaff", bonus: 0 },
    ],
    description: "A priest of the Old Faith, wielding the powers of nature and adopting animal forms.",
    isCaster: true,
    spellcastingAbility: "wis",
    spellsByLevel: {
      1: ["poison-spray", "witch-bolt", "flaming-sphere"],
      3: ["shatter"],
      5: ["lightning-bolt"],
      7: ["ice-storm"],
      9: ["cone-of-cold"],
      11: ["chain-lightning"],
      15: ["sunburst"],
      17: ["incendiary-cloud"],
    },
    canSelfHealInCombat: true,
    healCostsSlot: true,
  },
  {
    id: "fighter",
    name: "Fighter",
    hitDie: 10,
    primaryAbility: "str",
    weapons: [
      { baseId: "longsword", bonus: 0 },
      { baseId: "light-crossbow", bonus: 0 },
    ],
    description: "A master of martial combat, skilled with a variety of weapons and armor.",
    isCaster: false,
    canSelfHealInCombat: true,
  },
  {
    id: "monk",
    name: "Monk",
    hitDie: 8,
    primaryAbility: "dex",
    weapons: [
      { baseId: "shortsword", bonus: 0 },
      { baseId: "dart", bonus: 0 },
    ],
    description: "A master of martial arts, harnessing the power of the body in pursuit of perfection.",
    isCaster: false,
    canSelfHealInCombat: false,
  },
  {
    id: "paladin",
    name: "Paladin",
    hitDie: 10,
    primaryAbility: "str",
    weapons: [
      { baseId: "longsword", bonus: 0 },
      { baseId: "javelin", bonus: 0 },
    ],
    description: "A holy warrior bound to a sacred oath.",
    isCaster: true,
    spellcastingAbility: "cha",
    spellsByLevel: {
      2: ["guiding-bolt"],
      5: ["scorching-ray"],
      9: ["flame-strike"],
      13: ["finger-of-death"],
      17: ["sunburst"],
    },
    canSelfHealInCombat: true,
  },
  {
    id: "ranger",
    name: "Ranger",
    hitDie: 10,
    primaryAbility: "dex",
    weapons: [
      { baseId: "longsword", bonus: 0 },
      { baseId: "shortbow", bonus: 0 },
    ],
    description: "A warrior who combats threats on the edges of civilization.",
    isCaster: true,
    spellcastingAbility: "wis",
    spellsByLevel: {
      2: ["guiding-bolt"],
      5: ["flaming-sphere"],
      9: ["ice-storm"],
      13: ["cone-of-cold"],
      17: ["sunburst"],
    },
    canSelfHealInCombat: true,
    healMinLevel: 2,
    healCostsSlot: true,
  },
  {
    id: "rogue",
    name: "Rogue",
    hitDie: 8,
    primaryAbility: "dex",
    weapons: [
      { baseId: "shortsword", bonus: 0 },
      { baseId: "shortbow", bonus: 0 },
    ],
    description: "A scoundrel who uses stealth and trickery to overcome obstacles and enemies.",
    isCaster: false,
    canSelfHealInCombat: false,
  },
  {
    id: "sorcerer",
    name: "Sorcerer",
    hitDie: 6,
    primaryAbility: "cha",
    weapons: [
      { baseId: "dagger", bonus: 0 },
      { baseId: "light-crossbow", bonus: 0 },
    ],
    description: "A spellcaster who draws on inherent magic from a gift or bloodline.",
    isCaster: true,
    spellcastingAbility: "cha",
    spellsByLevel: {
      1: ["fire-bolt", "burning-hands", "magic-missile"],
      3: ["scorching-ray"],
      5: ["fireball", "lightning-bolt"],
      7: ["ice-storm"],
      9: ["cone-of-cold"],
      11: ["disintegrate", "chain-lightning"],
      13: ["delayed-blast-fireball"],
      15: ["sunburst"],
      17: ["meteor-swarm"],
    },
    canSelfHealInCombat: false,
  },
  {
    id: "warlock",
    name: "Warlock",
    hitDie: 8,
    primaryAbility: "cha",
    weapons: [
      { baseId: "light-crossbow", bonus: 0 },
      { baseId: "dagger", bonus: 0 },
    ],
    description: "A wielder of magic derived from a bargain with an extraplanar entity.",
    isCaster: true,
    spellcastingAbility: "cha",
    spellsByLevel: {
      1: ["eldritch-blast", "witch-bolt"],
      3: ["scorching-ray"],
      5: ["fireball"],
      7: ["ice-storm"],
      9: ["flame-strike"],
      11: ["chain-lightning"],
      13: ["finger-of-death"],
      17: ["psychic-scream"],
    },
    canSelfHealInCombat: false,
  },
  {
    id: "wizard",
    name: "Wizard",
    hitDie: 6,
    primaryAbility: "int",
    weapons: [
      { baseId: "quarterstaff", bonus: 0 },
      { baseId: "dagger", bonus: 0 },
    ],
    description: "A scholarly magic-user capable of manipulating the structures of reality.",
    isCaster: true,
    spellcastingAbility: "int",
    spellsByLevel: {
      1: ["fire-bolt", "magic-missile", "burning-hands", "witch-bolt"],
      2: ["toll-the-dead"],
      3: ["scorching-ray", "shatter"],
      5: ["fireball", "lightning-bolt"],
      7: ["ice-storm"],
      9: ["cone-of-cold", "flame-strike"],
      11: ["disintegrate", "chain-lightning"],
      13: ["finger-of-death", "delayed-blast-fireball"],
      15: ["sunburst"],
      17: ["meteor-swarm"],
    },
    canSelfHealInCombat: false,
  },
];

export function findClass(classId: string): DnDClass | undefined {
  return CLASSES.find((c) => c.id.toLowerCase() === classId.toLowerCase());
}
