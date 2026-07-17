import { rollInitiative } from "@/lib/coop/initiative";
import { walkMonsterChain } from "@/lib/coop/monster-chain";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";
import type { CampaignPlayer } from "@/lib/coop/types";
import type { Character } from "@/lib/db/schema";
import { fetchMonster } from "@/lib/game/dnd5e";
import type { Monster } from "@/lib/game/types";
import { supabaseAdmin } from "@/lib/supabase";

import type {
  NewStoryMessage,
  StoryCampaign,
  StoryMessage,
  StoryPlayer,
} from "./db";

// Same shape both story encounter callers already returned, so
// applyEncounter (solo action) and /combat/start (DM trigger) can each
// return this directly.
export type SpawnEncounterResult =
  | { error: string; status: number }
  | { combatCampaignId: string; encounterMessage: StoryMessage | null };

// Spin up a coop combat campaign for a single story encounter and
// stamp its id onto the story row. Enrolls the *whole story party* —
// every roster player (role='player') brings their character. In solo
// that's just the owner's single row; in coop it's the full party. The
// DM seat has no character and never enrolls (which is also why a
// DM-created coop story no longer 404s here — we read the roster, not
// the nullable story.character_id).
//
// Characters are fetched fresh (not from the frozen roster snapshot) so
// each fight starts from current HP / level / loot, matching how solo
// combat has always behaved.
//
// The caller has already authorized (owner in solo, DM seat in coop)
// and broadcasts afterward; this helper is the shared middle.
export async function spawnStoryEncounter(params: {
  story: StoryCampaign;
  sceneId: string;
  monsterIndex: string;
  count: number | undefined;
  // campaigns.created_by — the owner (solo) or the triggering DM (coop).
  createdBy: string;
  // author_user_id on the story-log "encounter started" marker.
  authorUserId: string;
  intent?: string | null;
}): Promise<SpawnEncounterResult> {
  const { story, sceneId, monsterIndex, count, createdBy, authorUserId } =
    params;
  const intent = params.intent ?? null;

  // The party: every roster player, ordered by position. Filter out any
  // without a character (defensive — role='player' rows always have one).
  const { data: rosterRows, error: rosterError } = await supabaseAdmin
    .from("story_players")
    .select("*")
    .eq("campaign_id", story.id)
    .eq("role", "player")
    .order("position", { ascending: true });
  if (rosterError) return { error: rosterError.message, status: 500 };
  const roster = ((rosterRows ?? []) as StoryPlayer[]).filter(
    (p) => p.character_id,
  );
  if (roster.length === 0) {
    return { error: "no players to fight this encounter", status: 409 };
  }

  // Fresh character rows by roster character_id (current HP / level).
  const charIds = roster.map((p) => p.character_id as string);
  const { data: charRows, error: charError } = await supabaseAdmin
    .from("characters")
    .select("*")
    .in("id", charIds);
  if (charError) return { error: charError.message, status: 500 };
  const charById = new Map(
    ((charRows ?? []) as Character[]).map((c) => [c.id, c]),
  );

  // Instantiate `count` copies of the monster (each tracked by index).
  let monsterTemplate: Monster;
  try {
    monsterTemplate = await fetchMonster(monsterIndex);
  } catch (err) {
    return {
      error: `monster fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      status: 502,
    };
  }
  const monsterCount = Math.max(1, count ?? 1);
  const monsters: Monster[] = Array.from({ length: monsterCount }, () => ({
    ...monsterTemplate,
  }));

  // Coop campaign, already active — the story owns scene progression, so
  // there's no lobby and no between-encounters flow.
  const campaignInsert = await supabaseAdmin
    .from("campaigns")
    .insert({
      status: "active",
      created_by: createdBy,
      monsters,
      turn_pointer: 0,
      current_difficulty: null,
    })
    .select("*")
    .single();
  if (campaignInsert.error) {
    return { error: campaignInsert.error.message, status: 500 };
  }
  const combat = campaignInsert.data as {
    id: string;
    encounter_number: number;
  };
  const combatCampaignId = combat.id;

  // Enroll each party player at a contiguous position, HP frozen at the
  // moment the fight begins.
  const playerInserts = roster
    .map((p, i) => {
      const character = charById.get(p.character_id as string);
      if (!character) return null;
      return {
        campaign_id: combatCampaignId,
        user_id: p.user_id,
        position: i,
        character_snapshot: character,
        current_hp: character.current_hp,
        is_ready: true,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  if (playerInserts.length === 0) {
    await supabaseAdmin.from("campaigns").delete().eq("id", combatCampaignId);
    return { error: "no player characters found", status: 404 };
  }
  const { data: insertedPlayers, error: playersError } = await supabaseAdmin
    .from("campaign_players")
    .insert(playerInserts)
    .select("*");
  if (playersError) {
    await supabaseAdmin.from("campaigns").delete().eq("id", combatCampaignId);
    return { error: playersError.message, status: 500 };
  }
  const players = (insertedPlayers ?? []) as CampaignPlayer[];

  // Roll initiative + walk any leading monster turns so nobody lands on
  // a stuck "monster's turn". Same machinery coop uses for a real party.
  const initiativeOrder = rollInitiative(players, monsters);
  await supabaseAdmin
    .from("campaigns")
    .update({ initiative_order: initiativeOrder, turn_pointer: 0 })
    .eq("id", combatCampaignId);

  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.current_hp]),
  );
  const activeCampaign = {
    id: combatCampaignId,
    status: "active" as const,
    created_by: createdBy,
    monsters,
    turn_pointer: 0,
    turn_deadline: null,
    outcome: null,
    initiative_order: initiativeOrder,
    encounter_number: combat.encounter_number,
    current_difficulty: null,
    created_at: "",
    updated_at: "",
  };
  const chain = await walkMonsterChain({
    campaignId: combatCampaignId,
    campaign: activeCampaign,
    players,
    monsters,
    playerHp,
    pointer: 0,
    nextTurnNumber: 0,
  });
  const finalUpdate: Record<string, unknown> = {
    turn_pointer: chain.pointer,
    turn_deadline: chain.defeat ? null : nextTurnDeadline(),
  };
  if (chain.defeat) {
    finalUpdate.status = "finished";
    finalUpdate.outcome = "lost";
  }
  await supabaseAdmin
    .from("campaigns")
    .update(finalUpdate)
    .eq("id", combatCampaignId);

  // Stamp the coop campaign id onto the story so every member's page
  // opens the locked combat dialog.
  const { error: stampError } = await supabaseAdmin
    .from("story_campaigns")
    .update({ active_combat_campaign_id: combatCampaignId })
    .eq("id", story.id);
  if (stampError) return { error: stampError.message, status: 500 };

  // Visible story-log marker; carries the combat id so /combat/end can
  // correlate the resolution back to this trigger.
  const summaryCount =
    monsterCount > 1 ? `${monsterCount} × ${monsterIndex}` : monsterIndex;
  const content = intent
    ? `⚔ Encounter — ${summaryCount}. ${intent}`
    : `⚔ Encounter — ${summaryCount}.`;
  const storyMsg: NewStoryMessage = {
    campaign_id: story.id,
    role: "system",
    content,
    author_user_id: authorUserId,
    metadata: {
      scene_id: sceneId,
      kind: "encounter_started",
      combat_campaign_id: combatCampaignId,
      monsterIndex,
      count: monsterCount,
      intent,
    },
  };
  const { data: insertedMsg, error: msgError } = await supabaseAdmin
    .from("story_messages")
    .insert(storyMsg)
    .select()
    .single();
  if (msgError) {
    // Combat is live; only the log marker failed. The dialog still
    // opens from the stamped active_combat_campaign_id.
    console.error("story encounter message failed", msgError.message);
  }

  return {
    combatCampaignId,
    encounterMessage: (insertedMsg ?? null) as StoryMessage | null,
  };
}
