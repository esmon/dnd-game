import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import {
  fetchMonster,
  fetchMonsterIndexListByCrs,
  pickRandomMonsterIndex,
} from "@/lib/game/dnd5e";
import { supabaseAdmin } from "@/lib/supabase";
import {
  buildEncounterSpec,
  nearbyCrStrings,
} from "@/lib/coop/encounter-builder";
import { rollInitiative } from "@/lib/coop/initiative";

type RouteContext = { params: Promise<{ id: string }> };

const MIN_PLAYERS_TO_START = 2;

// POST /api/campaign/[id]/start — creator-only. Validates the lobby is
// full enough to fight, picks a monster pool sized to the party's
// average level, and flips status from waiting → active. Once active,
// no more players can join and the action loop (Phase M3) takes over.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId, "creator");
  if (!auth.ok) return auth.response;
  const { campaign, players } = auth.ctx;

  if (campaign.status !== "waiting") {
    return NextResponse.json(
      { error: "campaign already started" },
      { status: 409 },
    );
  }

  if (players.length < MIN_PLAYERS_TO_START) {
    return NextResponse.json(
      { error: `need at least ${MIN_PLAYERS_TO_START} players to start` },
      { status: 409 },
    );
  }

  // Every non-creator player must explicitly ready up. The creator's
  // own ready flag is implicit — clicking Start is the signal — so we
  // skip it in this check.
  const notReady = players.filter(
    (p) => p.user_id !== campaign.created_by && !p.is_ready,
  );
  if (notReady.length > 0) {
    return NextResponse.json(
      { error: "waiting on other players to ready up" },
      { status: 409 },
    );
  }

  // Roll a 5e-style encounter spec: random difficulty (weighted toward
  // medium), random monster count (weighted toward 1–2), and a target
  // CR derived from the party's adjusted XP budget. See
  // lib/coop/encounter-builder.ts for the math.
  const playerLevels = players.map((p) => p.character_snapshot.level);
  const spec = buildEncounterSpec(playerLevels);

  let monsters;
  try {
    // Try the target CR first; widen outward if dnd5eapi has nothing
    // listed at that CR (rare, but possible for niche tiers).
    let indices = await fetchMonsterIndexListByCrs([spec.perMonsterCr]);
    if (indices.length === 0) {
      indices = await fetchMonsterIndexListByCrs(
        nearbyCrStrings(spec.perMonsterCr, 2),
      );
    }
    const picks: string[] = [];
    for (let i = 0; i < spec.monsterCount; i++) {
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

  // Roll initiative for the whole party + monster pool; persist the
  // resulting slot order so action route + UI agree on whose turn is
  // next regardless of position.
  const initiativeOrder = rollInitiative(players, monsters);

  const update = await supabaseAdmin
    .from("campaigns")
    .update({
      status: "active",
      monsters,
      turn_pointer: 0,
      initiative_order: initiativeOrder,
    })
    .eq("id", campaignId);

  if (update.error) {
    return NextResponse.json(
      { error: update.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    campaignId,
    monsters,
    encounter: spec,
    initiative: initiativeOrder,
  });
}
