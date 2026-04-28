import type {
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
};

export type Action =
  | { type: "BOOTSTRAP_DONE"; player: Player; indices: MonsterIndex[] }
  | { type: "SET_PLAYER"; player: Player }
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
  | { type: "FULL_HEAL" };

function pushTurn(state: GameState, isPlayer: boolean, text: string): GameState {
  const turn: Turn = { id: state.nextTurnId, isPlayer, text };
  return {
    ...state,
    turns: [turn, ...state.turns],
    nextTurnId: state.nextTurnId + 1,
  };
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
      const player: Player = {
        ...state.player,
        xp: state.player.xp + state.monster.xp,
      };
      const text = `${player.name} wins!`;
      const wins = state.stats.wins + 1;
      return pushTurn(
        {
          ...state,
          player,
          status: "lobby",
          monster: null,
          monsterPending: false,
          stats: { ...state.stats, wins },
        },
        true,
        text,
      );
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

    default:
      return state;
  }
}
