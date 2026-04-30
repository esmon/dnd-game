// Per-turn idle timeout: if the active player doesn't act within
// TURN_TIMEOUT_MS the timeout endpoint auto-skips them so the game
// keeps moving. Tuned long enough that a player can think through
// options but short enough that a disconnected teammate doesn't
// freeze a coop fight.
export const TURN_TIMEOUT_MS = 60_000;

// ISO timestamp for "now + the timeout." Stored on
// campaigns.turn_deadline whenever the action loop hands control
// back to a player; cleared when no player is up (between
// encounters, finished).
export function nextTurnDeadline(): string {
  return new Date(Date.now() + TURN_TIMEOUT_MS).toISOString();
}
