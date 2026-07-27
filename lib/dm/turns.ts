import type { StoryPlayer } from "./db";

// Coop narrative-phase turn order. Only role 'player' rows are in the
// rotation (the DM runs the world and never "takes a turn"), ordered
// by roster position.
export function turnOrder(players: StoryPlayer[]): StoryPlayer[] {
  return players
    .filter((p) => p.role === "player")
    .sort((a, b) => a.position - b.position);
}

// First player's user_id — the turn when a coop story starts. Null if
// there are no players.
export function firstTurnUserId(players: StoryPlayer[]): string | null {
  return turnOrder(players)[0]?.user_id ?? null;
}

// The user_id whose turn comes after `currentUserId`, wrapping around.
// Falls back to the first player when current isn't in the order
// (e.g. the active player left mid-game). Null if no players remain.
export function nextTurnUserId(
  players: StoryPlayer[],
  currentUserId: string | null,
): string | null {
  const order = turnOrder(players);
  if (order.length === 0) return null;
  const idx = order.findIndex((p) => p.user_id === currentUserId);
  if (idx === -1) return order[0].user_id;
  return order[(idx + 1) % order.length].user_id;
}
