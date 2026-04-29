"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";

import {
  BackpackIcon,
  ChevronsUpIcon,
  FlaskConicalIcon,
  FootprintsIcon,
  HeartIcon,
  MoonIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
  SwordsIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CharacterPickerDialog } from "@/components/game/character-picker-dialog";
import { CombatLog } from "@/components/game/combat-log";
import { MobileCombatLog } from "@/components/game/mobile-combat-log";
import { CommandPanel } from "@/components/game/command-panel";
import { DisabledTip } from "@/components/game/disabled-tip";
import { PlayerPanel } from "@/components/game/player-panel";
import { InventoryDialog } from "@/components/game/inventory-dialog";
import { LevelUpDialog } from "@/components/game/level-up-dialog";
import { MonsterCard } from "@/components/game/monster-card";
import { StatsBar } from "@/components/game/stats-bar";
import { VictoryDialog } from "@/components/game/victory-dialog";
import { rollDice, randomInt } from "@/lib/game/dice";
import {
  classFeatureLabel,
  computeWeaponAttackDamage,
} from "@/lib/dnd/class-features";
import { findClass } from "@/lib/dnd/classes";
import {
  applyDamageMultiplier,
  averageDamage,
  damageMultiplier,
  playerAC,
  rollAttack,
  weaponAttackAbility,
} from "@/lib/dnd/combat";
import {
  weaponAttackBonus,
  weaponAttackBonusDice,
  weaponAttackMultiplier,
} from "@/lib/dnd/class-features";
import { abilityModifier } from "@/lib/dnd/derive";
import { MAX_LEVEL, xpThresholdForLevel } from "@/lib/dnd/leveling";
import { RACES } from "@/lib/dnd/races";
import { findLowestSlot, slotsForLevel } from "@/lib/dnd/spells";
import { WEAPONS, weaponsByBaseId } from "@/lib/dnd/weapons";
import {
  EQUIP_CAP,
  EQUIPPED_SPELL_CAP,
  gameReducer,
  initialState,
  type GameState,
} from "@/lib/game/reducer";
import type { AbilityScores } from "@/lib/db/schema";
import type {
  Consumable,
  Monster,
  MonsterIndex,
  Player,
  Weapon,
} from "@/lib/game/types";
import type { Character, CharacterUpdate } from "@/lib/db/schema";
import { characterToPlayer } from "@/lib/db/schema";
import {
  fetchWithSession,
  getActiveCharacterId,
  setActiveCharacterId,
  clearActiveCharacterId,
  cachePlayerState,
  readPlayerStateCache,
  clearPlayerStateCache,
} from "@/lib/session";

// Migration helper: legacy weapons stored as { name, damage } only.
// Map by case-insensitive name to a SRD baseId.
function legacyWeaponToWeapon(w: { name: string; damage: string }): Weapon {
  const match = WEAPONS.find(
    (def) => def.name.toLowerCase() === w.name.toLowerCase(),
  );
  return {
    id: crypto.randomUUID(),
    baseId: match?.baseId ?? "",
    name: w.name,
    damage: w.damage,
    bonus: 0,
    damageType: match?.damageType ?? "slashing",
  };
}

function isFullyShapedWeapon(w: unknown): boolean {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.baseId === "string" &&
    typeof o.bonus === "number"
  );
}

// Migration helper: pre-DRVI weapons exist on disk without a damageType field.
// Backfill from the catalog (or default to slashing) so all in-memory Weapons
// satisfy the type.
function ensureDamageType(w: Weapon): Weapon {
  if (typeof w.damageType === "string" && w.damageType.length > 0) return w;
  const def = weaponsByBaseId[w.baseId];
  return { ...w, damageType: def?.damageType ?? "slashing" };
}

function needsDamageTypeBackfill(weapons: Weapon[]): boolean {
  return weapons.some(
    (w) => typeof w.damageType !== "string" || w.damageType.length === 0,
  );
}

function pickRandomMonsterIndex(indices: MonsterIndex[]): MonsterIndex | null {
  if (indices.length === 0) return null;
  return indices[Math.floor(Math.random() * indices.length)];
}

type ConsumableGroup = {
  key: string;
  ids: string[];
  representative: Consumable;
};

