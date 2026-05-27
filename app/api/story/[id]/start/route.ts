import { NextRequest, NextResponse } from "next/server";

import { findCampaign } from "@/lib/dm/campaigns";
import type {
  NewStoryMessage,
  StoryCampaign,
  StoryPlayer,
} from "@/lib/dm/db";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const MIN_PLAYERS_TO_START = 1;

// POST /api/story/[id]/start — DM-only. Flips a coop story from
// 'lobby' to 'active' and seeds the first scene's readAloud, the
// same opening solo gets at create time. Gated on:
//   - caller is the DM seat (dm_user_id)
//   - status is currently 'lobby'
//   - there's at least one player (besides the DM) and every
//     player has readied up
export async function POST(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  const { data: campaignRow, error: campaignError } = await supabase
    .from("story_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }
  if (!campaignRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const campaign = campaignRow as StoryCampaign;

  // Only the DM seat can start. (dm_user_id is set when the creator
  // took the DM seat, or when a joiner claimed it.)
  if (campaign.dm_user_id !== user.id) {
    return NextResponse.json(
      { error: "only the DM can start the story" },
      { status: 403 },
    );
  }
  if (campaign.status !== "lobby") {
    return NextResponse.json(
      { error: "story is not in the lobby" },
      { status: 409 },
    );
  }

  const { data: playersRows, error: playersError } = await supabase
    .from("story_players")
    .select("*")
    .eq("campaign_id", id);
  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 });
  }
  const players = (playersRows ?? []) as StoryPlayer[];
  const partyPlayers = players.filter((p) => p.role === "player");
  if (partyPlayers.length < MIN_PLAYERS_TO_START) {
    return NextResponse.json(
      { error: "need at least one player to start" },
      { status: 409 },
    );
  }
  const notReady = partyPlayers.filter((p) => !p.is_ready);
  if (notReady.length > 0) {
    return NextResponse.json(
      { error: "waiting on players to ready up" },
      { status: 409 },
    );
  }

  const template = findCampaign(campaign.campaign_template_id);
  if (!template || template.scenes.length === 0) {
    return NextResponse.json(
      { error: "campaign template missing or empty" },
      { status: 500 },
    );
  }
  const firstScene = template.scenes.find(
    (s) => s.id === campaign.current_scene_id,
  ) ?? template.scenes[0];

  const { error: flipError } = await supabase
    .from("story_campaigns")
    .update({ status: "active" })
    .eq("id", id);
  if (flipError) {
    return NextResponse.json({ error: flipError.message }, { status: 500 });
  }

  // Seed the opening narrative now that play has begun. Same shape
  // as the solo create path.
  const seedMessages: NewStoryMessage[] = firstScene.readAloud.map(
    (content) => ({
      campaign_id: id,
      role: "narrative",
      content,
      author_user_id: null,
      metadata: { scene_id: firstScene.id, kind: "scene_opening" },
    }),
  );
  if (seedMessages.length > 0) {
    const { error: seedError } = await supabase
      .from("story_messages")
      .insert(seedMessages);
    if (seedError) {
      console.error("story start seed failed", seedError.message);
    }
  }

  // Tell every lobby member the story has begun so their page swaps
  // to the play surface immediately.
  await broadcastStoryUpdate(id);

  return NextResponse.json({
    campaign: { ...campaign, status: "active" } satisfies StoryCampaign,
  });
}
