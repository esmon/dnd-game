import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/end-campaign — voluntarily ends a campaign
// from the rest screen. Outcome is "won" because the party survived
// every encounter they fought; per-encounter rewards already
// committed via persistVictoryRewards on each win, so there's no
// extra sync to do here.
//
// Distinct from /forfeit (which exists for active fights and counts
// as a defeat). End-campaign only applies in between_encounters.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { campaign } = auth.ctx;

  if (campaign.status !== "between_encounters") {
    return NextResponse.json(
      { error: "campaign is not between encounters" },
      { status: 409 },
    );
  }

  const update = await supabaseAdmin
    .from("campaigns")
    .update({ status: "finished", outcome: "won" })
    .eq("id", campaignId);
  if (update.error) {
    return NextResponse.json(
      { error: update.error.message },
      { status: 500 },
    );
  }

  await broadcastCampaignUpdate(campaignId);
  return NextResponse.json({ ok: true, outcome: "won" });
}
