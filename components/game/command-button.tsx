"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DisabledTip } from "@/components/game/disabled-tip";
import { cn } from "@/lib/utils";

// Visual category for a command. Drives color, variant, and (for `dev`) size.
// Add a kind here when you need a new color, not when you need a new label.
export type CommandKind =
  | "weapon" // red — physical attack
  | "smite" // amber — divine smite
  | "spell" // indigo — spellcast
  | "scroll" // gray — one-shot scroll
  | "potion" // rose — heal consumable
  | "primary" // emerald — forward action (FIGHT, HEAL, Play Again)
  | "neutral" // outline — utility (REST, INVENTORY, RUN AWAY, navigation)
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
  scroll: { variant: "secondary", className: "" },
  potion: {
    className: "bg-rose-300 text-rose-950 hover:bg-rose-300/80",
  },
  primary: {
    className: "bg-emerald-500 text-white hover:bg-emerald-500/90",
  },
  neutral: { variant: "outline", className: "" },
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
  // Both layouts share a single flex-row button so the icon stays vertically
  // centered. With a subtitle, the label and subtitle stack inside a flex-col
  // text column to the right of the icon — so they share the same left edge.
  const layoutClass = subtitle
    ? "h-auto justify-start py-1.5 text-left leading-tight"
    : "justify-start";

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
