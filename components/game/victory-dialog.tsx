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
  onDismiss: () => void;
};

export function VictoryDialog({ victory, playerName, onDismiss }: Props) {
  const { monsterName, xpGained, levelsGained } = victory;
  const leveledUp = levelsGained.length > 0;
  const finalLevel = levelsGained[levelsGained.length - 1];

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
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
        <DialogFooter>
          <Button onClick={onDismiss} className="w-full">
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
