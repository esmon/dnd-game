import { CLASSES } from "@/lib/dnd/classes";
import { abilityModifier } from "@/lib/dnd/derive";
import {
  MAX_LEVEL,
  hpGainOnLevelUp,
  isAsiLevel,
  levelForXp,
  proficiencyBonusForLevel,
  xpThresholdForLevel,
} from "@/lib/dnd/leveling";
import { rollLoot } from "@/lib/dnd/loot";
import { mintSpell, slotsForLevel, spellsByBaseId } from "@/lib/dnd/spells";
import { weaponsByBaseId } from "@/lib/dnd/weapons";
import type {
  AbilityScores,
  Armor,
  Consumable,
  GameStats,
  GameStatus,
  Monster,
  MonsterIndex,
  Player,
  Potion,
  Scroll,
  Turn,
  VictoryInfo,
  Weapon,
} from "./types";

// Discriminator: Armor is the only loot category with `acBase` —
// Weapon doesn't have it, Scroll / Potion both have `kind`. Lets
// the loot resolver branch without adding a `kind` field to the
// Armor type (which would force a backfill on the rows we already
// shipped).
function isArmorLoot(
  loot: Weapon | Armor | Scroll | Potion,
): loot is Armor {
  return "acBase" in loot;
}

export const EQUIP_CAP = 2;
export const EQUIPPED_SPELL_CAP = 5;

export type GameState = {
  status: GameStatus;
  player: Player | null;
  monster: Monster | null;
  turns: Turn[];
  stats: GameStats;
  monsterIndices: MonsterIndex[];
  loading: boolean; // initial bootstrap (player + index list)
  monsterPending: boolean; // true while monster's 1s counter-attack is queued
  nextTurnId: number;
  asiPending: number[];
  victory: VictoryInfo | null;
  inventoryOpen: boolean;
  characterCount: number;
  characterPickerOpen: boolean;
  logExpanded: boolean;
  // Win streak — kept separate from stats.wins (the lifetime
  // counter) so a loss can reset the streak without zeroing the
  // total. Drives the every-3rd-win FULL_HEAL bonus. Runtime-only;
  // not persisted to the character row.
  winStreak: number;
  // Set on LOSE, cleared on START_FIGHT. Drives the "You Lose!" lobby panel
  // so the player gets a clear post-defeat affordance instead of an empty
  // gap between PlayerPanel and CommandPanel.
  lastDefeatedBy: string | null;
  // Set on RUN_AWAY_SUCCESS, cleared on START_FIGHT / WIN. Drives the
  // flee variant of the lobby outcome panel — same pattern
  // lastDefeatedBy uses, since neither has a dedicated payload like
  // `victory` and both narrate "the last fight ended this way."
  lastFledFrom: string | null;
  // Snapshot of the most recent attack from each side. `nonce` increments
  // on every offensive action so panels know to fire a shake animation
  // (changes on hit and miss). `damage` is 0 on miss, otherwise the actual
  // hp dealt — drives shake intensity. Stored as one object so the two
  // values are always updated atomically.
  lastPlayerAttack: { nonce: number; damage: number };
  lastMonsterAttack: { nonce: number; damage: number };
};

export const initialState: GameState = {
  status: "lobby",
  player: null,
  monster: null,
  turns: [],
  stats: { wins: 0, losses: 0, runaways: 0 },
  winStreak: 0,
  monsterIndices: [],
  loading: true,
  monsterPending: false,
  nextTurnId: 1,
  asiPending: [],
  victory: null,
  inventoryOpen: false,
  characterCount: 0,
  characterPickerOpen: false,
  logExpanded: false,
  lastDefeatedBy: null,
  lastFledFrom: null,
  lastPlayerAttack: { nonce: 0, damage: 0 },
  lastMonsterAttack: { nonce: 0, damage: 0 },
};

