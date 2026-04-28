import type { AbilityScores, Player, Weapon } from "@/lib/game/types";

export type { AbilityScores };

export interface Character {
  id: string;
  session_id: string;
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
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCharacter = Omit<Character, "id" | "created_at" | "updated_at"> & {
  id?: string;
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
    abilityScores: c.ability_scores,
    proficiencyBonus: c.proficiency_bonus,
  };
}
