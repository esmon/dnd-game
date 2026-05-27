import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryCampaignStatus,
  StoryMessage,
} from "@/lib/dm/db";
import {
  FAILURE_END,
  SUCCESS_END,
  type PlayerAction,
  type PlayerActionEffect,
} from "@/lib/dm/types";
import type { Character } from "@/lib/db/schema";
import { rollInitiative } from "@/lib/coop/initiative";
import { walkMonsterChain } from "@/lib/coop/monster-chain";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";
import type { CampaignPlayer } from "@/lib/coop/types";
import { fetchMonster } from "@/lib/game/dnd5e";
import type { Monster } from "@/lib/game/types";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/story/[id]/action — resolve an authored player action
// from the current scene. Body: { actionId }. The action must be
// declared on the campaign template's current scene (we don't trust
// the client to invent ids).
//
// Pipeline:
//   1. Look up the action on the current scene
//   2. Post its `response` as a `narrative` message (system-authored,
//      role: narrative — reads as the world responding)
//   3. Apply its effect:
//        - narrate  → no-op (the message above is enough)
//        - advance  → set current_scene_id + auto-publish the new
//                     scene's readAloud (same shape as /advance)
//        - encounter → spin up a coop campaign + post the
//                     "encounter begins" marker, same as
//                     /combat/start
//
// Combat + advance machinery duplicates the relevant parts of
// /advance and /combat/start rather than HTTP-chaining to keep the
// player-facing round-trip a single request. If a future refactor
// extracts those into shared helpers, this route should call them
// directly.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: storyId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { actionId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const actionId = body.actionId;
  if (typeof actionId !== "string" || actionId.length === 0) {
    return NextResponse.json({ error: "missing actionId" }, { status: 400 });
  }

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

  // Owner gate. Anyone who can see the story (RLS) can take an
  // action — this is the player surface. (DM-only actions like
  // "trigger encounter" used to live on the DM Notes panel; player
  // actions are explicitly authored as player-facing.)
  if (story.user_id !== user.id) {
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
      { error: "resolve the current encounter first" },
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

  const action: PlayerAction | undefined = currentScene.playerActions?.find(
    (a) => a.id === actionId,
  );
  if (!action) {
    return NextResponse.json(
      {
        error: `no action "${actionId}" on scene "${currentScene.id}"`,
      },
      { status: 400 },
    );
  }

  // Victory gate (mirrors the UI's PlayerCommands filter): a
  // `requiresVictory` beat can only fire once this scene's encounter
  // has been resolved with a win. Stops a direct API call from
  // claiming the kill without the fight.
  if (action.requiresVictory) {
    const { data: resolvedRows, error: resolvedError } = await supabase
      .from("story_messages")
      .select("metadata")
      .eq("campaign_id", storyId)
      .eq("role", "system");
    if (resolvedError) {
      return NextResponse.json(
        { error: resolvedError.message },
        { status: 500 },
      );
    }
    const won = (resolvedRows ?? []).some((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return (
        meta.kind === "encounter_resolved" &&
        meta.scene_id === currentScene.id &&
        meta.outcome === "won"
      );
    });
    if (!won) {
      return NextResponse.json(
        { error: "you haven't won this fight yet" },
        { status: 409 },
      );
    }
  }

  // 1. Post the action's response as narrative. This always runs,
  // regardless of effect — the response IS the player-visible
  // result.
  const responseMessage: NewStoryMessage = {
    campaign_id: storyId,
    role: "narrative",
    content: action.response,
    author_user_id: null,
    metadata: {
      scene_id: currentScene.id,
      kind: "player_action_response",
      action_id: action.id,
    },
  };
  const { data: respRow, error: respError } = await supabase
    .from("story_messages")
    .insert(responseMessage)
    .select()
    .single();
  if (respError) {
    return NextResponse.json({ error: respError.message }, { status: 500 });
  }
  const newMessages: StoryMessage[] = [respRow as StoryMessage];

  // 2. Apply the effect (if any).
  const effect: PlayerActionEffect | undefined = action.effect;
  let combatCampaignId: string | null = null;
  let updatedCampaign: StoryCampaign = story;

  if (effect?.kind === "advance") {
    const result = await applyAdvance(supabase, story, template, effect.to);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    newMessages.push(...result.newMessages);
    updatedCampaign = result.campaign;
  } else if (effect?.kind === "encounter") {
    const result = await applyEncounter(
      supabase,
      story,
      currentScene.id,
      effect.monsterIndex,
      effect.count,
    );
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    if (result.encounterMessage) {
      newMessages.push(result.encounterMessage);
    }
    combatCampaignId = result.combatCampaignId;
    updatedCampaign = {
      ...story,
      active_combat_campaign_id: combatCampaignId,
    };
  }

  // Narrative + any scene/combat effect just landed — fan out to
  // the rest of the party. (When this action started an encounter,
  // the combat-channel broadcast already fired upstream; this one
  // refreshes the story page itself.)
  await broadcastStoryUpdate(storyId);

  return NextResponse.json({
    campaign: updatedCampaign,
    newMessages,
    combatCampaignId,
  });
}

// ─── advance helper ─────────────────────────────────────────────
// Duplicates the logic in /advance to keep the player-action
// request a single round-trip. If shared logic is needed elsewhere,
// extract to lib/dm/server/.

type AdvanceResult =
  | { error: string; status: number }
  | { campaign: StoryCampaign; newMessages: StoryMessage[] };

