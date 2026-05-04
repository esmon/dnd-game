export type GameStatus = "lobby" | "fighting";

export type DamageType = "slashing" | "piercing" | "bludgeoning";

// 5e weapon proficiency tier. "simple" = anyone-can-use (most casters
// at minimum); "martial" = requires class proficiency or you lose
// the proficiency bonus on attacks. Optional on the runtime type so
// older snapshots created before this field landed continue to load
// — mintWeapon always stamps it now, and lookup via weaponsByBaseId
// is the fallback when reading legacy data.
export type WeaponCategory = "simple" | "martial";

export type Weapon = {
  id: string;
  baseId: string;
  name: string;
  damage: string; // dice notation including bonus, e.g. "1d8+1"
  bonus: number; // 0 mundane | 1 | 2 | 3
  damageType: DamageType;
  category?: WeaponCategory;
};

// 5e armor categories. Shields are technically not "armor" in PHB
// but they share the same proficiency framework, so we model them
// as an Armor row with category=shield to keep one type instead of
// two.
export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

export type Armor = {
  id: string;
  baseId: string;
  name: string;
  category: ArmorCategory;
  // Base AC. For shields this is 0 (the +2 bonus is applied by the
  // AC formula when both armor + shield are equipped). For body
  // armor this is the PHB AC value (e.g. Chain Mail = 16).
  acBase: number;
  // DEX cap added to AC. Light armor has no cap (undefined), medium
  // armor caps at 2, heavy armor blocks DEX entirely (0). Shields
  // don't apply DEX themselves.
  dexCap?: number;
  stealthDisadvantage?: boolean;
  // Heavy armor strength requirement. Worn under STR threshold =>
  // 10ft speed penalty (we don't model speed yet, but plumbing the
  // field now keeps the catalog faithful).
  strRequirement?: number;
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
  // True for area-of-effect spells (Fireball, Burning Hands, etc.).
  // The coop resolver applies the rolled damage to every alive
  // monster (with per-monster resistance multipliers) instead of
  // requiring a target selection. Older snapshots may be missing
  // this field; treat undefined as false.
  aoe?: boolean;
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
  // The DB row's updated_at as last seen by this client. Used to
  // invalidate the localStorage cache when an external writer (e.g.
  // a coop campaign on another device) advances the row past the
  // cached state. Optional because anonymous play has no DB row.
  dbUpdatedAt?: string;
  abilityScores: AbilityScores;
  proficiencyBonus: number;
  knownSpells: Spell[];
  equippedSpells: Spell[];
  spellSlots: Record<string, number>;
  consumables: Consumable[];
  // 5e armor + shield slots. Optional because pre-armor character
  // snapshots are still in the wild; the AC formula treats undefined
  // / null as "wearing nothing" → unarmored AC fallback.
  equippedArmor?: Armor | null;
  equippedShield?: Armor | null;
  // Unequipped armor + shield drops carried between fights.
  armorInventory?: Armor[];
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
  // Raw DEX score from dnd5eapi (10 = +0 mod). Used for initiative
  // rolls in coop. Older monster snapshots may be missing this; the
  // initiative roller treats undefined as DEX 10.
  dexterity?: number;
};

// Action type drives the icon shown in the combat log. Kept separate
// from `kind` (which drives row highlighting) so a crit attack still
// renders the sword icon plus the gold crit background.
export type TurnAction =
  | "attack"
  | "spell"
  | "scroll"
  | "smite"
  | "heal"
  | "potion"
  | "skip";

export type Turn = {
  id: number;
  isPlayer: boolean;
  text: string;
  kind?: "levelup" | "loot" | "crit" | "win" | "loss" | "encounter";
  action?: TurnAction;
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
  loot: Weapon | Scroll | Potion | Armor | null;
};

export type MonsterIndex = {
  index: string;
  name: string;
};