export type Action =
  | { type: "BOOTSTRAP_DONE"; player: Player; indices: MonsterIndex[] }
  | { type: "SET_PLAYER"; player: Player }
  | { type: "SET_MONSTER_INDICES"; indices: MonsterIndex[] }
  | { type: "SET_MONSTER"; monster: Monster }
  | { type: "START_FIGHT" }
  | { type: "RETURN_TO_LOBBY" }
  | {
      type: "PLAYER_ATTACK";
      damage: number;
      weaponName: string;
      note?: string;
      missed?: boolean;
      crit?: boolean;
    }
  | { type: "MONSTER_PENDING" }
  | { type: "MONSTER_ATTACK"; damage: number; note?: string; missed?: boolean; crit?: boolean }
  | { type: "PLAYER_HEAL"; amount: number; slotLevel?: number }
  | { type: "RUN_AWAY_SUCCESS" }
  | { type: "RUN_AWAY_FAIL" }
  | { type: "WIN" }
  | { type: "LOSE" }
  | { type: "FULL_HEAL" }
  | { type: "LONG_REST" }
  | { type: "APPLY_ASI"; deltas: Partial<AbilityScores> }
  | { type: "DEV_NEXT_LEVEL" }
  | { type: "DISMISS_VICTORY"; keepLoot?: boolean }
  | { type: "RESOLVE_LOOT"; keepLoot: boolean }
  | { type: "SET_INVENTORY_OPEN"; open: boolean }
  | { type: "SET_CHARACTER_COUNT"; count: number }
  | { type: "SET_CHARACTER_PICKER_OPEN"; open: boolean }
  | { type: "SET_LOG_EXPANDED"; expanded: boolean }
  | { type: "ADD_LOOT"; weapon: Weapon }
  | { type: "EQUIP_WEAPON"; id: string }
  | { type: "UNEQUIP_WEAPON"; id: string }
  | { type: "DISCARD_WEAPON"; id: string }
  // Equipping armor swaps it with the currently-worn piece (one
  // body slot in 5e); the unworn one returns to the armor inventory
  // so the player can swap back. Shields are a separate slot.
  | { type: "EQUIP_ARMOR"; id: string }
  | { type: "UNEQUIP_ARMOR" }
  | { type: "DISCARD_ARMOR"; id: string }
  | { type: "EQUIP_SHIELD"; id: string }
  | { type: "UNEQUIP_SHIELD" }
  | { type: "DISCARD_SHIELD"; id: string }
  | {
      type: "CAST_SPELL";
      spellId: string;
      damage: number;
      note?: string;
      missed?: boolean;
      crit?: boolean;
    }
  | {
      type: "SMITE_ATTACK";
      damage: number;
      weaponName: string;
      smiteDamage: number;
      smiteSlotLevel: number;
      note?: string;
      missed?: boolean;
      crit?: boolean;
      consumeSlot?: boolean;
    }
  | { type: "USE_SCROLL"; scrollId: string; damage: number; note?: string; missed?: boolean; crit?: boolean }
  | { type: "USE_POTION"; potionId: string; healed: number }
  | { type: "REFILL_SLOTS" }
  | { type: "EQUIP_SPELL"; id: string }
  | { type: "UNEQUIP_SPELL"; id: string }
  | { type: "DISCARD_CONSUMABLE"; id: string };

function pushTurn(
  state: GameState,
  isPlayer: boolean,
  text: string,
  kind?: Turn["kind"],
  action?: Turn["action"],
): GameState {
  const turn: Turn = {
    id: state.nextTurnId,
    isPlayer,
    text,
    ...(kind && { kind }),
    ...(action && { action }),
  };
  return {
    ...state,
    turns: [turn, ...state.turns],
    nextTurnId: state.nextTurnId + 1,
  };
}

function applyLevelUps(
  player: Player,
  asiPending: number[],
): { player: Player; asiPending: number[]; texts: string[] } {
  const targetLevel = levelForXp(player.xp);
  if (targetLevel <= player.level) {
    return { player, asiPending, texts: [] };
  }
  const klass = CLASSES.find(
    (c) => c.id.toLowerCase() === player.classId.toLowerCase(),
  );
  if (!klass) {
    return { player, asiPending, texts: [] };
  }
  const conMod = abilityModifier(player.abilityScores.con);
  const newAsi = [...asiPending];
  const texts: string[] = [];
  let p = player;
  for (let lvl = p.level + 1; lvl <= targetLevel; lvl++) {
    const gain = hpGainOnLevelUp(klass.hitDie, conMod);
    p = {
      ...p,
      level: lvl,
      maxHealth: p.maxHealth + gain,
      health: p.health + gain,
      proficiencyBonus: proficiencyBonusForLevel(lvl),
    };
    if (isAsiLevel(lvl)) newAsi.push(lvl);
    texts.push(`${p.name} reaches level ${lvl}!`);

    const learned = klass.spellsByLevel?.[lvl] ?? [];
    if (learned.length > 0) {
      const newKnown = [...p.knownSpells];
      const newEquipped = [...p.equippedSpells];
      for (const baseId of learned) {
        const def = spellsByBaseId[baseId];
        if (!def) continue;
        const spell = mintSpell(def);
        newKnown.push(spell);
        if (newEquipped.length < EQUIPPED_SPELL_CAP) {
          newEquipped.push(spell);
        }
        texts.push(`${p.name} learns ${spell.name}!`);
      }
      p = { ...p, knownSpells: newKnown, equippedSpells: newEquipped };
    }
  }
  if (klass.isCaster && p.level !== player.level) {
    p = { ...p, spellSlots: slotsForLevel(p.level) };
  }
  // Leveling up implicitly long-rests the player — bump HP all the
  // way to max instead of just adding the per-level gain. Avoids the
  // post-fight UX where Rest still beckoned even after the player
  // dinged a level (the gain alone wasn't enough to reach full HP).
  p = { ...p, health: p.maxHealth };
  return { player: p, asiPending: newAsi, texts };
}

