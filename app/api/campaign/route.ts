import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import type { Character } from "@/lib/db/schema";
import { supabaseAdmin } from "@/lib/supabase";

// POST /api/campaign — creates a waiting campaign owned by the signed-in
// caller, with their selected character snapshotted as player 0.
//
// Body: { characterId: string } — must belong to the caller (user_id
// match). The character is loaded fresh and dropped into
// `campaign_players.character_snapshot` so future level-ups don't
// retroactively buff a frozen campaign.
//
// Returns: { campaignId } — caller routes to /campaign/[id] which is
// the lobby until the second player joins.
export async function POST(request: NextRequest) {
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json(
      { error: "must be signed in to create a campaign" },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    characterId?: string;
  };
  if (typeof body.characterId !== "string" || body.characterId.length === 0) {
    return NextResponse.json(
      { error: "missing characterId" },
      { status: 400 },
    );
  }

  // Confirm the character exists and belongs to this user. user_id check
  // is the new ownership path; legacy session-only characters can't seed
  // a campaign (they'd need to sign in / claim first, which is fine).
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

  // Insert the campaign row first so we can reference its id when
  // adding the creator as player 0.
  const campaignInsert = await supabaseAdmin
    .from("campaigns")
    .insert({
      status: "waiting",
      created_by: userId,
      monsters: [],
      turn_pointer: 0,
    })
    .select("id")
    .single();

  if (campaignInsert.error) {
    return NextResponse.json(
      { error: campaignInsert.error.message },
      { status: 500 },
    );
  }

  const campaignId = (campaignInsert.data as { id: string }).id;

  const playerInsert = await supabaseAdmin.from("campaign_players").insert({
    campaign_id: campaignId,
    user_id: userId,
    position: 0,
    character_snapshot: character,
    current_hp: character.current_hp,
  });

  if (playerInsert.error) {
    // Roll back the campaign so we don't leave an orphan row. Cascade
    // FKs would handle this on user delete but not here.
    await supabaseAdmin.from("campaigns").delete().eq("id", campaignId);
    return NextResponse.json(
      { error: playerInsert.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ campaignId }, { status: 201 });
}
