import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type { StoryCampaign } from "@/lib/dm/db";
import { spawnStoryEncounter } from "@/lib/dm/combat";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
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

  // Spawn the fight for the whole story party (shared helper). The
  // triggering DM is created_by + author; the roster supplies the
  // combatants. In solo this is just the owner's single roster row.
  const result = await spawnStoryEncounter({
    story,
    sceneId: currentScene.id,
    monsterIndex: encounter.monsterIndex,
    count: encounter.count,
    createdBy: user.id,
    authorUserId: user.id,
    intent: encounter.intent ?? intent ?? null,
  });
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await broadcastCampaignUpdate(result.combatCampaignId);
  // Also nudge the story page so every member's locked combat
  // dialog mounts off the new active_combat_campaign_id.
  await broadcastStoryUpdate(storyId);
  return NextResponse.json(
    {
      combatCampaignId: result.combatCampaignId,
      message: result.encounterMessage,
    },
    { status: 201 },
  );
}
