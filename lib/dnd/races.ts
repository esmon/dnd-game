import type { AbilityScores } from "@/lib/db/schema";

export type Race = {
  id: string;
  name: string;
  asi: Partial<AbilityScores>;
  speed: number;
  description: string;
};

export const RACES: readonly Race[] = [
  {
    id: "dwarf",
    name: "Dwarf",
    asi: { con: 2 },
    speed: 25,
    description:
      "Stout, hardy folk forged in mountain halls. Resistant to poison and at home with stone and steel.",
  },
  {
    id: "elf",
    name: "Elf",
    asi: { dex: 2 },
    speed: 30,
    description:
      "Graceful, long-lived people of forest and twilight, attuned to magic and keen of senses.",
  },
  {
    id: "halfling",
    name: "Halfling",
    asi: { dex: 2 },
    speed: 25,
    description:
      "Small, lucky, and irrepressibly cheerful. They slip through danger that would crush larger folk.",
  },
  {
    id: "human",
    name: "Human",
    asi: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
    speed: 30,
    description:
      "Versatile and ambitious. Humans push into every corner of the world and master every craft.",
  },
  {
    id: "dragonborn",
    name: "Dragonborn",
    asi: { str: 2, cha: 1 },
    speed: 30,
    description:
      "Proud, draconic warriors with breath weapons and a fierce code of honor.",
  },
  {
    id: "gnome",
    name: "Gnome",
    asi: { int: 2 },
    speed: 25,
    description:
      "Inquisitive tinkerers and illusionists, full of laughter and small magics.",
  },
  // Half-Elf MVP simplification: SRD allows +1 to two abilities of the player's
  // choice on top of +2 CHA. We hardcode +1 CON / +1 WIS so the wizard math
  // stays deterministic without an extra picker step.
  {
    id: "half-elf",
    name: "Half-Elf",
    asi: { cha: 2, con: 1, wis: 1 },
    speed: 30,
    description:
      "Born between two worlds, half-elves blend human drive with elven grace.",
  },
  {
    id: "half-orc",
    name: "Half-Orc",
    asi: { str: 2, con: 1 },
    speed: 30,
    description:
      "Fierce and resilient, half-orcs channel raw fury into devastating blows.",
  },
  {
    id: "tiefling",
    name: "Tiefling",
    asi: { cha: 2, int: 1 },
    speed: 30,
    description:
      "Marked by infernal heritage, tieflings carry charisma, cunning, and a whiff of brimstone.",
  },
];
