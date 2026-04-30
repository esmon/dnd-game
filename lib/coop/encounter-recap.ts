import type { CampaignAction } from "./types";

// Walk the campaign-wide action log and bucket the kill rewards by
// encounter. Both the rest screen (per-encounter recap + running
// cumulative totals) and the final outcome panel (per-encounter
// breakdown + grand total) build off the same shape, so we extract
// it here to keep the two views consistent and testable.

export interface EncounterRecap {
  encounterNumber: number;
  // Monster names killed during this encounter, in chronological order.
  killed: string[];
  // XP each player gained from this encounter (server already
  // divided by party size on stamp, so this is per-player).
  xpPerPlayer: number;
  // Loot drops keyed by the player_id that landed the killing blow.
  lootByPlayer: Map<string, string[]>;
}

export function buildEncounterRecaps(
  actions: CampaignAction[],
): EncounterRecap[] {
  const byEncounter = new Map<number, EncounterRecap>();

  for (const a of actions) {
    const payload = a.payload as Record<string, unknown>;
    if (
      payload.killed_monster_index === undefined ||
      payload.killed_monster_index === null
    ) {
      continue;
    }

    let recap = byEncounter.get(a.encounter_number);
    if (!recap) {
      recap = {
        encounterNumber: a.encounter_number,
        killed: [],
        xpPerPlayer: 0,
        lootByPlayer: new Map(),
      };
      byEncounter.set(a.encounter_number, recap);
    }

    const monsterName = (payload.killed_monster_name as string) ?? "";
    if (monsterName) recap.killed.push(monsterName);
    recap.xpPerPlayer += (payload.xp_awarded as number) ?? 0;

    const loot = payload.loot as { name: string; kind: string } | null;
    if (loot && a.actor_player_id) {
      const list = recap.lootByPlayer.get(a.actor_player_id) ?? [];
      list.push(loot.name);
      recap.lootByPlayer.set(a.actor_player_id, list);
    }
  }

  return [...byEncounter.values()].sort(
    (a, b) => a.encounterNumber - b.encounterNumber,
  );
}

export interface CumulativeStats {
  // Total XP per player across all encounters in the campaign so far.
  // Each player gained the same amount (server splits evenly), so
  // this is a single number.
  totalXpPerPlayer: number;
  // All loot drops keyed by the player who claimed them, across the
  // whole campaign.
  totalLootByPlayer: Map<string, string[]>;
  encountersCleared: number;
}

export function aggregateRecaps(recaps: EncounterRecap[]): CumulativeStats {
  let totalXpPerPlayer = 0;
  const totalLootByPlayer = new Map<string, string[]>();
  for (const r of recaps) {
    totalXpPerPlayer += r.xpPerPlayer;
    for (const [playerId, names] of r.lootByPlayer) {
      const existing = totalLootByPlayer.get(playerId) ?? [];
      totalLootByPlayer.set(playerId, [...existing, ...names]);
    }
  }
  return {
    totalXpPerPlayer,
    totalLootByPlayer,
    encountersCleared: recaps.length,
  };
}
