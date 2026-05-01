import type { Character } from "@/lib/db/schema";
import { findClass } from "@/lib/dnd/classes";
import { abilityModifier } from "@/lib/dnd/derive";
import {
  hpGainOnLevelUp,
  levelForXp,
  proficiencyBonusForLevel,
} from "@/lib/dnd/leveling";
import {
  mintSpell,
  slotsForLevel,
  spellsByBaseId,
} from "@/lib/dnd/spells";

// Coop equivalent of solo's applyLevelUps (lib/game/reducer.ts) —
// works on the snake_case Character snapshot stored on
// campaign_players.character_snapshot. Walks up to levelForXp(xp),
// bumping max_hp / current_hp / proficiency_bonus for each level
// gained, learning the class's level-table spells (and auto-equipping
// up to the cap), and refreshing spell slots for casters.
//
// Doesn't apply ASI — coop hasn't shipped a level-up dialog yet so
// ability scores stay put on a level cross. Players still get the
// HP / proficiency / spells; the +2 stat bump waits on a UI to
// resolve it.
export const EQUIPPED_SPELL_CAP = 5;

export type LevelUpResult = {
  character: Character;
  levelsGained: number[];
  spellsLearned: string[];
};

export function applyCharacterLevelUps(character: Character): LevelUpResult {
  const targetLevel = levelForXp(character.xp);
  if (targetLevel <= character.level) {
    return { character, levelsGained: [], spellsLearned: [] };
  }
  const klass = findClass(character.class);
  if (!klass) {
    return { character, levelsGained: [], spellsLearned: [] };
  }

  const conMod = abilityModifier(character.ability_scores.con);
  const levelsGained: number[] = [];
  const spellsLearned: string[] = [];
  let c = character;

  for (let lvl = c.level + 1; lvl <= targetLevel; lvl++) {
    const gain = hpGainOnLevelUp(klass.hitDie, conMod);
    c = {
      ...c,
      level: lvl,
      max_hp: c.max_hp + gain,
      current_hp: c.current_hp + gain,
      proficiency_bonus: proficiencyBonusForLevel(lvl),
    };
    levelsGained.push(lvl);

    const learned = klass.spellsByLevel?.[lvl] ?? [];
    if (learned.length > 0) {
      const newKnown = [...c.known_spells];
      const newEquipped = [...c.equipped_spells];
      for (const baseId of learned) {
        const def = spellsByBaseId[baseId];
        if (!def) continue;
        const spell = mintSpell(def);
        newKnown.push(spell);
        if (newEquipped.length < EQUIPPED_SPELL_CAP) {
          newEquipped.push(spell);
        }
        spellsLearned.push(spell.name);
      }
      c = { ...c, known_spells: newKnown, equipped_spells: newEquipped };
    }
  }
  if (klass.isCaster) {
    c = { ...c, spell_slots: slotsForLevel(c.level) };
  }
  return { character: c, levelsGained, spellsLearned };
}
