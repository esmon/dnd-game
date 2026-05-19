import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryMessage,
} from "@/lib/dm/db";
import type { Character } from "@/lib/db/schema";
import { rollInitiative } from "@/lib/coop/initiative";
import { walkMonsterChain } from "@/lib/coop/monster-chain";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";
import type { CampaignPlayer } from "@/lib/coop/types";
import { fetchMonster } from "@/lib/game/dnd5e";
import type { Monster } from "@/lib/game/types";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/story/[id]/combat/start — spin up an *active* coop
// campaign for a single story encounter and stamp its id onto the
// story_campaigns row.
//
// Why coop tables: a story encounter is a turn-based fight with N
// monsters and one (eventually multiple) player. The coop machinery
// already handles initiative, action log, turn pointer, defeat
// detection, and victory persistence (XP/loot back to the character
// row). Reusing it is cheaper than rebuilding combat under a new
// schema.
//
// Differences from a normal coop campaign:
//   - Created already in `status: 'active'`. No lobby, no other
//     joiners.
//   - One player (the story owner), one or more monsters from the
//     encounter spec (NOT the random pool).
//   - max-encounters is implicit 1 — between_encounters flow
//     doesn't apply since the story owns scene progression.
//
// Body: { monsterIndex: string, count?: number, intent?: string }.
// The encounter must match one declared on the current scene of the
// story's active template.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: storyId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { monsterIndex?: string; count?: number; intent?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { monsterIndex, count, intent } = body;
  if (typeof monsterIndex !== "string" || monsterIndex.length === 0) {
    return NextResponse.json(
      { error: "missing monsterIndex" },
      { status: 400 },
    );
  }

  // Load the story campaign via the SSR client (RLS filters by
  // owner/dm). If RLS hides it from this caller the result is null
  // — natural 404 without an extra check.
  const { data: storyRow, error: storyError } = await supabase
    .from("story_campaigns")
    .select("*")
    .eq("id", storyId)
    .maybeSingle();
  if (storyError) {
    return NextResponse.json({ error: storyError.message }, { status: 500 });
  }
  if (!storyRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const story = storyRow as StoryCampaign;
  const isDm =
    (story.dm_kind === "self" && story.user_id === user.id) ||
    (story.dm_kind === "human" && story.dm_user_id === user.id) ||
    story.dm_kind === "ai";
  if (!isDm) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (story.status !== "active") {
    return NextResponse.json(
      { error: "campaign is not active" },
      { status: 409 },
    );
  }
  if (story.active_combat_campaign_id) {
    return NextResponse.json(
      { error: "combat is already in flight" },
      { status: 409 },
    );
  }

  const template = findCampaign(story.campaign_template_id);
  if (!template) {
    return NextResponse.json(
      { error: `unknown campaign template: ${story.campaign_template_id}` },
      { status: 500 },
    );
  }
  const currentScene = template.scenes.find(
    (s) => s.id === story.current_scene_id,
  );
  if (!currentScene) {
    return NextResponse.json(
      { error: `current scene not in template: ${story.current_scene_id}` },
      { status: 500 },
    );
  }

  // Encounter must exist on the current scene. Match by monsterIndex
  // (+ optional count) so a stray client can't spawn arbitrary
  // monsters into the coop machinery.
  const declared = currentScene.scripted.encounters ?? [];
  const encounter = declared.find(
    (e) =>
      e.monsterIndex === monsterIndex &&
      (count === undefined || e.count === count),
  );
  if (!encounter) {
    return NextResponse.json(
      {
        error: `no matching encounter on scene "${currentScene.id}" for ${monsterIndex}`,
      },
      { status: 400 },
    );
  }

  // Load the player's character. characters has no RLS yet, so
  // explicit ownership check (story.user_id is the owner per RLS
  // above; we trust it here).
  const { data: charRow, error: charError } = await supabaseAdmin
    .from("characters")
    .select("*")
    .eq("id", story.character_id)
    .maybeSingle();
  if (charError) {
    return NextResponse.json({ error: charError.message }, { status: 500 });
  }
  if (!charRow) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  const character = charRow as Character;

  // Fetch the monster from dnd5eapi once; instantiate `count` copies
  // since multiple identical monsters in coop's array is fine (each
  // tracked by position index).
  let monsterTemplate: Monster;
  try {
    monsterTemplate = await fetchMonster(encounter.monsterIndex);
  } catch (err) {
    return NextResponse.json(
      {
        error: `monster fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }
  const monsterCount = Math.max(1, encounter.count ?? 1);
  const monsters: Monster[] = Array.from({ length: monsterCount }, () => ({
    ...monsterTemplate,
  }));

  // Insert the coop campaign already in `active` state. No lobby
  // phase — the story owns who's playing and there's only one
  // player. encounter_number = 1, max-encounters is implicit.
  const campaignInsert = await supabaseAdmin
    .from("campaigns")
    .insert({
      status: "active",
      created_by: user.id,
      monsters,
      turn_pointer: 0,
      // No difficulty roll — story encounters are pre-authored.
      current_difficulty: null,
    })
    .select("*")
    .single();
  if (campaignInsert.error) {
    return NextResponse.json(
      { error: campaignInsert.error.message },
      { status: 500 },
    );
  }
  const combatCampaign = campaignInsert.data as {
    id: string;
    encounter_number: number;
  };
  const combatCampaignId = combatCampaign.id;

  // Insert the player snapshot + freeze the character's current HP
  // at the moment the fight begins. (Coop pulls current_hp into the
  // player row so each fight starts from where solo left off.)
  const playerInsert = await supabaseAdmin
    .from("campaign_players")
    .insert({
      campaign_id: combatCampaignId,
      user_id: user.id,
      position: 0,
      character_snapshot: character,
      current_hp: character.current_hp,
      // Pre-readied — there's no lobby to ready up in.
      is_ready: true,
    })
    .select("*")
    .single();
  if (playerInsert.error) {
    // Roll back the orphan campaign.
    await supabaseAdmin.from("campaigns").delete().eq("id", combatCampaignId);
    return NextResponse.json(
      { error: playerInsert.error.message },
      { status: 500 },
    );
  }
  const players: CampaignPlayer[] = [playerInsert.data as CampaignPlayer];

  // Roll initiative + walk any leading monster chain so the player
  // doesn't land on a stuck "monster's turn" if their DEX lost the
  // roll. Same pattern as /campaign/[id]/start.
  const initiativeOrder = rollInitiative(players, monsters);
  await supabaseAdmin
    .from("campaigns")
    .update({
      initiative_order: initiativeOrder,
      turn_pointer: 0,
    })
    .eq("id", combatCampaignId);

  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.current_hp]),
  );
  const activeCampaign = {
    id: combatCampaignId,
    status: "active" as const,
    created_by: user.id,
    monsters,
    turn_pointer: 0,
    turn_deadline: null,
    outcome: null,
    initiative_order: initiativeOrder,
    encounter_number: combatCampaign.encounter_number,
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

  // Stamp the coop campaign id onto the story campaign. Use the SSR
  // client so RLS confirms the caller still owns the story row.
  const { error: stampError } = await supabase
    .from("story_campaigns")
    .update({ active_combat_campaign_id: combatCampaignId })
    .eq("id", storyId);
  if (stampError) {
    return NextResponse.json({ error: stampError.message }, { status: 500 });
  }

  // Visible signal in the story log that combat has begun. Carries
  // the combat campaign id in metadata so a follow-up /combat/end
  // can correlate the resolution back to this trigger.
  const summaryCount = monsterCount > 1
    ? `${monsterCount} × ${encounter.monsterIndex}`
    : encounter.monsterIndex;
  const intentNote = encounter.intent ?? intent ?? null;
  const content = intentNote
    ? `⚔ Encounter — ${summaryCount}. ${intentNote}`
    : `⚔ Encounter — ${summaryCount}.`;
  const storyMsg: NewStoryMessage = {
    campaign_id: storyId,
    role: "system",
    content,
    author_user_id: user.id,
    metadata: {
      scene_id: currentScene.id,
      kind: "encounter_started",
      combat_campaign_id: combatCampaignId,
      monsterIndex: encounter.monsterIndex,
      count: monsterCount,
      intent: encounter.intent ?? null,
    },
  };
  const { data: insertedMsg, error: msgError } = await supabase
    .from("story_messages")
    .insert(storyMsg)
    .select()
    .single();
  if (msgError) {
    // Combat is live; the story-log marker just didn't post. Log
    // and continue — the dialog will still open from the stamped
    // active_combat_campaign_id.
    console.error("story encounter message failed", msgError.message);
  }

  await broadcastCampaignUpdate(combatCampaignId);
  return NextResponse.json(
    {
      combatCampaignId,
      message: (insertedMsg ?? null) as StoryMessage | null,
    },
    { status: 201 },
  );
}
