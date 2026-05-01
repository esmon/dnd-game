import {
  FlaskConicalIcon,
  FootprintsIcon,
  HeartIcon,
  ScrollTextIcon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
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

// Single combat-log entry. Color and prefix come from `turn.kind`; falls back
// to blue (player) / red (monster) for plain attacks. Used by CombatLog and
// MobileCombatLog so the two stay visually identical.
export function TurnLine({ turn }: { turn: Turn }) {
  const Icon = turn.action ? ACTION_ICON[turn.action] : null;
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
              : turn.isPlayer
                ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
      )}
    >
      {Icon ? <Icon className="size-4 shrink-0" /> : null}
      <span>
        {turn.kind === "levelup"
          ? `LEVEL UP — ${turn.text}`
          : turn.kind === "loot"
            ? `LOOT — ${turn.text}`
            : turn.text}
      </span>
    </li>
  );
}
