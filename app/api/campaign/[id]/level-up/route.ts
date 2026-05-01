import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import { applyCharacterLevelUps } from "@/lib/coop/leveling";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/level-up — fold any banked XP into actual
// level/HP/spell gains for every campaign member. Idempotent (a
// player already at levelForXp(xp) is a no-op) so the rest screen
// can fire it on mount without coordination. Backfill for
// campaigns whose kills predate the per-kill level-up path in the
// action route; new campaigns rarely hit this with anything to do.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { players } = auth.ctx;

  let leveled = false;
  for (const player of players) {
    const result = applyCharacterLevelUps(player.character_snapshot);
    if (result.levelsGained.length === 0) continue;
    leveled = true;
    const update = await supabaseAdmin
      .from("campaign_players")
      .update({
        character_snapshot: result.character,
        // Level-up adds the rolled HP gain to the running current_hp;
        // mirror it on the campaign_players column so the battle UI
        // stays in sync. Cap at the new max so the bump can't push
        // anyone past full.
        current_hp: Math.min(
          result.character.max_hp,
          player.current_hp +
            (result.character.max_hp - player.character_snapshot.max_hp),
        ),
      })
      .eq("id", player.id);
    if (update.error) {
      return NextResponse.json(
        { error: `failed to apply level-up: ${update.error.message}` },
        { status: 500 },
      );
    }
  }

  if (leveled) {
    await broadcastCampaignUpdate(campaignId);
  }
  return NextResponse.json({ campaignId, leveled });
}
