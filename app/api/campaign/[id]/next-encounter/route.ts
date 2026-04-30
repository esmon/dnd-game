import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import {
  buildEncounterSpec,
  nearbyCrStrings,
} from "@/lib/coop/encounter-builder";
import { rollInitiative } from "@/lib/coop/initiative";
import { walkMonsterChain } from "@/lib/coop/monster-chain";
import {
  fetchMonster,
  fetchMonsterIndexListByCrs,
  pickRandomMonsterIndex,
} from "@/lib/game/dnd5e";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/next-encounter — chains into another fight
// from the rest screen. Any member can trigger it (it's a party
// decision, but anyone can pull the trigger). Increments
// encounter_number, revives every player to full HP, rolls a new
// encounter spec + initiative, and flips status back to active. If
// initiative puts a monster ahead of all players, the leading swings
// land before the response returns — same shape as the start route.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { campaign, players } = auth.ctx;

  if (campaign.status !== "between_encounters") {
    return NextResponse.json(
      { error: "campaign is not between encounters" },
      { status: 409 },
    );
  }

  // Roll a fresh encounter for the now-revived party. Same builder as
  // the start route — random difficulty (weighted), random monster
  // count, target CR derived from the party's adjusted XP budget at
  // their *current* levels (any level-ups from the prior encounter
  // are already on the snapshots).
  const playerLevels = players.map((p) => p.character_snapshot.level);
  const spec = buildEncounterSpec(playerLevels);

  let monsters;
  try {
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

  const initiativeOrder = rollInitiative(players, monsters);
  const nextEncounterNumber = campaign.encounter_number + 1;

  // Revive every player to full HP. Spell slots and consumables stay
  // at whatever the prior encounter left them — the rest is short, not
  // long. We may want a Hit-Dice-based partial heal later, but full
  // restore keeps the MVP loop tight.
  for (const player of players) {
    await supabaseAdmin
      .from("campaign_players")
      .update({ current_hp: player.character_snapshot.max_hp })
      .eq("id", player.id);
  }

  // Flip into the new encounter atomically with the bookkeeping —
  // status, fresh monster pool, fresh initiative, pointer reset to
  // top of the new initiative order, encounter number incremented.
  // walkMonsterChain reads campaign.encounter_number to stamp action
  // rows, so we update first then run the chain.
  const flip = await supabaseAdmin
    .from("campaigns")
    .update({
      status: "active",
      monsters,
      turn_pointer: 0,
      initiative_order: initiativeOrder,
      encounter_number: nextEncounterNumber,
      current_difficulty: spec.difficulty,
    })
    .eq("id", campaignId);

  if (flip.error) {
    return NextResponse.json(
      { error: flip.error.message },
      { status: 500 },
    );
  }

  // Same leading-monster-chain as the start route: if initiative puts
  // a monster ahead of every player, run those swings now.
  const activeCampaign = {
    ...campaign,
    status: "active" as const,
    monsters,
    turn_pointer: 0,
    initiative_order: initiativeOrder,
    encounter_number: nextEncounterNumber,
  };
  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.character_snapshot.max_hp]),
  );

  // Determine the next turn_number for this campaign — actions are
  // monotonically numbered across the entire campaign (not reset per
  // encounter), so the chain-walker keeps inserting from wherever
  // the prior encounter left off.
  const lastActionRes = await supabaseAdmin
    .from("campaign_actions")
    .select("turn_number")
    .eq("campaign_id", campaignId)
    .order("turn_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextTurnNumber =
    typeof lastActionRes.data?.turn_number === "number"
      ? lastActionRes.data.turn_number + 1
      : 0;

  const chain = await walkMonsterChain({
    campaignId,
    campaign: activeCampaign,
    players,
    monsters,
    playerHp,
    pointer: 0,
    nextTurnNumber,
  });

  const finalUpdate: Record<string, unknown> = { turn_pointer: chain.pointer };
  if (chain.defeat) {
    finalUpdate.status = "finished";
    finalUpdate.outcome = "lost";
  }
  await supabaseAdmin
    .from("campaigns")
    .update(finalUpdate)
    .eq("id", campaignId);

  return NextResponse.json({
    campaignId,
    encounter_number: nextEncounterNumber,
    monsters,
    encounter: spec,
    initiative: initiativeOrder,
  });
}
