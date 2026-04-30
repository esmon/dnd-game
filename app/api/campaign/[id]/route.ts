import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import { supabaseAdmin } from "@/lib/supabase";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/campaign/[id] — returns the campaign + its current players,
// scoped to members of the campaign. The lobby UI polls this on first
// load and then subscribes to Realtime for live updates.
//
// Anyone with the link can hit this, but they only get data back if
// they're already a player on the campaign or are the creator. Once
// joined they keep access (RLS would also enforce this server-side
// against signed-in clients, but we double-check here so unauthorized
// callers get a clean 403 instead of an empty payload).
export async function GET(request: NextRequest, ctx: RouteContext) {
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json(
      { error: "must be signed in" },
      { status: 401 },
    );
  }

  const { id: campaignId } = await ctx.params;

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

  // Authorization: caller must be the creator or a player. The creator
  // can preview an empty lobby before anyone joins; players who later
  // leave (future feature) lose access along with their row.
  const isMember =
    campaign.created_by === userId ||
    players.some((p) => p.user_id === userId);
  if (!isMember) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Pull the action log so the combat view can render it without a
  // second round trip. Cheap while turn counts are small; we'll
  // paginate or trim if a long campaign ever runs hot.
  const actionsRes = await supabaseAdmin
    .from("campaign_actions")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("turn_number", { ascending: true });
  if (actionsRes.error) {
    return NextResponse.json(
      { error: actionsRes.error.message },
      { status: 500 },
    );
  }
  const actions = (actionsRes.data ?? []) as CampaignAction[];

  return NextResponse.json({ campaign, players, actions });
}
