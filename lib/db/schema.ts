import type {
  AbilityScores,
  Armor,
  Consumable,
  Player,
  Spell,
  Weapon,
} from "@/lib/game/types";

export type { AbilityScores };

export interface Character {
  id: string;
  session_id: string;
  // Set when an anonymous character has been claimed by a signed-in user
  // (Phase 4 of cross-device auth). Null until then; access via either
  // session_id or user_id is allowed in the API.
  user_id: string | null;
  name: string;
  race: string;
  subrace: string | null;
  class: string;
  subclass: string | null;
  background: string;
  alignment: string;
  level: number;
  xp: number;
  ability_scores: AbilityScores;
  max_hp: number;
  current_hp: number;
  proficiency_bonus: number;
  weapons: Weapon[];
  inventory: Weapon[];
  known_spells: Spell[];
  equipped_spells: Spell[];
  spell_slots: Record<string, number>;
  consumables: Consumable[];
  // 5e armor + shield slots. Optional / null because the columns
  // were added after the initial schema; legacy rows return null
  // and the AC formula treats that as "wearing nothing."
  equipped_armor?: Armor | null;
  equipped_shield?: Armor | null;
  // Unequipped armor + shield drops kept around between fights.
  // Same shape pattern as `inventory` (weapons) and `consumables`.
  armor_inventory?: Armor[];
  // Per-character battle counters (the StatsBar). Optional because
  // the columns landed after the initial schema; characterToPlayer
  // defaults each to 0 when the row predates the migration.
  wins?: number;
  losses?: number;
  runaways?: number;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCharacter = Omit<
  Character,
  "id" | "user_id" | "created_at" | "updated_at"
> & {
  id?: string;
  user_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type CharacterUpdate = {
  current_hp?: number;
  xp?: number;
  level?: number;
  weapons?: Weapon[];
  inventory?: Weapon[];
  max_hp?: number;
  proficiency_bonus?: number;
  ability_scores?: AbilityScores;
  known_spells?: Spell[];
  equipped_spells?: Spell[];
  spell_slots?: Record<string, number>;
  consumables?: Consumable[];
  equipped_armor?: Armor | null;
  equipped_shield?: Armor | null;
  armor_inventory?: Armor[];
  wins?: number;
  losses?: number;
  runaways?: number;
};

export function characterToPlayer(c: Character): Player {
  return {
    id: c.id,
    name: c.name,
    avatar: c.avatar_url,
    maxHealth: c.max_hp,
    health: c.current_hp,
    xp: c.xp,
    weapons: c.weapons,
    inventory: c.inventory,
    level: c.level,
    classId: c.class,
    raceId: c.race,
    dbUpdatedAt: c.updated_at,
    abilityScores: c.ability_scores,
    proficiencyBonus: c.proficiency_bonus,
    knownSpells: c.known_spells ?? [],
    equippedSpells: c.equipped_spells ?? [],
    spellSlots: c.spell_slots ?? {},
    consumables: c.consumables ?? [],
    equippedArmor: c.equipped_armor ?? null,
    equippedShield: c.equipped_shield ?? null,
    armorInventory: c.armor_inventory ?? [],
    stats: {
      wins: c.wins ?? 0,
      losses: c.losses ?? 0,
      runaways: c.runaways ?? 0,
    },
  };
}
