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
): { character: Character; summary: string[] } {
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
  if (xpGained > 0) {
    const fromLevel = c.level;
    const result = applyCharacterLevelUps(c);
    if (result.levelsGained.length > 0) {
      c = result.character;
      summary.push(
        c.level - fromLevel === 1
          ? `Reached level ${c.level}`
          : `Reached level ${c.level} (+${c.level - fromLevel})`,
      );
    }
  }

  return { character: c, summary };
}

// Grant the scene's scripted rewards to the story's character and
// return a system message summarizing them (to drop into the log).
// No-op (returns null) when the scene has no rewards, the story has no
// character (a coop DM seat), the character row is missing, or nothing
// mechanical was granted. characters has no RLS — supabaseAdmin.
export async function grantSceneRewards(
  story: StoryCampaign,
  scene: Scene,
): Promise<NewStoryMessage | null> {
  const rewards = scene.scripted.rewards;
  if (!rewards || rewards.length === 0 || !story.character_id) return null;

  const { data: charRow, error: charError } = await supabaseAdmin
    .from("characters")
    .select("*")
    .eq("id", story.character_id)
    .maybeSingle();
  if (charError) {
    console.error("scene reward character load failed", charError.message);
    return null;
  }
  if (!charRow) return null;

  const { character, summary } = applyRewards(charRow as Character, rewards);
  if (summary.length === 0) return null;

  // Only touch armor_inventory when an armor reward actually dropped,
  // so xp / weapon / potion / scroll grants don't depend on that
  // column existing (see the known armor_inventory schema-cache gap).
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
  if (rewards.some((r) => r.kind === "armor")) {
    update.armor_inventory = character.armor_inventory ?? [];
  }

  const { error: updateError } = await supabaseAdmin
    .from("characters")
    .update(update)
    .eq("id", character.id);
  if (updateError) {
    console.error("scene reward persist failed", updateError.message);
    return null;
  }

  return {
    campaign_id: story.id,
    role: "system",
    content: `Rewards: ${summary.join(" · ")}.`,
    author_user_id: null,
    metadata: { scene_id: scene.id, kind: "scene_rewards" },
  };
}
