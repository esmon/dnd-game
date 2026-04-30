import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";
import type { Campaign, CampaignPlayer } from "@/lib/coop/types";

// Standard 5e party size cap. Encounter builder already scales the
// adjusted XP budget across N players via DMG p.83's small/large-party
// multiplier bumps, so any party between the start route's MIN and
// here is fair game.
const MAX_PLAYERS = 6;

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/join — joins a waiting campaign as a player,
// snapshotting the caller's chosen character at position N (next free
// slot, currently capped at 2).
//
// Body: { characterId } — must belong to the caller (user_id match).
//
// Returns 409 if the campaign is full or already started, or if the
// caller is already a member.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json(
      { error: "must be signed in to join a campaign" },
      { status: 401 },
    );
  }

  const { id: campaignId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    characterId?: string;
  };
  if (typeof body.characterId !== "string" || body.characterId.length === 0) {
    return NextResponse.json(
      { error: "missing characterId" },
      { status: 400 },
    );
  }

  // Character ownership check up-front — saves a round trip if the
  // user passed someone else's id.
  const charRes = await supabaseAdmin
    .from("characters")
    .select("*")
    .eq("id", body.characterId)
    .maybeSingle();
  if (charRes.error) {
    return NextResponse.json(
      { error: charRes.error.message },
      { status: 500 },
    );
  }
  if (!charRes.data) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  const character = charRes.data as Character;
  if (character.user_id !== userId) {
    return NextResponse.json(
      { error: "character not owned by caller" },
      { status: 403 },
    );
  }

  // Campaign must exist and be in lobby state.
  const campaignRes = await supabaseAdmin
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignRes.error) {
    return NextResponse.json(
      { error: campaignRes.error.message },
      { status: 500 },
    );
  }
  if (!campaignRes.data) {
    return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }
  const campaign = campaignRes.data as Campaign;
  if (campaign.status !== "waiting") {
    return NextResponse.json(
      { error: "campaign already started" },
      { status: 409 },
    );
  }

  // Pull existing players to compute the next position and to enforce
  // the player cap. The unique constraint on (campaign_id, user_id)
  // would also catch a double-join, but reading here lets us return a
  // clearer error.
  const playersRes = await supabaseAdmin
    .from("campaign_players")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: true });
  if (playersRes.error) {
    return NextResponse.json(
      { error: playersRes.error.message },
      { status: 500 },
    );
  }
  const players = (playersRes.data ?? []) as CampaignPlayer[];

  if (players.some((p) => p.user_id === userId)) {
    return NextResponse.json(
      { error: "already a member of this campaign" },
      { status: 409 },
    );
  }
  if (players.length >= MAX_PLAYERS) {
    return NextResponse.json(
      { error: "campaign is full" },
      { status: 409 },
    );
  }

  const position = players.length;
  const insertRes = await supabaseAdmin.from("campaign_players").insert({
    campaign_id: campaignId,
    user_id: userId,
    position,
    character_snapshot: character,
    current_hp: character.current_hp,
  });
  if (insertRes.error) {
    return NextResponse.json(
      { error: insertRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ campaignId, position }, { status: 201 });
}
