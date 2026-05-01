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
        "flex items-center gap-2 rounded-md px-3 py-1.5 font-mono text-sm font-semibold",
        turn.kind === "levelup"
          ? "border-2 border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
          : turn.kind === "loot"
            ? "border-2 border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
            : turn.kind === "crit"
              ? "border-2 border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
              : turn.kind === "win"
                ? "border-2 border-emerald-500 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                : turn.kind === "loss"
                  ? "border-2 border-rose-500 bg-rose-100 text-rose-900 dark:bg-rose-950/50 dark:text-rose-100"
                  : turn.kind === "encounter"
                    ? "border-2 border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                    : turn.isPlayer
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                      : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <span>{turn.text}</span>
    </li>
  );
}
