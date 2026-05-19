"use client";

import { MoonIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CommandButton } from "@/components/shared/command-button";
import { LobbyResultFrame } from "@/components/shared/lobby-result-frame";
import type { VictoryInfo } from "@/lib/game/types";

// Lobby middle-column panel for the three "fight ended" states:
// victory (won the fight), flee (ran away), defeat (auto-restored
// after losing). One component instead of three since the only real
// differences are the tone color, header copy, and a couple of
// outcome-specific bits (XP / loot block on victory). Rest button
// at the bottom appears whenever the player has anything to recover
// — fed by `restNeeded` from the caller, which already knows
// whether HP and slots are full.

function lootDisplay(loot: NonNullable<VictoryInfo["loot"]>): {
  name: string;
  detail: string;
} {
  if ("kind" in loot) {
    if (loot.kind === "scroll") {
      return {
        name: `Scroll of ${loot.spellName}`,
        detail: `${loot.damage} ${loot.damageType}`,
      };
    }
    return { name: loot.name, detail: loot.healDice };
  }
  if ("acBase" in loot) {
    // Armor / shield drop: show the AC contribution. Shields add
    // the base +2 inside playerAC; magic shields stack their bonus
    // into acBase, so the visible total is 2 + acBase. Body armor
    // already has its magic bonus baked into acBase by mintArmor.
    const detail =
      loot.category === "shield"
        ? `+${2 + loot.acBase} AC`
        : `AC ${loot.acBase}`;
    return { name: loot.name, detail };
  }
  return { name: loot.name, detail: loot.damage };
}

export type LobbyOutcome =
  | {
      kind: "victory";
      victory: VictoryInfo;
      playerName: string;
      onKeep: () => void;
      onDiscard: () => void;
    }
  | { kind: "flee"; monsterName: string }
  | { kind: "defeat"; defeatedBy: string };

export function LobbyOutcomePanel({
  outcome,
  onRest,
  restDisabled,
  restDisabledReason,
  restNeeded,
  hpDamaged = false,
  slotsSpent = false,
}: {
  outcome: LobbyOutcome;
  onRest: () => void;
  restDisabled: boolean;
  restDisabledReason: string | null;
  restNeeded: boolean;
  // Contextual flags so the suggestion text matches reality. After
  // FULL_HEAL (every 3rd win streak) HP is at max but slots can
  // still be down, in which case the old "You took damage" copy was
  // misleading. Defaults to false so existing call sites that
  // haven't wired these up degrade to the generic phrasing.
  hpDamaged?: boolean;
  slotsSpent?: boolean;
}) {
  const restMessage =
    hpDamaged && slotsSpent
      ? "You took damage and spent spell slots. Rest before your next fight."
      : slotsSpent
        ? "You spent spell slots this fight. Rest before your next fight."
        : hpDamaged
          ? "You took damage in this fight. Rest before your next one."
          : "Take a moment to rest before your next fight.";
  const tone =
    outcome.kind === "victory"
      ? "text-emerald-600"
      : outcome.kind === "defeat"
        ? "text-rose-600"
        : "text-amber-600";
  const title =
    outcome.kind === "victory"
      ? "Victory"
      : outcome.kind === "defeat"
        ? "You Lose"
        : "Escaped";
  const subtitle =
    outcome.kind === "victory"
      ? `${outcome.playerName} defeated ${outcome.victory.monsterName}`
      : outcome.kind === "defeat"
        ? `Defeated by ${outcome.defeatedBy}`
        : `Got away from ${outcome.monsterName}`;

  const loot =
    outcome.kind === "victory" && outcome.victory.loot
      ? lootDisplay(outcome.victory.loot)
      : null;
  const finalLevel =
    outcome.kind === "victory" && outcome.victory.levelsGained.length > 0
      ? outcome.victory.levelsGained[outcome.victory.levelsGained.length - 1]
      : null;

  return (
    <LobbyResultFrame className="gap-3">
      <div className="flex flex-col items-center gap-1 text-center">
        <p
          className={`text-2xl font-bold uppercase tracking-widest ${tone}`}
        >
          {title}
        </p>
        <p className="text-sm">{subtitle}</p>
        {outcome.kind === "victory" ? (
          <p className="text-sm tabular-nums">
            + {outcome.victory.xpGained} XP
          </p>
        ) : null}
        {finalLevel != null ? (
          <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
            Reached level {finalLevel}!
          </p>
        ) : null}
      </div>

      {outcome.kind === "victory" && loot ? (
        <div className="flex flex-col gap-2">
          <p className="text-center text-xs font-bold uppercase tracking-widest">
            Loot
          </p>
          <div className="flex items-center justify-between rounded-md border border-zinc-300 bg-background px-3 py-2 dark:border-zinc-700">
            <span className="text-sm font-bold uppercase tracking-widest">
              {loot.name}
            </span>
            <span className="text-xs tabular-nums">{loot.detail}</span>
          </div>
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              onClick={outcome.onDiscard}
              className="flex-1 justify-center"
            >
              Discard
            </Button>
            <Button
              onClick={outcome.onKeep}
              className="flex-1 justify-center bg-emerald-500 text-foreground hover:bg-emerald-500/90"
            >
              Keep
            </Button>
          </div>
        </div>
      ) : null}

      {restNeeded ? (
        <>
          {/* Separator only when there's a loot block above to
              divide from. Same hairline the lobby command panel
              uses between in-fight and navigation actions, so the
              two-section split reads visually consistent. */}
          {outcome.kind === "victory" && loot ? (
            <div className="my-1 h-px bg-primary" />
          ) : null}
          <p className="text-center text-xs">{restMessage}</p>
          <CommandButton
            kind="heal"
            icon={MoonIcon}
            label="Rest"
            onClick={onRest}
            disabled={restDisabled}
            disabledReason={restDisabledReason}
          />
        </>
      ) : null}
    </LobbyResultFrame>
  );
}
