import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";
import type { Campaign } from "@/lib/coop/types";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/campaign/[id]/player — swaps the caller's character in the
// campaign. Only valid while the campaign is `waiting`; once active,
// frozen snapshots are load-bearing for combat math and can't be
// hot-swapped without a more involved migration of in-flight state.
//
// Body: { characterId } — must belong to the caller. The new
// character_snapshot replaces the old one, and current_hp is reset
// from the character's saved current_hp (so a half-HP character
// doesn't get a free heal by re-picking themselves).
export async function PATCH(request: NextRequest, ctx: RouteContext) {
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json(
      { error: "must be signed in" },
      { status: 401 },
    );
  }

  const { id: campaignId } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    characterId?: string;
  };
  if (typeof body.characterId !== "string" || body.characterId.length === 0) {
    return NextResponse.json(
      { error: "missing characterId" },
      { status: 400 },
    );
  }

  // Campaign must exist and still be in lobby state.
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
  if (campaign.status !== "waiting") {
    return NextResponse.json(
      { error: "campaign already started" },
      { status: 409 },
    );
  }

  // Validate character ownership before touching the campaign row.
  const charRes = await supabaseAdmin
    .from("characters")
    .select("*")
    .eq("id", body.characterId)
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

  // Caller must already be a member; we're updating their row, not
  // creating one.
  const updateRes = await supabaseAdmin
    .from("campaign_players")
    .update({
      character_snapshot: character,
      current_hp: character.current_hp,
    })
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

  return NextResponse.json({ campaignId, characterId: character.id });
}
