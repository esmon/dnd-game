import type { Monster } from "@/lib/game/types";
import type { CampaignPlayer } from "@/lib/coop/types";

// Turn order is players-by-position followed by monsters-by-index, then
// repeat. `turn_pointer` is a monotonically incrementing counter; we
// modulo into the combined slot count and then skip dead actors.
//
// All MVP campaigns are 2 players + 1 monster, so the slot list is at
// most 4 long. Plenty of headroom to swap to a smarter initiative
// system later (rolled DEX initiative, etc.) without changing callers.

export type TurnSlot =
  | { kind: "player"; index: number }
  | { kind: "monster"; index: number };

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
  players: CampaignPlayer[],
  monsters: Monster[],
): { pointer: number; slot: TurnSlot } | null {
  const slots = buildSlots(players.length, monsters.length);
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
