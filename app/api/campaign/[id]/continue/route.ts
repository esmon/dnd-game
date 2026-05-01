import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import { buildEncounterSpec } from "@/lib/coop/encounter-builder";
import { fetchMonsterPoolForSpec } from "@/lib/coop/encounter-pool";
import { rollInitiative } from "@/lib/coop/initiative";
import {
  nextTurnNumberFor,
  walkMonsterChain,
} from "@/lib/coop/monster-chain";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";
import { slotsForLevel } from "@/lib/dnd/spells";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/continue — defeat-screen "Play Again" vote.
// Each call flips the caller's continue_ready flag. When every
// member is ready, the same call rerolls the encounter at the same
// encounter_number (no XP awarded for the failed run, but levels /
// loot earned earlier in the campaign stay since they're already on
// the snapshots), restores HP / spell slots, and flips status back
// to active. Mirrors the next-encounter route's reset logic but
// keeps the encounter counter where it was so the recap still
// reflects "this is the encounter that killed you, take 2."
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { campaign, myPlayer } = auth.ctx;

  if (campaign.status !== "finished" || campaign.outcome !== "lost") {
    return NextResponse.json(
      { error: "campaign is not in a defeated state" },
      { status: 409 },
    );
  }
  if (!myPlayer) {
    return NextResponse.json(
      { error: "caller has no player row" },
      { status: 403 },
    );
  }

  // Vote: idempotent flip of this player's continue_ready. We re-read
  // the player rows after the flip (rather than mutating in-memory)
  // so the all-ready check sees a consistent post-write view, even
  // if two players click roughly simultaneously.
  if (!myPlayer.continue_ready) {
    const flag = await supabaseAdmin
      .from("campaign_players")
      .update({ continue_ready: true })
      .eq("id", myPlayer.id);
    if (flag.error) {
      return NextResponse.json(
        { error: `failed to record vote: ${flag.error.message}` },
        { status: 500 },
      );
    }
  }

  const refresh = await supabaseAdmin
    .from("campaign_players")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: true });
  if (refresh.error) {
    return NextResponse.json(
      { error: `failed to refresh players: ${refresh.error.message}` },
      { status: 500 },
    );
  }
  const refreshed = refresh.data ?? [];
  const allReady = refreshed.length > 0 && refreshed.every((p) => p.continue_ready);

  if (!allReady) {
    // Still waiting on at least one teammate. Broadcast so other
    // clients see the vote land in their UI immediately.
    await broadcastCampaignUpdate(campaignId);
    return NextResponse.json({ campaignId, ready: false });
  }

  // All in — reset the run. Same long-rest reset as next-encounter:
  // full HP, full spell slots, consumables stay (physical items the
  // party doesn't magically restock).
  for (const player of refreshed) {
    const refreshedSnapshot = {
      ...player.character_snapshot,
      spell_slots: slotsForLevel(player.character_snapshot.level),
    };
    const restoredHp = player.character_snapshot.max_hp;
    const update = await supabaseAdmin
      .from("campaign_players")
      .update({
        current_hp: restoredHp,
        character_snapshot: refreshedSnapshot,
        continue_ready: false,
      })
      .eq("id", player.id);
    if (update.error) {
      return NextResponse.json(
        { error: `failed to restore player state: ${update.error.message}` },
        { status: 500 },
      );
    }
  }

  // Roll a fresh encounter and bump the counter. The battle UI scopes
  // its action log + HP derivation by encounter_number, so reusing
  // the failed run's number bled prior swings/deaths into the retry —
  // bumping gives the new fight a clean slate (same shape as
  // next-encounter, but coming off a defeat instead of a clear).
  const playerLevels = refreshed.map((p) => p.character_snapshot.level);
  const spec = buildEncounterSpec(playerLevels);
  const pool = await fetchMonsterPoolForSpec(spec);
  if (!pool.ok) {
    return NextResponse.json({ error: pool.error }, { status: pool.status });
  }
  const monsters = pool.monsters;
  const initiativeOrder = rollInitiative(refreshed, monsters);
  const nextEncounterNumber = campaign.encounter_number + 1;

  const flip = await supabaseAdmin
    .from("campaigns")
    .update({
      status: "active",
      outcome: null,
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

  // Same leading-monster-chain handling as start / next-encounter.
  // walkMonsterChain reads campaign.encounter_number to stamp action
  // rows, so the new value has to be on the campaign object it sees.
  const activeCampaign = {
    ...campaign,
    status: "active" as const,
    outcome: null,
    monsters,
    turn_pointer: 0,
    initiative_order: initiativeOrder,
    encounter_number: nextEncounterNumber,
  };
  const playerHp: Record<string, number> = Object.fromEntries(
    refreshed.map((p) => [p.id, p.character_snapshot.max_hp]),
  );

  let nextTurnNumber: number;
  try {
    nextTurnNumber = await nextTurnNumberFor(campaignId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const chain = await walkMonsterChain({
    campaignId,
    campaign: activeCampaign,
    players: refreshed,
    monsters,
    playerHp,
    pointer: 0,
    nextTurnNumber,
  });

  const finalUpdate: Record<string, unknown> = {
    turn_pointer: chain.pointer,
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

  // Note from the parallel players for any callers that want to know
  // whether the click was the one that triggered the reset.
  return NextResponse.json({ campaignId, ready: true, encounter: spec });
}
