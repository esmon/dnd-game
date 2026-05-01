"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Consumable, Spell, Weapon } from "@/lib/game/types";

type Tab = "weapons" | "spells" | "consumables";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventory: Weapon[];
  equippedIds: string[];
  equipCap: number;
  knownSpells: Spell[];
  equippedSpellIds: string[];
  spellCap: number;
  consumables: Consumable[];
  onEquip: (id: string) => void;
  onUnequip: (id: string) => void;
  onDiscard: (id: string) => void;
  onEquipSpell: (id: string) => void;
  onUnequipSpell: (id: string) => void;
  onDiscardConsumable: (id: string) => void;
};

function spellLevelLabel(level: number): string {
  if (level === 0) return "Cantrip";
  if (level === 1) return "1st";
  if (level === 2) return "2nd";
  if (level === 3) return "3rd";
  return `${level}th`;
}

export function InventoryDialog({
  open,
  onOpenChange,
  inventory,
  equippedIds,
  equipCap,
  knownSpells,
  equippedSpellIds,
  spellCap,
  consumables,
  onEquip,
  onUnequip,
  onDiscard,
  onEquipSpell,
  onUnequipSpell,
  onDiscardConsumable,
}: Props) {
  const [tab, setTab] = useState<Tab>("weapons");
  const equippedSet = new Set(equippedIds);
  const equippedCount = equippedIds.length;
  const atCap = equippedCount >= equipCap;

  const equippedSpellSet = new Set(equippedSpellIds);
  const equippedSpellCount = equippedSpellIds.length;
  const atSpellCap = equippedSpellCount >= spellCap;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-2 border-zinc-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            Inventory
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-center gap-1">
          <TabButton active={tab === "weapons"} onClick={() => setTab("weapons")}>
            Weapons
          </TabButton>
          <TabButton active={tab === "spells"} onClick={() => setTab("spells")}>
            Spells
          </TabButton>
          <TabButton
            active={tab === "consumables"}
            onClick={() => setTab("consumables")}
          >
            Consumables
          </TabButton>
        </div>

        {tab === "weapons" ? (
          <>
            <p className="text-center font-mono text-xs tabular-nums">
              Equipped {equippedCount}/{equipCap}
            </p>
            {inventory.length === 0 ? (
              <p className="py-6 text-center text-sm">
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
                        className={cn(
                          "flex flex-col gap-2 rounded-md bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
                          isEquipped
                            ? "border-2 border-zinc-900"
                            : "border border-muted-foreground/20",
                        )}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-sm font-bold uppercase tracking-widest">
                            {w.name}
                          </span>
                          <span className="font-mono text-xs tabular-nums">
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
          </>
        ) : null}

        {tab === "spells" ? (
          <>
            <p className="text-center font-mono text-xs tabular-nums">
              Equipped {equippedSpellCount}/{spellCap}
            </p>
            {knownSpells.length === 0 ? (
              <p className="py-6 text-center text-sm">
                No spells known.
              </p>
            ) : (
              <ScrollArea className="max-h-[60vh] pr-2">
                <div className="flex flex-col gap-2">
                  {knownSpells.map((s) => {
                    const isEquipped = equippedSpellSet.has(s.id);
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "flex flex-col gap-2 rounded-md bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between",
                          isEquipped
                            ? "border-2 border-zinc-900"
                            : "border border-muted-foreground/20",
                        )}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-sm font-bold uppercase tracking-widest">
                            {s.name}
                          </span>
                          <span className="font-mono text-xs tabular-nums">
                            {spellLevelLabel(s.level)} · {s.damage} {s.damageType}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="default"
                            disabled={isEquipped || atSpellCap}
                            onClick={() => onEquipSpell(s.id)}
                            className="flex-1 sm:flex-none"
                          >
                            Equip
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isEquipped}
                            onClick={() => onUnequipSpell(s.id)}
                            className="flex-1 sm:flex-none"
                          >
                            Unequip
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </>
        ) : null}

        {tab === "consumables" ? (
          <>
            {consumables.length === 0 ? (
              <p className="py-6 text-center text-sm">
                No consumables.
              </p>
            ) : (
              <ScrollArea className="max-h-[60vh] pr-2">
                <div className="flex flex-col gap-2">
                  {consumables.map((c) => {
                    const detail =
                      c.kind === "scroll"
                        ? `Scroll · ${c.damage} ${c.damageType}`
                        : `Potion · ${c.healDice}`;
                    const label =
                      c.kind === "scroll" ? c.spellName : c.name;
                    return (
                      <div
                        key={c.id}
                        className="flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-mono text-sm font-bold uppercase tracking-widest">
                            {label}
                          </span>
                          <span className="font-mono text-xs tabular-nums">
                            {detail}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onDiscardConsumable(c.id)}
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
          </>
        ) : null}

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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-md border-2 border-zinc-900 px-3 py-1 font-mono text-xs uppercase tracking-widest",
        active
          ? "bg-zinc-900 text-white"
          : "bg-card text-zinc-900 dark:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}
