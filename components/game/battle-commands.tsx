"use client";

import type { LucideIcon } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DisabledTip } from "@/components/game/disabled-tip";
import { PanelLabel } from "@/components/game/panel-label";
import { cn } from "@/lib/utils";

// Dragon-Warrior style 2x2 battle panel. Caller supplies the four
// tile specs so the same component serves solo (Attack / Spell /
// Inventory / Run Away) and coop (Attack / Spell / Skip / Forfeit) —
// only the third and fourth tiles change. Each tile is either a
// popover (Attack/Spell/Inventory) or a direct action (Run Away/Skip
// /Forfeit). Used at every viewport — replaces the flat command list
// for in-fight panels.

// All tiles render with the same default Button styling (black bg /
// white text in light mode). The icon + label do the categorization;
// color was a distraction, especially with four tiles next to each
// other. `kind` is kept on the type for callers who still want to
// describe what each tile is.
export type BattleTileKind = "attack" | "spell" | "neutral" | "danger";

export type BattleTile = {
  key: string;
  kind: BattleTileKind;
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
  icon: Icon,
  label,
  disabled = false,
  disabledReason = null,
  onClick,
  popover,
}: Omit<BattleTile, "key" | "kind">) {
  const trigger = (
    <Button
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-h-12 w-full justify-start py-1.5 text-left leading-tight"
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
        // Cap to viewport so a long Spells / Inventory list scrolls
        // inside the popover instead of bleeding past the top of the
        // browser. base-ui's positioner exposes --available-height
        // as the safe space on the chosen side; min() with 80vh as a
        // fallback for older browsers / cases where the var is
        // unset.
        className="flex w-72 flex-col gap-2 overflow-y-auto max-h-[min(80vh,var(--available-height,80vh))]"
        onClick={() => setOpen(false)}
      >
        {popover}
      </PopoverContent>
    </Popover>
  );
}

export function BattleCommands({
  className,
  tiles,
}: {
  className?: string;
  tiles: BattleTile[];
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3",
        className,
      )}
    >
      <PanelLabel>Commands</PanelLabel>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-1">
        {tiles.map(({ key, ...rest }) => (
          <CategoryButton key={key} {...rest} />
        ))}
      </div>
    </div>
  );
}
