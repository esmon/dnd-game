import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/forfeit — any active player ends the
// campaign for the whole party. Outcome is "lost"; HP resets on each
// player's character row (matching the defeat-recovery from the action
// endpoint) so nobody returns to home stuck low. No XP or loot
// persists — same as a defeat.
//
// Useful when one player rage-quits or the encounter is unwinnable;
// without it the other party member can't escape an active campaign.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { campaign, players } = auth.ctx;

  if (campaign.status !== "active") {
    return NextResponse.json(
      { error: "campaign not active" },
      { status: 409 },
    );
  }

  await supabaseAdmin
    .from("campaigns")
    .update({ status: "finished", outcome: "lost" })
    .eq("id", campaignId);

  // Reset HP on each character so the home page bootstrap doesn't
  // resurrect with 0 HP. Match defeat-recovery behavior — no other
  // snapshot state syncs back, so consumed slots / used potions
  // during the campaign just evaporate.
  for (const player of players) {
    await supabaseAdmin
      .from("characters")
      .update({
        current_hp: player.character_snapshot.max_hp,
      } satisfies Partial<Character>)
      .eq("id", player.character_snapshot.id);
  }

  await broadcastCampaignUpdate(campaignId);
  return NextResponse.json({ ok: true });
}
