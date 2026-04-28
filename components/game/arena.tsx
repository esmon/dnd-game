"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CombatLog } from "@/components/game/combat-log";
import { MonsterCard } from "@/components/game/monster-card";
import { PlayerCard } from "@/components/game/player-card";
import { StatsBar } from "@/components/game/stats-bar";
import { rollDice, randomInt } from "@/lib/game/dice";
import {
  gameReducer,
  initialState,
  type GameState,
} from "@/lib/game/reducer";
import type {
  Monster,
  MonsterIndex,
  Player,
  StarterPlayerResponse,
} from "@/lib/game/types";

const PLAYER_STORAGE_KEY = "monster-slayer:player";

// Persist just the slice we need to rehydrate; the rest is fetched fresh.
type StoredPlayer = Pick<
  Player,
  "name" | "avatar" | "maxHealth" | "health" | "xp" | "weapons"
>;

function storePlayer(player: Player) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredPlayer = {
      name: player.name,
      avatar: player.avatar,
      maxHealth: player.maxHealth,
      health: player.health,
      xp: player.xp,
      weapons: player.weapons,
    };
    window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota / private mode — non-fatal.
  }
}

function loadStoredPlayer(): Player | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlayer;
    if (
      typeof parsed.name === "string" &&
      typeof parsed.maxHealth === "number" &&
      Array.isArray(parsed.weapons)
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function pickRandomMonsterIndex(indices: MonsterIndex[]): MonsterIndex | null {
  if (indices.length === 0) return null;
  return indices[Math.floor(Math.random() * indices.length)];
}

export function Arena() {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  // We need fresh state inside async timeouts (player health after the
  // attack may have changed). Keep a ref in sync to avoid stale closures.
  const stateRef = useRef<GameState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Bootstrap: load player (from localStorage if present, else from API) and
  // fetch the monster index list. Done once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = loadStoredPlayer();
        let player: Player;
        if (stored) {
          player = stored;
        } else {
          const res = await fetch("/api/player");
          if (!res.ok) throw new Error(`player fetch ${res.status}`);
          const data = (await res.json()) as StarterPlayerResponse;
          player = {
            name: data.name,
            avatar: data.avatar,
            maxHealth: data.maxHealth,
            health: data.maxHealth,
            xp: 0,
            weapons: data.weapons,
          };
        }

        const monstersRes = await fetch("/api/monsters");
        if (!monstersRes.ok) {
          throw new Error(`monsters fetch ${monstersRes.status}`);
        }
        const indices = (await monstersRes.json()) as MonsterIndex[];

        if (cancelled) return;
        dispatch({ type: "BOOTSTRAP_DONE", player, indices });
        storePlayer(player);
      } catch (err) {
        // Surface in the console; the UI will sit in "loading" forever which
        // is the same failure mode the legacy app had.
        console.error("bootstrap failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist player to localStorage on every change.
  useEffect(() => {
    if (state.player) storePlayer(state.player);
  }, [state.player]);

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

  // Mirrors legacy `monsterAttack`: 1s suspense, then the monster swings back.
  // We resolve win/lose from the *post-attack* state in the ref, so the same
  // function handles "monster kills player" cleanly.
  const triggerMonsterAttack = useCallback(() => {
    dispatch({ type: "MONSTER_PENDING" });
    setTimeout(() => {
      const snapshot = stateRef.current;
      if (!snapshot.monster || !snapshot.player) return;
      const damage = rollDice(snapshot.monster.damageDice);
      dispatch({ type: "MONSTER_ATTACK", damage });

      // After the dispatch completes, resolve outcome from the next snapshot.
      // setTimeout(...,0) ensures the ref has caught up to the new state.
      setTimeout(() => {
        const after = stateRef.current;
        if (!after.player || !after.monster) return;
        if (after.player.health <= 0) {
          dispatch({ type: "LOSE" });
        }
      }, 0);
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
      dispatch({ type: "PLAYER_ATTACK", damage, weaponName });

      // Resolve on the next tick so we read post-attack health.
      setTimeout(() => {
        const after = stateRef.current;
        if (!after.monster || !after.player) return;
        if (after.monster.health <= 0) {
          dispatch({ type: "WIN" });
          // Every 3 wins → full heal, matching legacy behavior.
          setTimeout(() => {
            const post = stateRef.current;
            if (post.stats.wins > 0 && post.stats.wins % 3 === 0) {
              dispatch({ type: "FULL_HEAL" });
            }
          }, 0);
        } else {
          triggerMonsterAttack();
        }
      }, 0);
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

  const handleRunAway = useCallback(() => {
    const snap = stateRef.current;
    if (snap.status !== "fighting" || snap.monsterPending) return;
    const success = Math.random() < 0.4;
    if (success) {
      dispatch({ type: "RUN_AWAY_SUCCESS" });
    } else {
      dispatch({ type: "RUN_AWAY_FAIL" });
      triggerMonsterAttack();
    }
  }, [triggerMonsterAttack]);

  const handleResetPlayer = useCallback(async () => {
    // Used after a loss — pull a fresh starter player.
    try {
      const res = await fetch("/api/player");
      if (!res.ok) throw new Error(`player fetch ${res.status}`);
      const data = (await res.json()) as StarterPlayerResponse;
      const player: Player = {
        name: data.name,
        avatar: data.avatar,
        maxHealth: data.maxHealth,
        health: data.maxHealth,
        xp: 0,
        weapons: data.weapons,
      };
      dispatch({ type: "SET_PLAYER", player });
      storePlayer(player);
    } catch (err) {
      console.error("player reset failed", err);
    }
  }, []);

  if (state.loading || !state.player) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground">Loading the arena...</p>
      </div>
    );
  }

  const { player, monster, status, monsterPending, stats, turns } = state;
  const playerAlive = player.health > 0;
  const actionsDisabled =
    monsterPending || !monster || monster.health <= 0 || !playerAlive;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 p-6">
      <h1 className="text-center text-3xl font-bold tracking-tight">
        Monster Slayer
      </h1>

      <StatsBar stats={stats} />

      {status === "fighting" && monster ? (
        <div className="grid gap-4 md:grid-cols-2">
          <PlayerCard player={player} />
          <MonsterCard monster={monster} />
        </div>
      ) : (
        <div className="mx-auto w-full max-w-md">
          <PlayerCard player={player} />
        </div>
      )}

      {status === "fighting" && !monster ? (
        <p className="text-center text-sm text-muted-foreground">
          A new challenger approaches...
        </p>
      ) : null}

      <Separator />

      <CombatLog turns={turns} />

      <div className="flex flex-wrap items-center justify-center gap-3">
        {status === "lobby" && playerAlive ? (
          <>
            <Button
              size="lg"
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={startFight}
            >
              FIGHT
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleHeal}
              disabled={player.health >= player.maxHealth}
            >
              REST
            </Button>
          </>
        ) : null}

        {status === "lobby" && !playerAlive ? (
          <Button
            size="lg"
            className="bg-emerald-500 text-white hover:bg-emerald-500/90"
            onClick={handleResetPlayer}
          >
            Restart
          </Button>
        ) : null}

        {status === "fighting" ? (
          <>
            {player.weapons.map((weapon) => (
              <Button
                key={weapon.name}
                size="lg"
                variant="destructive"
                onClick={() => handleAttack(weapon.name, weapon.damage)}
                disabled={actionsDisabled}
              >
                {weapon.name} attack ({weapon.damage})
              </Button>
            ))}
            <Button
              size="lg"
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={handleHeal}
              disabled={actionsDisabled || player.health >= player.maxHealth}
            >
              HEAL
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleRunAway}
              disabled={actionsDisabled}
            >
              RUN AWAY
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
