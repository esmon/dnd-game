import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import {
  fetchMonster,
  fetchMonsterIndexList,
  pickRandomMonsterIndex,
} from "@/lib/game/dnd5e";
import { supabaseAdmin } from "@/lib/supabase";
import type { Campaign, CampaignPlayer } from "@/lib/coop/types";

type RouteContext = { params: Promise<{ id: string }> };

const MIN_PLAYERS_TO_START = 2;
// MVP: one monster per encounter, sized to party average level. Future
// passes can take a body param for multi-monster fights, themed pools,
// etc.
const MONSTER_COUNT = 1;

// POST /api/campaign/[id]/start — creator-only. Validates the lobby is
// full enough to fight, picks a monster pool sized to the party's
// average level, and flips status from waiting → active. Once active,
// no more players can join and the action loop (Phase M3) takes over.
export async function POST(request: NextRequest, ctx: RouteContext) {
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

  if (campaign.created_by !== userId) {
    return NextResponse.json(
      { error: "only the creator can start the campaign" },
      { status: 403 },
    );
  }
  if (campaign.status !== "waiting") {
    return NextResponse.json(
      { error: "campaign already started" },
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

  if (players.length < MIN_PLAYERS_TO_START) {
    return NextResponse.json(
      { error: `need at least ${MIN_PLAYERS_TO_START} players to start` },
      { status: 409 },
    );
  }

  // Average party level — keeps a low-level player from getting bodied
  // alongside a level-20 friend, and avoids trivializing high-level
  // characters with a CR-1 monster. round() is "good enough" for MVP.
  const avgLevel = Math.max(
    1,
    Math.round(
      players.reduce(
        (sum, p) => sum + p.character_snapshot.level,
        0,
      ) / players.length,
    ),
  );

  let monsters;
  try {
    const indices = await fetchMonsterIndexList(avgLevel);
    const picks: string[] = [];
    for (let i = 0; i < MONSTER_COUNT; i++) {
      const pick = pickRandomMonsterIndex(indices);
      if (!pick) break;
      picks.push(pick.index);
    }
    if (picks.length === 0) {
      return NextResponse.json(
        { error: "no monsters available for this party level" },
        { status: 500 },
      );
    }
    monsters = await Promise.all(picks.map((index) => fetchMonster(index)));
  } catch (err) {
    return NextResponse.json(
      {
        error: `monster pool fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  const update = await supabaseAdmin
    .from("campaigns")
    .update({
      status: "active",
      monsters,
      turn_pointer: 0,
    })
    .eq("id", campaignId);

  if (update.error) {
    return NextResponse.json(
      { error: update.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ campaignId, monsters });
}
