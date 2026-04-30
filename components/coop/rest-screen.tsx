"use client";

import { useState } from "react";

import { HealthBar } from "@/components/game/health-bar";
import { LobbyResultFrame } from "@/components/game/lobby-result-frame";
import { PanelLabel } from "@/components/game/panel-label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

  // Per-encounter recap: walk the actions stamped with this encounter,
  // sum xp_awarded and collect loot per killer. Same shape the outcome
  // panel uses, just scoped to one fight.
  const encounterActions = actions.filter(
    (a) => a.encounter_number === campaign.encounter_number,
  );
  const lootByPlayer = new Map<string, string[]>();
  let totalXp = 0;
  for (const action of encounterActions) {
    const payload = action.payload as Record<string, unknown>;
    if (
      payload.killed_monster_index === undefined ||
      payload.killed_monster_index === null
    ) {
      continue;
    }
    totalXp += (payload.xp_awarded as number) ?? 0;
    const loot = payload.loot as { name: string; kind: string } | null;
    if (loot && action.actor_player_id) {
      const list = lootByPlayer.get(action.actor_player_id) ?? [];
      list.push(loot.name);
      lootByPlayer.set(action.actor_player_id, list);
    }
  }

  async function next() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/campaign/${campaign.id}/next-encounter`,
        { method: "POST" },
      );
      if (!res.ok) {
        const text = await res.text();
        setError(`Failed to start next encounter (${res.status}): ${text}`);
        return;
      }
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        const text = await res.text();
        setError(`Failed to end campaign (${res.status}): ${text}`);
        return;
      }
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
            <p className="text-sm uppercase tracking-widest text-muted-foreground">
              The party rests
            </p>
          </div>

          <div className="relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3 font-mono">
            <PanelLabel>Party</PanelLabel>
            <div className="flex flex-col gap-2 pt-2">
              {players.map((p) => {
                const isMe = p.user_id === userId;
                const max = p.character_snapshot.max_hp;
                const lootList = lootByPlayer.get(p.id) ?? [];
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex flex-col gap-1 rounded-md border border-muted-foreground/20 px-3 py-2",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-bold uppercase tracking-widest">
                        {p.character_snapshot.name}
                        {isMe ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (You)
                          </span>
                        ) : null}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {max}/{max}
                      </span>
                    </div>
                    <HealthBar current={max} max={max} className="h-2" />
                    {lootList.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
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
            <span className="text-muted-foreground"> per player</span>
          </p>

          <div className="flex flex-col gap-2">
            <Button
              onClick={next}
              disabled={busy}
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
            >
              {busy ? "Loading…" : `Encounter ${campaign.encounter_number + 1}`}
            </Button>
            <Button onClick={end} disabled={busy} variant="outline">
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
