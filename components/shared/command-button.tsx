"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DisabledTip } from "@/components/shared/disabled-tip";
import { cn } from "@/lib/utils";

// Visual category for a command. Drives color, variant, and (for `dev`) size.
// Add a kind here when you need a new color, not when you need a new label.
export type CommandKind =
  | "weapon" // red — physical attack
  | "smite" // amber — divine smite
  | "spell" // indigo — spellcast
  | "scroll" // amber-200 — parchment scroll
  | "potion" // rose — heal consumable
  | "heal" // teal — self-heal action (HEAL)
  | "primary" // emerald — forward action (FIGHT, Play Again, Start Campaign)
  | "danger" // red-600 — panic / escape (Run Away, Forfeit)
  | "neutral" // outline — utility (REST, INVENTORY, navigation)
  | "dev"; // outline + small + muted — dev-only shortcuts

type Variant = "default" | "outline" | "secondary" | "destructive";
type Size = "default" | "sm";

const KIND_STYLE: Record<
  CommandKind,
  { variant?: Variant; size?: Size; className: string }
> = {
  weapon: { variant: "destructive", className: "" },
  smite: {
    className: "bg-amber-500 text-white hover:bg-amber-500/90",
  },
  spell: {
    className: "bg-indigo-600 text-white hover:bg-indigo-600/90",
  },
  scroll: {
    className: "bg-amber-200 text-amber-950 hover:bg-amber-200/80",
  },
  potion: {
    className: "bg-rose-300 text-rose-950 hover:bg-rose-300/80",
  },
  heal: {
    className: "bg-teal-400 text-foreground hover:bg-teal-400/90",
  },
  primary: {
    className: "bg-action text-action-foreground hover:bg-action/90",
  },
  danger: {
    className: "bg-red-600 text-white hover:bg-red-600/90",
  },
  neutral: { className: "" },
  dev: { variant: "outline", size: "sm", className: "text-xs opacity-60" },
};

export type CommandButtonProps = {
  kind: CommandKind;
  icon?: LucideIcon;
  label: ReactNode;
  subtitle?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string | null;
  // When true, the panel hides this button instead of rendering it
  // disabled. Use for state-disabled actions (already at full HP, no
  // living targets) where the button conveys no useful info while
  // unavailable. Resource-disabled buttons (out of slots, not your
  // turn) should stay visible so the player can see what they have.
  hideWhenDisabled?: boolean;
};

export function CommandButton({
  kind,
  icon: Icon,
  label,
  subtitle,
  onClick,
  disabled,
  disabledReason = null,
}: CommandButtonProps) {
  const { variant, size, className } = KIND_STYLE[kind];
  // Single layout for every command button so the panel reads as a
  // uniform stack — without min-h, label-only buttons (HEAL, Skip Turn,
  // REST) collapse to ~32px while subtitled ones balloon to ~50px.
  // Both share the icon position; the label/subtitle column just adds
  // a second line when a subtitle is present.
  const layoutClass =
    "h-auto min-h-12 justify-start py-1.5 text-left leading-tight";

  const button = (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full", className, layoutClass)}
    >
      {Icon ? <Icon className="size-5 shrink-0" /> : null}
      {subtitle ? (
        <span className="flex min-w-0 flex-col items-start gap-0">
          <span className="truncate">{label}</span>
          <span className="text-xs opacity-70">{subtitle}</span>
        </span>
      ) : (
        label
      )}
    </Button>
  );

  return <DisabledTip reason={disabledReason}>{button}</DisabledTip>;
}
