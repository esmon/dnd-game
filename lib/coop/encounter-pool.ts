import {
  fetchMonster,
  fetchMonsterIndexListByCrs,
  pickRandomMonsterIndex,
} from "@/lib/game/dnd5e";
import type { Monster } from "@/lib/game/types";

import type { EncounterSpec } from "./encounter-builder";
import { nearbyCrStrings } from "./encounter-builder";

// Fetch a fresh monster pool for an EncounterSpec from dnd5eapi.
// Tries the spec's exact CR first; widens to nearby CRs if the API
// has nothing at that target (rare but possible for niche tiers).
//
// Returns a Result so callers can map directly to NextResponse without
// re-implementing the try/catch + status mapping in every route.
export type MonsterPoolResult =
  | { ok: true; monsters: Monster[] }
  | { ok: false; status: number; error: string };

export async function fetchMonsterPoolForSpec(
  spec: EncounterSpec,
): Promise<MonsterPoolResult> {
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
      return {
        ok: false,
        status: 500,
        error: "no monsters available for this party level",
      };
    }
    const monsters = await Promise.all(picks.map((index) => fetchMonster(index)));
    return { ok: true, monsters };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `monster pool fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
