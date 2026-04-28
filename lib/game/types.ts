export type GameStatus = "lobby" | "fighting";

export type DamageType = "slashing" | "piercing" | "bludgeoning";

export type Weapon = {
  id: string;
  baseId: string;
  name: string;
  damage: string; // dice notation including bonus, e.g. "1d8+1"
  bonus: number; // 0 mundane | 1 | 2 | 3
  damageType: DamageType;
};

export type AbilityScores = {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
};

export type Spell = {
  id: string;
  baseId: string;
  name: string;
  level: number; // 0 = cantrip, 1..9 leveled
  damage: string;
  damageType: string;
  school: string;
};

export type Scroll = {
  kind: "scroll";
  id: string;
  spellName: string;
  spellLevel: number;
  damage: string;
  damageType: string;
};

export type Potion = {
  kind: "potion";
  id: string;
  baseId: string;
  name: string;
  healDice: string;
  rarity: "common" | "uncommon" | "rare" | "very-rare";
};

export type Consumable = Scroll | Potion;

export type Player = {
  id?: string;
  name: string;
  avatar: string | null;
  maxHealth: number;
  health: number;
  xp: number;
  weapons: Weapon[];
  inventory: Weapon[];
  level: number;
  classId: string;
  raceId: string;
  abilityScores: AbilityScores;
  proficiencyBonus: number;
  knownSpells: Spell[];
  equippedSpells: Spell[];
  spellSlots: Record<string, number>;
  consumables: Consumable[];
};

export type Monster = {
  name: string;
  index: string; // dnd5eapi index slug, kept for debug/keys
  avatar: string | null;
  maxHealth: number;
  health: number;
  xp: number;
  damageDice: string; // dice notation used for monster turn damage
  challengeRating: number;
  ac: number;
  attackBonus: number;
  damageType: string;
  damageResistances: string[];
  damageVulnerabilities: string[];
  damageImmunities: string[];
};

export type Turn = {
  id: number;
  isPlayer: boolean;
  text: string;
  kind?: "levelup" | "loot" | "crit";
};

export type GameStats = {
  wins: number;
  losses: number;
  runaways: number;
};

export type VictoryInfo = {
  monsterName: string;
  xpGained: number;
  levelsGained: number[];
  loot: Weapon | Scroll | Potion | null;
};

export type MonsterIndex = {
  index: string;
  name: string;
};
