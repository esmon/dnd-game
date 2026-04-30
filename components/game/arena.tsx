"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  BackpackIcon,
  ChevronsUpIcon,
  CompassIcon,
  FlaskConicalIcon,
  FootprintsIcon,
  HeartIcon,
  MoonIcon,
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
import { CommandButton } from "@/components/game/command-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CharacterPickerDialog } from "@/components/game/character-picker-dialog";
import { DefeatPanel } from "@/components/game/defeat-panel";
import { CombatLog } from "@/components/game/combat-log";
import { MobileCombatLog } from "@/components/game/mobile-combat-log";
import { CommandPanel, type CommandItem } from "@/components/game/command-panel";
import { PlayerPanel } from "@/components/game/player-panel";
import { InventoryDialog } from "@/components/game/inventory-dialog";
import { LevelUpDialog } from "@/components/game/level-up-dialog";
import { MonsterCard } from "@/components/game/monster-card";
import { StatsBar } from "@/components/game/stats-bar";
import { VictoryPanel } from "@/components/game/victory-panel";
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
import { MAX_LEVEL } from "@/lib/dnd/leveling";
import { RACES } from "@/lib/dnd/races";
import { findLowestSlot, slotsForLevel } from "@/lib/dnd/spells";
import {
  EQUIP_CAP,
  EQUIPPED_SPELL_CAP,
  gameReducer,
  initialState,
  type GameState,
} from "@/lib/game/reducer";
import { useArenaBootstrap } from "@/lib/arena/use-arena-bootstrap";
import { useArenaPersistence } from "@/lib/arena/use-arena-persistence";
import { useUser } from "@/lib/auth/use-user";
import { groupConsumables } from "@/lib/game/consumables";
import { pickRandomMonsterIndex } from "@/lib/game/dnd5e";
import type { AbilityScores } from "@/lib/db/schema";
import type { Monster, MonsterIndex, Weapon } from "@/lib/game/types";
import { setActiveCharacterId } from "@/lib/session";

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

  // While auth is resolving, pass `undefined` so the bootstrap waits and
  // persistence stays inert. Once resolved, it's User | null.
  const { user, loading: authLoading } = useUser();
  const authedUser = authLoading ? undefined : user;

  // Tracks the create-campaign request in flight so the lobby button
  // can show "Starting…" and disable while waiting on the API + route.
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  useArenaBootstrap({
    dispatch,
    indexLevelRef,
    lastSyncedRef,
    user: authedUser,
  });
  useArenaPersistence({
    state,
    stateRef,
    needsPersistRef,
    lastSyncedRef,
    forceSyncRef,
    user: authedUser,
  });

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
    // Default-keep any unresolved loot before kicking off the fight, so
    // pressing FIGHT mid-victory doesn't silently discard a drop.
    // START_FIGHT itself clears the rest of the victory panel.
    const snap = stateRef.current;
    if (snap.victory?.loot) {
      forceSyncRef.current = true;
      dispatch({ type: "RESOLVE_LOOT", keepLoot: true });
    }
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
  const handleStartCampaign = useCallback(async () => {
    // Creator path: spin up a waiting campaign seeded with the active
    // character, then route to the lobby. Errors surface in the
    // console for now — UX-level error surfacing lives on the lobby
    // page itself for retries.
    const snap = stateRef.current;
    if (!snap.player?.id) return;
    if (creatingCampaign) return;
    setCreatingCampaign(true);
    try {
      const res = await fetch("/api/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: snap.player.id }),
      });
      if (!res.ok) {
        console.error("create campaign failed", res.status);
        return;
      }
      const { campaignId } = (await res.json()) as { campaignId: string };
      router.push(`/campaign/${campaignId}`);
    } catch (err) {
      console.error("create campaign threw", err);
    } finally {
      setCreatingCampaign(false);
    }
  }, [creatingCampaign, router]);

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

  // Attack options carry a pre-built CommandButton JSX node rather than raw
  // props because the React compiler refuses object-literal closures that
  // capture refs (handleAttack/handleSmite/etc all read stateRef.current).
  // JSX props are fine — the compiler trusts them — so we render here and
  // route through CommandItem's `render` branch in the commands array below.
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
        <CommandButton
          kind="weapon"
          icon={SwordIcon}
          label={weapon.name}
          subtitle={weapon.damage}
          onClick={() => handleAttack(weapon)}
          disabled={actionsDisabled}
          disabledReason={fightActionReason}
        />
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
        <CommandButton
          kind="smite"
          icon={SunIcon}
          label={smiteOutOfSlots ? "Smite" : `Smite (L${smiteSlotLevel})`}
          subtitle={
            smiteOutOfSlots
              ? "+?d8 radiant"
              : `+${smiteSlotLevel + 1}d8 radiant`
          }
          onClick={() => handleSmite(smiteWeapon, smiteSlotLevel)}
          disabled={actionsDisabled || smiteOutOfSlots}
          disabledReason={smiteReason}
        />
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
    const effective = outOfSlots
      ? 0
      : averageDamage(spell.damage) * monsterDmgMult(spell.damageType);
    const key = `s-${spell.id}`;
    attackOptions.push({
      key,
      effective,
      node: (
        <CommandButton
          kind="spell"
          icon={SparklesIcon}
          label={spell.name}
          subtitle={`${spell.damage} · ${slotInfo}`}
          onClick={() =>
            handleCastSpell(
              spell.id,
              spell.level,
              spell.damage,
              spell.damageType,
            )
          }
          disabled={actionsDisabled || outOfSlots}
          disabledReason={spellReason}
        />
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
        <CommandButton
          kind="scroll"
          icon={ScrollTextIcon}
          label={`${c.spellName}${count > 1 ? ` ×${count}` : ""}`}
          subtitle={`Scroll · ${c.damage}`}
          onClick={() => handleUseScroll(useId, c.damage, c.damageType)}
          disabled={actionsDisabled}
          disabledReason={fightActionReason}
        />
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
          <PlayerPanel
            player={player}
            attackNonce={state.lastMonsterAttack.nonce}
            attackDamage={state.lastMonsterAttack.damage}
          />
          {monster ? (
            <MonsterCard
              monster={monster}
              attackNonce={state.lastPlayerAttack.nonce}
              attackDamage={state.lastPlayerAttack.damage}
            />
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
          <CommandPanel
            className="col-span-2 md:col-span-1"
            commands={[
              ...visibleAttackOptions.map(
                (o): CommandItem => ({ key: o.key, render: o.node }),
              ),
              ...(hiddenAttackOptions.length > 0
                ? [
                    {
                      key: "attacks-popover",
                      render: (
                        <Popover
                          open={state.attacksExpanded}
                          onOpenChange={(open) =>
                            dispatch({
                              type: "SET_ATTACKS_EXPANDED",
                              expanded: open,
                            })
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
                      ),
                    } satisfies CommandItem,
                  ]
                : []),
              ...potionGroups.flatMap((group): CommandItem[] => {
                if (group.representative.kind !== "potion") return [];
                const c = group.representative;
                const count = group.ids.length;
                const useId = group.ids[0];
                const potionFull = player.health >= player.maxHealth;
                const potionReason =
                  fightActionReason ??
                  (potionFull ? "Already at full HP" : null);
                return [
                  {
                    key: group.key,
                    kind: "potion",
                    icon: FlaskConicalIcon,
                    label: `${c.name}${count > 1 ? ` ×${count}` : ""}`,
                    subtitle: `Potion · ${c.healDice}`,
                    onClick: () => handleUsePotion(useId, c.healDice),
                    disabled: actionsDisabled || potionFull,
                    disabledReason: potionReason,
                  },
                ];
              }),
              ...(canSelfHealInCombat
                ? [
                    {
                      key: "heal",
                      kind: "heal",
                      icon: HeartIcon,
                      label: "HEAL",
                      onClick: handleHeal,
                      disabled:
                        actionsDisabled ||
                        healUnderMinLevel ||
                        healOutOfSlots ||
                        player.health >= player.maxHealth,
                      disabledReason: healReason,
                    } satisfies CommandItem,
                  ]
                : []),
              {
                key: "run-away",
                kind: "neutral",
                icon: FootprintsIcon,
                label: "RUN AWAY",
                onClick: handleRunAway,
                disabled: actionsDisabled,
                disabledReason: fightActionReason,
              },
              {
                key: "inventory",
                kind: "neutral",
                icon: BackpackIcon,
                label: "INVENTORY",
                onClick: () =>
                  dispatch({ type: "SET_INVENTORY_OPEN", open: true }),
              },
            ]}
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <PlayerPanel
            player={player}
            attackNonce={state.lastMonsterAttack.nonce}
            attackDamage={state.lastMonsterAttack.damage}
            className={
              state.victory || state.lastDefeatedBy
                ? "hidden md:flex"
                : undefined
            }
          />
          {state.victory ? (
            <VictoryPanel
              victory={state.victory}
              playerName={player.name}
              onKeep={() => {
                if (state.victory?.loot) forceSyncRef.current = true;
                dispatch({ type: "RESOLVE_LOOT", keepLoot: true });
              }}
              onDiscard={() => {
                if (state.victory?.loot) forceSyncRef.current = true;
                dispatch({ type: "RESOLVE_LOOT", keepLoot: false });
              }}
            />
          ) : state.lastDefeatedBy ? (
            <DefeatPanel defeatedBy={state.lastDefeatedBy} />
          ) : null}
          <MobileCombatLog
            turns={turns}
            expanded={state.logExpanded}
            onToggle={(expanded) =>
              dispatch({ type: "SET_LOG_EXPANDED", expanded })
            }
          />
          <CommandPanel
            className="md:col-start-3"
            commands={[
              {
                key: "fight",
                kind: "primary",
                icon: SwordsIcon,
                label: "FIGHT",
                onClick: startFight,
                disabled: asiPending.length > 0,
                disabledReason: lobbyActionReason,
              },
              {
                key: "rest",
                kind: "neutral",
                icon: MoonIcon,
                label: "REST",
                onClick: handleRest,
                disabled: asiPending.length > 0 || restPointless,
                disabledReason: restReason,
              },
              {
                key: "inventory",
                kind: "neutral",
                icon: BackpackIcon,
                label: "INVENTORY",
                onClick: () =>
                  dispatch({ type: "SET_INVENTORY_OPEN", open: true }),
              },
              ...(state.characterCount > 1
                ? [
                    {
                      key: "switch-character",
                      kind: "neutral",
                      icon: UsersIcon,
                      label: "Switch Character",
                      onClick: () =>
                        dispatch({
                          type: "SET_CHARACTER_PICKER_OPEN",
                          open: true,
                        }),
                    } satisfies CommandItem,
                  ]
                : []),
              {
                key: "create-new",
                kind: "neutral",
                icon: UserPlusIcon,
                label: "Create New Character",
                onClick: () => router.push("/create"),
              },
              ...(user
                ? [
                    {
                      key: "start-campaign",
                      kind: "neutral" as const,
                      icon: CompassIcon,
                      label: creatingCampaign
                        ? "Starting Campaign…"
                        : "Start Campaign",
                      onClick: handleStartCampaign,
                      disabled: creatingCampaign,
                    } satisfies CommandItem,
                  ]
                : []),
              ...(process.env.NODE_ENV === "development"
                ? [
                    {
                      key: "dev-next-level",
                      kind: "dev",
                      icon: ChevronsUpIcon,
                      label: "[DEV] +1 Level",
                      onClick: () => {
                        dispatch({ type: "DEV_NEXT_LEVEL" });
                        needsPersistRef.current = true;
                      },
                      disabled:
                        player.level >= MAX_LEVEL || asiPending.length > 0,
                      disabledReason:
                        player.level >= MAX_LEVEL
                          ? "Already at max level"
                          : lobbyActionReason,
                    } satisfies CommandItem,
                  ]
                : []),
            ]}
          />
        </div>
      )}

      <Separator className="hidden md:block" />

      <div className="hidden md:block">
        <CombatLog turns={turns} />
      </div>


      {!state.victory && pendingAsiLevel !== undefined ? (
        <LevelUpDialog
          key={pendingAsiLevel}
          level={pendingAsiLevel}
          classId={player.classId}
          raceId={player.raceId}
          currentScores={player.abilityScores}
          playerLevel={player.level}
          currentMaxHp={player.maxHealth}
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
