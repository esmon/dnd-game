import { NextRequest, NextResponse } from "next/server";

import type { Character } from "@/lib/db/schema";
import type {
  NewStoryPlayer,
  StoryCampaign,
  StoryPlayer,
  StoryPlayerRole,
} from "@/lib/dm/db";
import { broadcastStoryUpdate } from "@/lib/dm/realtime";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// Standard 5e party cap, matching coop's join route.
const MAX_PLAYERS = 6;

// POST /api/story/[id]/join — join a coop story that's waiting in
// the lobby. Body: { role?: 'player' | 'dm', characterId?: string }.
//   role 'player' (default) → bring a character; inserted at the
//     next free position. Requires characterId owned by the caller.
//   role 'dm' → claim the open DM seat (no character). Only works
//     when the seat is unclaimed; sets dm_user_id on the campaign.
//
// Mutations run through supabaseAdmin with explicit checks: a joiner
// is (by definition) not yet a member, and claiming the DM seat
// updates a row they don't own — neither fits the member-scoped RLS
// write policies, so we validate here instead. (The new lobby SELECT
// policy is what lets them *read* the lobby to get this far.)
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  let body: { role?: StoryPlayerRole; characterId?: string };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const role: StoryPlayerRole = body.role === "dm" ? "dm" : "player";

  // Campaign must exist and still be in the lobby.
  const { data: campaignRow, error: campaignError } = await supabaseAdmin
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
  if (campaign.status !== "lobby") {
    return NextResponse.json(
      { error: "this story isn't accepting players" },
      { status: 409 },
    );
  }

  // Current roster — used to reject double-joins, compute the next
  // position, enforce the cap, and check whether the DM seat is open.
  const { data: rosterRows, error: rosterError } = await supabaseAdmin
    .from("story_players")
    .select("*")
    .eq("campaign_id", id)
    .order("position", { ascending: true });
  if (rosterError) {
    return NextResponse.json({ error: rosterError.message }, { status: 500 });
  }
  const roster = (rosterRows ?? []) as StoryPlayer[];
  if (roster.some((p) => p.user_id === user.id)) {
    return NextResponse.json(
      { error: "you're already in this story" },
      { status: 409 },
    );
  }

  if (role === "dm") {
    // The seat is open only if nobody holds it on the campaign and no
    // roster row claims the dm role.
    const seatTaken =
      campaign.dm_user_id !== null || roster.some((p) => p.role === "dm");
    if (seatTaken) {
      return NextResponse.json(
        { error: "the DM seat is already taken" },
        { status: 409 },
      );
    }

    const { error: claimError } = await supabaseAdmin
      .from("story_campaigns")
      .update({ dm_user_id: user.id, dm_kind: "human" })
      .eq("id", id);
    if (claimError) {
      return NextResponse.json({ error: claimError.message }, { status: 500 });
    }

    const dmInsert: NewStoryPlayer = {
      campaign_id: id,
      user_id: user.id,
      role: "dm",
      character_id: null,
      character_snapshot: null,
      is_ready: true,
      position: roster.length,
    };
    const { data: dmRow, error: dmError } = await supabaseAdmin
      .from("story_players")
      .insert(dmInsert)
      .select()
      .single();
    if (dmError) {
      // Roll back the seat claim so it stays open for the next joiner.
      await supabaseAdmin
        .from("story_campaigns")
        .update({ dm_user_id: null })
        .eq("id", id);
      return NextResponse.json({ error: dmError.message }, { status: 500 });
    }
    await broadcastStoryUpdate(id);
    return NextResponse.json(dmRow as StoryPlayer, { status: 201 });
  }

  // role === "player" — bring a character.
  const partyCount = roster.filter((p) => p.role === "player").length;
  if (partyCount >= MAX_PLAYERS) {
    return NextResponse.json({ error: "the party is full" }, { status: 409 });
  }
  if (typeof body.characterId !== "string" || body.characterId.length === 0) {
    return NextResponse.json({ error: "missing characterId" }, { status: 400 });
  }

  // characters has no RLS yet — supabaseAdmin + explicit owner check.
  const { data: charRow, error: charError } = await supabaseAdmin
    .from("characters")
    .select("*")
    .eq("id", body.characterId)
    .maybeSingle();
  if (charError) {
    return NextResponse.json({ error: charError.message }, { status: 500 });
  }
  if (!charRow) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }
  const character = charRow as Character;
  if (character.user_id !== user.id) {
    return NextResponse.json(
      { error: "character not owned by caller" },
      { status: 403 },
    );
  }

  const playerInsert: NewStoryPlayer = {
    campaign_id: id,
    user_id: user.id,
    role: "player",
    character_id: character.id,
    character_snapshot: character,
    is_ready: false,
    position: roster.length,
  };
  const { data: playerRow, error: playerError } = await supabaseAdmin
    .from("story_players")
    .insert(playerInsert)
    .select()
    .single();
  if (playerError) {
    return NextResponse.json({ error: playerError.message }, { status: 500 });
  }
  await broadcastStoryUpdate(id);
  return NextResponse.json(playerRow as StoryPlayer, { status: 201 });
}
