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
import type {
  AbilityScores,
  GameStats,
  GameStatus,
  Monster,
  MonsterIndex,
  Player,
  Turn,
} from "./types";

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
  | { type: "DEV_NEXT_LEVEL" };

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
      return { ...state, monster: action.monster, monsterPending: false };

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
      const playerWithXp: Player = {
        ...state.player,
        xp: state.player.xp + state.monster.xp,
      };
      const { player, asiPending, texts: levelUpTexts } = applyLevelUps(
        playerWithXp,
        state.asiPending,
      );
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
      };
      next = pushTurn(next, true, winText);
      for (const t of levelUpTexts) {
        next = pushTurn(next, true, t, "levelup");
      }
      return next;
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
      // Clamp at 0 so XP can't go negative on defeat.
      const xp =
        state.player.xp > state.monster.xp
          ? state.player.xp - state.monster.xp
          : 0;
      const player: Player = { ...state.player, xp };
      const text = `${state.monster.name} wins!`;
      return pushTurn(
        {
          ...state,
          player,
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

    default:
      return state;
  }
}
