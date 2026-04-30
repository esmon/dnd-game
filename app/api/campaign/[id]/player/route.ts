import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/campaign/[id]/player — updates the caller's row in the
// campaign. Only valid while the campaign is `waiting`; once active,
// frozen snapshots are load-bearing for combat math and can't be
// hot-swapped without a more involved migration of in-flight state.
//
// Body (any subset):
//   - characterId: string — swap to a new character (must belong to the
//     caller). Snapshot is replaced and current_hp is reset from the
//     character's saved current_hp so a half-HP character doesn't get a
//     free heal by re-picking themselves. Changing characters also
//     resets is_ready to false — picking a new sheet implies you're
//     reconsidering, so the creator shouldn't be able to start in the
//     same poll cycle.
//   - ready: boolean — toggle the ready flag.
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { userId, campaign, myPlayer } = auth.ctx;

  const body = (await request.json().catch(() => ({}))) as {
    characterId?: string;
    ready?: boolean;
  };
  const wantsCharacterChange = typeof body.characterId === "string" && body.characterId.length > 0;
  const wantsReadyChange = typeof body.ready === "boolean";
  if (!wantsCharacterChange && !wantsReadyChange) {
    return NextResponse.json(
      { error: "nothing to update — pass characterId and/or ready" },
      { status: 400 },
    );
  }

  if (campaign.status !== "waiting") {
    return NextResponse.json(
      { error: "campaign already started" },
      { status: 409 },
    );
  }

  if (!myPlayer) {
    return NextResponse.json(
      { error: "not a member of this campaign" },
      { status: 403 },
    );
  }

  const patch: Record<string, unknown> = {};

  if (wantsCharacterChange) {
    // Validate character ownership before touching the campaign row.
    const charRes = await supabaseAdmin
      .from("characters")
      .select("*")
      .eq("id", body.characterId!)
      .maybeSingle();
    if (charRes.error) {
      return NextResponse.json(
        { error: charRes.error.message },
        { status: 500 },
      );
    }
    if (!charRes.data) {
      return NextResponse.json({ error: "character not found" }, { status: 404 });
    }
    const character = charRes.data as Character;
    if (character.user_id !== userId) {
      return NextResponse.json(
        { error: "character not owned by caller" },
        { status: 403 },
      );
    }
    patch.character_snapshot = character;
    patch.current_hp = character.current_hp;
    // Re-arming the ready flag on character change keeps the creator
    // from starting on a stale "ready" if you swap mid-deliberation.
    patch.is_ready = false;
  }

  if (wantsReadyChange) {
    // One-way: ready is a commitment, not a toggle. Unreadying directly
    // would invite spam right before the creator clicks Start. The
    // legitimate way to "unready" is to swap characters, which already
    // resets the flag above as a side effect.
    if (body.ready === false) {
      return NextResponse.json(
        { error: "ready is one-way; change character to reset" },
        { status: 409 },
      );
    }
    patch.is_ready = true;
  }

  // Caller must already be a member; we're updating their row, not
  // creating one.
  const updateRes = await supabaseAdmin
    .from("campaign_players")
    .update(patch)
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (updateRes.error) {
    return NextResponse.json(
      { error: updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data) {
    return NextResponse.json(
      { error: "not a member of this campaign" },
      { status: 403 },
    );
  }

  return NextResponse.json({ campaignId });
}
