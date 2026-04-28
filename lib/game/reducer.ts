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
import { slotsForLevel } from "@/lib/dnd/spells";
import type {
  AbilityScores,
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
};

export const initialState: GameState = {
  status: "lobby",
  player: null,
  monster: null,
  turns: [],
  stats: { wins: 0, losses: 0, runaways: 0 },
  monsterIndices: [],
  loading: true,
  monsterPending: false,
  nextTurnId: 1,
  asiPending: [],
  victory: null,
  inventoryOpen: false,
  characterCount: 0,
  characterPickerOpen: false,
};

export type Action =
  | { type: "BOOTSTRAP_DONE"; player: Player; indices: MonsterIndex[] }
  | { type: "SET_PLAYER"; player: Player }
  | { type: "SET_MONSTER_INDICES"; indices: MonsterIndex[] }
  | { type: "SET_MONSTER"; monster: Monster }
  | { type: "START_FIGHT" }
  | { type: "RETURN_TO_LOBBY" }
  | { type: "PLAYER_ATTACK"; damage: number; weaponName: string }
  | { type: "MONSTER_PENDING" }
  | { type: "MONSTER_ATTACK"; damage: number }
  | { type: "PLAYER_HEAL"; amount: number }
  | { type: "RUN_AWAY_SUCCESS" }
  | { type: "RUN_AWAY_FAIL" }
  | { type: "WIN" }
  | { type: "LOSE" }
  | { type: "FULL_HEAL" }
  | { type: "APPLY_ASI"; deltas: Partial<AbilityScores> }
  | { type: "DEV_NEXT_LEVEL" }
  | { type: "DISMISS_VICTORY"; keepLoot?: boolean }
  | { type: "SET_INVENTORY_OPEN"; open: boolean }
  | { type: "SET_CHARACTER_COUNT"; count: number }
  | { type: "SET_CHARACTER_PICKER_OPEN"; open: boolean }
  | { type: "ADD_LOOT"; weapon: Weapon }
  | { type: "EQUIP_WEAPON"; id: string }
  | { type: "UNEQUIP_WEAPON"; id: string }
  | { type: "DISCARD_WEAPON"; id: string }
  | { type: "CAST_SPELL"; spellId: string; damage: number }
  | { type: "USE_SCROLL"; scrollId: string; damage: number }
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
): GameState {
  const turn: Turn = { id: state.nextTurnId, isPlayer, text, ...(kind && { kind }) };
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
  }
  if (klass.isCaster && p.level !== player.level) {
    p = { ...p, spellSlots: slotsForLevel(p.level) };
  }
  return { player: p, asiPending: newAsi, texts };
}

export function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "BOOTSTRAP_DONE":
      return {
        ...state,
        player: action.player,
        monsterIndices: action.indices,
        loading: false,
      };

    case "SET_PLAYER":
      return { ...state, player: action.player };

    case "SET_MONSTER_INDICES":
      return { ...state, monsterIndices: action.indices };

    case "SET_MONSTER":
      return pushTurn(
        { ...state, monster: action.monster, monsterPending: false },
        true,
        `You have encountered a ${action.monster.name}!`,
      );

    case "START_FIGHT":
      // Caller is responsible for following up with SET_MONSTER once fetched.
      return {
        ...state,
        status: "fighting",
        turns: [],
        monster: null,
        monsterPending: false,
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
      const text = `${state.player.name} attacks ${monster.name} with ${action.weaponName} for ${action.damage}hp`;
      return pushTurn({ ...state, monster }, true, text);
    }

    case "MONSTER_PENDING":
      return { ...state, monsterPending: true };

    case "MONSTER_ATTACK": {
      if (!state.monster || !state.player) return state;
      const newHealth = Math.max(0, state.player.health - action.damage);
      const player: Player = { ...state.player, health: newHealth };
      const text = `${state.monster.name} attacks ${player.name} for ${action.damage} hp`;
      return pushTurn(
        { ...state, player, monsterPending: false },
        false,
        text,
      );
    }

    case "PLAYER_HEAL": {
      if (!state.player) return state;
      const newHealth = Math.min(
        state.player.maxHealth,
        state.player.health + action.amount,
      );
      const player: Player = { ...state.player, health: newHealth };
      const text = `${state.player.name} heals for ${action.amount}`;
      return pushTurn({ ...state, player }, true, text);
    }

    case "RUN_AWAY_SUCCESS": {
      if (!state.player) return state;
      const text = `${state.player.name} successfully runs away!`;
      return pushTurn(
        {
          ...state,
          status: "lobby",
          monster: null,
          monsterPending: false,
          stats: { ...state.stats, runaways: state.stats.runaways + 1 },
        },
        true,
        text,
      );
    }

    case "RUN_AWAY_FAIL": {
      if (!state.player) return state;
      const text = `${state.player.name} failed to run away!`;
      return pushTurn(state, true, text);
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
        asiPending,
        victory: { monsterName, xpGained, levelsGained, loot },
      };
      next = pushTurn(next, true, winText);
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

    case "DISMISS_VICTORY": {
      const keepLoot = action.keepLoot ?? true;
      const loot = state.victory?.loot;
      if (keepLoot && loot && state.player) {
        if ("kind" in loot) {
          const consumable: Consumable = loot;
          return {
            ...state,
            victory: null,
            player: {
              ...state.player,
              consumables: [...state.player.consumables, consumable],
            },
          };
        }
        const weapon: Weapon = loot;
        return {
          ...state,
          victory: null,
          player: {
            ...state.player,
            inventory: [...state.player.inventory, weapon],
          },
        };
      }
      return { ...state, victory: null };
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
      return pushTurn(
        {
          ...state,
          status: "lobby",
          monster: null,
          monsterPending: false,
          stats: {
            ...state.stats,
            losses: state.stats.losses + 1,
            wins: 0,
          },
        },
        false,
        text,
      );
    }

    case "FULL_HEAL": {
      if (!state.player) return state;
      const player: Player = { ...state.player, health: state.player.maxHealth };
      return { ...state, player };
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
      const player: Player = { ...state.player, abilityScores };
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

    case "CAST_SPELL": {
      if (!state.player || !state.monster) return state;
      const spell = state.player.equippedSpells.find(
        (s) => s.id === action.spellId,
      );
      if (!spell) return state;
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
      const text = `${player.name} casts ${spell.name} for ${action.damage} hp`;
      return pushTurn({ ...state, monster, player }, true, text);
    }

    case "USE_SCROLL": {
      if (!state.player || !state.monster) return state;
      const scroll = state.player.consumables.find(
        (c): c is Scroll => c.kind === "scroll" && c.id === action.scrollId,
      );
      if (!scroll) return state;
      const newHealth = Math.max(0, state.monster.health - action.damage);
      const monster: Monster = { ...state.monster, health: newHealth };
      const player: Player = {
        ...state.player,
        consumables: state.player.consumables.filter(
          (c) => c.id !== action.scrollId,
        ),
      };
      const text = `${player.name} reads a scroll of ${scroll.spellName} for ${action.damage} hp`;
      return pushTurn({ ...state, monster, player }, true, text);
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
      return pushTurn({ ...state, player }, true, text);
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
