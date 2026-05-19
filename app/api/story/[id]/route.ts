import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type { StoryCampaign, StoryMessage } from "@/lib/dm/db";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/story/[id] — full snapshot of one campaign (row +
// messages in created_at order). The story page loads this once on
// mount; subsequent updates either come from the player POSTing a
// message (returns the new row) or from a future realtime channel.
export async function GET(request: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json({ error: "sign-in required" }, { status: 401 });
  }

  // supabaseAdmin bypasses RLS; the explicit user_id / dm_user_id
  // check below is the actual authorization gate.
  const { data: campaign, error: campaignError } = await supabaseAdmin
    .from("story_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json({ error: campaignError.message }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const c = campaign as StoryCampaign;
  if (c.user_id !== userId && c.dm_user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: messages, error: messagesError } = await supabaseAdmin
    .from("story_messages")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return NextResponse.json({ error: messagesError.message }, { status: 500 });
  }

  return NextResponse.json({
    campaign: c,
    messages: (messages ?? []) as StoryMessage[],
  });
}
