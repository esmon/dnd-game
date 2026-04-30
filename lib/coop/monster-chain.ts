import { findClass } from "@/lib/dnd/classes";
import { playerAC, rollAttack } from "@/lib/dnd/combat";
import { rollDice } from "@/lib/game/dice";
import type { Monster } from "@/lib/game/types";
import { supabaseAdmin } from "@/lib/supabase";
import { pickMonsterTarget } from "./monster-ai";
import { nextAliveSlot, slotsForCampaign } from "./turn-order";
import type { Campaign, CampaignPlayer } from "./types";

// Walk forward through the initiative slots, resolving each monster's
// turn until we either land on a player slot (they get to act next)
// or every player is downed (campaign loss). Used by:
//
//   - action/route: after the acting player's action lands, advance
//     the pointer through any monster turns that come up before the
//     next player's turn arrives.
//   - start/route: when initiative puts a monster ahead of the first
//     player, run those swings before flipping status to active so
//     the players don't see "Goblin's turn" with no resolution.
//
// Mutates `playerHp` in place and writes campaign_players + campaign_actions
// rows for each monster swing. Returns the new pointer/turn_number plus
// whether the chain ended in a TPK; the caller is responsible for
// finalizing the campaign row (status='finished', outcome='lost') and
// running persistDefeatRecovery in the defeat case.

export interface MonsterChainResult {
  pointer: number;
  nextTurnNumber: number;
  defeat: boolean;
}

export async function walkMonsterChain(args: {
  campaignId: string;
  campaign: Campaign;
  players: CampaignPlayer[];
  monsters: Monster[];
  playerHp: Record<string, number>;
  pointer: number;
  nextTurnNumber: number;
}): Promise<MonsterChainResult> {
  const { campaignId, campaign, players, monsters, playerHp } = args;
  let pointer = args.pointer;
  let nextTurnNumber = args.nextTurnNumber;
  const slotCount = slotsForCampaign(campaign, players, monsters).length;
  if (slotCount === 0) {
    return { pointer, nextTurnNumber, defeat: false };
  }

  while (true) {
    const next = nextAliveSlot(pointer, campaign, players, monsters);
    if (!next) return { pointer, nextTurnNumber, defeat: false };
    pointer = next.pointer;
    if (next.slot.kind === "player") {
      return { pointer, nextTurnNumber, defeat: false };
    }

    const monster = monsters[next.slot.index];

    // Live-HP snapshot so the AI doesn't keep targeting a teammate
    // that already dropped earlier in this same chain.
    const aliveTargets = players
      .filter((p) => playerHp[p.id] > 0)
      .map((p) => ({ ...p, current_hp: playerHp[p.id] }));
    if (aliveTargets.length === 0) {
      return { pointer, nextTurnNumber, defeat: true };
    }
    const targetPlayer = pickMonsterTarget(aliveTargets);
    if (!targetPlayer) {
      return { pointer, nextTurnNumber, defeat: true };
    }

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
      return { pointer, nextTurnNumber, defeat: true };
    }

    pointer = (pointer + 1) % slotCount;
  }
}
