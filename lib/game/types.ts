export type GameStatus = "lobby" | "fighting";

export type Weapon = {
  id: string;
  baseId: string;
  name: string;
  damage: string; // dice notation including bonus, e.g. "1d8+1"
  bonus: number; // 0 mundane | 1 | 2 | 3
};

export type AbilityScores = {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
};

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
  abilityScores: AbilityScores;
  proficiencyBonus: number;
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
};

export type Turn = {
  id: number;
  isPlayer: boolean;
  text: string;
  kind?: "levelup";
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
  loot: Weapon | null;
};

export type MonsterIndex = {
  index: string;
  name: string;
};
