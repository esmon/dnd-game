"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CombatLog } from "@/components/game/combat-log";
import { CommandPanel } from "@/components/game/command-panel";
import { PlayerPanel } from "@/components/game/player-panel";
import { InventoryDialog } from "@/components/game/inventory-dialog";
import { LevelUpDialog } from "@/components/game/level-up-dialog";
import { MonsterCard } from "@/components/game/monster-card";
import { StatsBar } from "@/components/game/stats-bar";
import { VictoryDialog } from "@/components/game/victory-dialog";
import { rollDice, randomInt } from "@/lib/game/dice";
import { MAX_LEVEL, xpThresholdForLevel } from "@/lib/dnd/leveling";
import { WEAPONS } from "@/lib/dnd/weapons";
import {
  EQUIP_CAP,
  gameReducer,
  initialState,
  type GameState,
} from "@/lib/game/reducer";
import type { AbilityScores } from "@/lib/db/schema";
import type { Monster, MonsterIndex, Player, Weapon } from "@/lib/game/types";
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

function pickRandomMonsterIndex(indices: MonsterIndex[]): MonsterIndex | null {
  if (indices.length === 0) return null;
  return indices[Math.floor(Math.random() * indices.length)];
}

export function Arena() {
  const router = useRouter();
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const [inventoryOpen, setInventoryOpen] = useState(false);
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

        if (cancelled) return;
        indexLevelRef.current = player.level;
        lastSyncedRef.current = { id: character.id, level: player.level };
        dispatch({ type: "BOOTSTRAP_DONE", player, indices });
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
      const damage = rollDice(snap.monster.damageDice);
      const newPlayerHealth = Math.max(0, snap.player.health - damage);
      dispatch({ type: "MONSTER_ATTACK", damage });
      if (newPlayerHealth <= 0) {
        dispatch({ type: "LOSE" });
        needsPersistRef.current = true;
      }
    }, 1000);
  }, []);

  const handleAttack = useCallback(
    (weaponName: string, damageDice: string) => {
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
      const damage = rollDice(damageDice);
      const newMonsterHealth = Math.max(0, snap.monster.health - damage);
      dispatch({ type: "PLAYER_ATTACK", damage, weaponName });
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

    const amount = randomInt(1, 10);
    dispatch({ type: "PLAYER_HEAL", amount });

    // In a fight, healing still costs you a turn — monster swings back.
    if (snap.status === "fighting" && snap.monster && snap.monster.health > 0) {
      triggerMonsterAttack();
    }
  }, [triggerMonsterAttack]);

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

  const pendingAsiLevel = asiPending[0];

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 p-6">
      <h1 className="text-center text-3xl font-bold tracking-tight">
        Monster Slayer
      </h1>

      <StatsBar stats={stats} />

      {status === "fighting" ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
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
          <CommandPanel>
            {player.weapons.map((weapon) => (
              <Button
                key={weapon.id}
                variant="destructive"
                onClick={() => handleAttack(weapon.name, weapon.damage)}
                disabled={actionsDisabled}
              >
                {weapon.name}
                <span className="ml-1 text-xs opacity-70">
                  ({weapon.damage})
                </span>
              </Button>
            ))}
            <Button
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={handleHeal}
              disabled={actionsDisabled || player.health >= player.maxHealth}
            >
              HEAL
            </Button>
            <Button
              variant="outline"
              onClick={handleRunAway}
              disabled={actionsDisabled}
            >
              RUN AWAY
            </Button>
            <Button variant="outline" onClick={() => setInventoryOpen(true)}>
              INVENTORY
            </Button>
          </CommandPanel>
        </div>
      ) : playerAlive ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          <PlayerPanel player={player} />
          <CommandPanel className="md:col-start-3">
            <Button
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={startFight}
              disabled={asiPending.length > 0}
            >
              FIGHT
            </Button>
            {player.health < player.maxHealth ? (
              <Button
                variant="outline"
                onClick={handleHeal}
                disabled={asiPending.length > 0}
              >
                REST
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setInventoryOpen(true)}>
              INVENTORY
            </Button>
            {process.env.NODE_ENV === "development" ? (
              <Button
                size="sm"
                variant="outline"
                className="text-xs opacity-60"
                onClick={() => {
                  dispatch({ type: "DEV_NEXT_LEVEL" });
                  needsPersistRef.current = true;
                }}
                disabled={player.level >= MAX_LEVEL || asiPending.length > 0}
              >
                [DEV] +1 Level
              </Button>
            ) : null}
          </CommandPanel>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-xs">
          <CommandPanel>
            <Button
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={handlePlayAgain}
            >
              Play Again
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/create")}
            >
              Create New Character
            </Button>
            {process.env.NODE_ENV === "development" ? (
              <Button
                size="sm"
                variant="outline"
                className="text-xs opacity-60"
                onClick={() => {
                  dispatch({ type: "DEV_NEXT_LEVEL" });
                  needsPersistRef.current = true;
                }}
                disabled={player.level >= MAX_LEVEL || asiPending.length > 0}
              >
                [DEV] +1 Level
              </Button>
            ) : null}
          </CommandPanel>
        </div>
      )}

      <Separator />

      <CombatLog turns={turns} />

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
        open={inventoryOpen}
        onOpenChange={setInventoryOpen}
        inventory={player.inventory}
        equippedIds={player.weapons.map((w) => w.id)}
        equipCap={EQUIP_CAP}
        onEquip={handleEquip}
        onUnequip={handleUnequip}
        onDiscard={handleDiscard}
      />
    </div>
  );
}
