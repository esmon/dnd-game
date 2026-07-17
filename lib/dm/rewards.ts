import { applyCharacterLevelUps } from "@/lib/coop/leveling";
import type { Character } from "@/lib/db/schema";
import { armorByBaseId, mintArmor } from "@/lib/dnd/armor";
import { mintPotion, potionsByBaseId } from "@/lib/dnd/potions";
import { spellsByBaseId } from "@/lib/dnd/spells";
import { mintWeapon, weaponsByBaseId } from "@/lib/dnd/weapons";
import type { Scroll } from "@/lib/game/types";
import { supabaseAdmin } from "@/lib/supabase";

import type { NewStoryMessage, StoryCampaign } from "./db";
import type { Reward, Scene } from "./types";

// Apply a scene's scripted rewards to a character. Pure: returns a new
// character + human-readable summary lines; the caller persists.
//
// xp banks onto the character and can trigger level-ups (same path
// combat uses); item rewards mint a real Weapon/Armor/Potion/Scroll
// from the base catalogs and drop it into the matching bag. 'story'
// rewards are narrative-only (already in the scene's prose) and grant
// nothing mechanical. Unknown base ids are skipped rather than
// crashing the advance.
export function applyRewards(
  character: Character,
  rewards: Reward[],
): { character: Character; summary: string[]; leveledTo: number | null } {
  let c: Character = { ...character };
  const summary: string[] = [];
  let xpGained = 0;

  for (const r of rewards) {
    switch (r.kind) {
      case "xp": {
        xpGained += r.amount;
        c = { ...c, xp: c.xp + r.amount };
        summary.push(`+${r.amount} XP`);
        break;
      }
      case "weapon": {
        const def = weaponsByBaseId[r.baseId];
        if (!def) break;
        const weapon = mintWeapon(def, r.bonus ?? 0);
        c = { ...c, inventory: [...c.inventory, weapon] };
        summary.push(weapon.name);
        break;
      }
      case "armor": {
        const def = armorByBaseId[r.baseId];
        if (!def) break;
        const armor = mintArmor(def, r.bonus ?? 0);
        c = { ...c, armor_inventory: [...(c.armor_inventory ?? []), armor] };
        summary.push(armor.name);
        break;
      }
      case "potion": {
        const def = potionsByBaseId[r.baseId];
        if (!def) break;
        const potion = mintPotion(def);
        c = { ...c, consumables: [...c.consumables, potion] };
        summary.push(potion.name);
        break;
      }
      case "scroll": {
        const def = spellsByBaseId[r.spellBaseId];
        if (!def) break;
        const scroll: Scroll = {
          kind: "scroll",
          id: crypto.randomUUID(),
          spellName: def.name,
          spellLevel: def.level,
          damage: def.damage,
          damageType: def.damageType,
        };
        c = { ...c, consumables: [...c.consumables, scroll] };
        summary.push(`Scroll of ${def.name}`);
        break;
      }
      case "story":
        // Narrative reward — no inventory / xp effect.
        break;
    }
  }

  // Bank any xp into levels the same way combat does, so a quest XP
  // bonus that crosses a threshold bumps level / max_hp / spells.
  // The level result is returned separately from the item/xp summary
  // because reward *content* is identical across a party but each
  // member crosses (or doesn't cross) a threshold on their own.
  let leveledTo: number | null = null;
  if (xpGained > 0) {
    const result = applyCharacterLevelUps(c);
    if (result.levelsGained.length > 0) {
      c = result.character;
      leveledTo = c.level;
    }
  }

  return { character: c, summary, leveledTo };
}

// Persist one character's post-reward state. Only touches
// armor_inventory when an armor reward dropped, so xp / weapon / potion
// / scroll grants don't depend on that column existing (see the known
// armor_inventory schema-cache gap). characters has no RLS —
// supabaseAdmin.
async function persistRewardedCharacter(
  character: Character,
  hasArmorReward: boolean,
): Promise<boolean> {
  const update: Record<string, unknown> = {
    xp: character.xp,
    level: character.level,
    max_hp: character.max_hp,
    proficiency_bonus: character.proficiency_bonus,
    known_spells: character.known_spells,
    equipped_spells: character.equipped_spells,
    spell_slots: character.spell_slots,
    inventory: character.inventory,
    consumables: character.consumables,
  };
  if (hasArmorReward) {
    update.armor_inventory = character.armor_inventory ?? [];
  }
  const { error } = await supabaseAdmin
    .from("characters")
    .update(update)
    .eq("id", character.id);
  if (error) {
    console.error("scene reward persist failed", error.message);
    return false;
  }
  return true;
}

// Grant the scene's scripted rewards to *every* party player and return
// a system message summarizing them (to drop into the log). Rewards are
// scene-scripted, so the item/xp payout is identical for each player;
// only level-ups differ, so the message notes those per character.
//
// No-op (returns null) when the scene has no rewards, there are no
// player characters (e.g. a coop DM-only view before anyone joined), or
// nothing mechanical was granted. characters has no RLS — supabaseAdmin.
export async function grantSceneRewards(
  story: StoryCampaign,
  scene: Scene,
): Promise<NewStoryMessage | null> {
  const rewards = scene.scripted.rewards;
  if (!rewards || rewards.length === 0) return null;

  // Target characters: every roster player (role='player'). Fall back
  // to the legacy single story.character_id for pre-roster rows.
  const { data: rosterRows, error: rosterError } = await supabaseAdmin
    .from("story_players")
    .select("character_id")
    .eq("campaign_id", story.id)
    .eq("role", "player");
  if (rosterError) {
    console.error("scene reward roster load failed", rosterError.message);
    return null;
  }
  const characterIds = ((rosterRows ?? []) as { character_id: string | null }[])
    .map((r) => r.character_id)
    .filter((id): id is string => !!id);
  if (characterIds.length === 0 && story.character_id) {
    characterIds.push(story.character_id);
  }
  if (characterIds.length === 0) return null;

  const { data: charRows, error: charError } = await supabaseAdmin
    .from("characters")
    .select("*")
    .in("id", characterIds);
  if (charError) {
    console.error("scene reward character load failed", charError.message);
    return null;
  }
  const characters = (charRows ?? []) as Character[];
  if (characters.length === 0) return null;

  const hasArmorReward = rewards.some((r) => r.kind === "armor");

  // Item/xp summary is identical for every player; capture it once.
  // Level-up notes are per character.
  let itemSummary: string[] | null = null;
  const levelNotes: string[] = [];
  let persistedAny = false;

  for (const original of characters) {
    const { character, summary, leveledTo } = applyRewards(original, rewards);
    if (summary.length === 0) continue;
    const ok = await persistRewardedCharacter(character, hasArmorReward);
    if (!ok) continue;
    persistedAny = true;
    if (itemSummary === null) itemSummary = summary;
    if (leveledTo !== null) {
      levelNotes.push(`${character.name} reached level ${leveledTo}`);
    }
  }

  if (!persistedAny || itemSummary === null) return null;

  const solo = characters.length === 1;
  const lead = solo ? "Rewards" : "The party receives";
  let content = `${lead}: ${itemSummary.join(" · ")}.`;
  if (levelNotes.length > 0) {
    content += ` ${levelNotes.join(" · ")}.`;
  }

  return {
    campaign_id: story.id,
    role: "system",
    content,
    author_user_id: null,
    metadata: { scene_id: scene.id, kind: "scene_rewards" },
  };
}
