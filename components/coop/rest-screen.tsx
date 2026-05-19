"use client";

import { useEffect, useState } from "react";

import { HealthBar } from "@/components/shared/health-bar";
import { LobbyResultFrame } from "@/components/shared/lobby-result-frame";
import { PanelLabel } from "@/components/shared/panel-label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { readApiError } from "@/lib/coop/api-error";
import {
  aggregateRecaps,
  buildEncounterRecaps,
} from "@/lib/coop/encounter-recap";
import { MAX_LEVEL, xpProgressInLevel } from "@/lib/dnd/leveling";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";

// Between-encounters rest screen. Shows after a fight ends in
// victory; the party is revived to full HP server-side and the player
// chooses whether to chain into another fight or bank rewards and
// end the campaign.
//
// The screen only summarizes the encounter that JUST ended (filter
// actions by encounter_number === campaign.encounter_number); the
// campaign-wide outcome panel handles totals across all fights.
export function RestScreen({
  campaign,
  players,
  actions,
  userId,
  onContinue,
}: {
  campaign: Campaign;
  players: CampaignPlayer[];
  actions: CampaignAction[];
  userId: string;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fold any banked XP into actual level-ups before the rest screen
  // settles. Idempotent on the server, so each viewer can fire it
  // without coordination — the broadcast on success refetches every
  // open client. Backfill for campaigns whose earlier kills predate
  // the per-kill leveling path in the action route.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/campaign/${campaign.id}/level-up`, {
          method: "POST",
        });
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { leveled?: boolean };
        if (data.leveled) onContinue();
      } catch {
        // Best-effort. The action route's per-kill leveling and the
        // next-encounter restoration cover the steady state; missing
        // this one call just means a stuck level still shows here.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaign.id, onContinue]);

  // Build the same recap shape the final outcome panel uses, then
  // pluck out *this* encounter for the per-fight detail and aggregate
  // across all of them for the running campaign-so-far totals.
  const recaps = buildEncounterRecaps(actions);
  const thisRecap = recaps.find(
    (r) => r.encounterNumber === campaign.encounter_number,
  );
  const cumulative = aggregateRecaps(recaps);
  const lootByPlayer = thisRecap?.lootByPlayer ?? new Map<string, string[]>();
  const totalXp = thisRecap?.xpPerPlayer ?? 0;

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/campaign/${campaign.id}/next-encounter`,
        { method: "POST" },
      );
      if (!res.ok) {
        setError(
          await readApiError(
            res,
            "Couldn't start the next encounter. Try again.",
          ),
        );
        return;
      }
      onContinue();
    } catch {
      setError("Network hiccup. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaign/${campaign.id}/end-campaign`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(
          await readApiError(res, "Couldn't end the campaign. Try again."),
        );
        return;
      }
      onContinue();
    } catch {
      setError("Network hiccup. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <LobbyResultFrame className="gap-4">
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="text-2xl font-bold uppercase tracking-widest text-emerald-600">
              Encounter {campaign.encounter_number} cleared
            </p>
            <p className="text-sm uppercase tracking-widest">
              The party rests
            </p>
          </div>

          <div className="relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3 font-mono">
            <PanelLabel>Party</PanelLabel>
            <div className="flex flex-col gap-2 pt-2">
              {players.map((p) => {
                const isMe = p.user_id === userId;
                const snap = p.character_snapshot;
                const max = snap.max_hp;
                const lootList = lootByPlayer.get(p.id) ?? [];
                const atMaxLevel = snap.level >= MAX_LEVEL;
                const xpProgress = xpProgressInLevel(snap.xp, snap.level);
                const xpLabel = atMaxLevel
                  ? "MAX"
                  : `${xpProgress.inLevel}/${xpProgress.needed} XP`;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border border-muted-foreground/20 px-3 py-2",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-bold uppercase tracking-widest">
                        {snap.name}
                        {isMe ? (
                          <span className="ml-2 text-xs">
                            (You)
                          </span>
                        ) : null}
                        <span className="ml-2 text-xs text-muted-foreground">
                          · Lv {snap.level}
                        </span>
                      </span>
                      <span className="font-mono text-xs tabular-nums">
                        {max}/{max}
                      </span>
                    </div>
                    <HealthBar current={max} max={max} className="h-2" />
                    <div className="flex text-xs uppercase tracking-widest tabular-nums">
                      <span>{xpLabel}</span>
                    </div>
                    {lootList.length > 0 ? (
                      <p className="text-xs">
                        Loot: {lootList.join(", ")}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-center font-mono text-sm">
            <span className="font-bold">+{totalXp} XP</span>
            <span className=""> per player this fight</span>
          </p>

          {cumulative.encountersCleared > 1 ? (
            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-background/50 px-3 py-2 text-center font-mono text-xs">
              Campaign so far —{" "}
              <span className="font-bold text-foreground">
                {cumulative.encountersCleared} cleared
              </span>
              {", "}
              <span className="font-bold text-foreground">
                +{cumulative.totalXpPerPlayer} XP
              </span>{" "}
              banked per player
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              onClick={next}
              disabled={busy}
              className="bg-emerald-500 text-foreground hover:bg-emerald-500/90"
            >
              {busy ? "Loading…" : `Encounter ${campaign.encounter_number + 1}`}
            </Button>
            <Button onClick={end} disabled={busy}>
              End Campaign
            </Button>
            {error ? (
              <p className="text-center text-sm text-rose-600">{error}</p>
            ) : null}
          </div>
        </LobbyResultFrame>
      </div>
    </main>
  );
}
