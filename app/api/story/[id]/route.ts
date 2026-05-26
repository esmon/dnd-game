import { NextRequest, NextResponse } from "next/server";

import type { Character } from "@/lib/db/schema";
import type { StoryCampaign, StoryMessage, StoryPlayer } from "@/lib/dm/db";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/story/[id] — full snapshot of one campaign (row +
// messages in created_at order). The SSR client carries the caller's
// auth.uid(); RLS gates whether they're allowed to see this row
// (member: owner / dm_user_id / a story_players row).
//
// One deliberate exception: a non-member following an invite link to
// a coop *lobby* should be able to view it (to join). RLS stays
// member-scoped — opening it up would leak every lobby into the "my
// stories" list — so we fall back to an admin read and only expose
// the row when it's actually in the lobby. Once a story starts it
// locks back to members only.
export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  const { data: memberCampaign, error: campaignError } = await supabase
    .from("story_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }

  // RLS returned nothing — either it doesn't exist or the caller
  // isn't a member. Allow the one case we want visible to outsiders:
  // an open lobby. Anything else is a 404 from their perspective.
  let c = memberCampaign as StoryCampaign | null;
  if (!c) {
    const { data: lobbyRow, error: lobbyError } = await supabaseAdmin
      .from("story_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (lobbyError) {
      return NextResponse.json({ error: lobbyError.message }, { status: 500 });
    }
    const candidate = lobbyRow as StoryCampaign | null;
    if (!candidate || candidate.status !== "lobby") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    c = candidate;
  }

  const { data: messages, error: messagesError } = await supabase
    .from("story_messages")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  // Party roster. Read via admin so a lobby viewer (not yet a member,
  // so RLS would hide every row) still sees who's in; authorization
  // is already gated by the campaign read above.
  const { data: playersRows, error: playersError } = await supabaseAdmin
    .from("story_players")
    .select("*")
    .eq("campaign_id", id)
    .order("position", { ascending: true });
  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 });
  }
  const players = (playersRows ?? []) as StoryPlayer[];

  // Legacy convenience: the solo play page's party panel still reads
  // a single `character`. Resolve it from the campaign's character_id
  // when set (empty for coop-as-DM stories). characters has no RLS
  // yet — supabaseAdmin, gated transitively by the campaign read.
  let character: Character | null = null;
  if (c.character_id) {
    const { data: characterRow, error: characterError } = await supabaseAdmin
      .from("characters")
      .select("*")
      .eq("id", c.character_id)
      .maybeSingle();
    if (characterError) {
      return NextResponse.json(
        { error: characterError.message },
        { status: 500 },
      );
    }
    character = (characterRow ?? null) as Character | null;
  }

  return NextResponse.json({
    campaign: c,
    messages: (messages ?? []) as StoryMessage[],
    players,
    character,
  });
}
