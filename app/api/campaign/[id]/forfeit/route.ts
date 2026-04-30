import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";
import type { Campaign, CampaignPlayer } from "@/lib/coop/types";

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
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json({ error: "must be signed in" }, { status: 401 });
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
  if (campaign.status !== "active") {
    return NextResponse.json(
      { error: "campaign not active" },
      { status: 409 },
    );
  }

  const playersRes = await supabaseAdmin
    .from("campaign_players")
    .select("*")
    .eq("campaign_id", campaignId);
  if (playersRes.error) {
    return NextResponse.json(
      { error: playersRes.error.message },
      { status: 500 },
    );
  }
  const players = (playersRes.data ?? []) as CampaignPlayer[];

  // Caller must be a member.
  if (!players.some((p) => p.user_id === userId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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

  return NextResponse.json({ ok: true });
}
