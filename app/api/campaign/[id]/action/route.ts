import { NextRequest, NextResponse } from "next/server";

import { applyCharacterLevelUps } from "@/lib/coop/leveling";
import { authorizeCampaign } from "@/lib/coop/auth";
import type { Character } from "@/lib/db/schema";
import { rollLoot } from "@/lib/dnd/loot";
import { supabaseAdmin } from "@/lib/supabase";
import type { CampaignPlayer } from "@/lib/coop/types";
import {
  resolvePlayerAction,
  type ActionBody,
} from "@/lib/coop/server-actions";
import { nextAliveSlot, slotsForCampaign } from "@/lib/coop/turn-order";
import { nextTurnNumberFor, walkMonsterChain } from "@/lib/coop/monster-chain";
import { broadcastCampaignUpdate } from "@/lib/coop/realtime";
import { nextTurnDeadline } from "@/lib/coop/turn-timer";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/campaign/[id]/action — submits the calling player's action
// for the current turn. The route handles the database plumbing
// (load → validate turn → dispatch to resolver → apply patches → walk
// the monster chain → persist); kind-specific dice rolling lives in
// lib/coop/server-actions so adding more action types doesn't bloat
// this file.
export async function POST(request: NextRequest, ctx: RouteContext) {
  const { id: campaignId } = await ctx.params;
  const auth = await authorizeCampaign(request, campaignId);
  if (!auth.ok) return auth.response;
  const { userId, campaign, players } = auth.ctx;

  const body = (await request.json().catch(() => null)) as ActionBody | null;
  if (!body || typeof body.kind !== "string") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (campaign.status !== "active") {
    return NextResponse.json(
      { error: "campaign is not active" },
      { status: 409 },
    );
  }

  // Optimistic concurrency rests on `(campaign_id, turn_number)`
  // uniqueness in campaign_actions: two concurrent submissions race to
  // insert turn N, the loser gets a unique violation and 409s.
  let nextTurnNumber: number;
  try {
    nextTurnNumber = await nextTurnNumberFor(campaignId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  let monsters = [...campaign.monsters];
  let pointer = campaign.turn_pointer;

  const current = nextAliveSlot(pointer, campaign, players, monsters);
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
  const monstersBefore = monsters;
  monsters =
    body.kind === "attack" ||
    body.kind === "spell" ||
    body.kind === "scroll" ||
    body.kind === "smite"
      ? resolution.monsters
      : monsters;

  if (resolution.snapshotPatch) {
    actingPlayer.character_snapshot = resolution.snapshotPatch;
  }

  // Track player HP locally; flushed below for monsters' counter-
  // attacks and persisted at end. Seeded from current rows, then
  // patched if the resolver healed the actor. The DB write happens
  // after the action insert below so we don't burn a slot / take a
  // heal that the action log will never reflect.
  const playerHp: Record<string, number> = Object.fromEntries(
    players.map((p) => [p.id, p.current_hp]),
  );
  if (typeof resolution.currentHpPatch === "number") {
    playerHp[actingPlayer.id] = resolution.currentHpPatch;
  }

  // Detect every freshly-killed monster from the resolver's mutation.
  // Single-target hits will return a 1-element list; AoE spells can
  // wipe several at once, all of which get loot/XP processed.
  const killedIndices: number[] = [];
  for (let i = 0; i < monsters.length; i++) {
    if (monstersBefore[i] && monstersBefore[i].health > 0 && monsters[i].health <= 0) {
      killedIndices.push(i);
    }
  }
  const modifiedSnapshots = new Set<string>();
  if (resolution.snapshotPatch) modifiedSnapshots.add(actingPlayer.id);

  // Loot + XP awards on kill. Loot goes to the killer (killing-blow
  // policy). XP follows 5e RAW: the monster's full XP is divided evenly
  // across the whole party, regardless of whether a member is currently
  // down — they "participated in the encounter."
  const killLogs: Array<{
    index: number;
    name: string;
    xpPerPlayer: number;
    loot: { name: string; kind: string } | null;
  }> = [];
  let xpPerPlayerTotal = 0;

  for (const killedIndex of killedIndices) {
    const killed = monsters[killedIndex];
    let lootForLog: { name: string; kind: string } | null = null;
    const loot = rollLoot(killed);
    if (loot) {
      // Three slot categories on the snapshot: weapons (inventory),
      // consumables (scrolls / potions, which carry a kind tag), and
      // armor (only field with acBase). Discriminate structurally to
      // keep loot agnostic of any future "kind: armor" backfill.
      if ("kind" in loot) {
        actingPlayer.character_snapshot = {
          ...actingPlayer.character_snapshot,
          consumables: [...actingPlayer.character_snapshot.consumables, loot],
        };
        lootForLog = {
          name: loot.kind === "scroll" ? `Scroll of ${loot.spellName}` : loot.name,
          kind: loot.kind,
        };
      } else if ("acBase" in loot) {
        actingPlayer.character_snapshot = {
          ...actingPlayer.character_snapshot,
          armor_inventory: [
            ...(actingPlayer.character_snapshot.armor_inventory ?? []),
            loot,
          ],
        };
        lootForLog = { name: loot.name, kind: "armor" };
      } else {
        actingPlayer.character_snapshot = {
          ...actingPlayer.character_snapshot,
          inventory: [...actingPlayer.character_snapshot.inventory, loot],
        };
        lootForLog = { name: loot.name, kind: "weapon" };
      }
      modifiedSnapshots.add(actingPlayer.id);
    }

    const xpPerPlayer = Math.floor(killed.xp / Math.max(1, players.length));
    xpPerPlayerTotal += xpPerPlayer;
    for (const p of players) {
      p.character_snapshot = {
        ...p.character_snapshot,
        xp: p.character_snapshot.xp + xpPerPlayer,
      };
      modifiedSnapshots.add(p.id);
    }
    killLogs.push({
      index: killedIndex,
      name: killed.name,
      xpPerPlayer,
      loot: lootForLog,
    });
  }

  // Run XP-driven level-ups for any player who crossed a threshold.
  // Bumps level / max_hp / proficiency / learned spells / spell slots
  // on the snapshot; the snapshot persist below picks up the change.
  // current_hp on the campaign_players row needs a separate write
  // since the column is independent of the snapshot's current_hp.
  const levelUpsByPlayer = new Map<string, number[]>();
  for (const p of players) {
    if (!modifiedSnapshots.has(p.id)) continue;
    const result = applyCharacterLevelUps(p.character_snapshot);
    if (result.levelsGained.length === 0) continue;
    const hpGain = result.character.max_hp - p.character_snapshot.max_hp;
    p.character_snapshot = result.character;
    if (hpGain > 0) {
      const newCurrent = Math.min(
        result.character.max_hp,
        playerHp[p.id] + hpGain,
      );
      playerHp[p.id] = newCurrent;
      p.current_hp = newCurrent;
    }
    levelUpsByPlayer.set(p.id, result.levelsGained);
  }

  // Insert the action FIRST — that's the row carrying the unique
  // (campaign_id, turn_number) constraint, so it's the one source of
  // truth for who owns this turn. If it fails (most commonly: the
  // turn timer fired and /timeout claimed the same turn_number),
  // every other DB write below is skipped, so the player doesn't end
  // up with a consumed slot / new loot / banked XP that the log
  // never shows.
  const playerActionInsert = await supabaseAdmin
    .from("campaign_actions")
    .insert({
      campaign_id: campaignId,
      turn_number: nextTurnNumber,
      encounter_number: campaign.encounter_number,
      ...resolution.action,
      payload: {
        ...resolution.action.payload,
        ...(killLogs.length > 0
          ? {
              // Keep the single-kill fields populated for backwards
              // compatibility (recap panels reading killed_monster_name
              // / xp_awarded / loot still work for solo target hits);
              // AoE-aware code reads `kills` for the full list.
              killed_monster_index: killLogs[0].index,
              killed_monster_name: killLogs[0].name,
              xp_awarded: xpPerPlayerTotal,
              loot: killLogs[0].loot,
              kills: killLogs.map((k) => ({
                monster_index: k.index,
                monster_name: k.name,
                xp_awarded: k.xpPerPlayer,
                loot: k.loot,
              })),
            }
          : {}),
      },
    });
  if (playerActionInsert.error) {
    // 23505 = postgres unique_violation. Most commonly fired when the
    // turn timer expired between this client's pre-flight read and
    // the insert — /timeout already claimed turn_number N. Friendly
    // 409 so the UI can show "your turn just expired" instead of a
    // raw 500.
    if (playerActionInsert.error.code === "23505") {
      return NextResponse.json(
        {
          error:
            "Your turn was just resolved by the timer — wait a moment and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error: `failed to log player action: ${playerActionInsert.error.message}`,
      },
      { status: 500 },
    );
  }
  nextTurnNumber++;

  // Now safe to persist the side effects — the action row is in the
  // log so anything we write here will be reflected in the UI.
  // Players who leveled up just had their current_hp bumped (level-up
  // adds the rolled HP to the running total); fold that into the
  // snapshot persist below so the campaign_players column stays in
  // sync with playerHp.
  if (typeof resolution.currentHpPatch === "number") {
    await supabaseAdmin
      .from("campaign_players")
      .update({ current_hp: resolution.currentHpPatch })
      .eq("id", actingPlayer.id);
  }
  for (const id of modifiedSnapshots) {
    const player = players.find((p) => p.id === id);
    if (!player) continue;
    const update: Record<string, unknown> = {
      character_snapshot: player.character_snapshot,
    };
    if (levelUpsByPlayer.has(id)) {
      update.current_hp = player.current_hp;
    }
    await supabaseAdmin
      .from("campaign_players")
      .update(update)
      .eq("id", id);
  }

  // Win check before rotating. In multi-encounter mode the campaign
  // doesn't go straight to "finished" — it pauses in
  // "between_encounters" so the party can rest, then either chains
  // into another fight (POST /next-encounter) or ends the campaign
  // (POST /end-campaign). Per-encounter rewards are committed now via
  // persistVictoryRewards so a later TPK doesn't wipe the prior wins.
  if (monsters.length > 0 && monsters.every((m) => m.health <= 0)) {
    const winUpdate = await supabaseAdmin
      .from("campaigns")
      .update({
        monsters,
        status: "between_encounters",
        turn_pointer: pointer,
        // No active turn during the rest screen; clear the timer.
        turn_deadline: null,
      })
      .eq("id", campaignId);
    if (winUpdate.error) {
      return NextResponse.json(
        { error: `failed to flip to between_encounters: ${winUpdate.error.message}` },
        { status: 500 },
      );
    }
    await persistVictoryRewards(players);
    await broadcastCampaignUpdate(campaignId);
    return NextResponse.json({
      ok: true,
      finished: false,
      betweenEncounters: true,
    });
  }

  // Advance one slot past the player who just acted, then walk any
  // monster swings up to the next player turn (or until everyone's
  // down). Slot count varies — initiative interleaves monsters and
  // players in any order — so wrap on the resolved slot list.
  const slotCount = slotsForCampaign(campaign, players, monsters).length;
  pointer = (pointer + 1) % slotCount;

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
  nextTurnNumber = chain.nextTurnNumber;

  if (chain.defeat) {
    const lossUpdate = await supabaseAdmin
      .from("campaigns")
      .update({
        monsters,
        status: "finished",
        outcome: "lost",
        turn_pointer: pointer,
        turn_deadline: null,
      })
      .eq("id", campaignId);
    if (lossUpdate.error) {
      return NextResponse.json(
        { error: `failed to flip to lost: ${lossUpdate.error.message}` },
        { status: 500 },
      );
    }
    await persistDefeatRecovery(players);
    await broadcastCampaignUpdate(campaignId);
    return NextResponse.json({ ok: true, finished: true, outcome: "lost" });
  }

  // Chain ended on a player slot (walkMonsterChain returns there);
  // arm the idle-skip timer so a disconnected teammate doesn't stall
  // the encounter forever.
  const turnUpdate = await supabaseAdmin
    .from("campaigns")
    .update({
      monsters,
      turn_pointer: pointer,
      turn_deadline: nextTurnDeadline(),
    })
    .eq("id", campaignId);
  if (turnUpdate.error) {
    return NextResponse.json(
      { error: `failed to advance turn pointer: ${turnUpdate.error.message}` },
      { status: 500 },
    );
  }

  await broadcastCampaignUpdate(campaignId);
  return NextResponse.json({ ok: true });
}

// Sync each player's mutated campaign snapshot back to their characters
// row so xp gains, loot drops, and consumed slots/items persist into
// solo and future campaigns. HP resets to full — winning a fight
// shouldn't leave anyone stuck low when they exit to home.
async function persistVictoryRewards(players: CampaignPlayer[]): Promise<void> {
  for (const player of players) {
    const snap = player.character_snapshot;
    await supabaseAdmin
      .from("characters")
      .update({
        xp: snap.xp,
        // Level-up state — leveling currently happens on every kill
        // (action route's XP loop), so any new level / max_hp /
        // proficiency / learned spells need to flow back to the
        // character row or solo would still see the pre-campaign
        // level next time the player loaded their character.
        level: snap.level,
        max_hp: snap.max_hp,
        proficiency_bonus: snap.proficiency_bonus,
        known_spells: snap.known_spells,
        equipped_spells: snap.equipped_spells,
        weapons: snap.weapons,
        inventory: snap.inventory,
        consumables: snap.consumables,
        spell_slots: snap.spell_slots,
        // Armor stays where it was on the snapshot so a piece picked
        // up mid-campaign carries back to solo / future campaigns.
        equipped_armor: snap.equipped_armor ?? null,
        equipped_shield: snap.equipped_shield ?? null,
        armor_inventory: snap.armor_inventory ?? [],
        current_hp: snap.max_hp,
      } satisfies Partial<Character>)
      .eq("id", snap.id);
  }
}

// On defeat we don't sync the snapshot's consumed-slot / consumed-item
// state back to characters — losing a fight is enough cost without
// destroying mid-campaign resource expenditure. We do reset HP so
// nobody returns to the home screen with 0 HP.
async function persistDefeatRecovery(
  players: CampaignPlayer[],
): Promise<void> {
  for (const player of players) {
    const snap = player.character_snapshot;
    await supabaseAdmin
      .from("characters")
      .update({ current_hp: snap.max_hp } satisfies Partial<Character>)
      .eq("id", snap.id);
  }
}
