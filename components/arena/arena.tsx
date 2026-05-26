"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import {
  BackpackIcon,
  BookOpenIcon,
  ChevronsUpIcon,
  FlaskConicalIcon,
  FootprintsIcon,
  HeartIcon,
  ScrollTextIcon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
  SwordsIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CommandButton } from "@/components/shared/command-button";
import { CharacterPickerDialog } from "@/components/shared/character-picker-dialog";
import { CombatLog } from "@/components/arena/combat-log";
import { MobileCombatLog } from "@/components/shared/mobile-combat-log";
import { CommandPanel, type CommandItem } from "@/components/shared/command-panel";
import {
  BattleCommands,
  type BattleTile,
} from "@/components/shared/battle-commands";
import { LobbyOutcomePanel } from "@/components/arena/lobby-outcome-panel";
import { PlayerPanel } from "@/components/arena/player-panel";
import {
  CampaignPickerDialog,
  type StoryStartConfig,
} from "@/components/story/campaign-picker-dialog";
import { FightModeDialog } from "@/components/arena/fight-mode-dialog";
import { InventoryDialog } from "@/components/arena/inventory-dialog";
import { LevelUpDialog } from "@/components/arena/level-up-dialog";
import { MonsterCard } from "@/components/arena/monster-card";
import { StatsBar } from "@/components/arena/stats-bar";
import { rollDice, randomInt } from "@/lib/game/dice";
import {
  classFeatureLabel,
  computeWeaponAttackDamage,
} from "@/lib/dnd/class-features";
import {
  findClass,
  isArmorProficient,
  isWeaponProficient,
  prefersSpellsForClass,
} from "@/lib/dnd/classes";
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
import { useHideAuthButton } from "@/lib/ui/auth-button-visibility";
import { useUser } from "@/lib/auth/use-user";
import { groupConsumables } from "@/lib/game/consumables";
import { pickRandomMonsterIndex } from "@/lib/game/dnd5e";
import { characterToPlayer } from "@/lib/db/schema";
import type { AbilityScores, Character } from "@/lib/db/schema";
import type { GameStats, Monster, MonsterIndex, Weapon } from "@/lib/game/types";
import { fetchWithSession, setActiveCharacterId } from "@/lib/session";

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
  // Last (id, level, stats) we wrote to Supabase. Used to decide when to
  // sync — we push on level changes and on any stats change so wins /
  // losses / runaways can't sit only in the local cache and get lost when
  // an external write invalidates it.
  const lastSyncedRef = useRef<{
    id: string;
    level: number;
    stats: GameStats;
  } | null>(null);
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
  // Story Mode lobby state. `picker` toggles the campaign-picker
  // dialog; `starting` blocks repeat submits while POST /api/story
  // is in flight. Same shape as the coop "Starting…" pattern.
  const [storyPickerOpen, setStoryPickerOpen] = useState(false);
  const [startingStory, setStartingStory] = useState(false);
  // Fight-mode picker (Solo vs Co-op). Only opens for signed-in
  // players; anonymous players start solo directly since co-op
  // needs an account.
  const [fightMenuOpen, setFightMenuOpen] = useState(false);

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
      const targetAC = playerAC(
        klass,
        snap.player.abilityScores,
        snap.player.equippedArmor ?? null,
        snap.player.equippedShield ?? null,
      );
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
      const klass = findClass(snap.player.classId);
      // 5e: PB on the to-hit roll only applies if the class is
      // proficient with this weapon's category. A wizard swinging a
      // greataxe still hits AC, just without the +PB bonus.
      const proficient = isWeaponProficient(
        klass,
        weapon.baseId,
        weapon.category,
      );
      const mod =
        (proficient ? snap.player.proficiencyBonus : 0) +
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
        const newStreak = snap.winStreak + 1;
        if (newStreak > 0 && newStreak % 3 === 0) {
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

  const handleStartStory = useCallback(
    async (config: StoryStartConfig) => {
      const snap = stateRef.current;
      if (!snap.player?.id) return;
      if (startingStory) return;
      setStartingStory(true);
      try {
        const res = await fetch("/api/story", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            characterId: snap.player.id,
            campaignTemplateId: config.campaignTemplateId,
            mode: config.mode,
            dmRole: config.dmRole,
          }),
        });
        if (!res.ok) {
          console.error("create story failed", res.status);
          return;
        }
        const { id } = (await res.json()) as { id: string };
        setStoryPickerOpen(false);
        // Solo lands in play; coop lands in the lobby. The story
        // page routes on status, so the destination is the same URL
        // either way.
        router.push(`/story/${id}`);
      } catch (err) {
        console.error("create story threw", err);
      } finally {
        setStartingStory(false);
      }
    },
    [router, startingStory],
  );

  const handleRest = useCallback(() => {
    const snap = stateRef.current;
    if (!snap.player) return;
    // 5e long rest: full HP + all spell slots back. The reducer
    // handles both restorations + the log line in one transition.
    dispatch({ type: "LONG_REST" });
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
      // 5e RAW: armor you aren't proficient with blocks somatic /
      // verbal components. The Spells tile in BattleCommands gates
      // off this same condition so the user shouldn't get here, but
      // bail defensively.
      const klass = findClass(snap.player.classId);
      if (
        snap.player.equippedArmor &&
        !isArmorProficient(klass, snap.player.equippedArmor)
      ) {
        return;
      }
      // Treat all damage spells as spell-attack-roll spells (deviation from
      // RAW: Fireball etc. should be DEX saves, but we collapse the two for
      // a single combat path).
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
        const newStreak = snap.winStreak + 1;
        if (newStreak > 0 && newStreak % 3 === 0) {
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
      const klass = findClass(snap.player.classId);
      const proficient = isWeaponProficient(
        klass,
        weapon.baseId,
        weapon.category,
      );
      const mod =
        (proficient ? snap.player.proficiencyBonus : 0) +
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
        const newStreak = snap.winStreak + 1;
        if (newStreak > 0 && newStreak % 3 === 0) {
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
      if (
        snap.player.equippedArmor &&
        !isArmorProficient(klass, snap.player.equippedArmor)
      ) {
        return;
      }
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
        const newStreak = snap.winStreak + 1;
        if (newStreak > 0 && newStreak % 3 === 0) {
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

  const handleEquipArmor = useCallback((id: string) => {
    dispatch({ type: "EQUIP_ARMOR", id });
    needsPersistRef.current = true;
  }, []);

  const handleUnequipArmor = useCallback(() => {
    dispatch({ type: "UNEQUIP_ARMOR" });
    needsPersistRef.current = true;
  }, []);

  const handleDiscardArmor = useCallback((id: string) => {
    dispatch({ type: "DISCARD_ARMOR", id });
    needsPersistRef.current = true;
  }, []);

  const handleEquipShield = useCallback((id: string) => {
    dispatch({ type: "EQUIP_SHIELD", id });
    needsPersistRef.current = true;
  }, []);

  const handleUnequipShield = useCallback(() => {
    dispatch({ type: "UNEQUIP_SHIELD" });
    needsPersistRef.current = true;
  }, []);

  const handleDiscardShield = useCallback((id: string) => {
    dispatch({ type: "DISCARD_SHIELD", id });
    needsPersistRef.current = true;
  }, []);

  const handleSelectCharacter = useCallback((id: string) => {
    setActiveCharacterId(id);
    // Cleanest reset for everything (game state, refs, fetched indices) is a
    // full page reload — bootstrap will pick up the new active character.
    window.location.reload();
  }, []);

  // Avatar swap. The /api/character/[id]/avatar route handles
  // bucket upload + the row patch in one shot, returning the
  // updated Character — we just rebuild Player from it and dispatch.
  // Signed-in only, so we guard on player.id (anonymous local
  // characters have an id too, but no Supabase row, so the API
  // would 403 with no userId on the request).
  const handleUploadAvatar = useCallback(async (file: File) => {
    const snap = stateRef.current;
    const playerId = snap.player?.id;
    if (!playerId) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetchWithSession(
      `/api/character/${playerId}/avatar`,
      { method: "POST", body: form },
    );
    if (!res.ok) {
      console.error("avatar upload failed", res.status);
      return;
    }
    const row = (await res.json()) as Character;
    dispatch({ type: "SET_PLAYER", player: characterToPlayer(row) });
  }, []);

  // Hide the global AuthButton while in a fight so it doesn't crowd
  // the small-viewport battle UI. The hook is called unconditionally;
  // the boolean controls whether the effect actually hides.
  useHideAuthButton(state.status === "fighting");

  if (state.loading || !state.player) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p>Loading the arena...</p>
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

  // 5e RAW: armor you aren't proficient with blocks somatic / verbal
  // components — both spell and scroll actions surface this as a
  // single user-facing reason. Returns the blocking armor name when
  // gated, null when the player is fine to cast.
  const playerKlass = findClass(player.classId);
  const armorSpellBlock: string | null =
    player.equippedArmor &&
    !isArmorProficient(playerKlass, player.equippedArmor)
      ? `Can't cast — not proficient with ${player.equippedArmor.name}`
      : null;

  // REST is heal + refill spell slots. Pointless only when HP is already
  // full AND every slot is already at the level's max (or no slots, for
  // non-casters whose spellSlots is just {}). Split the two checks
  // so the outcome panel can pick the right "why rest" copy — after
  // FULL_HEAL on a 3rd-win streak HP is full but slots can still be
  // down, and saying "you took damage" is wrong.
  const hpDamaged = player.health < player.maxHealth;
  const slotsSpent = (() => {
    const max = slotsForLevel(player.level);
    for (const lvl of Object.keys(player.spellSlots)) {
      if ((player.spellSlots[lvl] ?? 0) < (max[lvl] ?? 0)) return true;
    }
    return false;
  })();
  const restPointless = !hpDamaged && !slotsSpent;
  const restReason: string | null =
    lobbyActionReason ??
    (restPointless ? "Already at full HP and full slots" : null);

  const pendingAsiLevel = asiPending[0];

  const playerClass = findClass(player.classId);
  const prefersSpells = prefersSpellsForClass(playerClass);
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
  // `category` splits the list for the mobile 4-button panel: "weapon"
  // feeds the Attack popover, "spell" feeds the Spell popover.
  type AttackOption = {
    key: string;
    category: "weapon" | "spell";
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
    // Weapon stays usable; the to-hit roll just drops PB at attack
    // resolution time. Surface the tag in the subtitle so the
    // player sees why their swings are missing more often.
    const weaponProficient = isWeaponProficient(
      playerKlass,
      weapon.baseId,
      weapon.category,
    );
    const subtitle = weaponProficient
      ? weapon.damage
      : `${weapon.damage} · non-proficient`;
    attackOptions.push({
      key,
      category: "weapon",
      effective,
      node: (
        <CommandButton
          kind="weapon"
          icon={SwordIcon}
          label={weapon.name}
          subtitle={subtitle}
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
      category: "weapon",
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
      category: "spell",
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
      category: "spell",
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

  // Category splits feed the BattleCommands tiles. Already sorted by
  // effective damage since the parent list was sorted above.
  const weaponCategoryNodes = attackOptions
    .filter((o) => o.category === "weapon")
    .map((o) => <Fragment key={o.key}>{o.node}</Fragment>);
  const spellCategoryNodes = attackOptions
    .filter((o) => o.category === "spell")
    .map((o) => <Fragment key={o.key}>{o.node}</Fragment>);

  const potionGroups = consumableGroups.filter(
    (g) => g.representative.kind === "potion",
  );

  const healNode = canSelfHealInCombat ? (
    <CommandButton
      kind="heal"
      icon={HeartIcon}
      label="Heal"
      onClick={handleHeal}
      disabled={
        actionsDisabled ||
        healUnderMinLevel ||
        healOutOfSlots ||
        player.health >= player.maxHealth
      }
      disabledReason={healReason}
    />
  ) : null;

  // Spell tile: castable spells + scrolls (already in spellCategoryNodes)
  // plus the class heal action when available.
  const spellTileNodes = healNode
    ? [...spellCategoryNodes, <Fragment key="heal">{healNode}</Fragment>]
    : spellCategoryNodes;

  // Inventory tile: quick-use potions + a footer button that opens the
  // full gear/spell management dialog. Always non-empty so the tile
  // stays enabled even with no consumables.
  const potionTileNodes = potionGroups.flatMap((group): React.ReactNode[] => {
    if (group.representative.kind !== "potion") return [];
    const c = group.representative;
    const count = group.ids.length;
    const useId = group.ids[0];
    const potionFull = player.health >= player.maxHealth;
    const potionReason =
      fightActionReason ?? (potionFull ? "Already at full HP" : null);
    return [
      <CommandButton
        key={group.key}
        kind="potion"
        icon={FlaskConicalIcon}
        label={`${c.name}${count > 1 ? ` ×${count}` : ""}`}
        subtitle={`Potion · ${c.healDice}`}
        onClick={() => handleUsePotion(useId, c.healDice)}
        disabled={actionsDisabled || potionFull}
        disabledReason={potionReason}
      />,
    ];
  });
  const inventoryTileNodes: React.ReactNode[] = [
    ...potionTileNodes,
    <Button
      key="manage"
      className="w-full"
      onClick={() => dispatch({ type: "SET_INVENTORY_OPEN", open: true })}
    >
      <BackpackIcon className="size-4" />
      Manage Gear & Spells
    </Button>,
  ];

  // Build the in-fight battle tiles up here — the React compiler
  // refuses an IIFE inside JSX because it can't statically prove the
  // closure-captured handlers don't read refs during render. A flat
  // const it trusts.
  const attackTile: BattleTile = {
    key: "attack",
    kind: "attack",
    icon: SwordIcon,
    label: "Attack",
    disabled: actionsDisabled || weaponCategoryNodes.length === 0,
    disabledReason: actionsDisabled
      ? fightActionReason
      : weaponCategoryNodes.length === 0
        ? "No weapons equipped"
        : null,
    popover: weaponCategoryNodes,
  };
  const spellTile: BattleTile = {
    key: "spell",
    kind: "spell",
    icon: SparklesIcon,
    label: "Spells",
    disabled:
      actionsDisabled ||
      armorSpellBlock !== null ||
      spellTileNodes.length === 0,
    disabledReason: actionsDisabled
      ? fightActionReason
      : armorSpellBlock
        ? armorSpellBlock
        : spellTileNodes.length === 0
          ? "No spells available"
          : null,
    popover: spellTileNodes,
  };
  const battleTiles: BattleTile[] = [
    ...(prefersSpells
      ? [spellTile, attackTile]
      : [attackTile, spellTile]),
    {
      key: "inventory",
      kind: "neutral",
      icon: BackpackIcon,
      label: "Inventory",
      popover: inventoryTileNodes,
    },
    {
      key: "run-away",
      kind: "danger",
      icon: FootprintsIcon,
      label: "Run Away",
      disabled: actionsDisabled,
      disabledReason: fightActionReason,
      onClick: handleRunAway,
    },
  ];

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <h1 className="hidden text-center text-2xl font-bold tracking-tight md:block md:text-3xl">
        Monster Smashy Smashy
      </h1>

      <StatsBar stats={stats} />

      {status === "fighting" ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <PlayerPanel
            player={player}
            attackNonce={state.lastMonsterAttack.nonce}
          />
          {monster ? (
            <MonsterCard
              monster={monster}
              attackNonce={state.lastPlayerAttack.nonce}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center rounded-md border-2 border-zinc-900 bg-card font-mono p-3">
              <p className="text-sm">
                A new challenger approaches...
              </p>
            </div>
          )}
          <BattleCommands
            className="col-span-2 md:col-span-1"
            tiles={battleTiles}
          />
          <MobileCombatLog
            className="col-span-2"
            turns={turns}
            expanded={state.logExpanded}
            onToggle={(expanded) =>
              dispatch({ type: "SET_LOG_EXPANDED", expanded })
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          <PlayerPanel
            player={player}
            attackNonce={state.lastMonsterAttack.nonce}
            className={
              state.victory || state.lastDefeatedBy || state.lastFledFrom
                ? "hidden md:flex"
                : undefined
            }
            // Anonymous (no `user`) characters have no Supabase row,
            // so we keep the slot read-only for them — the route
            // would 403 anyway.
            onAvatarUpload={user ? handleUploadAvatar : undefined}
          />
          {state.victory ? (
            <LobbyOutcomePanel
              outcome={{
                kind: "victory",
                victory: state.victory,
                playerName: player.name,
                onKeep: () => {
                  if (state.victory?.loot) {
                    forceSyncRef.current = true;
                    needsPersistRef.current = true;
                  }
                  dispatch({ type: "RESOLVE_LOOT", keepLoot: true });
                },
                onDiscard: () => {
                  if (state.victory?.loot) {
                    forceSyncRef.current = true;
                    needsPersistRef.current = true;
                  }
                  dispatch({ type: "RESOLVE_LOOT", keepLoot: false });
                },
              }}
              onRest={handleRest}
              restDisabled={asiPending.length > 0 || restPointless}
              restDisabledReason={restReason}
              restNeeded={!restPointless}
              hpDamaged={hpDamaged}
              slotsSpent={slotsSpent}
            />
          ) : state.lastDefeatedBy ? (
            <LobbyOutcomePanel
              outcome={{ kind: "defeat", defeatedBy: state.lastDefeatedBy }}
              onRest={handleRest}
              restDisabled={asiPending.length > 0 || restPointless}
              restDisabledReason={restReason}
              restNeeded={!restPointless}
              hpDamaged={hpDamaged}
              slotsSpent={slotsSpent}
            />
          ) : state.lastFledFrom ? (
            <LobbyOutcomePanel
              outcome={{ kind: "flee", monsterName: state.lastFledFrom }}
              onRest={handleRest}
              restDisabled={asiPending.length > 0 || restPointless}
              restDisabledReason={restReason}
              restNeeded={!restPointless}
              hpDamaged={hpDamaged}
              slotsSpent={slotsSpent}
            />
          ) : null}
          <CommandPanel
            className="md:col-start-3"
            commands={[
              {
                key: "fight",
                kind: "primary",
                icon: SwordsIcon,
                label: "Fight",
                // Signed-in players get the Solo / Co-op picker;
                // anonymous players have no co-op option, so the
                // button just starts a solo fight directly.
                onClick: () =>
                  user ? setFightMenuOpen(true) : startFight(),
                disabled: asiPending.length > 0 || creatingCampaign,
                disabledReason: lobbyActionReason,
              },
              ...(user
                ? [
                  {
                    key: "start-story",
                    kind: "primary",
                    icon: BookOpenIcon,
                    label: startingStory ? "Starting Story…" : "Story Mode",
                    onClick: () => setStoryPickerOpen(true),
                    disabled: startingStory,
                  } satisfies CommandItem,
                ]
                : []),
              {
                // Visual divider between primary commands (Fight /
                // Story Mode) and navigation (Switch Character /
                // Create New / dev). Rest now lives on the
                // VictoryPanel so it's the obvious next step after a
                // fight ends.
                key: "nav-separator",
                render: <div className="my-1 h-px bg-primary" />,
              },
              {
                key: "inventory",
                kind: "neutral",
                icon: BackpackIcon,
                label: "Inventory",
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
          <MobileCombatLog
            turns={turns}
            expanded={state.logExpanded}
            onToggle={(expanded) =>
              dispatch({ type: "SET_LOG_EXPANDED", expanded })
            }
          />
        </div>
      )}

      <div className="hidden md:block">
        <CombatLog turns={turns} />
      </div>


      {/* Wait for the player to Keep/Discard loot before opening the
          ASI picker — otherwise the dialog blocks the panel they're
          trying to interact with. RESOLVE_LOOT only nulls
          `victory.loot`, so the celebration text stays put while the
          dialog runs on top. */}
      {!state.victory?.loot && pendingAsiLevel !== undefined ? (
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
        klass={playerKlass ?? null}
        armorInventory={player.armorInventory ?? []}
        equippedArmor={player.equippedArmor ?? null}
        equippedShield={player.equippedShield ?? null}
        onEquip={handleEquip}
        onUnequip={handleUnequip}
        onDiscard={handleDiscard}
        onEquipSpell={handleEquipSpell}
        onUnequipSpell={handleUnequipSpell}
        onDiscardConsumable={handleDiscardConsumable}
        onEquipArmor={handleEquipArmor}
        onUnequipArmor={handleUnequipArmor}
        onDiscardArmor={handleDiscardArmor}
        onEquipShield={handleEquipShield}
        onUnequipShield={handleUnequipShield}
        onDiscardShield={handleDiscardShield}
      />

      <CharacterPickerDialog
        open={state.characterPickerOpen}
        onOpenChange={(open) =>
          dispatch({ type: "SET_CHARACTER_PICKER_OPEN", open })
        }
        currentCharacterId={player.id ?? ""}
        onSelect={handleSelectCharacter}
      />

      <CampaignPickerDialog
        open={storyPickerOpen}
        onOpenChange={setStoryPickerOpen}
        onPick={handleStartStory}
        busy={startingStory}
      />

      <FightModeDialog
        open={fightMenuOpen}
        onOpenChange={setFightMenuOpen}
        onSolo={() => {
          setFightMenuOpen(false);
          startFight();
        }}
        onCoop={handleStartCampaign}
        creatingCampaign={creatingCampaign}
      />
    </div>
  );
}
