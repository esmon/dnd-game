"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";

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
import type { Monster, MonsterIndex, Player } from "@/lib/game/types";
import type { Character, CharacterUpdate } from "@/lib/db/schema";
import { characterToPlayer } from "@/lib/db/schema";
import {
  fetchWithSession,
  getActiveCharacterId,
  setActiveCharacterId,
  clearActiveCharacterId,
} from "@/lib/session";

function pickRandomMonsterIndex(indices: MonsterIndex[]): MonsterIndex | null {
  if (indices.length === 0) return null;
  return indices[Math.floor(Math.random() * indices.length)];
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

        const player = characterToPlayer(character);

        const monstersRes = await fetch("/api/monsters");
        if (!monstersRes.ok) {
          throw new Error(`monsters fetch ${monstersRes.status}`);
        }
        const indices = (await monstersRes.json()) as MonsterIndex[];

        if (cancelled) return;
        dispatch({ type: "BOOTSTRAP_DONE", player, indices });
      } catch (err) {
        console.error("bootstrap failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const persistPlayer = useCallback(async (player: Player) => {
    if (!player.id) return;
    const update: CharacterUpdate = {
      current_hp: player.health,
      xp: player.xp,
    };
    try {
      const res = await fetchWithSession(`/api/character/${player.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!res.ok) console.error("character patch failed", res.status);
    } catch (err) {
      console.error("character patch failed", err);
    }
  }, []);

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

  // 1s suspense, then the monster swings back. Win/lose resolves from the
  // post-attack state in the ref so this also handles "monster kills player".
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
          setTimeout(() => {
            const post = stateRef.current;
            if (post.player) void persistPlayer(post.player);
          }, 0);
        }
      }, 0);
    }, 1000);
  }, [persistPlayer]);

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
          setTimeout(() => {
            const post = stateRef.current;
            if (post.stats.wins > 0 && post.stats.wins % 3 === 0) {
              dispatch({ type: "FULL_HEAL" });
            }
            setTimeout(() => {
              const final = stateRef.current;
              if (final.player) void persistPlayer(final.player);
            }, 0);
          }, 0);
        } else {
          triggerMonsterAttack();
        }
      }, 0);
    },
    [triggerMonsterAttack, persistPlayer],
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
    setTimeout(() => {
      const post = stateRef.current;
      if (post.player) void persistPlayer(post.player);
    }, 0);
  }, [persistPlayer]);

  const handleRunAway = useCallback(() => {
    const snap = stateRef.current;
    if (snap.status !== "fighting" || snap.monsterPending) return;
    const success = Math.random() < 0.4;
    if (success) {
      dispatch({ type: "RUN_AWAY_SUCCESS" });
      setTimeout(() => {
        const post = stateRef.current;
        if (post.player) void persistPlayer(post.player);
      }, 0);
    } else {
      dispatch({ type: "RUN_AWAY_FAIL" });
      triggerMonsterAttack();
    }
  }, [triggerMonsterAttack, persistPlayer]);

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
          <>
            <Button
              size="lg"
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
              onClick={handlePlayAgain}
            >
              Play Again
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => router.push("/create")}
            >
              Create New Character
            </Button>
          </>
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
