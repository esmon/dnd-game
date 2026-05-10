"use client";

import { useCallback, useEffect, type MutableRefObject } from "react";

import type { User } from "@supabase/supabase-js";

import type { CharacterUpdate } from "@/lib/db/schema";
import type { GameState } from "@/lib/game/reducer";
import type { GameStats, Player } from "@/lib/game/types";
import {
  cachePlayerState,
  clearPlayerStateCache,
  fetchWithSession,
} from "@/lib/session";
import { updateLocalCharacterMutable } from "@/lib/storage/local-character";

// Persistence branches on auth state:
//
//   • Anonymous: a single localStorage character is the source of truth.
//     Every persist tick merges the current player into the stored
//     Character. No Supabase calls; localStorage is synchronous, so the
//     beforeunload flush is a no-op.
//
//   • Signed-in: existing two-tier model. Always cache mutable fields to
//     `dnd-cache-{id}` in localStorage; PATCH Supabase only when the level
//     changed (or `forceSyncRef` was raised after loot Keep/Discard) so
//     network writes stay proportional to meaningful state changes. The
//     beforeunload flush sends a keepalive PATCH.
//
// Refs are owned by the arena component because handlers there raise
// needsPersistRef / forceSyncRef directly; the hook just consumes them.
export function useArenaPersistence({
  state,
  stateRef,
  needsPersistRef,
  lastSyncedRef,
  forceSyncRef,
  user,
}: {
  state: GameState;
  stateRef: MutableRefObject<GameState>;
  needsPersistRef: MutableRefObject<boolean>;
  lastSyncedRef: MutableRefObject<{
    id: string;
    level: number;
    stats: GameStats;
  } | null>;
  forceSyncRef: MutableRefObject<boolean>;
  user: User | null | undefined;
}) {
  const playerToUpdate = useCallback(
    (player: Player, stats: GameStats): CharacterUpdate => {
      return {
        current_hp: player.health,
        xp: player.xp,
        level: player.level,
        max_hp: player.maxHealth,
        proficiency_bonus: player.proficiencyBonus,
        ability_scores: player.abilityScores,
        weapons: player.weapons,
        inventory: player.inventory,
        known_spells: player.knownSpells,
        equipped_spells: player.equippedSpells,
        spell_slots: player.spellSlots,
        consumables: player.consumables,
        equipped_armor: player.equippedArmor ?? null,
        equipped_shield: player.equippedShield ?? null,
        armor_inventory: player.armorInventory ?? [],
        wins: stats.wins,
        losses: stats.losses,
        runaways: stats.runaways,
      };
    },
    [],
  );

  const cacheLocally = useCallback((player: Player, stats: GameStats) => {
    if (!player.id) return;
    cachePlayerState(player.id, {
      current_hp: player.health,
      xp: player.xp,
      level: player.level,
      max_hp: player.maxHealth,
      proficiency_bonus: player.proficiencyBonus,
      ability_scores: player.abilityScores,
      weapons: player.weapons,
      inventory: player.inventory,
      known_spells: player.knownSpells,
      equipped_spells: player.equippedSpells,
      spell_slots: player.spellSlots,
      consumables: player.consumables,
      equipped_armor: player.equippedArmor ?? null,
      equipped_shield: player.equippedShield ?? null,
      armor_inventory: player.armorInventory ?? [],
      wins: stats.wins,
      losses: stats.losses,
      runaways: stats.runaways,
      // Stamp the DB version this cache was written against so the
      // bootstrap can detect external writes (other device, coop,
      // etc.) and discard a stale cache.
      dbUpdatedAt: player.dbUpdatedAt,
    });
  }, []);

  const syncToSupabase = useCallback(
    async (
      player: Player,
      stats: GameStats,
      opts?: { keepalive?: boolean },
    ) => {
      if (!player.id) return;
      const update = playerToUpdate(player, stats);
      try {
        const res = await fetchWithSession(`/api/character/${player.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
          keepalive: opts?.keepalive,
        });
        if (!res.ok) {
          console.error("character patch failed", res.status);
          return;
        }
        // The PATCH returns the updated row including the new
        // updated_at; thread it back onto the player so subsequent
        // cache writes stamp the right server version.
        try {
          const row = (await res.json()) as { updated_at?: string };
          if (typeof row.updated_at === "string") {
            player.dbUpdatedAt = row.updated_at;
          }
        } catch {
          // Body parse failed — non-blocking, the cache will just
          // miss its stamp this round and refetch will re-sync.
        }
        lastSyncedRef.current = {
          id: player.id,
          level: player.level,
          stats,
        };
        clearPlayerStateCache(player.id);
      } catch (err) {
        console.error("character patch failed", err);
      }
    },
    [playerToUpdate, lastSyncedRef],
  );

  // Deferred persist once dialogs are dismissed and we're idle in the
  // lobby. Anonymous: write the merged Character to localStorage.
  // Signed-in: cache fields, then PATCH Supabase if level changed or a
  // force-sync was requested.
  //
  // No `state.victory` gate: the victory celebration can sit on screen
  // for a while, and we want the wins increment + new XP / level to
  // persist immediately. Loot is held in `state.victory.loot` (not
  // player.inventory) until RESOLVE_LOOT, so persisting here writes the
  // current player state without the unclaimed drop — that's fine, the
  // loot resolution dispatches its own follow-up persist.
  useEffect(() => {
    if (!needsPersistRef.current) return;
    if (state.asiPending.length > 0) return;
    if (state.status !== "lobby") return;
    if (!state.player) return;
    needsPersistRef.current = false;

    const player = state.player;
    const stats = state.stats;

    if (!user) {
      updateLocalCharacterMutable(playerToUpdate(player, stats));
      return;
    }

    cacheLocally(player, stats);

    const last = lastSyncedRef.current;
    const playerId = player.id;
    const levelChanged =
      !!playerId &&
      (!last || last.id !== playerId || last.level !== player.level);
    // Stats (wins/losses/runaways) sit only in the cache between syncs;
    // an external write to the row will drop the cache and lose them.
    // Sync on every change so the row is the source of truth.
    const statsChanged =
      !!playerId &&
      (!last ||
        last.id !== playerId ||
        last.stats.wins !== stats.wins ||
        last.stats.losses !== stats.losses ||
        last.stats.runaways !== stats.runaways);
    if (levelChanged || statsChanged || forceSyncRef.current) {
      forceSyncRef.current = false;
      void syncToSupabase(player, stats);
    }
  }, [
    state.asiPending.length,
    state.status,
    state.player,
    state.stats,
    cacheLocally,
    syncToSupabase,
    playerToUpdate,
    needsPersistRef,
    lastSyncedRef,
    forceSyncRef,
    user,
  ]);

  // Tab-close keepalive flush. Anonymous already lives in localStorage —
  // nothing to send. Signed-in fires a keepalive PATCH.
  useEffect(() => {
    if (!user) return;
    const flush = () => {
      const snap = stateRef.current;
      const p = snap.player;
      if (p?.id) void syncToSupabase(p, snap.stats, { keepalive: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stateRef, syncToSupabase, user]);
}
