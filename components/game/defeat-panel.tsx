import { LobbyResultFrame } from "@/components/game/lobby-result-frame";

// Lobby middle-column panel shown after a defeat. Mirrors the player and
// command panels' frame so the lobby grid feels balanced instead of empty.
export function DefeatPanel({ defeatedBy }: { defeatedBy: string }) {
  return (
    <LobbyResultFrame className="items-center gap-2 text-center">
      <p className="text-2xl font-bold uppercase tracking-widest text-rose-600">
        You Lose
      </p>
      <p className="text-sm text-muted-foreground">Defeated by {defeatedBy}</p>
    </LobbyResultFrame>
  );
}
