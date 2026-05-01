"use client";

import type { LucideIcon } from "lucide-react";
import { Fragment, useState, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DisabledTip } from "@/components/game/disabled-tip";
import { PanelLabel } from "@/components/game/panel-label";
import { cn } from "@/lib/utils";

// Dragon-Warrior style 2x2 mobile battle panel. Caller supplies the
// four tile specs so the same component serves solo (Attack / Spell /
// Inventory / Run Away) and coop (Attack / Spell / Skip / Forfeit) —
// only the third and fourth tiles change. Each tile is either a
// popover (Attack/Spell/Inventory) or a direct action (Run Away/Skip
// /Forfeit).

export type MobileTileKind = "attack" | "spell" | "neutral" | "danger";

const KIND_CLASS: Record<MobileTileKind, string> = {
  attack: "bg-destructive text-white hover:bg-destructive/90",
  spell: "bg-indigo-600 text-white hover:bg-indigo-600/90",
  neutral: "",
  danger: "bg-red-600 text-white hover:bg-red-600/90",
};

export type MobileBattleTile = {
  key: string;
  kind: MobileTileKind;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  disabledReason?: string | null;
  // Mutually exclusive: a popover-bound tile shows a menu of actions,
  // a direct-action tile fires onClick. Modeling both in one type
  // would require a discriminated union — the runtime check in
  // CategoryButton is good enough and keeps the call sites readable.
  popover?: ReactNode;
  onClick?: () => void;
};

function CategoryButton({
  kind,
  icon: Icon,
  label,
  disabled = false,
  disabledReason = null,
  onClick,
  popover,
}: Omit<MobileBattleTile, "key">) {
  const trigger = (
    <Button
      variant={kind === "neutral" ? "outline" : "default"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-auto min-h-12 w-full justify-start py-1.5 text-left leading-tight",
        KIND_CLASS[kind],
      )}
    >
      <Icon className="size-5 shrink-0" />
      {label}
    </Button>
  );

  const wrapped = (
    <DisabledTip reason={disabled ? disabledReason : null}>
      {trigger}
    </DisabledTip>
  );

  if (!popover || disabled) return wrapped;

  return <CategoryPopover trigger={trigger} popover={popover} />;
}

// Controlled wrapper so a tap inside the popover closes it after the
// action runs — otherwise the popup would float over the just-changed
// HP bars and the player would have to tap-outside to dismiss it.
function CategoryPopover({
  trigger,
  popover,
}: {
  trigger: ReactElement;
  popover: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        side="top"
        align="center"
        className="flex w-72 flex-col gap-2"
        onClick={() => setOpen(false)}
      >
        {popover}
      </PopoverContent>
    </Popover>
  );
}

export function MobileBattleCommands({
  className,
  tiles,
}: {
  className?: string;
  tiles: MobileBattleTile[];
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3",
        className,
      )}
    >
      <PanelLabel>Commands</PanelLabel>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <Fragment key={tile.key}>
            <CategoryButton {...tile} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
