import { NextRequest, NextResponse } from "next/server";

import type { Character } from "@/lib/db/schema";
import type { StoryCampaign, StoryMessage } from "@/lib/dm/db";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/story/[id] — full snapshot of one campaign (row +
// messages in created_at order). The SSR client carries the caller's
// auth.uid(); RLS gates whether they're allowed to see this row
// (owner or dm_user_id only) so a non-member naturally gets 404
// without us reimplementing the check in code.
export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("story_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }
  if (!campaign) {
    // Either the campaign doesn't exist or RLS hid it from this
    // caller. Either way it's a 404 from their perspective.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: messages, error: messagesError } = await supabase
    .from("story_messages")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  // Bundle the character row so the page can render the party panel
  // without a second round-trip. characters has no RLS yet —
  // supabaseAdmin is the consistent path the other story routes use.
  // The story_campaigns RLS above already established that this
  // caller owns the campaign, and the campaign points at one
  // character_id, so reading that row is safe by transitive trust.
  const c = campaign as StoryCampaign;
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

  return NextResponse.json({
    campaign: c,
    messages: (messages ?? []) as StoryMessage[],
    character: (characterRow ?? null) as Character | null,
  });
}
