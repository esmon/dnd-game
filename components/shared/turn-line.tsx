import {
  AlertTriangleIcon,
  ChevronsUpIcon,
  FlaskConicalIcon,
  FootprintsIcon,
  GiftIcon,
  HeartIcon,
  ScrollTextIcon,
  SkullIcon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
  TrophyIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { Turn, TurnAction } from "@/lib/game/types";

// Match the CommandButton's per-action icon so a log entry visually
// echoes the button that produced it. Same icons; row colors follow
// `turn.kind` (highlight) and `turn.isPlayer` (default tint), not
// the action — keeps the existing palette intact.
const ACTION_ICON: Record<TurnAction, LucideIcon> = {
  attack: SwordIcon,
  spell: SparklesIcon,
  scroll: ScrollTextIcon,
  smite: SunIcon,
  heal: HeartIcon,
  potion: FlaskConicalIcon,
  skip: FootprintsIcon,
};

// Event-style entries (no combat verb) get an icon from kind so the
// row reads as "this is a level-up / loot drop / encounter / win"
// at a glance. Replaces the old "LEVEL UP — " / "LOOT — " text
// prefixes — the icon does the same job with less visual noise.
const KIND_ICON: Partial<Record<NonNullable<Turn["kind"]>, LucideIcon>> = {
  levelup: ChevronsUpIcon,
  loot: GiftIcon,
  win: TrophyIcon,
  loss: SkullIcon,
  encounter: AlertTriangleIcon,
};

// Single combat-log entry. Color comes from `turn.kind`; falls back
// to blue (player) / red (monster) for plain attacks. Icon prefers
// action (combat verb) over kind (event marker). Used by CombatLog
// and MobileCombatLog so the two stay visually identical.
export function TurnLine({ turn }: { turn: Turn }) {
  const Icon = turn.action
    ? ACTION_ICON[turn.action]
    : turn.kind
      ? (KIND_ICON[turn.kind] ?? null)
      : null;
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-md border-2 border-border bg-muted/60 px-3 py-1.5 font-mono text-sm",
        // Monochrome — icons + weight do the categorization. Crit
        // stays bold so the gold moments still pop without leaning
        // on color.
        turn.kind === "crit" ? "font-bold" : "font-semibold",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <span>{turn.text}</span>
    </li>
  );
}
