"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VictoryInfo } from "@/lib/game/types";

type Props = {
  victory: VictoryInfo;
  playerName: string;
  onKeep: () => void;
  onDiscard: () => void;
};

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

export function VictoryDialog({
  victory,
  playerName,
  onKeep,
  onDiscard,
}: Props) {
  const { monsterName, xpGained, levelsGained, loot } = victory;
  const leveledUp = levelsGained.length > 0;
  const finalLevel = levelsGained[levelsGained.length - 1];
  const display = loot ? lootDisplay(loot) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            Victory!
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-2 text-center">
          <p>
            <span className="font-bold">{playerName}</span> defeated{" "}
            <span className="font-bold">{monsterName}</span>!
          </p>
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            + {xpGained} XP
          </p>
          {leveledUp ? (
            <p className="font-bold text-emerald-700 dark:text-emerald-400">
              Reached level {finalLevel}!
            </p>
          ) : null}
        </div>
        {display ? (
          <div className="flex flex-col gap-2">
            <p className="text-center font-mono text-sm font-bold uppercase tracking-widest">
              Loot
            </p>
            <div className="flex items-center justify-between rounded-md border-2 border-zinc-900 bg-card px-3 py-2">
              <span className="font-mono text-sm font-bold uppercase tracking-widest">
                {display.name}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {display.detail}
              </span>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          {display ? (
            <div className="flex w-full gap-2">
              <Button variant="outline" onClick={onDiscard} className="flex-1">
                Discard
              </Button>
              <Button
                onClick={onKeep}
                className="flex-1 bg-emerald-500 text-white hover:bg-emerald-500/90"
              >
                Keep
              </Button>
            </div>
          ) : (
            <Button onClick={onKeep} className="w-full">
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
