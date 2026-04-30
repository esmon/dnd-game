import type { Monster } from "@/lib/game/types";
import { abilityModifier } from "@/lib/dnd/derive";
import type { CampaignPlayer, TurnSlot } from "./types";

// 5e initiative: every actor rolls 1d20 + DEX mod once at the start
// of combat; the encounter cycles through actors in descending order.
// Ties are broken however the DM likes — we use a deterministic
// random tiebreak per actor (rolled once during sort) so the order
// stays stable for a given roll.

interface RolledSlot {
  slot: TurnSlot;
  roll: number;
  // Random in [0, 1) to break exact ties. Realized once per actor
  // before the sort so re-sorting is consistent.
  jitter: number;
}

function dexMod(dex: number): number {
  return abilityModifier(dex);
}

export function rollInitiative(
  players: CampaignPlayer[],
  monsters: Monster[],
): TurnSlot[] {
  const rolled: RolledSlot[] = [];

  for (let i = 0; i < players.length; i++) {
    const dex = players[i].character_snapshot.ability_scores.dex;
    const d20 = Math.floor(Math.random() * 20) + 1;
    const roll = d20 + dexMod(dex);
    rolled.push({
      slot: { kind: "player", index: i, roll },
      roll,
      jitter: Math.random(),
    });
  }
  for (let i = 0; i < monsters.length; i++) {
    const dex = monsters[i].dexterity ?? 10;
    const d20 = Math.floor(Math.random() * 20) + 1;
    const roll = d20 + dexMod(dex);
    rolled.push({
      slot: { kind: "monster", index: i, roll },
      roll,
      jitter: Math.random(),
    });
  }

  rolled.sort((a, b) => {
    if (a.roll !== b.roll) return b.roll - a.roll;
    return b.jitter - a.jitter;
  });

  return rolled.map((r) => r.slot);
}
