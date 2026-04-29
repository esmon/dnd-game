"use client";

import { useCallback, useEffect, type MutableRefObject } from "react";

import type { CharacterUpdate } from "@/lib/db/schema";
import type { GameState } from "@/lib/game/reducer";
import type { Player } from "@/lib/game/types";
import {
  cachePlayerState,
  clearPlayerStateCache,
  fetchWithSession,
} from "@/lib/session";

// Two-part persistence for the arena:
//
// 1. After ASI / victory dismissal, when we're idle in the lobby, snapshot
//    the latest player state. Always cache to localStorage; only PATCH
//    Supabase when the level changed (or `forceSyncRef` was raised, e.g.
//    after a loot Keep/Discard) — keeps Supabase writes proportional to
//    meaningful changes.
//
// 2. On tab close / visibility change to hidden, fire a keepalive PATCH so
//    in-flight progress doesn't die with the tab.
//
// Refs are passed in (not owned here) because handlers in the arena raise
// `needsPersistRef` / `forceSyncRef` directly; the hook just consumes them.
export function useArenaPersistence({
  state,
  stateRef,
  needsPersistRef,
  lastSyncedRef,
  forceSyncRef,
}: {
  state: GameState;
  stateRef: MutableRefObject<GameState>;
  needsPersistRef: MutableRefObject<boolean>;
  lastSyncedRef: MutableRefObject<{ id: string; level: number } | null>;
  forceSyncRef: MutableRefObject<boolean>;
}) {
  const cacheLocally = useCallback((player: Player) => {
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
    });
  }, []);

  const syncToSupabase = useCallback(
    async (player: Player, opts?: { keepalive?: boolean }) => {
      if (!player.id) return;
      const update: CharacterUpdate = {
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
      };
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
        lastSyncedRef.current = { id: player.id, level: player.level };
        clearPlayerStateCache(player.id);
      } catch (err) {
        console.error("character patch failed", err);
      }
    },
    [lastSyncedRef],
  );

  // Fire deferred persist once the victory + ASI dialogs are dismissed and
  // we're in the lobby.
  useEffect(() => {
    if (!needsPersistRef.current) return;
    if (state.victory) return;
    if (state.asiPending.length > 0) return;
    if (state.status !== "lobby") return;
    if (!state.player) return;
    needsPersistRef.current = false;

    const player = state.player;
    cacheLocally(player);

    const last = lastSyncedRef.current;
    const playerId = player.id;
    const levelChanged =
      !!playerId &&
      (!last || last.id !== playerId || last.level !== player.level);
    if (levelChanged || forceSyncRef.current) {
      forceSyncRef.current = false;
      void syncToSupabase(player);
    }
  }, [
    state.victory,
    state.asiPending.length,
    state.status,
    state.player,
    cacheLocally,
    syncToSupabase,
    needsPersistRef,
    lastSyncedRef,
    forceSyncRef,
  ]);

  // Flush in-memory state to Supabase when the tab is closing or hidden.
  // keepalive lets the request survive the unload.
  useEffect(() => {
    const flush = () => {
      const p = stateRef.current.player;
      if (p?.id) void syncToSupabase(p, { keepalive: true });
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
  }, [stateRef, syncToSupabase]);
}
