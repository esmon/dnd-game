import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import { supabaseAdmin } from "@/lib/supabase";
import type { CampaignAction } from "@/lib/coop/types";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/campaign/[id] — returns the campaign + its current players
// + the action log. Membership is enforced by authorizeCampaign;
// non-members get a clean 403.
export async function GET(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { campaign, players } = auth.ctx;

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
