"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Weapon } from "@/lib/game/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventory: Weapon[];
  equippedIds: string[];
  equipCap: number;
  onEquip: (id: string) => void;
  onUnequip: (id: string) => void;
  onDiscard: (id: string) => void;
};

export function InventoryDialog({
  open,
  onOpenChange,
  inventory,
  equippedIds,
  equipCap,
  onEquip,
  onUnequip,
  onDiscard,
}: Props) {
  const equippedSet = new Set(equippedIds);
  const equippedCount = equippedIds.length;
  const atCap = equippedCount >= equipCap;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            Inventory
          </DialogTitle>
        </DialogHeader>
        <p className="text-center font-mono text-xs tabular-nums text-muted-foreground">
          Equipped {equippedCount}/{equipCap}
        </p>
        {inventory.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Inventory is empty.
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="flex flex-col gap-2">
              {inventory.map((w) => {
                const isEquipped = equippedSet.has(w.id);
                return (
                  <div
                    key={w.id}
                    className="flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-sm font-bold uppercase tracking-widest">
                        {w.name}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {w.damage}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isEquipped || atCap}
                        onClick={() => onEquip(w.id)}
                        className="flex-1 sm:flex-none"
                      >
                        Equip
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isEquipped}
                        onClick={() => onUnequip(w.id)}
                        className="flex-1 sm:flex-none"
                      >
                        Unequip
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => onDiscard(w.id)}
                        className="flex-1 sm:flex-none"
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
