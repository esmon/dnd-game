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
import { walkMonsterChain } from "@/lib/coop/monster-chain";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";

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

  // Flip status to active first so walkMonsterChain's writes (action
  // log rows, current_hp updates) land on a non-waiting campaign.
  // Initiative order has to be persisted at the same time because the
  // chain-walker reads it back via the campaign param.
  const flip = await supabaseAdmin
    .from("campaigns")
    .update({
      status: "active",
      monsters,
      turn_pointer: 0,
      initiative_order: initiativeOrder,
      current_difficulty: spec.difficulty,
    })
    .eq("id", campaignId);

  if (flip.error) {
    return NextResponse.json(
      { error: flip.error.message },
      { status: 500 },
    );
  }

  // If initiative put a monster ahead of every player, run those
  // swings now so the first player to load the battle screen sees
  // their own turn (and any damage already taken), not a stuck
  // "Goblin's turn" that nobody can advance.
  const activeCampaign = {
    ...campaign,
    status: "active" as const,
    monsters,
    turn_pointer: 0,
    initiative_order: initiativeOrder,
  };
  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.current_hp]),
  );
  const chain = await walkMonsterChain({
    campaignId,
    campaign: activeCampaign,
    players,
    monsters,
    playerHp,
    pointer: 0,
    nextTurnNumber: 0,
  });

  // Persist the resulting pointer (and outcome if the opening round
  // somehow downed every PC). Defeat at start is exceedingly unlikely
  // — players are at full HP, no consumables spent — but handle it
  // for completeness so the campaign doesn't sit "active" with a
  // dead party.
  const finalUpdate: Record<string, unknown> = {
    turn_pointer: chain.pointer,
    // Arm the idle-skip timer if combat is still live.
    turn_deadline: chain.defeat ? null : nextTurnDeadline(),
  };
  if (chain.defeat) {
    finalUpdate.status = "finished";
    finalUpdate.outcome = "lost";
  }
  await supabaseAdmin
    .from("campaigns")
    .update(finalUpdate)
    .eq("id", campaignId);

  await broadcastCampaignUpdate(campaignId);
  return NextResponse.json({
    campaignId,
    monsters,
    encounter: spec,
    initiative: initiativeOrder,
  });
}