function groupConsumables(consumables: Consumable[]): ConsumableGroup[] {
  const groups = new Map<string, ConsumableGroup>();
  for (const c of consumables) {
    const key =
      c.kind === "scroll"
        ? `scroll:${c.spellName}:${c.spellLevel}`
        : `potion:${c.baseId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(c.id);
    } else {
      groups.set(key, { key, ids: [c.id], representative: c });
    }
  }
  return Array.from(groups.values());
}

export function Arena() {
  const router = useRouter();
  const [state, dispatch] = useReducer(gameReducer, initialState);
  // We need fresh state inside async timeouts (player health after the
  // attack may have changed). Keep a ref in sync to avoid stale closures.
  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Tracks the level used to fetch the current index list, so we know when
  // to refetch after a level-up changes the CR pool.
  const indexLevelRef = useRef<number | null>(null);
  // Set to true when a persist is pending. Persistence is deferred until the
  // ASI queue is empty so we save with finalized ability scores.
  const needsPersistRef = useRef(false);
  // Last (id, level) we wrote to Supabase. Used to decide when to sync —
  // we only push to Supabase on level changes; otherwise we just cache.
  const lastSyncedRef = useRef<{ id: string; level: number } | null>(null);
  // One-shot flag: force the next persist effect to also push to Supabase
  // (used after loot keep/discard so inventory decisions never sit unsynced).
  const forceSyncRef = useRef(false);

  // Bootstrap: load the active character from Supabase + monster index list.
  // If no active id is set, fall back to the most recent character for this
  // session (one-time migration so existing players don't lose their character).
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
  }, [router]);

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
    [],
  );

  // Refetch monster index list whenever the player's level crosses a CR pool
  // boundary. Fires after WIN-induced level-ups and after any state restore.
  useEffect(() => {
    const lvl = state.player?.level;
    if (lvl == null) return;
    if (indexLevelRef.current === lvl) return;
    indexLevelRef.current = lvl;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/monsters?level=${lvl}`);
        if (!res.ok) throw new Error(`monsters fetch ${res.status}`);
        const indices = (await res.json()) as MonsterIndex[];
        if (cancelled) return;
        dispatch({ type: "SET_MONSTER_INDICES", indices });
      } catch (err) {
        console.error("monster index refetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.player?.level]);

  // Fire deferred persist once the victory + ASI dialogs are dismissed and
  // we're in the lobby. Always caches to localStorage; only PATCHes Supabase
  // if the level changed (or this is the first sync for a new character).
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
  ]);

  // Flush whatever's in memory to Supabase when the tab is closing or going
  // into the background. keepalive lets the request survive the unload.
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
  }, [syncToSupabase]);

  const fetchAndSetMonster = useCallback(async () => {
    const indices = stateRef.current.monsterIndices;
    const pick = pickRandomMonsterIndex(indices);
    if (!pick) return;
    try {
      const res = await fetch(`/api/monsters/${pick.index}`);
      if (!res.ok) throw new Error(`monster ${pick.index} ${res.status}`);
      const monster = (await res.json()) as Monster;
      dispatch({ type: "SET_MONSTER", monster });
    } catch (err) {
      console.error("monster fetch failed", err);
    }
  }, []);

  const startFight = useCallback(() => {
    dispatch({ type: "START_FIGHT" });
    void fetchAndSetMonster();
  }, [fetchAndSetMonster]);

  // 1s suspense, then the monster swings back. Compute the post-attack HP
  // from the snapshot so we can dispatch LOSE in the same tick (avoids a
  // race where stateRef hasn't caught up between MONSTER_ATTACK and LOSE).
  const triggerMonsterAttack = useCallback(() => {
    dispatch({ type: "MONSTER_PENDING" });
    setTimeout(() => {
      const snap = stateRef.current;
      if (!snap.monster || !snap.player) return;
      const klass = findClass(snap.player.classId) ?? null;
      const targetAC = playerAC(klass, snap.player.abilityScores);
      const attack = rollAttack(snap.monster.attackBonus, targetAC);
      if (!attack.hit) {
        dispatch({
          type: "MONSTER_ATTACK",
          damage: 0,
          missed: true,
          note: `d20 ${attack.d20}`,
        });
        return;
      }
      const race = RACES.find((r) => r.id === snap.player!.raceId);
      const baseRaw =
        rollDice(snap.monster.damageDice) +
        (attack.crit ? rollDice(snap.monster.damageDice) : 0);
      const dmgMult = damageMultiplier(
        snap.monster.damageType,
        race?.damageResistances ?? [],
        race?.damageImmunities ?? [],
        race?.damageVulnerabilities ?? [],
      );
      const damage = applyDamageMultiplier(baseRaw, dmgMult);
      const noteParts = [snap.monster.damageType];
      if (dmgMult.label) noteParts.push(dmgMult.label);
      const note = noteParts.join(" — ");
      const newPlayerHealth = Math.max(0, snap.player.health - damage);
      dispatch({
        type: "MONSTER_ATTACK",
        damage,
        crit: attack.crit,
        note,
      });
      if (newPlayerHealth <= 0) {
        dispatch({ type: "LOSE" });
        needsPersistRef.current = true;
      }
    }, 1000);
  }, []);

  const handleAttack = useCallback(
    (weapon: Weapon) => {
      const snap = stateRef.current;
      if (
        snap.status !== "fighting" ||
        !snap.monster ||
        !snap.player ||
        snap.monsterPending ||
        snap.monster.health <= 0
      ) {
        return;
      }
      const ability = weaponAttackAbility(weapon, snap.player.abilityScores);
      const mod =
        snap.player.proficiencyBonus +
        abilityModifier(snap.player.abilityScores[ability]);
      const attack = rollAttack(mod, snap.monster.ac);
      if (!attack.hit) {
        dispatch({
          type: "PLAYER_ATTACK",
          damage: 0,
          weaponName: weapon.name,
          missed: true,
          note: `d20 ${attack.d20}`,
        });
        triggerMonsterAttack();
        return;
      }
      const rawDamage = computeWeaponAttackDamage(
        snap.player.classId,
        snap.player.level,
        weapon.damage,
        attack.crit,
      );
      const dmgMult = damageMultiplier(
        weapon.damageType,
        snap.monster.damageResistances,
        snap.monster.damageImmunities,
        snap.monster.damageVulnerabilities,
      );
      const damage = applyDamageMultiplier(rawDamage, dmgMult);
      const featureLabel = classFeatureLabel(
        snap.player.classId,
        snap.player.level,
      );
      const noteParts: string[] = [];
      if (featureLabel) noteParts.push(featureLabel);
      const dtype = weapon.damageType;
      noteParts.push(dmgMult.label ? `${dtype} — ${dmgMult.label}` : dtype);
      const note = noteParts.join(" · ");
      const newMonsterHealth = Math.max(0, snap.monster.health - damage);
      dispatch({
        type: "PLAYER_ATTACK",
        damage,
        weaponName: weapon.name,
        crit: attack.crit,
        note,
      });
      if (newMonsterHealth <= 0) {
        dispatch({ type: "WIN" });
        const newWins = snap.stats.wins + 1;
        if (newWins > 0 && newWins % 3 === 0) {
          dispatch({ type: "FULL_HEAL" });
        }
        // Persist runs from a useEffect once asiPending drains; flag here
        // so any pending ASI dialog can resolve before the PATCH.
        needsPersistRef.current = true;
      } else {
        triggerMonsterAttack();
      }
    },
    [triggerMonsterAttack],
  );

  const handleHeal = useCallback(() => {
    const snap = stateRef.current;
    if (!snap.player) return;
    if (snap.monsterPending) return;
    if (snap.player.health >= snap.player.maxHealth) return;

    const klass = findClass(snap.player.classId);
    if (!klass?.canSelfHealInCombat) return;
    if (snap.player.level < (klass.healMinLevel ?? 1)) return;

    let slotLevel: number | undefined;
    if (klass.healCostsSlot) {
      const lowest = findLowestSlot(snap.player.spellSlots);
      if (!lowest) return;
      slotLevel = lowest.level;
    }

    const amount = randomInt(1, 10);
    dispatch({ type: "PLAYER_HEAL", amount, slotLevel });

    // In a fight, healing still costs you a turn — monster swings back.
    if (snap.status === "fighting" && snap.monster && snap.monster.health > 0) {
      triggerMonsterAttack();
    }
  }, [triggerMonsterAttack]);

  // REST in lobby: full heal + refill spell slots, both persisted.
  const handleRest = useCallback(() => {
    const snap = stateRef.current;
    if (!snap.player) return;
    if (snap.player.health < snap.player.maxHealth) {
      const amount = randomInt(1, 10);
      dispatch({ type: "PLAYER_HEAL", amount });
    }
    dispatch({ type: "REFILL_SLOTS" });
    needsPersistRef.current = true;
  }, []);

  const handleCastSpell = useCallback(
    (
      spellId: string,
      spellLevel: number,
      damageDice: string,
      damageType: string,
    ) => {
      const snap = stateRef.current;
      if (
        snap.status !== "fighting" ||
        !snap.monster ||
        !snap.player ||
        snap.monsterPending ||
        snap.monster.health <= 0
      ) {
        return;
      }
      if (spellLevel > 0) {
        const remaining = snap.player.spellSlots[String(spellLevel)] ?? 0;
        if (remaining <= 0) return;
      }
      // Treat all damage spells as spell-attack-roll spells (deviation from
      // RAW: Fireball etc. should be DEX saves, but we collapse the two for
      // a single combat path).
      const klass = findClass(snap.player.classId);
      const ability = klass?.spellcastingAbility ?? "int";
      const mod =
        snap.player.proficiencyBonus +
        abilityModifier(snap.player.abilityScores[ability]);
      const attack = rollAttack(mod, snap.monster.ac);
      if (!attack.hit) {
        // Slot is still consumed on miss for spell-attack spells.
        dispatch({
          type: "CAST_SPELL",
          spellId,
          damage: 0,
          missed: true,
          note: `d20 ${attack.d20}`,
        });
        triggerMonsterAttack();
        return;
      }
      const rawDamage =
        rollDice(damageDice) + (attack.crit ? rollDice(damageDice) : 0);
      const dmgMult = damageMultiplier(
        damageType,
        snap.monster.damageResistances,
        snap.monster.damageImmunities,
        snap.monster.damageVulnerabilities,
      );
      const damage = applyDamageMultiplier(rawDamage, dmgMult);
      const note = dmgMult.label
        ? `${damageType} — ${dmgMult.label}`
        : damageType;
      const newMonsterHealth = Math.max(0, snap.monster.health - damage);
      dispatch({
        type: "CAST_SPELL",
        spellId,
        damage,
        crit: attack.crit,
        note,
      });
      if (newMonsterHealth <= 0) {
        dispatch({ type: "WIN" });
        const newWins = snap.stats.wins + 1;
        if (newWins > 0 && newWins % 3 === 0) {
          dispatch({ type: "FULL_HEAL" });
        }
        needsPersistRef.current = true;
      } else {
        triggerMonsterAttack();
      }
    },
    [triggerMonsterAttack],
  );

  const handleSmite = useCallback(
    (weapon: Weapon, smiteSlotLevel: number) => {
      const snap = stateRef.current;
      if (
        snap.status !== "fighting" ||
        !snap.monster ||
        !snap.player ||
        snap.monsterPending ||
        snap.monster.health <= 0
      ) {
        return;
      }
      const remaining =
        snap.player.spellSlots[String(smiteSlotLevel)] ?? 0;
      if (remaining <= 0) return;
      const ability = weaponAttackAbility(weapon, snap.player.abilityScores);
      const mod =
        snap.player.proficiencyBonus +
        abilityModifier(snap.player.abilityScores[ability]);
      const attack = rollAttack(mod, snap.monster.ac);
      if (!attack.hit) {
        // Smite isn't consumed on miss because 5e declares smite after the
        // hit lands. Dispatch a non-consuming SMITE_ATTACK miss so the log
        // reads as a smite attempt rather than a regular swing.
        dispatch({
          type: "SMITE_ATTACK",
          damage: 0,
          weaponName: weapon.name,
          smiteDamage: 0,
          smiteSlotLevel,
          missed: true,
          consumeSlot: false,
          note: `d20 ${attack.d20}`,
        });
        triggerMonsterAttack();
        return;
      }
      const rawWeaponDamage = computeWeaponAttackDamage(
        snap.player.classId,
        snap.player.level,
        weapon.damage,
        attack.crit,
      );
      const weaponMult = damageMultiplier(
        weapon.damageType,
        snap.monster.damageResistances,
        snap.monster.damageImmunities,
        snap.monster.damageVulnerabilities,
      );
      const weaponDamage = applyDamageMultiplier(rawWeaponDamage, weaponMult);
      const smiteDice = `${smiteSlotLevel + 1}d8`;
      const rawSmite =
        rollDice(smiteDice) + (attack.crit ? rollDice(smiteDice) : 0);
      const radiantMult = damageMultiplier(
        "radiant",
        snap.monster.damageResistances,
        snap.monster.damageImmunities,
        snap.monster.damageVulnerabilities,
      );
      const smiteDamage = applyDamageMultiplier(rawSmite, radiantMult);
      const noteParts = [
        weaponMult.label
          ? `${weapon.damageType} — ${weaponMult.label}`
          : weapon.damageType,
      ];
      noteParts.push(
        radiantMult.label ? `radiant — ${radiantMult.label}` : "radiant",
      );
      const note = noteParts.join(" + ");
      const total = weaponDamage + smiteDamage;
      const newMonsterHealth = Math.max(0, snap.monster.health - total);
      dispatch({
        type: "SMITE_ATTACK",
        damage: weaponDamage,
        weaponName: weapon.name,
        smiteDamage,
        smiteSlotLevel,
        crit: attack.crit,
        consumeSlot: true,
        note,
      });
      if (newMonsterHealth <= 0) {
        dispatch({ type: "WIN" });
        const newWins = snap.stats.wins + 1;
        if (newWins > 0 && newWins % 3 === 0) {
          dispatch({ type: "FULL_HEAL" });
        }
        needsPersistRef.current = true;
      } else {
        triggerMonsterAttack();
      }
    },
    [triggerMonsterAttack],
  );

  const handleUseScroll = useCallback(
    (scrollId: string, damageDice: string, damageType: string) => {
      const snap = stateRef.current;
      if (
        snap.status !== "fighting" ||
        !snap.monster ||
        !snap.player ||
        snap.monsterPending ||
        snap.monster.health <= 0
      ) {
        return;
      }
      const klass = findClass(snap.player.classId);
      // Non-casters reading a scroll fall back to INT, matching SRD ruling.
      const ability = klass?.spellcastingAbility ?? "int";
      const mod =
        snap.player.proficiencyBonus +
        abilityModifier(snap.player.abilityScores[ability]);
      const attack = rollAttack(mod, snap.monster.ac);
      if (!attack.hit) {
        dispatch({
          type: "USE_SCROLL",
          scrollId,
          damage: 0,
          missed: true,
          note: `d20 ${attack.d20}`,
        });
        triggerMonsterAttack();
        return;
      }
      const rawDamage =
        rollDice(damageDice) + (attack.crit ? rollDice(damageDice) : 0);
      const dmgMult = damageMultiplier(
        damageType,
        snap.monster.damageResistances,
        snap.monster.damageImmunities,
        snap.monster.damageVulnerabilities,
      );
      const damage = applyDamageMultiplier(rawDamage, dmgMult);
      const note = dmgMult.label
        ? `${damageType} — ${dmgMult.label}`
        : damageType;
      const newMonsterHealth = Math.max(0, snap.monster.health - damage);
      dispatch({
        type: "USE_SCROLL",
        scrollId,
        damage,
        crit: attack.crit,
        note,
      });
      if (newMonsterHealth <= 0) {
        dispatch({ type: "WIN" });
        const newWins = snap.stats.wins + 1;
        if (newWins > 0 && newWins % 3 === 0) {
          dispatch({ type: "FULL_HEAL" });
        }
        needsPersistRef.current = true;
      } else {
        triggerMonsterAttack();
      }
    },
    [triggerMonsterAttack],
  );

  const handleUsePotion = useCallback(
    (potionId: string, healDice: string) => {
      const snap = stateRef.current;
      if (!snap.player) return;
      if (snap.monsterPending) return;
      const healed = rollDice(healDice);
      dispatch({ type: "USE_POTION", potionId, healed });
      // In a fight, drinking still costs a turn — monster swings back.
      if (
        snap.status === "fighting" &&
        snap.monster &&
        snap.monster.health > 0
      ) {
        triggerMonsterAttack();
      }
      needsPersistRef.current = true;
    },
    [triggerMonsterAttack],
  );

  const handleEquipSpell = useCallback((id: string) => {
    dispatch({ type: "EQUIP_SPELL", id });
    needsPersistRef.current = true;
  }, []);

  const handleUnequipSpell = useCallback((id: string) => {
    dispatch({ type: "UNEQUIP_SPELL", id });
    needsPersistRef.current = true;
  }, []);

  const handleDiscardConsumable = useCallback((id: string) => {
    dispatch({ type: "DISCARD_CONSUMABLE", id });
    needsPersistRef.current = true;
  }, []);

  const handlePlayAgain = useCallback(() => {
    dispatch({ type: "FULL_HEAL" });
    needsPersistRef.current = true;
  }, []);

  const handleRunAway = useCallback(() => {
    const snap = stateRef.current;
    if (snap.status !== "fighting" || snap.monsterPending) return;
    const success = Math.random() < 0.4;
    if (success) {
      dispatch({ type: "RUN_AWAY_SUCCESS" });
      needsPersistRef.current = true;
    } else {
      dispatch({ type: "RUN_AWAY_FAIL" });
      triggerMonsterAttack();
    }
  }, [triggerMonsterAttack]);

  const handleAsiConfirm = useCallback((deltas: Partial<AbilityScores>) => {
    dispatch({ type: "APPLY_ASI", deltas });
  }, []);

  const handleEquip = useCallback((id: string) => {
    dispatch({ type: "EQUIP_WEAPON", id });
    needsPersistRef.current = true;
  }, []);

  const handleUnequip = useCallback((id: string) => {
    dispatch({ type: "UNEQUIP_WEAPON", id });
    needsPersistRef.current = true;
  }, []);

  const handleDiscard = useCallback((id: string) => {
    dispatch({ type: "DISCARD_WEAPON", id });
    needsPersistRef.current = true;
  }, []);

  const handleSelectCharacter = useCallback((id: string) => {
    setActiveCharacterId(id);
    // Cleanest reset for everything (game state, refs, fetched indices) is a
    // full page reload — bootstrap will pick up the new active character.
    window.location.reload();
  }, []);

  if (state.loading || !state.player) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground">Loading the arena...</p>
      </div>
    );
  }

  const { player, monster, status, monsterPending, stats, turns, asiPending } =
    state;
  const playerAlive = player.health > 0;
  const actionsDisabled =
    monsterPending ||
    !monster ||
    monster.health <= 0 ||
    !playerAlive ||
    asiPending.length > 0;

  // Shared reason text for the common "you can't take any action right now"
  // disabled states. Returns null when actions are allowed.
  const fightActionReason: string | null = (() => {
    if (asiPending.length > 0) return "Resolve level-up first";
    if (monsterPending) return "Wait for the monster's turn";
    if (!monster) return "Loading monster...";
    if (monster && monster.health <= 0) return "Monster is already defeated";
    if (!playerAlive) return "You can't act while defeated";
    return null;
  })();

  const lobbyActionReason: string | null =
    asiPending.length > 0 ? "Resolve level-up first" : null;

  // REST is heal + refill spell slots. Pointless only when HP is already
  // full AND every slot is already at the level's max (or no slots, for
  // non-casters whose spellSlots is just {}).
  const restPointless = (() => {
    if (player.health < player.maxHealth) return false;
    const max = slotsForLevel(player.level);
    for (const lvl of Object.keys(player.spellSlots)) {
      if ((player.spellSlots[lvl] ?? 0) < (max[lvl] ?? 0)) return false;
    }
    return true;
  })();
  const restReason: string | null =
    lobbyActionReason ??
    (restPointless ? "Already at full HP and full slots" : null);

  const pendingAsiLevel = asiPending[0];

  const playerClass = findClass(player.classId);
  const canSelfHealInCombat = playerClass?.canSelfHealInCombat ?? false;
  const healMinLevel = playerClass?.healMinLevel ?? 1;
  const healCostsSlot = playerClass?.healCostsSlot ?? false;
  const healLowestSlot = healCostsSlot
    ? findLowestSlot(player.spellSlots)
    : undefined;
  const healOutOfSlots = healCostsSlot && !healLowestSlot;
  const healUnderMinLevel = player.level < healMinLevel;
  const healReason: string | null =
    fightActionReason ??
    (healUnderMinLevel
      ? `Available at level ${healMinLevel}`
      : healOutOfSlots
        ? "Out of spell slots — REST to refill"
        : player.health >= player.maxHealth
          ? "Already at full HP"
          : null);

  // Smite metadata derived from current state. Lifted out of the JSX IIFE
  // so the React compiler isn't confused into thinking it touches refs
  // during render.
  const isSmiteEligible =
    player.classId.toLowerCase() === "paladin" &&
    player.level >= 2 &&
    player.weapons.length > 0;
  const smiteSlot = isSmiteEligible
    ? findLowestSlot(player.spellSlots)
    : undefined;
  const smiteSlotLevel = smiteSlot ? smiteSlot.level : 0;
  const smiteOutOfSlots = isSmiteEligible && !smiteSlot;
  const smiteWeapon = isSmiteEligible ? player.weapons[0] : null;
  const smiteReason =
    fightActionReason ??
    (smiteOutOfSlots ? "Out of spell slots — REST to refill" : null);

  // Pre-rank all offensive actions by expected damage against the current
  // monster. Buttons render in this order so the most effective option is
  // first. Weapons, smite, equipped spells, and scrolls all participate;
  // potions are a separate (heal) category.
  const consumableGroups = groupConsumables(player.consumables);
  const weaponFlatBonus = weaponAttackBonus(player.classId, player.level);
  const weaponBonusDiceStr = weaponAttackBonusDice(player.classId, player.level);
  const weaponBonusDiceAvg = weaponBonusDiceStr
    ? averageDamage(weaponBonusDiceStr)
    : 0;
  const weaponMultiplier = weaponAttackMultiplier(player.classId, player.level);
  const monsterDmgMult = (damageType: string): number => {
    if (!monster) return 1;
    return damageMultiplier(
      damageType,
      monster.damageResistances,
      monster.damageImmunities,
      monster.damageVulnerabilities,
    ).mult;
  };

  type AttackOption = {
    key: string;
    effective: number;
    node: React.ReactNode;
  };
  const attackOptions: AttackOption[] = [];

  for (const weapon of player.weapons) {
    const baseAvg = averageDamage(weapon.damage);
    const totalAvg =
      (baseAvg + weaponFlatBonus + weaponBonusDiceAvg) * weaponMultiplier;
    const effective = totalAvg * monsterDmgMult(weapon.damageType);
    const key = `w-${weapon.id}`;
    attackOptions.push({
      key,
      effective,
      node: (
        <DisabledTip key={key} reason={fightActionReason}>
          <Button
            variant="destructive"
            onClick={() => handleAttack(weapon)}
            disabled={actionsDisabled}
            className="h-auto w-full flex-col gap-0 py-1.5 leading-tight"
          >
            <span className="flex items-center gap-1.5">
              <SwordIcon className="size-3.5 shrink-0" />
              <span className="truncate">{weapon.name}</span>
            </span>
            <span className="text-xs opacity-70">{weapon.damage}</span>
          </Button>
        </DisabledTip>
      ),
    });
  }

  if (isSmiteEligible && smiteWeapon) {
    const baseAvg = averageDamage(smiteWeapon.damage);
    const weaponPart = (baseAvg + weaponFlatBonus) * weaponMultiplier;
    const smiteDiceAvg = (smiteSlotLevel + 1) * 4.5;
    const effective = smiteOutOfSlots
      ? 0
      : weaponPart * monsterDmgMult(smiteWeapon.damageType) +
        smiteDiceAvg * monsterDmgMult("radiant");
    attackOptions.push({
      key: "smite",
      effective,
      node: (
        <DisabledTip key="smite" reason={smiteReason}>
          <Button
            className="h-auto w-full flex-col gap-0 bg-amber-500 py-1.5 leading-tight text-white hover:bg-amber-500/90"
            onClick={() => handleSmite(smiteWeapon, smiteSlotLevel)}
            disabled={actionsDisabled || smiteOutOfSlots}
          >
            <span className="flex items-center gap-1.5">
              <SunIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {smiteOutOfSlots ? "Smite" : `Smite (L${smiteSlotLevel})`}
              </span>
            </span>
            <span className="text-xs opacity-80">
              {smiteOutOfSlots
                ? "+?d8 radiant"
                : `+${smiteSlotLevel + 1}d8 radiant`}
            </span>
          </Button>
        </DisabledTip>
      ),
    });
  }

  for (const spell of player.equippedSpells) {
    const slotsMax = player.spellSlots[String(spell.level)] ?? 0;
    const slotsLeft = spell.level === 0 ? Infinity : slotsMax;
    const outOfSlots = spell.level > 0 && slotsLeft <= 0;
    const slotInfo =
      spell.level === 0
        ? "cantrip"
        : `L${spell.level} · ${slotsLeft}/${slotsMax}`;
    const spellReason =
      fightActionReason ??
      (outOfSlots
        ? `Out of L${spell.level} spell slots — REST to refill`
        : null);
    const effective =
      averageDamage(spell.damage) * monsterDmgMult(spell.damageType);
    const key = `s-${spell.id}`;
    attackOptions.push({
      key,
      effective,
      node: (
        <DisabledTip key={key} reason={spellReason}>
          <Button
            className="h-auto w-full flex-col gap-0 bg-indigo-600 py-1.5 leading-tight text-white hover:bg-indigo-600/90"
            onClick={() =>
              handleCastSpell(
                spell.id,
                spell.level,
                spell.damage,
                spell.damageType,
              )
            }
            disabled={actionsDisabled || outOfSlots}
          >
            <span className="flex items-center gap-1.5">
              <SparklesIcon className="size-3.5 shrink-0" />
              <span className="truncate">{spell.name}</span>
            </span>
            <span className="text-xs opacity-70">
              {spell.damage} · {slotInfo}
            </span>
          </Button>
        </DisabledTip>
      ),
    });
  }

  for (const group of consumableGroups) {
    if (group.representative.kind !== "scroll") continue;
    const c = group.representative;
    const count = group.ids.length;
    const useId = group.ids[0];
    const effective = averageDamage(c.damage) * monsterDmgMult(c.damageType);
    const key = `sc-${group.key}`;
    attackOptions.push({
      key,
      effective,
      node: (
        <DisabledTip key={key} reason={fightActionReason}>
          <Button
            variant="secondary"
            onClick={() => handleUseScroll(useId, c.damage, c.damageType)}
            disabled={actionsDisabled}
            className="h-auto w-full flex-col gap-0 py-1.5 leading-tight"
          >
            <span className="flex items-center gap-1.5">
              <ScrollTextIcon className="size-3.5 shrink-0" />
              <span className="truncate">
                {c.spellName}
                {count > 1 ? ` ×${count}` : ""}
              </span>
            </span>
            <span className="text-xs opacity-70">Scroll · {c.damage}</span>
          </Button>
        </DisabledTip>
      ),
    });
  }

  attackOptions.sort((a, b) => b.effective - a.effective);

  const TOP_ATTACK_LIMIT = 3;
  const visibleAttackOptions = attackOptions.slice(0, TOP_ATTACK_LIMIT);
  const hiddenAttackOptions = attackOptions.slice(TOP_ATTACK_LIMIT);

  const potionGroups = consumableGroups.filter(
    (g) => g.representative.kind === "potion",
  );

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <h1 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
        Monster Smashy Smashy
      </h1>

      <StatsBar stats={stats} />

      {status === "fighting" ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <PlayerPanel player={player} />
          {monster ? (
            <MonsterCard monster={monster} />
          ) : (
            <div className="flex min-h-[200px] items-center justify-center rounded-xl border bg-card p-6">
              <p className="text-sm text-muted-foreground">
                A new challenger approaches...
              </p>
            </div>
          )}
          <MobileCombatLog
            className="col-span-2"
            turns={turns}
            expanded={state.logExpanded}
            onToggle={(expanded) =>
              dispatch({ type: "SET_LOG_EXPANDED", expanded })
            }
          />
          <CommandPanel className="col-span-2 md:col-span-1">
            {visibleAttackOptions.map((o) => o.node)}
            {hiddenAttackOptions.length > 0 ? (
              <Popover
                open={state.attacksExpanded}
                onOpenChange={(open) =>
                  dispatch({ type: "SET_ATTACKS_EXPANDED", expanded: open })
                }
              >
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      Show {hiddenAttackOptions.length} more
                    </Button>
                  }
                />
                <PopoverContent
                  side="left"
                  align="start"
                  className="flex w-64 flex-col gap-2"
                >
                  {hiddenAttackOptions.map((o) => o.node)}
                </PopoverContent>
              </Popover>
            ) : null}
            {potionGroups.map((group) => {
              if (group.representative.kind !== "potion") return null;
              const c = group.representative;
              const count = group.ids.length;
              const useId = group.ids[0];
              const potionFull = player.health >= player.maxHealth;
              const potionReason =
                fightActionReason ??
                (potionFull ? "Already at full HP" : null);
              return (
                <DisabledTip key={group.key} reason={potionReason}>
                  <Button
                    variant="secondary"
                    onClick={() => handleUsePotion(useId, c.healDice)}
                    disabled={actionsDisabled || potionFull}
                    className="h-auto w-full flex-col gap-0 py-1.5 leading-tight"
                  >
                    <span className="flex items-center gap-1.5">
                      <FlaskConicalIcon className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {c.name}
                        {count > 1 ? ` ×${count}` : ""}
                      </span>
                    </span>
                    <span className="text-xs opacity-70">
                      Potion · {c.healDice}
                    </span>
                  </Button>
                </DisabledTip>
              );
            })}
            {canSelfHealInCombat ? (
              <DisabledTip reason={healReason}>
                <Button
                  className="w-full bg-emerald-500 text-white hover:bg-emerald-500/90"
                  onClick={handleHeal}
                  disabled={
                    actionsDisabled ||
                    healUnderMinLevel ||
                    healOutOfSlots ||
                    player.health >= player.maxHealth
                  }
                >
                  <HeartIcon className="size-3.5 shrink-0" />
                  HEAL
                </Button>
              </DisabledTip>
            ) : null}
            <DisabledTip reason={fightActionReason}>
              <Button
                variant="outline"
                onClick={handleRunAway}
                disabled={actionsDisabled}
                className="w-full"
              >
                <FootprintsIcon className="size-3.5 shrink-0" />
                RUN AWAY
              </Button>
            </DisabledTip>
            <Button variant="outline" onClick={() => dispatch({ type: "SET_INVENTORY_OPEN", open: true })}>
              <BackpackIcon className="size-3.5 shrink-0" />
              INVENTORY
            </Button>
          </CommandPanel>
        </div>
      ) : playerAlive ? (
        <div className="grid gap-4 md:grid-cols-3">
          <PlayerPanel player={player} />
          <MobileCombatLog
            turns={turns}
            expanded={state.logExpanded}
            onToggle={(expanded) =>
              dispatch({ type: "SET_LOG_EXPANDED", expanded })
            }
          />
          <CommandPanel className="md:col-start-3">
            <DisabledTip reason={lobbyActionReason}>
              <Button
                className="w-full bg-emerald-500 text-white hover:bg-emerald-500/90"
                onClick={startFight}
                disabled={asiPending.length > 0}
              >
                <SwordsIcon className="size-3.5 shrink-0" />
                FIGHT
              </Button>
            </DisabledTip>
            <DisabledTip reason={restReason}>
              <Button
                variant="outline"
                onClick={handleRest}
                disabled={asiPending.length > 0 || restPointless}
                className="w-full"
              >
                <MoonIcon className="size-3.5 shrink-0" />
                REST
              </Button>
            </DisabledTip>
            <Button variant="outline" onClick={() => dispatch({ type: "SET_INVENTORY_OPEN", open: true })}>
              <BackpackIcon className="size-3.5 shrink-0" />
              INVENTORY
            </Button>
            {state.characterCount > 1 ? (
              <Button
                variant="outline"
                onClick={() =>
                  dispatch({ type: "SET_CHARACTER_PICKER_OPEN", open: true })
                }
              >
                <UsersIcon className="size-3.5 shrink-0" />
                Switch Character
              </Button>
            ) : null}
            {process.env.NODE_ENV === "development" ? (
              <DisabledTip
                reason={
                  player.level >= MAX_LEVEL
                    ? "Already at max level"
                    : lobbyActionReason
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs opacity-60"
                  onClick={() => {
                    dispatch({ type: "DEV_NEXT_LEVEL" });
                    needsPersistRef.current = true;
                  }}
                  disabled={player.level >= MAX_LEVEL || asiPending.length > 0}
                >
                  <ChevronsUpIcon className="size-3.5 shrink-0" />
                  [DEV] +1 Level
                </Button>
              </DisabledTip>
            ) : null}
          </CommandPanel>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <CommandPanel className="md:col-start-2">
            <Button
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={handlePlayAgain}
            >
              <RotateCcwIcon className="size-3.5 shrink-0" />
              Play Again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/create")}
            >
              <UserPlusIcon className="size-3.5 shrink-0" />
              Create New Character
            </Button>
            {state.characterCount > 1 ? (
              <Button
                variant="outline"
                onClick={() =>
                  dispatch({ type: "SET_CHARACTER_PICKER_OPEN", open: true })
                }
              >
                <UsersIcon className="size-3.5 shrink-0" />
                Switch Character
              </Button>
            ) : null}
            {process.env.NODE_ENV === "development" ? (
              <DisabledTip
                reason={
                  player.level >= MAX_LEVEL
                    ? "Already at max level"
                    : lobbyActionReason
                }
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs opacity-60"
                  onClick={() => {
                    dispatch({ type: "DEV_NEXT_LEVEL" });
                    needsPersistRef.current = true;
                  }}
                  disabled={player.level >= MAX_LEVEL || asiPending.length > 0}
                >
                  <ChevronsUpIcon className="size-3.5 shrink-0" />
                  [DEV] +1 Level
                </Button>
              </DisabledTip>
            ) : null}
          </CommandPanel>
        </div>
      )}

      <Separator className="hidden md:block" />

      <div className="hidden md:block">
        <CombatLog turns={turns} />
      </div>

      {state.victory ? (
        <VictoryDialog
          victory={state.victory}
          playerName={player.name}
          onKeep={() => {
            if (state.victory?.loot) forceSyncRef.current = true;
            dispatch({ type: "DISMISS_VICTORY", keepLoot: true });
          }}
          onDiscard={() => {
            if (state.victory?.loot) forceSyncRef.current = true;
            dispatch({ type: "DISMISS_VICTORY", keepLoot: false });
          }}
        />
      ) : null}

      {!state.victory && pendingAsiLevel !== undefined ? (
        <LevelUpDialog
          key={pendingAsiLevel}
          level={pendingAsiLevel}
          currentScores={player.abilityScores}
          onConfirm={handleAsiConfirm}
        />
      ) : null}

      <InventoryDialog
        open={state.inventoryOpen}
        onOpenChange={(open) => dispatch({ type: "SET_INVENTORY_OPEN", open })}
        inventory={player.inventory}
        equippedIds={player.weapons.map((w) => w.id)}
        equipCap={EQUIP_CAP}
        knownSpells={player.knownSpells}
        equippedSpellIds={player.equippedSpells.map((s) => s.id)}
        spellCap={EQUIPPED_SPELL_CAP}
        consumables={player.consumables}
        onEquip={handleEquip}
        onUnequip={handleUnequip}
        onDiscard={handleDiscard}
        onEquipSpell={handleEquipSpell}
        onUnequipSpell={handleUnequipSpell}
        onDiscardConsumable={handleDiscardConsumable}
      />

      <CharacterPickerDialog
        open={state.characterPickerOpen}
        onOpenChange={(open) =>
          dispatch({ type: "SET_CHARACTER_PICKER_OPEN", open })
        }
        currentCharacterId={player.id ?? ""}
        onSelect={handleSelectCharacter}
      />
    </div>
  );
}
