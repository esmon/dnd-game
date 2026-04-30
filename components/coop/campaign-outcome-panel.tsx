"use client";

import { useEffect } from "react";
import Link from "next/link";

import { LobbyResultFrame } from "@/components/game/lobby-result-frame";
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

  // Per-player tallies from the action log. Walk every action; on
  // kills, the server stamped killed_monster_index + xp_awarded +
  // loot. XP went to every player alive at the moment of the kill
  // (server-side determination), but the action row itself doesn't
  // record that — for the recap we just show the snapshot's final
  // xp delta vs the original character (server already did the math
  // when it persisted to characters).
  const lootByPlayer = new Map<string, string[]>();
  let totalXp = 0;
  for (const action of actions) {
    const payload = action.payload as Record<string, unknown>;
    if (!payload.killed_monster_index && payload.killed_monster_index !== 0) {
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
                ? `The party defeated ${campaign.monsters.length === 1 ? "the monster" : "all the monsters"}.`
                : `The party fell to ${campaign.monsters.find((m) => m.health > 0)?.name ?? "the encounter"}.`}
            </p>
            {won && totalXp > 0 ? (
              <p className="text-sm tabular-nums text-muted-foreground">
                + {totalXp} XP earned across the party
              </p>
            ) : null}
          </div>

          {won ? (
            <div className="flex flex-col gap-2">
              <p className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Party
              </p>
              <ul className="flex flex-col gap-2">
                {players.map((p) => {
                  const isMe = p.user_id === userId;
                  const myLoot = lootByPlayer.get(p.id) ?? [];
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
                      {myLoot.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Loot: {myLoot.join(", ")}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No drops this fight.
                        </p>
                      )}
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
