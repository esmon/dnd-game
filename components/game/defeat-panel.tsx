// Lobby middle-column panel shown after a defeat. Mirrors the player and
// command panels' frame so the lobby grid feels balanced instead of empty.
export function DefeatPanel({ defeatedBy }: { defeatedBy: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-md border-2 border-zinc-900 bg-card px-4 py-6 font-mono text-center">
      <p className="text-2xl font-bold uppercase tracking-widest text-rose-600">
        You Lose
      </p>
      <p className="text-sm text-muted-foreground">
        Defeated by {defeatedBy}
      </p>
    </div>
  );
}
