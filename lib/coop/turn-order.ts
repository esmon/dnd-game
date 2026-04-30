import type { Monster } from "@/lib/game/types";
import type { Campaign, CampaignPlayer, TurnSlot } from "@/lib/coop/types";

// Turn order. Pre-M9b every campaign was strict round-robin —
// players-by-position then monsters-by-index — but now the start
// route rolls d20 + DEX initiative for every actor and persists the
// resulting slot list to `campaign.initiative_order`. Older active
// campaigns predating M9b have null there and fall back to the
// original round-robin so they don't break mid-fight.

export type { TurnSlot } from "@/lib/coop/types";

export function buildSlots(
  playerCount: number,
  monsterCount: number,
): TurnSlot[] {
  const slots: TurnSlot[] = [];
  for (let i = 0; i < playerCount; i++) {
    slots.push({ kind: "player", index: i });
  }
  for (let i = 0; i < monsterCount; i++) {
    slots.push({ kind: "monster", index: i });
  }
  return slots;
}

// Resolve the active turn-order list for this campaign. Defers to
// stored initiative when present; falls back to round-robin so
// pre-M9b active rows still resolve.
export function slotsForCampaign(
  campaign: Campaign,
  players: CampaignPlayer[],
  monsters: Monster[],
): TurnSlot[] {
  if (campaign.initiative_order && campaign.initiative_order.length > 0) {
    return campaign.initiative_order;
  }
  return buildSlots(players.length, monsters.length);
}

export function isSlotAlive(
  slot: TurnSlot,
  players: CampaignPlayer[],
  monsters: Monster[],
): boolean {
  if (slot.kind === "player") {
    return (players[slot.index]?.current_hp ?? 0) > 0;
  }
  return (monsters[slot.index]?.health ?? 0) > 0;
}

// From the given starting pointer, advance until we land on an alive
// slot — or return null when nobody is alive (campaign should end).
export function nextAliveSlot(
  pointer: number,
  campaign: Campaign,
  players: CampaignPlayer[],
  monsters: Monster[],
): { pointer: number; slot: TurnSlot } | null {
  const slots = slotsForCampaign(campaign, players, monsters);
  if (slots.length === 0) return null;
  for (let step = 0; step < slots.length; step++) {
    const i = (pointer + step) % slots.length;
    const slot = slots[i];
    if (isSlotAlive(slot, players, monsters)) {
      return { pointer: i, slot };
    }
  }
  return null;
}
