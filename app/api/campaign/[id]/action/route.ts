import { NextRequest, NextResponse } from "next/server";

import { getRequestIdentity } from "@/lib/auth/server-identity";
import { findClass } from "@/lib/dnd/classes";
import { playerAC, rollAttack } from "@/lib/dnd/combat";
import { rollDice } from "@/lib/game/dice";
import { supabaseAdmin } from "@/lib/supabase";
import type { Campaign, CampaignPlayer } from "@/lib/coop/types";
import {
  resolvePlayerAction,
  type ActionBody,
} from "@/lib/coop/server-actions";
import { nextAliveSlot } from "@/lib/coop/turn-order";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/action — submits the calling player's action
// for the current turn. The route handles the database plumbing
// (load → validate turn → dispatch to resolver → apply patches → walk
// the monster chain → persist); kind-specific dice rolling lives in
// lib/coop/server-actions so adding more action types doesn't bloat
// this file.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { userId } = await getRequestIdentity(request);
  if (!userId) {
    return NextResponse.json({ error: "must be signed in" }, { status: 401 });
  }

  const { id: campaignId } = await ctx.params;
  const body = (await request.json().catch(() => null)) as ActionBody | null;
  if (!body || typeof body.kind !== "string") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Load campaign + players + last turn number. Optimistic concurrency
  // rests on `(campaign_id, turn_number)` uniqueness in
  // campaign_actions: two concurrent submissions race to insert turn
  // N, the loser gets a unique violation and 409s.
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
  if (campaign.status !== "active") {
    return NextResponse.json(
      { error: "campaign is not active" },
      { status: 409 },
    );
  }

  const playersRes = await supabaseAdmin
    .from("campaign_players")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("position", { ascending: true });
  if (playersRes.error) {
    return NextResponse.json(
      { error: playersRes.error.message },
      { status: 500 },
    );
  }
  const players = (playersRes.data ?? []) as CampaignPlayer[];

  const lastActionRes = await supabaseAdmin
    .from("campaign_actions")
    .select("turn_number")
    .eq("campaign_id", campaignId)
    .order("turn_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastActionRes.error) {
    return NextResponse.json(
      { error: lastActionRes.error.message },
      { status: 500 },
    );
  }
  let nextTurnNumber =
    (lastActionRes.data?.turn_number as number | undefined) === undefined
      ? 0
      : (lastActionRes.data!.turn_number as number) + 1;

  let monsters = [...campaign.monsters];
  let pointer = campaign.turn_pointer;

  const current = nextAliveSlot(pointer, players, monsters);
  if (!current) {
    return NextResponse.json(
      { error: "no live actor — campaign already over" },
      { status: 409 },
    );
  }
  if (current.slot.kind !== "player") {
    return NextResponse.json(
      { error: "not your turn — wait for monster action" },
      { status: 409 },
    );
  }
  const actingPlayer = players[current.slot.index];
  if (actingPlayer.user_id !== userId) {
    return NextResponse.json({ error: "not your turn" }, { status: 409 });
  }
  pointer = current.pointer;

  // Hand off to the resolver. It returns either an error or a
  // (action row, monsters, optional snapshot patch, optional hp
  // patch) tuple we apply below.
  const resolution = resolvePlayerAction(body, actingPlayer, monsters);
  if (!resolution.ok) {
    return NextResponse.json(
      { error: resolution.error },
      { status: resolution.status },
    );
  }

  // Apply the resolver's patches.
  monsters =
    body.kind === "attack" || body.kind === "spell" || body.kind === "scroll"
      ? resolution.monsters
      : monsters;

  if (resolution.snapshotPatch) {
    await supabaseAdmin
      .from("campaign_players")
      .update({ character_snapshot: resolution.snapshotPatch })
      .eq("id", actingPlayer.id);
    actingPlayer.character_snapshot = resolution.snapshotPatch;
  }

  // Track player HP locally; flushed below for monsters' counter-
  // attacks and persisted at end. Seeded from current rows, then
  // patched if the resolver healed the actor.
  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.current_hp]),
  );
  if (typeof resolution.currentHpPatch === "number") {
    playerHp[actingPlayer.id] = resolution.currentHpPatch;
    await supabaseAdmin
      .from("campaign_players")
      .update({ current_hp: resolution.currentHpPatch })
      .eq("id", actingPlayer.id);
  }

  await supabaseAdmin.from("campaign_actions").insert({
    campaign_id: campaignId,
    turn_number: nextTurnNumber,
    ...resolution.action,
  });
  nextTurnNumber++;

  // Win check before rotating.
  if (monsters.length > 0 && monsters.every((m) => m.health <= 0)) {
    await supabaseAdmin
      .from("campaigns")
      .update({
        monsters,
        status: "finished",
        outcome: "won",
        turn_pointer: pointer,
      })
      .eq("id", campaignId);
    return NextResponse.json({ ok: true, finished: true, outcome: "won" });
  }

  // Walk forward — possibly executing several monster actions — until
  // the pointer lands on an alive player or the campaign ends.
  pointer = (pointer + 1) % (players.length + monsters.length);

  while (true) {
    const next = nextAliveSlot(pointer, players, monsters);
    if (!next) break;
    pointer = next.pointer;
    if (next.slot.kind === "player") break;

    const monster = monsters[next.slot.index];

    const aliveTargets = players.filter((p) => playerHp[p.id] > 0);
    if (aliveTargets.length === 0) break;
    const targetPlayer =
      aliveTargets[Math.floor(Math.random() * aliveTargets.length)];

    const klass = findClass(targetPlayer.character_snapshot.class) ?? null;
    const targetAC = playerAC(
      klass,
      targetPlayer.character_snapshot.ability_scores,
    );
    const attack = rollAttack(monster.attackBonus, targetAC);
    let damage = 0;
    if (attack.hit) {
      const raw =
        rollDice(monster.damageDice) +
        (attack.crit ? rollDice(monster.damageDice) : 0);
      damage = Math.max(0, raw);
    }
    const newHp = Math.max(0, playerHp[targetPlayer.id] - damage);
    playerHp[targetPlayer.id] = newHp;

    await supabaseAdmin
      .from("campaign_players")
      .update({ current_hp: newHp })
      .eq("id", targetPlayer.id);

    await supabaseAdmin.from("campaign_actions").insert({
      campaign_id: campaignId,
      turn_number: nextTurnNumber,
      actor_kind: "monster",
      actor_monster_index: next.slot.index,
      target_kind: "player",
      target_player_id: targetPlayer.id,
      kind: "attack",
      payload: {
        actor_name: monster.name,
        target_name: targetPlayer.character_snapshot.name,
        damage_type: monster.damageType,
        damage,
        d20: attack.d20,
        hit: attack.hit,
        crit: attack.crit,
        missed: !attack.hit,
      },
    });
    nextTurnNumber++;

    if (Object.values(playerHp).every((hp) => hp <= 0)) {
      await supabaseAdmin
        .from("campaigns")
        .update({
          monsters,
          status: "finished",
          outcome: "lost",
          turn_pointer: pointer,
        })
        .eq("id", campaignId);
      return NextResponse.json({ ok: true, finished: true, outcome: "lost" });
    }

    pointer = (pointer + 1) % (players.length + monsters.length);
  }

  await supabaseAdmin
    .from("campaigns")
    .update({ monsters, turn_pointer: pointer })
    .eq("id", campaignId);

  return NextResponse.json({ ok: true });
}
