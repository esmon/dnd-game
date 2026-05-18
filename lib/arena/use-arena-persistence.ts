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
      let mainOk = false;
      let dbUpdatedAt: string | undefined;
      try {
        const res = await fetchWithSession(`/api/character/${player.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
          keepalive: opts?.keepalive,
        });
        if (res.ok) {
          mainOk = true;
          try {
            const row = (await res.json()) as { updated_at?: string };
            if (typeof row.updated_at === "string") dbUpdatedAt = row.updated_at;
          } catch {
            // Body parse failed — non-blocking, the cache just misses
            // its stamp this round and refetch will re-sync.
          }
        } else {
          const text = await res.text().catch(() => "");
          console.error(
            "character patch failed",
            res.status,
            text.slice(0, 200),
          );
        }
      } catch (err) {
        console.error("character patch threw", err);
      }

      // Scalar fallback. Fires every persist tick alongside the main
      // PATCH so the small set of integer fields that drive
      // progression (level, xp, hp) and counters (wins/losses/run)
      // always land — even if the bigger payload fails its
      // validators or 5xx's. No shape validation, so this can't be
      // poisoned by a malformed weapon / spell / consumable.
      let scalarOk = false;
      try {
        const sres = await fetchWithSession(
          `/api/character/${player.id}/stats`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wins: stats.wins,
              losses: stats.losses,
              runaways: stats.runaways,
              level: player.level,
              xp: player.xp,
              current_hp: player.health,
              max_hp: player.maxHealth,
              proficiency_bonus: player.proficiencyBonus,
            }),
            keepalive: opts?.keepalive,
          },
        );
        if (sres.ok) {
          scalarOk = true;
          try {
            const row = (await sres.json()) as { updated_at?: string };
            if (typeof row.updated_at === "string") dbUpdatedAt = row.updated_at;
          } catch {
            // ignore
          }
        } else {
          const text = await sres.text().catch(() => "");
          console.error("scalar patch failed", sres.status, text.slice(0, 200));
        }
      } catch (err) {
        console.error("scalar patch threw", err);
      }

      // Cache holds the full mutable state (inventory, spells, armor,
      // etc.) — fields the scalar route doesn't cover. Only clear it
      // once the main PATCH succeeds, because that's the call that
      // carries those fields into the row. Otherwise the cache is the
      // only place they live, and dropping it would lose loot /
      // equip changes on the next bootstrap.
      if (mainOk) {
        if (dbUpdatedAt) player.dbUpdatedAt = dbUpdatedAt;
        lastSyncedRef.current = {
          id: player.id,
          level: player.level,
          stats,
        };
        clearPlayerStateCache(player.id);
      } else if (scalarOk && dbUpdatedAt) {
        // Scalar PATCH landed but main didn't. The row's updated_at
        // just advanced, so the cache we wrote a moment ago (with
        // the *old* stamp) would now look stale to the bootstrap's
        // freshness check and get dropped — taking inventory / equip
        // state with it. Re-write the cache with the new stamp so
        // the overlay survives.
        player.dbUpdatedAt = dbUpdatedAt;
        cacheLocally(player, stats);
        lastSyncedRef.current = {
          id: player.id,
          level: player.level,
          stats,
        };
      }
    },
    [playerToUpdate, lastSyncedRef, cacheLocally],
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