export function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "BOOTSTRAP_DONE":
      return {
        ...state,
        player: action.player,
        // Seed the StatsBar from the persisted character row. Older
        // snapshots without stats default through to 0/0/0 here so
        // the bar still renders cleanly.
        stats: action.player.stats ?? state.stats,
        monsterIndices: action.indices,
        loading: false,
      };

    case "SET_PLAYER":
      return {
        ...state,
        player: action.player,
        stats: action.player.stats ?? state.stats,
      };

    case "SET_MONSTER_INDICES":
      return { ...state, monsterIndices: action.indices };

    case "SET_MONSTER":
      return pushTurn(
        { ...state, monster: action.monster, monsterPending: false },
        true,
        `You have encountered a ${action.monster.name}!`,
        "encounter",
      );

    case "START_FIGHT":
      // Caller is responsible for following up with SET_MONSTER once fetched.
      // Combat log persists across fights — SET_MONSTER's "encountered"
      // entry marks the start of each new battle. Lobby outcome panels
      // (victory + lastDefeatedBy) clear here so the next fight starts
      // with a clean middle column.
      return {
        ...state,
        status: "fighting",
        monster: null,
        monsterPending: false,
        lastDefeatedBy: null,
        lastFledFrom: null,
        victory: null,
      };

    case "RETURN_TO_LOBBY":
      return {
        ...state,
        status: "lobby",
        monster: null,
        monsterPending: false,
      };

    case "PLAYER_ATTACK": {
      if (!state.monster || !state.player) return state;
      const newHealth = Math.max(0, state.monster.health - action.damage);
      const monster: Monster = { ...state.monster, health: newHealth };
      const note = action.note ? ` (${action.note})` : "";
      const text = action.missed
        ? `${state.player.name} attacks ${monster.name} with ${action.weaponName} — MISS${note}`
        : action.crit
          ? `CRIT — ${state.player.name} attacks ${monster.name} with ${action.weaponName} for ${action.damage}hp${note}`
          : `${state.player.name} attacks ${monster.name} with ${action.weaponName} for ${action.damage}hp${note}`;
      return pushTurn(
        {
          ...state,
          monster,
          lastPlayerAttack: {
            nonce: state.lastPlayerAttack.nonce + 1,
            damage: action.missed ? 0 : action.damage,
          },
        },
        true,
        text,
        action.crit ? "crit" : undefined,
        "attack",
      );
    }

    case "MONSTER_PENDING":
      return { ...state, monsterPending: true };

    case "MONSTER_ATTACK": {
      if (!state.monster || !state.player) return state;
      const newHealth = Math.max(0, state.player.health - action.damage);
      const player: Player = { ...state.player, health: newHealth };
      const note = action.note ? ` (${action.note})` : "";
      const text = action.missed
        ? `${state.monster.name} attacks ${player.name} — MISS${note}`
        : action.crit
          ? `CRIT — ${state.monster.name} attacks ${player.name} for ${action.damage} hp${note}`
          : `${state.monster.name} attacks ${player.name} for ${action.damage} hp${note}`;
      return pushTurn(
        {
          ...state,
          player,
          monsterPending: false,
          lastMonsterAttack: {
            nonce: state.lastMonsterAttack.nonce + 1,
            damage: action.missed ? 0 : action.damage,
          },
        },
        false,
        text,
        action.crit ? "crit" : undefined,
        "attack",
      );
    }

    case "PLAYER_HEAL": {
      if (!state.player) return state;
      let spellSlots = state.player.spellSlots;
      if (action.slotLevel) {
        const key = String(action.slotLevel);
        const remaining = spellSlots[key] ?? 0;
        if (remaining <= 0) return state;
        spellSlots = { ...spellSlots, [key]: remaining - 1 };
      }
      const newHealth = Math.min(
        state.player.maxHealth,
        state.player.health + action.amount,
      );
      const player: Player = { ...state.player, health: newHealth, spellSlots };
      const slotNote = action.slotLevel ? ` (L${action.slotLevel} slot)` : "";
      const text = `${state.player.name} heals for ${action.amount}${slotNote}`;
      return pushTurn({ ...state, player }, true, text, undefined, "heal");
    }

    case "RUN_AWAY_SUCCESS": {
      if (!state.player || !state.monster) return state;
      const text = `${state.player.name} successfully runs away!`;
      return pushTurn(
        {
          ...state,
          status: "lobby",
          monster: null,
          monsterPending: false,
          lastFledFrom: state.monster.name,
          stats: { ...state.stats, runaways: state.stats.runaways + 1 },
          winStreak: 0,
        },
        true,
        text,
        undefined,
        "skip",
      );
    }

    case "RUN_AWAY_FAIL": {
      if (!state.player) return state;
      const text = `${state.player.name} failed to run away!`;
      return pushTurn(state, true, text, undefined, "skip");
    }

    case "WIN": {
      if (!state.player || !state.monster) return state;
      const xpGained = state.monster.xp;
      const monsterName = state.monster.name;
      const startLevel = state.player.level;
      const playerWithXp: Player = {
        ...state.player,
        xp: state.player.xp + xpGained,
      };
      const { player: leveledPlayer, asiPending, texts: levelUpTexts } =
        applyLevelUps(playerWithXp, state.asiPending);
      const levelsGained: number[] = [];
      for (let l = startLevel + 1; l <= leveledPlayer.level; l++) {
        levelsGained.push(l);
      }
      const loot = rollLoot({
        challengeRating: state.monster.challengeRating,
        xp: state.monster.xp,
      });
      // Loot is held in victory.loot until the player decides to keep or
      // discard it via DISMISS_VICTORY.
      const player: Player = leveledPlayer;
      const winText = `${player.name} wins!`;
      const wins = state.stats.wins + 1;
      let next: GameState = {
        ...state,
        player,
        status: "lobby",
        monster: null,
        monsterPending: false,
        stats: { ...state.stats, wins },
        winStreak: state.winStreak + 1,
        asiPending,
        victory: { monsterName, xpGained, levelsGained, loot },
      };
      next = pushTurn(next, true, winText, "win");
      for (const t of levelUpTexts) {
        next = pushTurn(next, true, t, "levelup");
      }
      return next;
    }

    case "SET_INVENTORY_OPEN":
      return { ...state, inventoryOpen: action.open };

    case "SET_CHARACTER_COUNT":
      return { ...state, characterCount: action.count };

    case "SET_CHARACTER_PICKER_OPEN":
      return { ...state, characterPickerOpen: action.open };

    case "SET_LOG_EXPANDED":
      return { ...state, logExpanded: action.expanded };

    case "DISMISS_VICTORY": {
      const keepLoot = action.keepLoot ?? true;
      const loot = state.victory?.loot;
      if (keepLoot && loot && state.player) {
        const lootName =
          "kind" in loot && loot.kind === "scroll"
            ? `Scroll of ${loot.spellName}`
            : loot.name;
        const text = `${state.player.name} picks up ${lootName}!`;
        if ("kind" in loot) {
          const consumable: Consumable = loot;
          const next: GameState = {
            ...state,
            victory: null,
            player: {
              ...state.player,
              consumables: [...state.player.consumables, consumable],
            },
          };
          return pushTurn(next, true, text, "loot");
        }
        if (isArmorLoot(loot)) {
          const next: GameState = {
            ...state,
            victory: null,
            player: {
              ...state.player,
              armorInventory: [...(state.player.armorInventory ?? []), loot],
            },
          };
          return pushTurn(next, true, text, "loot");
        }
        const weapon: Weapon = loot;
        const next: GameState = {
          ...state,
          victory: null,
          player: {
            ...state.player,
            inventory: [...state.player.inventory, weapon],
          },
        };
        return pushTurn(next, true, text, "loot");
      }
      return { ...state, victory: null };
    }

    // Same loot keep/discard logic as DISMISS_VICTORY, but only clears
    // `victory.loot` — the rest of the panel (XP, monster name, level
    // info) stays visible until the user starts a new fight. Lets the
    // user resolve loot without dismissing the celebration.
    case "RESOLVE_LOOT": {
      if (!state.victory || !state.victory.loot || !state.player) return state;
      const loot = state.victory.loot;
      const victoryWithoutLoot = { ...state.victory, loot: null };

      if (action.keepLoot) {
        const lootName =
          "kind" in loot && loot.kind === "scroll"
            ? `Scroll of ${loot.spellName}`
            : loot.name;
        const text = `${state.player.name} picks up ${lootName}!`;
        if ("kind" in loot) {
          const consumable: Consumable = loot;
          const next: GameState = {
            ...state,
            victory: victoryWithoutLoot,
            player: {
              ...state.player,
              consumables: [...state.player.consumables, consumable],
            },
          };
          return pushTurn(next, true, text, "loot");
        }
        if (isArmorLoot(loot)) {
          const next: GameState = {
            ...state,
            victory: victoryWithoutLoot,
            player: {
              ...state.player,
              armorInventory: [...(state.player.armorInventory ?? []), loot],
            },
          };
          return pushTurn(next, true, text, "loot");
        }
        const weapon: Weapon = loot;
        const next: GameState = {
          ...state,
          victory: victoryWithoutLoot,
          player: {
            ...state.player,
            inventory: [...state.player.inventory, weapon],
          },
        };
        return pushTurn(next, true, text, "loot");
      }
      return { ...state, victory: victoryWithoutLoot };
    }

    case "DEV_NEXT_LEVEL": {
      if (!state.player) return state;
      if (state.player.level >= MAX_LEVEL) return state;
      const needed =
        xpThresholdForLevel(state.player.level + 1) - state.player.xp;
      const playerWithXp: Player = {
        ...state.player,
        xp: state.player.xp + Math.max(0, needed),
      };
      const { player, asiPending, texts } = applyLevelUps(
        playerWithXp,
        state.asiPending,
      );
      let next: GameState = { ...state, player, asiPending };
      for (const t of texts) {
        next = pushTurn(next, true, t, "levelup");
      }
      return next;
    }

    case "LOSE": {
      if (!state.player || !state.monster) return state;
      const text = `${state.monster.name} wins!`;
      // Auto-restore HP and slots on defeat so the lobby is immediately
      // playable again — the "You Lose" panel and lastDefeatedBy carry the
      // narrative; the player doesn't need a separate Play Again click.
      const player: Player = {
        ...state.player,
        health: state.player.maxHealth,
        spellSlots: slotsForLevel(state.player.level),
      };
      return pushTurn(
        {
          ...state,
          status: "lobby",
          monster: null,
          monsterPending: false,
          player,
          stats: {
            ...state.stats,
            losses: state.stats.losses + 1,
          },
          winStreak: 0,
          lastDefeatedBy: state.monster.name,
        },
        false,
        text,
        "loss",
      );
    }

    case "FULL_HEAL": {
      if (!state.player) return state;
      const klass = CLASSES.find(
        (c) => c.id.toLowerCase() === state.player!.classId.toLowerCase(),
      );
      // 3rd-win streak bonus — refill HP AND spell slots. Slot
      // restoration is new: keeping it HP-only meant a caster on a
      // streak still saw the Rest button after every "full heal,"
      // because their slots were silently down. Restoring both is
      // the simpler UX and matches what the log line implies.
      const player: Player = {
        ...state.player,
        health: state.player.maxHealth,
        spellSlots: klass?.isCaster
          ? slotsForLevel(state.player.level)
          : state.player.spellSlots,
      };
      const text = `${player.name} fully recovers on a winning streak!`;
      return pushTurn({ ...state, player }, true, text, "levelup");
    }

    case "APPLY_ASI": {
      if (!state.player) return state;
      const cur = state.player.abilityScores;
      const d = action.deltas;
      const abilityScores: AbilityScores = {
        str: cur.str + (d.str ?? 0),
        dex: cur.dex + (d.dex ?? 0),
        con: cur.con + (d.con ?? 0),
        int: cur.int + (d.int ?? 0),
        wis: cur.wis + (d.wis ?? 0),
        cha: cur.cha + (d.cha ?? 0),
      };
      // 5e RAW: a CON modifier increase retroactively bumps max HP by the
      // delta times character level. Bring current HP up by the same delta
      // so % stays consistent (clamped to maxHealth).
      const conModDelta =
        abilityModifier(abilityScores.con) - abilityModifier(cur.con);
      const hpDelta = conModDelta * state.player.level;
      const maxHealth = state.player.maxHealth + hpDelta;
      const health = Math.min(
        maxHealth,
        state.player.health + Math.max(0, hpDelta),
      );
      const player: Player = {
        ...state.player,
        abilityScores,
        maxHealth,
        health,
      };
      return {
        ...state,
        player,
        asiPending: state.asiPending.slice(1),
      };
    }

    case "ADD_LOOT": {
      if (!state.player) return state;
      const player: Player = {
        ...state.player,
        inventory: [...state.player.inventory, action.weapon],
      };
      return { ...state, player };
    }

    case "EQUIP_WEAPON": {
      if (!state.player) return state;
      if (state.player.weapons.length >= EQUIP_CAP) return state;
      if (state.player.weapons.some((w) => w.id === action.id)) return state;
      const target = state.player.inventory.find((w) => w.id === action.id);
      if (!target) return state;
      // Two-handed weapons occupy both hands — can't be wielded
      // alongside a shield. Player has to unequip the shield first.
      const targetTwoHanded =
        target.twoHanded ??
        weaponsByBaseId[target.baseId]?.twoHanded ??
        false;
      if (targetTwoHanded && state.player.equippedShield) return state;
      const player: Player = {
        ...state.player,
        weapons: [...state.player.weapons, target],
      };
      return { ...state, player };
    }

    case "UNEQUIP_WEAPON": {
      if (!state.player) return state;
      if (!state.player.weapons.some((w) => w.id === action.id)) return state;
      const player: Player = {
        ...state.player,
        weapons: state.player.weapons.filter((w) => w.id !== action.id),
      };
      return { ...state, player };
    }

    case "DISCARD_WEAPON": {
      if (!state.player) return state;
      const player: Player = {
        ...state.player,
        weapons: state.player.weapons.filter((w) => w.id !== action.id),
        inventory: state.player.inventory.filter((w) => w.id !== action.id),
      };
      return { ...state, player };
    }

    case "EQUIP_ARMOR": {
      if (!state.player) return state;
      const inventory = state.player.armorInventory ?? [];
      const target = inventory.find((a) => a.id === action.id);
      if (!target) return state;
      // 5e has one body slot. Equipping a new piece returns the
      // current one to inventory so the player can swap back.
      const previous = state.player.equippedArmor ?? null;
      const nextInventory = inventory.filter((a) => a.id !== action.id);
      if (previous) nextInventory.push(previous);
      const player: Player = {
        ...state.player,
        equippedArmor: target,
        armorInventory: nextInventory,
      };
      return { ...state, player };
    }

    case "UNEQUIP_ARMOR": {
      if (!state.player) return state;
      const current = state.player.equippedArmor;
      if (!current) return state;
      const player: Player = {
        ...state.player,
        equippedArmor: null,
        armorInventory: [...(state.player.armorInventory ?? []), current],
      };
      return { ...state, player };
    }

    case "DISCARD_ARMOR": {
      if (!state.player) return state;
      const player: Player = {
        ...state.player,
        equippedArmor:
          state.player.equippedArmor?.id === action.id
            ? null
            : (state.player.equippedArmor ?? null),
        armorInventory: (state.player.armorInventory ?? []).filter(
          (a) => a.id !== action.id,
        ),
      };
      return { ...state, player };
    }

    case "EQUIP_SHIELD": {
      if (!state.player) return state;
      const inventory = state.player.armorInventory ?? [];
      const target = inventory.find((a) => a.id === action.id);
      if (!target || target.category !== "shield") return state;
      // Shield + two-handed weapon is the same illegal combo as the
      // EQUIP_WEAPON gate, just from the other side. Player has to
      // unequip the two-handed weapon first.
      const hasTwoHandedWeapon = state.player.weapons.some(
        (w) =>
          w.twoHanded ?? weaponsByBaseId[w.baseId]?.twoHanded ?? false,
      );
      if (hasTwoHandedWeapon) return state;
      const previous = state.player.equippedShield ?? null;
      const nextInventory = inventory.filter((a) => a.id !== action.id);
      if (previous) nextInventory.push(previous);
      const player: Player = {
        ...state.player,
        equippedShield: target,
        armorInventory: nextInventory,
      };
      return { ...state, player };
    }

    case "UNEQUIP_SHIELD": {
      if (!state.player) return state;
      const current = state.player.equippedShield;
      if (!current) return state;
      const player: Player = {
        ...state.player,
        equippedShield: null,
        armorInventory: [...(state.player.armorInventory ?? []), current],
      };
      return { ...state, player };
    }

    case "DISCARD_SHIELD": {
      if (!state.player) return state;
      const player: Player = {
        ...state.player,
        equippedShield:
          state.player.equippedShield?.id === action.id
            ? null
            : (state.player.equippedShield ?? null),
        armorInventory: (state.player.armorInventory ?? []).filter(
          (a) => a.id !== action.id,
        ),
      };
      return { ...state, player };
    }

    case "CAST_SPELL": {
      if (!state.player || !state.monster) return state;
      const spell = state.player.equippedSpells.find(
        (s) => s.id === action.spellId,
      );
      if (!spell) return state;
      // Spell-attack spells consume the slot regardless of hit/miss.
      let spellSlots = state.player.spellSlots;
      if (spell.level > 0) {
        const key = String(spell.level);
        const remaining = spellSlots[key] ?? 0;
        if (remaining <= 0) return state;
        spellSlots = { ...spellSlots, [key]: remaining - 1 };
      }
      const newHealth = Math.max(0, state.monster.health - action.damage);
      const monster: Monster = { ...state.monster, health: newHealth };
      const player: Player = { ...state.player, spellSlots };
      const note = action.note ? ` (${action.note})` : "";
      const text = action.missed
        ? `${player.name} casts ${spell.name} — MISS${note}`
        : action.crit
          ? `CRIT — ${player.name} casts ${spell.name} for ${action.damage} hp${note}`
          : `${player.name} casts ${spell.name} for ${action.damage} hp${note}`;
      return pushTurn(
        {
          ...state,
          monster,
          player,
          lastPlayerAttack: {
            nonce: state.lastPlayerAttack.nonce + 1,
            damage: action.missed ? 0 : action.damage,
          },
        },
        true,
        text,
        action.crit ? "crit" : undefined,
        "spell",
      );
    }

    case "SMITE_ATTACK": {
      if (!state.player || !state.monster) return state;
      // Smite isn't consumed on miss because 5e declares smite after the hit
      // lands. consumeSlot defaults to true for hits, false for misses.
      const consume = action.consumeSlot ?? !action.missed;
      let spellSlots = state.player.spellSlots;
      if (consume) {
        const key = String(action.smiteSlotLevel);
        const remaining = spellSlots[key] ?? 0;
        if (remaining <= 0) return state;
        spellSlots = { ...spellSlots, [key]: remaining - 1 };
      }
      const total = action.damage + action.smiteDamage;
      const newHealth = Math.max(0, state.monster.health - total);
      const monster: Monster = { ...state.monster, health: newHealth };
      const player: Player = { ...state.player, spellSlots };
      const note = action.note ? ` (${action.note})` : "";
      const text = action.missed
        ? `${player.name} smites ${monster.name} with ${action.weaponName} — MISS${note}`
        : action.crit
          ? `CRIT — ${player.name} smites ${monster.name} with ${action.weaponName} for ${total} hp (L${action.smiteSlotLevel} smite +${action.smiteDamage})${note}`
          : `${player.name} smites ${monster.name} with ${action.weaponName} for ${total} hp (L${action.smiteSlotLevel} smite +${action.smiteDamage})${note}`;
      return pushTurn(
        {
          ...state,
          monster,
          player,
          lastPlayerAttack: {
            nonce: state.lastPlayerAttack.nonce + 1,
            damage: action.missed ? 0 : total,
          },
        },
        true,
        text,
        action.crit ? "crit" : undefined,
        "smite",
      );
    }

    case "USE_SCROLL": {
      if (!state.player || !state.monster) return state;
      const scroll = state.player.consumables.find(
        (c): c is Scroll => c.kind === "scroll" && c.id === action.scrollId,
      );
      if (!scroll) return state;
      // Scrolls are consumed regardless of hit/miss (matches 5e spell-attack
      // economy: the casting still resolves).
      const newHealth = Math.max(0, state.monster.health - action.damage);
      const monster: Monster = { ...state.monster, health: newHealth };
      const player: Player = {
        ...state.player,
        consumables: state.player.consumables.filter(
          (c) => c.id !== action.scrollId,
        ),
      };
      const note = action.note ? ` (${action.note})` : "";
      const text = action.missed
        ? `${player.name} reads a scroll of ${scroll.spellName} — MISS${note}`
        : action.crit
          ? `CRIT — ${player.name} reads a scroll of ${scroll.spellName} for ${action.damage} hp${note}`
          : `${player.name} reads a scroll of ${scroll.spellName} for ${action.damage} hp${note}`;
      return pushTurn(
        {
          ...state,
          monster,
          player,
          lastPlayerAttack: {
            nonce: state.lastPlayerAttack.nonce + 1,
            damage: action.missed ? 0 : action.damage,
          },
        },
        true,
        text,
        action.crit ? "crit" : undefined,
        "scroll",
      );
    }

    case "USE_POTION": {
      if (!state.player) return state;
      const potion = state.player.consumables.find(
        (c): c is Potion => c.kind === "potion" && c.id === action.potionId,
      );
      if (!potion) return state;
      const healed = Math.min(
        state.player.maxHealth - state.player.health,
        action.healed,
      );
      const player: Player = {
        ...state.player,
        health: state.player.health + healed,
        consumables: state.player.consumables.filter(
          (c) => c.id !== action.potionId,
        ),
      };
      const text = `${player.name} drinks a ${potion.name} for ${healed} hp`;
      return pushTurn({ ...state, player }, true, text, undefined, "potion");
    }

    case "REFILL_SLOTS": {
      if (!state.player) return state;
      const klass = CLASSES.find(
        (c) => c.id.toLowerCase() === state.player!.classId.toLowerCase(),
      );
      if (!klass || !klass.isCaster) return state;
      const player: Player = {
        ...state.player,
        spellSlots: slotsForLevel(state.player.level),
      };
      return { ...state, player };
    }

    case "LONG_REST": {
      // 5e long rest: regain all HP and all expended spell slots.
      // (We skip Hit Dice tracking — it's a sim-too-far for the
      // current game loop and Hit Dice never come into play
      // mechanically.) One log entry covers both restorations so
      // the user sees a clear "took a long rest" beat instead of
      // a heal line followed by a silent slot refill.
      if (!state.player) return state;
      const klass = CLASSES.find(
        (c) => c.id.toLowerCase() === state.player!.classId.toLowerCase(),
      );
      const player: Player = {
        ...state.player,
        health: state.player.maxHealth,
        spellSlots:
          klass?.isCaster
            ? slotsForLevel(state.player.level)
            : state.player.spellSlots,
      };
      const text = `${player.name} takes a long rest — HP and spell slots restored.`;
      // No `kind` highlight — the "LEVEL UP — " / "LOOT — " prefix
      // those tags add doesn't make sense for a rest. The heart
      // icon + text are enough to mark the entry.
      return pushTurn({ ...state, player }, true, text, undefined, "heal");
    }

    case "EQUIP_SPELL": {
      if (!state.player) return state;
      if (state.player.equippedSpells.length >= EQUIPPED_SPELL_CAP) return state;
      if (state.player.equippedSpells.some((s) => s.id === action.id))
        return state;
      const target = state.player.knownSpells.find((s) => s.id === action.id);
      if (!target) return state;
      const player: Player = {
        ...state.player,
        equippedSpells: [...state.player.equippedSpells, target],
      };
      return { ...state, player };
    }

    case "UNEQUIP_SPELL": {
      if (!state.player) return state;
      if (!state.player.equippedSpells.some((s) => s.id === action.id))
        return state;
      const player: Player = {
        ...state.player,
        equippedSpells: state.player.equippedSpells.filter(
          (s) => s.id !== action.id,
        ),
      };
      return { ...state, player };
    }

    case "DISCARD_CONSUMABLE": {
      if (!state.player) return state;
      const player: Player = {
        ...state.player,
        consumables: state.player.consumables.filter(
          (c) => c.id !== action.id,
        ),
      };
      return { ...state, player };
    }

    default:
      return state;
  }
}