async function applyAdvance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  story: StoryCampaign,
  template: NonNullable<ReturnType<typeof findCampaign>>,
  to: string,
): Promise<AdvanceResult> {
  const currentScene = template.scenes.find(
    (s) => s.id === story.current_scene_id,
  );
  if (!currentScene) {
    return {
      error: `current scene not in template: ${story.current_scene_id}`,
      status: 500,
    };
  }
  const transition = currentScene.transitions.find((t) => t.to === to);
  if (!transition) {
    return {
      error: `no transition to ${to} from ${currentScene.id}`,
      status: 400,
    };
  }

  if (to === SUCCESS_END || to === FAILURE_END) {
    const newStatus: StoryCampaignStatus =
      to === SUCCESS_END ? "completed_success" : "completed_failure";
    const closingText =
      to === SUCCESS_END
        ? template.conclusion.success
        : template.conclusion.failure;

    const { error: updateError } = await supabase
      .from("story_campaigns")
      .update({ status: newStatus })
      .eq("id", story.id);
    if (updateError) return { error: updateError.message, status: 500 };

    const closingMessage: NewStoryMessage = {
      campaign_id: story.id,
      role: "narrative",
      content: closingText,
      author_user_id: null,
      metadata: {
        scene_id: story.current_scene_id,
        kind: "conclusion",
        outcome: to,
      },
    };
    const { data: inserted, error: insertError } = await supabase
      .from("story_messages")
      .insert(closingMessage)
      .select()
      .single();
    if (insertError) return { error: insertError.message, status: 500 };

    return {
      campaign: { ...story, status: newStatus },
      newMessages: [inserted as StoryMessage],
    };
  }

  const nextScene = template.scenes.find((s) => s.id === to);
  if (!nextScene) {
    return { error: `target scene not in template: ${to}`, status: 500 };
  }

  const { error: updateError } = await supabase
    .from("story_campaigns")
    .update({ current_scene_id: nextScene.id })
    .eq("id", story.id);
  if (updateError) return { error: updateError.message, status: 500 };

  const seedMessages: NewStoryMessage[] = nextScene.readAloud.map((content) => ({
    campaign_id: story.id,
    role: "narrative",
    content,
    author_user_id: null,
    metadata: { scene_id: nextScene.id, kind: "scene_opening" },
  }));
  let inserted: StoryMessage[] = [];
  if (seedMessages.length > 0) {
    const { data: rows, error: insertError } = await supabase
      .from("story_messages")
      .insert(seedMessages)
      .select();
    if (insertError) {
      console.error("scene seed messages failed", insertError.message);
    } else {
      inserted = (rows ?? []) as StoryMessage[];
    }
  }

  return {
    campaign: { ...story, current_scene_id: nextScene.id },
    newMessages: inserted,
  };
}

// ─── encounter helper ───────────────────────────────────────────
// Duplicates the spawn-coop-campaign logic in /combat/start.

type EncounterResult =
  | { error: string; status: number }
  | {
      combatCampaignId: string;
      encounterMessage: StoryMessage | null;
    };

async function applyEncounter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  story: StoryCampaign,
  sceneId: string,
  monsterIndex: string,
  count: number | undefined,
): Promise<EncounterResult> {
  const { data: charRow, error: charError } = await supabaseAdmin
    .from("characters")
    .select("*")
    .eq("id", story.character_id)
    .maybeSingle();
  if (charError) return { error: charError.message, status: 500 };
  if (!charRow) return { error: "character not found", status: 404 };
  const character = charRow as Character;

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

  const campaignInsert = await supabaseAdmin
    .from("campaigns")
    .insert({
      status: "active",
      created_by: story.user_id,
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

  const playerInsert = await supabaseAdmin
    .from("campaign_players")
    .insert({
      campaign_id: combatCampaignId,
      user_id: story.user_id,
      position: 0,
      character_snapshot: character,
      current_hp: character.current_hp,
      is_ready: true,
    })
    .select("*")
    .single();
  if (playerInsert.error) {
    await supabaseAdmin.from("campaigns").delete().eq("id", combatCampaignId);
    return { error: playerInsert.error.message, status: 500 };
  }
  const players: CampaignPlayer[] = [playerInsert.data as CampaignPlayer];

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
    created_by: story.user_id,
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

  const { error: stampError } = await supabase
    .from("story_campaigns")
    .update({ active_combat_campaign_id: combatCampaignId })
    .eq("id", story.id);
  if (stampError) return { error: stampError.message, status: 500 };

  const summaryCount =
    monsterCount > 1 ? `${monsterCount} × ${monsterIndex}` : monsterIndex;
  const storyMsg: NewStoryMessage = {
    campaign_id: story.id,
    role: "system",
    content: `⚔ Encounter — ${summaryCount}.`,
    author_user_id: story.user_id,
    metadata: {
      scene_id: sceneId,
      kind: "encounter_started",
      combat_campaign_id: combatCampaignId,
      monsterIndex,
      count: monsterCount,
    },
  };
  const { data: insertedMsg, error: msgError } = await supabase
    .from("story_messages")
    .insert(storyMsg)
    .select()
    .single();
  if (msgError) {
    console.error("story encounter message failed", msgError.message);
  }

  await broadcastCampaignUpdate(combatCampaignId);

  return {
    combatCampaignId,
    encounterMessage: (insertedMsg ?? null) as StoryMessage | null,
  };
}
