"use client";

import { useEffect } from "react";
import Link from "next/link";

import { LobbyResultFrame } from "@/components/game/lobby-result-frame";
import {
  aggregateRecaps,
  buildEncounterRecaps,
} from "@/lib/coop/encounter-recap";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";
import { clearPlayerStateCache } from "@/lib/session";

// Final-screen panel for a finished campaign. Mirrors solo's
// VictoryPanel / DefeatPanel feel: emerald celebration on a win,
// rose-tinted "defeat" on a loss. Pulls per-player XP gained + loot
// out of the action log payloads (which the server stamped on each
// kill action) so the recap reads chronologically without needing
// extra schema.
export function CampaignOutcomePanel({
  campaign,
  players,
  actions,
  userId,
}: {
  campaign: Campaign;
  players: CampaignPlayer[];
  actions: CampaignAction[];
  userId: string;
}) {
  const won = campaign.outcome === "won";

  // The home page overlays a localStorage cache on top of the freshly
  // fetched character row (it's how solo persists in-flight state
  // between fights). After a campaign, the DB row is the source of
  // truth — XP, loot, consumables were all persisted server-side — so
  // the local cache is stale and would mask the rewards. Clear it on
  // mount so the home page falls through to the DB.
  const myCharacterId = players.find((p) => p.user_id === userId)
    ?.character_snapshot.id;
  useEffect(() => {
    if (myCharacterId) clearPlayerStateCache(myCharacterId);
  }, [myCharacterId]);

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
            <p className="text-sm text-muted-foreground">
              {won
                ? cumulative.encountersCleared === 1
                  ? "The party cleared the encounter."
                  : `The party cleared ${cumulative.encountersCleared} encounters.`
                : `The party fell to ${campaign.monsters.find((m) => m.health > 0)?.name ?? "the encounter"}.`}
            </p>
            {won && cumulative.totalXpPerPlayer > 0 ? (
              <p className="text-sm tabular-nums text-muted-foreground">
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
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      +{recap.xpPerPlayer} XP
                    </span>
                  </div>
                  {recap.killed.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Defeated: {recap.killed.join(", ")}
                    </p>
                  ) : null}
                  {players.map((p) => {
                    const isMe = p.user_id === userId;
                    const myLoot = recap.lootByPlayer.get(p.id) ?? [];
                    if (myLoot.length === 0) return null;
                    return (
                      <p key={p.id} className="text-xs text-muted-foreground">
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

              <p className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
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
                            <span className="ml-2 text-xs text-muted-foreground">
                              (You)
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs uppercase tracking-widest text-muted-foreground">
                          Lv {p.character_snapshot.level}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {myLoot.length > 0
                          ? `Loot: ${myLoot.join(", ")}`
                          : "No drops this run."}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <Link
            href="/"
            className="inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Back to home
          </Link>
        </LobbyResultFrame>
      </div>
    </main>
  );
}
