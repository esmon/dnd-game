"use client";

import { Button } from "@/components/ui/button";
import { LobbyResultFrame } from "@/components/game/lobby-result-frame";
import type { VictoryInfo } from "@/lib/game/types";

function lootDisplay(loot: NonNullable<VictoryInfo["loot"]>): {
  name: string;
  detail: string;
} {
  if ("kind" in loot) {
    if (loot.kind === "scroll") {
      return {
        name: `Scroll of ${loot.spellName}`,
        detail: `${loot.damage} ${loot.damageType}`,
      };
    }
    return { name: loot.name, detail: loot.healDice };
  }
  return { name: loot.name, detail: loot.damage };
}

// Lobby middle-column panel shown after a victory. Mirrors DefeatPanel — the
// frame matches the player and command panels so the lobby grid stays
// balanced. Loot keep/discard lives inline; if the user hits FIGHT without
// deciding, the caller defaults to keep (matching the old dialog's
// onOpenChange behavior).
export function VictoryPanel({
  victory,
  playerName,
  onKeep,
  onDiscard,
}: {
  victory: VictoryInfo;
  playerName: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const { monsterName, xpGained, levelsGained, loot } = victory;
  const leveledUp = levelsGained.length > 0;
  const finalLevel = levelsGained[levelsGained.length - 1];
  const display = loot ? lootDisplay(loot) : null;

  return (
    <LobbyResultFrame className="gap-3">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-2xl font-bold uppercase tracking-widest text-emerald-600">
          Victory
        </p>
        <p className="text-sm text-muted-foreground">
          {playerName} defeated {monsterName}
        </p>
        <p className="text-sm tabular-nums text-muted-foreground">
          + {xpGained} XP
        </p>
        {leveledUp ? (
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
            Reached level {finalLevel}!
          </p>
        ) : null}
      </div>
      {display ? (
        <div className="flex flex-col gap-2">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Loot
          </p>
          <div className="flex items-center justify-between rounded-md border border-zinc-300 bg-background px-3 py-2 dark:border-zinc-700">
            <span className="text-sm font-bold uppercase tracking-widest">
              {display.name}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {display.detail}
            </span>
          </div>
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              onClick={onDiscard}
              className="flex-1 justify-center"
            >
              Discard
            </Button>
            <Button
              onClick={onKeep}
              className="flex-1 justify-center bg-emerald-500 text-white hover:bg-emerald-500/90"
            >
              Keep
            </Button>
          </div>
        </div>
      ) : null}
    </LobbyResultFrame>
  );
}
