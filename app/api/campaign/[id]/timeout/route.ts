import { NextRequest, NextResponse } from "next/server";

import { authorizeCampaign } from "@/lib/coop/auth";
import {
  nextTurnNumberFor,
  walkMonsterChain,
} from "@/lib/coop/monster-chain";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { resolveSkip } from "@/lib/coop/server-actions";
import {
  nextAliveSlot,
  slotsForCampaign,
} from "@/lib/coop/turn-order";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";
import { supabaseAdmin } from "@/lib/supabase";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/timeout — auto-skip the active player when
// their turn deadline has expired. Any member can call it; the server
// validates the deadline and is idempotent (a second client racing to
// fire just sees the deadline reset and 409s).
//
// On success: insert a skip action for the idle player, walk the
// monster chain to the next player, and arm a fresh deadline.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { campaign, players } = auth.ctx;

  if (campaign.status !== "active") {
    return NextResponse.json(
      { error: "campaign is not active" },
      { status: 409 },
    );
  }
  if (
    !campaign.turn_deadline ||
    new Date(campaign.turn_deadline).getTime() > Date.now()
  ) {
    return NextResponse.json(
      { error: "turn has not yet expired" },
      { status: 409 },
    );
  }

  const monsters = [...campaign.monsters];
  let pointer = campaign.turn_pointer;
  const current = nextAliveSlot(pointer, campaign, players, monsters);
  if (!current) {
    return NextResponse.json(
      { error: "no live actor — campaign already over" },
      { status: 409 },
    );
  }
  pointer = current.pointer;

  let nextTurnNumber: number;
  try {
    nextTurnNumber = await nextTurnNumberFor(campaignId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Normal case: deadline expired, current slot is a player. Insert a
  // skip on their behalf and advance one slot before walking the
  // monster chain. If we somehow land on a monster slot here (e.g.
  // a previous chain returned the wrong pointer because of stale
  // in-memory aliveness — fixed in walkMonsterChain but old campaigns
  // can be in this state), skip the skip-insert step and just walk
  // the chain forward to unstick the campaign.
  const slotCount = slotsForCampaign(campaign, players, monsters).length;
  if (current.slot.kind === "player") {
    const idlePlayer = players[current.slot.index];
    const skipResolution = resolveSkip(idlePlayer);
    if (!skipResolution.ok) {
      return NextResponse.json(
        { error: skipResolution.error },
        { status: skipResolution.status },
      );
    }
    const skipInsert = await supabaseAdmin.from("campaign_actions").insert({
      campaign_id: campaignId,
      turn_number: nextTurnNumber,
      encounter_number: campaign.encounter_number,
      ...skipResolution.action,
      payload: {
        ...skipResolution.action.payload,
        // Mark the skip as a timeout so the log line reads "X timed
        // out and skipped" rather than "X skips their turn".
        timeout: true,
      },
    });
    if (skipInsert.error) {
      return NextResponse.json(
        { error: `failed to log skip: ${skipInsert.error.message}` },
        { status: 500 },
      );
    }
    nextTurnNumber++;
  }

  // Walk forward through any monster turns up to the next player.
  pointer = (pointer + 1) % slotCount;

  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.current_hp]),
  );
  const chain = await walkMonsterChain({
    campaignId,
    campaign,
    players,
    monsters,
    playerHp,
    pointer,
    nextTurnNumber,
  });
  pointer = chain.pointer;

  if (chain.defeat) {
    await supabaseAdmin
      .from("campaigns")
      .update({
        monsters,
        status: "finished",
        outcome: "lost",
        turn_pointer: pointer,
        turn_deadline: null,
      })
      .eq("id", campaignId);
    await broadcastCampaignUpdate(campaignId);
    return NextResponse.json({ ok: true, finished: true, outcome: "lost" });
  }

  await supabaseAdmin
    .from("campaigns")
    .update({
      monsters,
      turn_pointer: pointer,
      turn_deadline: nextTurnDeadline(),
    })
    .eq("id", campaignId);

  await broadcastCampaignUpdate(campaignId);
  return NextResponse.json({ ok: true });
}
