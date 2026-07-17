"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { findClass } from "@/lib/dnd/classes";
import { RACES } from "@/lib/dnd/races";
import { fetchWithSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { Character } from "@/lib/db/schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentCharacterId: string;
  onSelect: (id: string) => void;
  // Dialog heading. Defaults to the original "Switch Character" so
  // existing callers are unaffected; the story lobby passes
  // "Choose Your Character" for the join flow.
  title?: string;
  // Per-row action label (the button next to a non-current
  // character). Defaults to "Switch".
  selectLabel?: string;
};

export function CharacterPickerDialog({
  open,
  onOpenChange,
  currentCharacterId,
  onSelect,
  title = "Switch Character",
  selectLabel = "Switch",
}: Props) {
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const loading = open && characters === null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchWithSession("/api/characters")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        setCharacters(data as Character[]);
      })
      .catch((err) => {
        console.error("character list fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-2 border-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            {title}
          </DialogTitle>
        </DialogHeader>
        {loading || characters === null ? (
          <p className="py-6 text-center text-sm">
            Loading...
          </p>
        ) : characters.length === 0 ? (
          <p className="py-6 text-center text-sm">
            No characters.
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="flex flex-col gap-2">
              {characters.map((c) => {
                const isCurrent = c.id === currentCharacterId;
                const klass = findClass(c.class);
                const race = RACES.find((r) => r.id === c.race);
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md bg-card px-3 py-2",
                      isCurrent
                        ? "border-2 border-foreground"
                        : "border border-muted-foreground/20",
                    )}
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-sm font-bold uppercase tracking-widest">
                        {c.name}
                      </span>
                      <span className="font-mono text-xs tabular-nums">
                        Lvl {c.level} · {race?.name ?? c.race} ·{" "}
                        {klass?.name ?? c.class}
                      </span>
                    </div>
                    {isCurrent ? (
                      <span
                        aria-label="Current character"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-action text-action-foreground"
                      >
                        <CheckIcon className="size-4" />
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => onSelect(c.id)}>
                        {selectLabel}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button
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
