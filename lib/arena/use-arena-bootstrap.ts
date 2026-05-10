"use client";

import { useEffect, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";

import type { User } from "@supabase/supabase-js";

import { characterToPlayer } from "@/lib/db/schema";
import type { Character, CharacterUpdate } from "@/lib/db/schema";
import { xpThresholdForLevel } from "@/lib/dnd/leveling";
import {
  ensureDamageType,
  isFullyShapedWeapon,
  legacyWeaponToWeapon,
  needsDamageTypeBackfill,
} from "@/lib/game/migrations";
import type { Action } from "@/lib/game/reducer";
import type { GameStats, MonsterIndex, Weapon } from "@/lib/game/types";
import {
  clearActiveCharacterId,
  clearPlayerStateCache,
  fetchWithSession,
  getActiveCharacterId,
  readPlayerStateCache,
  setActiveCharacterId,
} from "@/lib/session";
import {
  getLocalCharacter,
  setLocalCharacter,
} from "@/lib/storage/local-character";

// One-shot bootstrap for the arena page. Branches on auth state:
//
//   • Anonymous (user === null): single-character localStorage flow. Reads
//     `dnd-local-character`; if empty, falls back once to any session-id
//     Supabase characters from the legacy model and migrates the most
//     recent down to localStorage. After this migration the user is local-
//     only; signing in eventually moves them up to Supabase via the claim
//     flow (Phase 6).
//
//   • Signed-in (user set): existing Supabase flow keyed by session_id.
//     Phase 5 will switch this to user_id queries.
//
// Caller passes `user`. While `user === undefined` (auth not yet
// resolved), bootstrap waits — the dispatch happens once we know.
export function useArenaBootstrap({
  dispatch,
  indexLevelRef,
  lastSyncedRef,
  user,
}: {
  dispatch: React.Dispatch<Action>;
  indexLevelRef: MutableRefObject<number | null>;
  lastSyncedRef: MutableRefObject<{
    id: string;
    level: number;
    stats: GameStats;
  } | null>;
  user: User | null | undefined;
}) {
  const router = useRouter();
  useEffect(() => {
    if (user === undefined) return; // still resolving auth; wait
    let cancelled = false;
    (async () => {
      try {
        let character: Character | null = null;

        if (user) {
          character = await loadFromSupabase(router);
        } else {
          character = await loadFromLocalOrLegacySupabase();
          if (!character) {
            router.push("/create");
            return;
          }
        }
        if (!character) return; // signed-in path may have redirected

        const normalized = await applyMigrations(character, !!user);
        character = normalized;

        const player = characterToPlayer(character);

        const monstersRes = await fetch(`/api/monsters?level=${player.level}`);
        if (!monstersRes.ok) {
          throw new Error(`monsters fetch ${monstersRes.status}`);
        }
        const indices = (await monstersRes.json()) as MonsterIndex[];

        // Switch-character UI shows when count > 1. Anonymous always = 1
        // (single-character constraint); signed-in derives from list.
        let count = 1;
        if (user) {
          try {
            const listRes = await fetchWithSession("/api/characters");
            if (listRes.ok) {
              const all = (await listRes.json()) as Character[];
              count = all.length;
            }
          } catch (err) {
            console.error("character count fetch failed", err);
          }
        }

        if (cancelled) return;
        indexLevelRef.current = player.level;
        lastSyncedRef.current = {
          id: character.id,
          level: player.level,
          stats: player.stats ?? { wins: 0, losses: 0, runaways: 0 },
        };
        dispatch({ type: "BOOTSTRAP_DONE", player, indices });
        dispatch({ type: "SET_CHARACTER_COUNT", count });
      } catch (err) {
        console.error("bootstrap failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, indexLevelRef, lastSyncedRef, router, user]);
}

// Anonymous path. Prefers localStorage; falls back once to any legacy
// session-id Supabase characters and migrates the most recent down so
// future bootstraps don't keep refetching.
async function loadFromLocalOrLegacySupabase(): Promise<Character | null> {
  const local = getLocalCharacter();
  if (local) return local;

  try {
    const res = await fetchWithSession("/api/characters");
    if (!res.ok) return null;
    const all = (await res.json()) as Character[];
    if (all.length === 0) return null;
    const migrated = all[0];
    setLocalCharacter(migrated);
    return migrated;
  } catch (err) {
    console.error("legacy session-id fallback failed", err);
    return null;
  }
}

// Signed-in path. Uses the existing active-character / character-list
// flow keyed by session_id. Phase 5 will switch this to user_id.
async function loadFromSupabase(
  router: ReturnType<typeof useRouter>,
): Promise<Character | null> {
  const activeId = getActiveCharacterId();
  if (activeId) {
    const res = await fetchWithSession(`/api/character/${activeId}`);
    if (res.status === 404) {
      clearActiveCharacterId();
      router.push("/create");
      return null;
    }
    if (!res.ok) {
      console.error("character fetch failed", res.status);
      return null;
    }
    return (await res.json()) as Character;
  }

  const res = await fetchWithSession("/api/characters");
  if (!res.ok) {
    console.error("characters list fetch failed", res.status);
    return null;
  }
  const all = (await res.json()) as Character[];
  if (all.length === 0) {
    router.push("/create");
    return null;
  }
  const character = all[0];
  setActiveCharacterId(character.id);
  return character;
}

// Run all the on-load migrations: cache overlay (signed-in only), legacy
// weapon shape, damageType backfill, XP floor. Persists changes back to
// the right storage (Supabase for signed-in, localStorage otherwise).
async function applyMigrations(
  character: Character,
  signedIn: boolean,
): Promise<Character> {
  let result = character;

  if (signedIn) {
    // Cache overlay: write-through state from the most recent solo
    // session. Discard the cache if the DB row has been updated
    // externally since this cache was written — detected by
    // comparing the cache's stamped `dbUpdatedAt` against the
    // freshly-fetched row's `updated_at`. Catches multi-device
    // shenanigans (coop on phone wins XP, then laptop reloads with
    // stale solo cache) and any future external writers without
    // needing a per-feature cache-clear at every external write site.
    const cache = readPlayerStateCache(result.id);
    if (cache) {
      const cacheIsForCurrentDbState =
        typeof cache.dbUpdatedAt === "string" &&
        cache.dbUpdatedAt === result.updated_at;
      if (cacheIsForCurrentDbState) {
        result = {
          ...result,
          current_hp: cache.current_hp,
          xp: cache.xp,
          level: cache.level,
          max_hp: cache.max_hp,
          proficiency_bonus: cache.proficiency_bonus,
          ability_scores: cache.ability_scores,
          weapons: cache.weapons,
          inventory: cache.inventory,
          known_spells: cache.known_spells ?? result.known_spells ?? [],
          equipped_spells:
            cache.equipped_spells ?? result.equipped_spells ?? [],
          spell_slots: cache.spell_slots ?? result.spell_slots ?? {},
          consumables: cache.consumables ?? result.consumables ?? [],
          equipped_armor:
            cache.equipped_armor ?? result.equipped_armor ?? null,
          equipped_shield:
            cache.equipped_shield ?? result.equipped_shield ?? null,
          armor_inventory:
            cache.armor_inventory ?? result.armor_inventory ?? [],
          wins: cache.wins ?? result.wins ?? 0,
          losses: cache.losses ?? result.losses ?? 0,
          runaways: cache.runaways ?? result.runaways ?? 0,
        };
      } else {
        // External writer has touched the row since this cache was
        // stamped (or the cache predates the dbUpdatedAt field).
        // Drop the stale entry so it doesn't haunt future loads.
        clearPlayerStateCache(result.id);
      }
    }
  }

  const inventoryEmpty =
    !Array.isArray(result.inventory) || result.inventory.length === 0;
  const hasLegacyWeapons =
    Array.isArray(result.weapons) &&
    result.weapons.length > 0 &&
    result.weapons.some((w) => !isFullyShapedWeapon(w));
  if (inventoryEmpty && hasLegacyWeapons) {
    const normalized = result.weapons.map((w) =>
      isFullyShapedWeapon(w) ? (w as Weapon) : legacyWeaponToWeapon(w),
    );
    result = { ...result, weapons: normalized, inventory: normalized };
    await persistMigration(result, signedIn, {
      weapons: normalized,
      inventory: normalized,
    });
  }

  if (
    needsDamageTypeBackfill(result.weapons) ||
    needsDamageTypeBackfill(result.inventory)
  ) {
    const weapons = result.weapons.map(ensureDamageType);
    const inventory = result.inventory.map(ensureDamageType);
    result = { ...result, weapons, inventory };
    await persistMigration(result, signedIn, { weapons, inventory });
  }

  const levelFloor = xpThresholdForLevel(result.level);
  if (result.xp < levelFloor) {
    result = { ...result, xp: levelFloor };
    await persistMigration(result, signedIn, { xp: levelFloor });
    if (signedIn) clearPlayerStateCache(result.id);
  }

  return result;
}

async function persistMigration(
  character: Character,
  signedIn: boolean,
  updates: CharacterUpdate,
): Promise<void> {
  if (signedIn) {
    try {
      await fetchWithSession(`/api/character/${character.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates satisfies CharacterUpdate),
      });
    } catch (err) {
      console.error("migration patch failed", err);
    }
  } else {
    setLocalCharacter(character);
  }
}
