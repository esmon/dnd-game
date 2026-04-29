"use client";

import { useEffect, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";

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
import type { MonsterIndex, Weapon } from "@/lib/game/types";
import {
  clearActiveCharacterId,
  clearPlayerStateCache,
  fetchWithSession,
  getActiveCharacterId,
  readPlayerStateCache,
  setActiveCharacterId,
} from "@/lib/session";

// One-shot bootstrap for the arena page: load the active character (or fall
// back to the most recent for this session), overlay any unsynced cache,
// run legacy weapon / damageType / XP-floor migrations with PATCH-back,
// then fetch the monster index list and character count. On completion
// dispatches BOOTSTRAP_DONE and SET_CHARACTER_COUNT.
//
// Callers pass refs we have to update before the dispatches land, since
// downstream effects (level-refetch, persistence) read them.
export function useArenaBootstrap({
  dispatch,
  indexLevelRef,
  lastSyncedRef,
}: {
  dispatch: React.Dispatch<Action>;
  indexLevelRef: MutableRefObject<number | null>;
  lastSyncedRef: MutableRefObject<{ id: string; level: number } | null>;
}) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let character: Character | null = null;
        const activeId = getActiveCharacterId();

        if (activeId) {
          const res = await fetchWithSession(`/api/character/${activeId}`);
          if (res.status === 404) {
            clearActiveCharacterId();
            router.push("/create");
            return;
          }
          if (!res.ok) {
            console.error("character fetch failed", res.status);
            return;
          }
          character = (await res.json()) as Character;
        } else {
          const res = await fetchWithSession("/api/characters");
          if (!res.ok) {
            console.error("characters list fetch failed", res.status);
            return;
          }
          const all = (await res.json()) as Character[];
          if (all.length === 0) {
            router.push("/create");
            return;
          }
          character = all[0];
          setActiveCharacterId(character.id);
        }

        // Overlay any unsynced localStorage cache (e.g. tab closed mid-grind
        // before the level-up sync fired). Cache is only present while there
        // are unsynced changes; cleared after every successful Supabase sync.
        const cache = readPlayerStateCache(character.id);
        if (cache) {
          character = {
            ...character,
            current_hp: cache.current_hp,
            xp: cache.xp,
            level: cache.level,
            max_hp: cache.max_hp,
            proficiency_bonus: cache.proficiency_bonus,
            ability_scores: cache.ability_scores,
            weapons: cache.weapons,
            inventory: cache.inventory,
            known_spells: cache.known_spells ?? character.known_spells ?? [],
            equipped_spells:
              cache.equipped_spells ?? character.equipped_spells ?? [],
            spell_slots: cache.spell_slots ?? character.spell_slots ?? {},
            consumables: cache.consumables ?? character.consumables ?? [],
          };
        }

        // Legacy migration: pre-inventory characters have weapons missing
        // id/baseId/bonus and an empty inventory. Normalize once and persist.
        const inventoryEmpty =
          !Array.isArray(character.inventory) || character.inventory.length === 0;
        const hasLegacyWeapons =
          Array.isArray(character.weapons) &&
          character.weapons.length > 0 &&
          character.weapons.some((w) => !isFullyShapedWeapon(w));
        if (inventoryEmpty && hasLegacyWeapons) {
          const normalized = character.weapons.map((w) =>
            isFullyShapedWeapon(w) ? (w as Weapon) : legacyWeaponToWeapon(w),
          );
          character = {
            ...character,
            weapons: normalized,
            inventory: normalized,
          };
          try {
            await fetchWithSession(`/api/character/${character.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                weapons: normalized,
                inventory: normalized,
              } satisfies CharacterUpdate),
            });
          } catch (err) {
            console.error("legacy weapon migration patch failed", err);
          }
        }

        // damageType backfill: pre-DRVI weapons lack the field. Patch once.
        if (
          needsDamageTypeBackfill(character.weapons) ||
          needsDamageTypeBackfill(character.inventory)
        ) {
          const weapons = character.weapons.map(ensureDamageType);
          const inventory = character.inventory.map(ensureDamageType);
          character = { ...character, weapons, inventory };
          try {
            await fetchWithSession(`/api/character/${character.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                weapons,
                inventory,
              } satisfies CharacterUpdate),
            });
          } catch (err) {
            console.error("damageType backfill patch failed", err);
          }
        }

        // XP floor migration: characters whose XP fell below their current
        // level's threshold (from the old LOSE clamp-to-0 behavior) get
        // bumped up to the floor so the XP bar stops looking stuck at 0.
        const levelFloor = xpThresholdForLevel(character.level);
        if (character.xp < levelFloor) {
          character = { ...character, xp: levelFloor };
          try {
            await fetchWithSession(`/api/character/${character.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                xp: levelFloor,
              } satisfies CharacterUpdate),
            });
            clearPlayerStateCache(character.id);
          } catch (err) {
            console.error("xp floor migration patch failed", err);
          }
        }

        const player = characterToPlayer(character);

        const monstersRes = await fetch(`/api/monsters?level=${player.level}`);
        if (!monstersRes.ok) {
          throw new Error(`monsters fetch ${monstersRes.status}`);
        }
        const indices = (await monstersRes.json()) as MonsterIndex[];

        // Count of session's characters drives whether the Switch button
        // shows up. Fetch alongside bootstrap so it's ready in the lobby.
        let count = 1;
        try {
          const listRes = await fetchWithSession("/api/characters");
          if (listRes.ok) {
            const all = (await listRes.json()) as Character[];
            count = all.length;
          }
        } catch (err) {
          console.error("character count fetch failed", err);
        }

        if (cancelled) return;
        indexLevelRef.current = player.level;
        lastSyncedRef.current = { id: character.id, level: player.level };
        dispatch({ type: "BOOTSTRAP_DONE", player, indices });
        dispatch({ type: "SET_CHARACTER_COUNT", count });
      } catch (err) {
        console.error("bootstrap failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch, indexLevelRef, lastSyncedRef, router]);
}
