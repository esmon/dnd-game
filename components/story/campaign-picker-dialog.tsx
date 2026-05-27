"use client";

import { CheckIcon } from "lucide-react";
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
import type { StoryMode, StoryPlayerRole } from "@/lib/dm/db";
import type { Campaign } from "@/lib/dm/types";
import { cn } from "@/lib/utils";

export type StoryStartConfig = {
  campaignTemplateId: string;
  mode: StoryMode;
  // Only meaningful when mode === "coop". Solo ignores it.
  dmRole: StoryPlayerRole;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pre-filtered by recommendedLevel against the active character.
  // null = show everything (no character context). The caller does
  // the filtering since it knows the character's level.
  visibleIds?: string[] | null;
  onPick: (config: StoryStartConfig) => void;
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
  const [mode, setMode] = useState<StoryMode>("solo");
  const [dmRole, setDmRole] = useState<StoryPlayerRole>("dm");
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
            No campaigns match your character&apos;s level.
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
                    className="relative flex flex-col gap-1 rounded-xl border-2 border-zinc-900 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    {isSelected ? (
                      <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white">
                        <CheckIcon className="size-4" />
                      </span>
                    ) : null}
                    <span className="truncate pr-8 font-mono text-sm font-bold uppercase tracking-widest">
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

        {/* Mode + (coop) DM-role selectors. Solo plays straight
            through; coop drops into a lobby where the party
            assembles. */}
        <div className="flex flex-col gap-3 border-t border-muted-foreground/20 pt-3">
          <Segmented
            label="Mode"
            value={mode}
            options={[
              { value: "solo", label: "Solo" },
              { value: "coop", label: "Co-op" },
            ]}
            onChange={setMode}
          />
          {mode === "coop" ? (
            <Segmented
              label="Your seat"
              value={dmRole}
              options={[
                { value: "dm", label: "I'll DM" },
                { value: "player", label: "I'll play" },
              ]}
              onChange={setDmRole}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            disabled={!selected || busy}
            onClick={() =>
              selected &&
              onPick({ campaignTemplateId: selected, mode, dmRole })
            }
          >
            {busy
              ? "Starting…"
              : mode === "coop"
                ? "Create Lobby"
                : "Begin Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Small two-or-more option segmented control. Generic over the
// value type so it serves both the mode (solo/coop) and seat
// (dm/player) toggles. Matches the composer role tabs on the
// story page visually.
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex gap-1 rounded-md border border-input bg-muted/30 p-0.5 text-xs uppercase tracking-widest">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-sm px-3 py-1 transition-colors",
                active ? "bg-zinc-900 text-white" : "hover:bg-muted/60",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
