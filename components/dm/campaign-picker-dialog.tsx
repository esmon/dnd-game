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
import { CAMPAIGNS } from "@/lib/dm/campaigns";
import type { Campaign } from "@/lib/dm/types";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pre-filtered by recommendedLevel against the active character.
  // null = show everything (no character context). The caller does
  // the filtering since it knows the character's level.
  visibleIds?: string[] | null;
  onPick: (campaignTemplateId: string) => void;
  busy?: boolean;
};

const TONE_LABEL: Record<Campaign["tone"], string> = {
  "gothic-horror": "Gothic Horror",
  "pulp-action": "Pulp Action",
  "high-fantasy": "High Fantasy",
  "grim-survival": "Grim Survival",
};

const DIFFICULTY_LABEL: Record<Campaign["difficulty"], string> = {
  low: "Low",
  mid: "Mid",
  high: "High",
};

export function CampaignPickerDialog({
  open,
  onOpenChange,
  visibleIds = null,
  onPick,
  busy = false,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const list = visibleIds
    ? CAMPAIGNS.filter((c) => visibleIds.includes(c.id))
    : CAMPAIGNS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-2 border-zinc-900 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            Choose a Campaign
          </DialogTitle>
        </DialogHeader>
        {list.length === 0 ? (
          <p className="py-6 text-center text-sm">
            No campaigns match your character's level.
          </p>
        ) : (
          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="flex flex-col gap-2">
              {list.map((c) => {
                const isSelected = selected === c.id;
                const [minLvl, maxLvl] = c.recommendedLevel;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c.id)}
                    className={cn(
                      "flex flex-col gap-1 rounded-md bg-card px-3 py-2 text-left",
                      isSelected
                        ? "border-2 border-zinc-900"
                        : "border border-muted-foreground/20",
                    )}
                  >
                    <span className="truncate font-mono text-sm font-bold uppercase tracking-widest">
                      {c.title}
                    </span>
                    <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                      Lv {minLvl}–{maxLvl} · {TONE_LABEL[c.tone]} ·{" "}
                      {DIFFICULTY_LABEL[c.difficulty]} difficulty
                    </span>
                    <span className="text-xs leading-snug">{c.premise}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            className="w-full"
            disabled={!selected || busy}
            onClick={() => selected && onPick(selected)}
          >
            {busy ? "Starting…" : "Begin Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
