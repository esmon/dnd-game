"use client";

import { useState } from "react";
import Link from "next/link";

import { LobbyResultFrame } from "@/components/shared/lobby-result-frame";
import { Button, buttonVariants } from "@/components/ui/button";
import { readApiError } from "@/lib/coop/api-error";
import {
  aggregateRecaps,
  buildEncounterRecaps,
} from "@/lib/coop/encounter-recap";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";
import { cn } from "@/lib/utils";

// Final-screen panel for a finished campaign. Mirrors solo's
// VictoryPanel / DefeatPanel feel: emerald celebration on a win,
// rose-tinted "defeat" on a loss. Pulls per-player XP gained + loot
// out of the action log payloads (which the server stamped on each
// kill action) so the recap reads chronologically without needing
// extra schema.
//
// On defeat, also runs a mutual ready-check: each player has their
// own "Play Again" vote (continue_ready on the player row). When
// both voted ready, /continue rerolls the encounter and flips the
// campaign back to active. Until then, the UI shows whose vote we're
// waiting on so neither player wonders if their click registered.
export function CampaignOutcomePanel({
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
  const won = campaign.outcome === "won";

  // Per-encounter recap from the action log + a campaign-wide rollup.
  // Each kill action carries killed_monster_name + xp_awarded + loot,
  // stamped with the encounter number it happened in.
  const recaps = buildEncounterRecaps(actions);
  const cumulative = aggregateRecaps(recaps);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-xl">
        <LobbyResultFrame className="gap-4">
          <div className="flex flex-col items-center gap-1 text-center">
            <p
              className={
                won
                  ? "text-2xl font-bold uppercase tracking-widest text-emerald-600"
                  : "text-2xl font-bold uppercase tracking-widest text-rose-600"
              }
            >
              {won ? "Victory" : "Defeat"}
            </p>
            <p className="text-sm">
              {won
                ? cumulative.encountersCleared === 1
                  ? "The party cleared the encounter."
                  : `The party cleared ${cumulative.encountersCleared} encounters.`
                : `The party fell to ${campaign.monsters.find((m) => m.health > 0)?.name ?? "the encounter"}.`}
            </p>
            {won && cumulative.totalXpPerPlayer > 0 ? (
              <p className="text-sm tabular-nums">
                + {cumulative.totalXpPerPlayer} XP banked per player
              </p>
            ) : null}
          </div>

          {won ? (
            <div className="flex flex-col gap-3">
              {recaps.map((recap) => (
                <div
                  key={recap.encounterNumber}
                  className="flex flex-col gap-2 rounded-md border border-zinc-300 bg-background px-3 py-2 text-sm dark:border-zinc-700"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold uppercase tracking-widest">
                      Encounter {recap.encounterNumber}
                    </span>
                    <span className="font-mono text-xs tabular-nums">
                      +{recap.xpPerPlayer} XP
                    </span>
                  </div>
                  {recap.killed.length > 0 ? (
                    <p className="text-xs">
                      Defeated: {recap.killed.join(", ")}
                    </p>
                  ) : null}
                  {players.map((p) => {
                    const isMe = p.user_id === userId;
                    const myLoot = recap.lootByPlayer.get(p.id) ?? [];
                    if (myLoot.length === 0) return null;
                    return (
                      <p key={p.id} className="text-xs">
                        <span className="font-bold text-foreground">
                          {p.character_snapshot.name}
                          {isMe ? " (You)" : ""}
                        </span>
                        : {myLoot.join(", ")}
                      </p>
                    );
                  })}
                </div>
              ))}

              <p className="text-center text-xs font-bold uppercase tracking-widest">
                Party
              </p>
              <ul className="flex flex-col gap-2">
                {players.map((p) => {
                  const isMe = p.user_id === userId;
                  const myLoot =
                    cumulative.totalLootByPlayer.get(p.id) ?? [];
                  return (
                    <li
                      key={p.id}
                      className="flex flex-col gap-1 rounded-md border border-zinc-300 bg-background px-3 py-2 text-sm dark:border-zinc-700"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="font-bold uppercase tracking-widest">
                          {p.character_snapshot.name}
                          {isMe ? (
                            <span className="ml-2 text-xs">
                              (You)
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs uppercase tracking-widest">
                          Lv {p.character_snapshot.level}
                        </span>
                      </div>
                      <p className="text-xs">
                        {myLoot.length > 0
                          ? `Loot: ${myLoot.join(", ")}`
                          : "No drops this run."}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <PlayAgainBlock
              campaignId={campaign.id}
              players={players}
              userId={userId}
              onContinue={onContinue}
            />
          )}

          <Link href="/" className={cn(buttonVariants(), "w-full")}>
            Back to home
          </Link>
        </LobbyResultFrame>
      </div>
    </main>
  );
}

// Mutual ready-check on defeat. Each player has a "Play Again" button
// that flips their continue_ready flag; when every member has voted,
// the same /continue call resets the run and broadcasts the flip
// back to active.
function PlayAgainBlock({
  campaignId,
  players,
  userId,
  onContinue,
}: {
  campaignId: string;
  players: CampaignPlayer[];
  userId: string;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = players.find((p) => p.user_id === userId);
  const myReady = !!me?.continue_ready;
  const others = players.filter((p) => p.user_id !== userId);
  const waitingOn = others.filter((p) => !p.continue_ready);

  async function vote() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaign/${campaignId}/continue`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(
          await readApiError(res, "Couldn't record your vote. Try again."),
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

  const buttonLabel = !myReady
    ? "Play Again"
    : waitingOn.length > 0
      ? `Waiting for ${waitingOn
          .map((p) => p.character_snapshot.name)
          .join(", ")}…`
      : "Restarting…";

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {players.map((p) => {
          const isMe = p.user_id === userId;
          return (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-md border border-zinc-300 bg-background px-3 py-2 text-sm dark:border-zinc-700"
            >
              <span className="font-bold uppercase tracking-widest">
                {p.character_snapshot.name}
                {isMe ? <span className="ml-2 text-xs">(You)</span> : null}
              </span>
              <span
                className={cn(
                  "font-mono text-xs uppercase tracking-widest",
                  p.continue_ready
                    ? "text-emerald-600"
                    : "text-muted-foreground",
                )}
              >
                {p.continue_ready ? "Ready" : "Pending"}
              </span>
            </li>
          );
        })}
      </ul>
      <Button
        onClick={vote}
        disabled={busy || myReady}
        className="w-full"
      >
        {buttonLabel}
      </Button>
      {error ? (
        <p className="text-center text-sm text-rose-600">{error}</p>
      ) : null}
    </div>
  );
}
