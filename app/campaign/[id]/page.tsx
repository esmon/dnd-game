"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CampaignBattle } from "@/components/coop/campaign-battle";
import { CampaignOutcomePanel } from "@/components/coop/campaign-outcome-panel";
import { RestScreen } from "@/components/coop/rest-screen";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { CharacterPickerDialog } from "@/components/game/character-picker-dialog";
import { useUser } from "@/lib/auth/use-user";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";
import { getActiveCharacterId } from "@/lib/session";

const MAX_PLAYERS = 6;
// Mirrors MIN_PLAYERS_TO_START on the start route. Hard-coded copy
// gate; the server is still the source of truth.
const MIN_PLAYERS_TO_START = 2;

type Snapshot = {
  campaign: Campaign;
  players: CampaignPlayer[];
  actions: CampaignAction[];
};
type LoadState =
  | { kind: "loading" }
  | { kind: "needs-join" }
  | { kind: "ready"; data: Snapshot }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

// Lobby + status-mirror page for a campaign. While `waiting`, polls
// every few seconds to pick up the second player joining; once `active`,
// shows a placeholder for the not-yet-built combat view (M3).
//
// Auth-gated: signed-in users only. If a non-member opens the link we
// show a "Join with your active character" prompt rather than auto-
// joining, so the user can pick the right character on the home page
// first if they want.
export default function CampaignLobbyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: campaignId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useUser();

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [refreshTick, setRefreshTick] = useState(0);
  // Two flags coordinate the active→finished swap:
  //   - seenActive: did this mount ever observe an active fight? If
  //     not, the user reloaded into a finished campaign and should go
  //     straight to the outcome panel — no point replaying.
  //   - actionsRevealed: has CampaignBattle finished pacing the final
  //     swing in? Until it has, keep rendering the battle so the
  //     killing blow's shake/log line gets to play.
  const [seenActive, setSeenActive] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);

  // Send signed-out users through sign-in, returning here after.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const next = encodeURIComponent(`/campaign/${campaignId}`);
      router.replace(`/auth/sign-in?next=${next}`);
    }
  }, [authLoading, user, campaignId, router]);

  const fetchSnapshot = useCallback(async () => {
    if (authLoading || !user) return;
    try {
      const res = await fetch(`/api/campaign/${campaignId}`);
      if (res.status === 403) {
        setState({ kind: "needs-join" });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "not-found" });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Failed to load (${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as Snapshot;
      setState({ kind: "ready", data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [authLoading, user, campaignId]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot, refreshTick]);

  // Latch seenActive the moment we observe an active fight, so a later
  // status flip to "finished" or "between_encounters" routes through
  // the battle screen long enough for CampaignBattle to play out the
  // killing blow.
  useEffect(() => {
    if (state.kind === "ready" && state.data.campaign.status === "active") {
      setSeenActive(true);
    }
  }, [state]);

  // Each time a fresh encounter spins up the campaign re-enters
  // "active" — wipe the actionsRevealed gate so the next encounter's
  // killing blow can latch it again. The initial active flip from
  // start/route benefits from this too: actionsRevealed defaults to
  // false on mount, this just keeps it in sync across encounters.
  const activeEncounterKey =
    state.kind === "ready" && state.data.campaign.status === "active"
      ? state.data.campaign.encounter_number
      : null;
  useEffect(() => {
    if (activeEncounterKey !== null) setActionsRevealed(false);
  }, [activeEncounterKey]);

  // Subscribe to the campaign's Realtime broadcast channel so any
  // teammate's mutating route (action, join, ready, start, next /
  // end encounter, forfeit) refetches us in <100ms instead of the
  // poll cadence. The polling below is now a slow safety net for
  // missed broadcasts (websocket hiccups, channel auth quirks).
  useEffect(() => {
    if (state.kind !== "ready") return;
    const status = state.data.campaign.status;
    if (
      status !== "waiting" &&
      status !== "active" &&
      status !== "between_encounters"
    ) {
      return;
    }
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`campaign:${campaignId}`)
      .on("broadcast", { event: "updated" }, () => {
        setRefreshTick((t) => t + 1);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [campaignId, state]);

  // Slow polling fallback while the campaign is in motion. Cadence is
  // intentionally relaxed (the broadcast above does the heavy lifting);
  // this just guarantees we converge after a missed message.
  useEffect(() => {
    if (state.kind !== "ready") return;
    const status = state.data.campaign.status;
    if (
      status !== "waiting" &&
      status !== "active" &&
      status !== "between_encounters"
    ) {
      return;
    }
    const intervalMs = status === "active" ? 5000 : 10000;
    const interval = setInterval(
      () => setRefreshTick((t) => t + 1),
      intervalMs,
    );
    return () => clearInterval(interval);
  }, [state]);

  if (authLoading || state.kind === "loading") {
    return <CenteredCard>Loading campaign…</CenteredCard>;
  }

  if (!user) {
    // Redirect already in flight.
    return <CenteredCard>Redirecting…</CenteredCard>;
  }

  if (state.kind === "not-found") {
    return (
      <CenteredCard>
        <p>Campaign not found.</p>
        <Link href="/" className="font-bold underline">
          Back to home
        </Link>
      </CenteredCard>
    );
  }

  if (state.kind === "error") {
    return (
      <CenteredCard>
        <p className="text-rose-600">Error: {state.message}</p>
        <Button onClick={() => setRefreshTick((t) => t + 1)}>
          Retry
        </Button>
      </CenteredCard>
    );
  }

  if (state.kind === "needs-join") {
    return (
      <JoinPrompt
        campaignId={campaignId}
        onJoined={() => setRefreshTick((t) => t + 1)}
      />
    );
  }

  const { campaign, players, actions } = state.data;
  const isCreator = campaign.created_by === user.id;

  if (campaign.status === "waiting") {
    return (
      <Lobby
        campaignId={campaignId}
        campaign={campaign}
        players={players}
        userId={user.id}
        isCreator={isCreator}
        onChanged={() => setRefreshTick((t) => t + 1)}
        onStarted={() => setRefreshTick((t) => t + 1)}
      />
    );
  }

  // Keep the battle mounted while an encounter has ended but the
  // killing blow hasn't finished revealing — applies to both the
  // between-encounters rest screen and the final outcome panel. If
  // the user reloaded straight into an ended state (seenActive never
  // latched), skip the reveal and show the destination panel.
  const isEncounterOver =
    campaign.status === "finished" ||
    campaign.status === "between_encounters";
  const showBattle =
    campaign.status === "active" ||
    (isEncounterOver && seenActive && !actionsRevealed);

  if (showBattle) {
    return (
      <CampaignBattle
        campaign={campaign}
        players={players}
        actions={actions}
        userId={user.id}
        onActionComplete={() => setRefreshTick((t) => t + 1)}
        onAllActionsRevealed={() => setActionsRevealed(true)}
      />
    );
  }

  if (campaign.status === "between_encounters") {
    return (
      <RestScreen
        campaign={campaign}
        players={players}
        actions={actions}
        userId={user.id}
        onContinue={() => setRefreshTick((t) => t + 1)}
      />
    );
  }

  // Finished — show the outcome recap (XP + loot per player on win).
  return (
    <CampaignOutcomePanel
      campaign={campaign}
      players={players}
      actions={actions}
      userId={user.id}
    />
  );
}

function Lobby({
  campaignId,
  campaign,
  players,
  userId,
  isCreator,
  onChanged,
  onStarted,
}: {
  campaignId: string;
  campaign: Campaign;
  players: CampaignPlayer[];
  userId: string;
  isCreator: boolean;
  onChanged: () => void;
  onStarted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [togglingReady, setTogglingReady] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/campaign/${campaignId}`
      : "";

  const slotsFilled = players.length;
  const myPlayer = players.find((p) => p.user_id === userId);
  const allJoinersReady = players
    .filter((p) => p.user_id !== campaign.created_by)
    .every((p) => p.is_ready);
  const canStart = isCreator && slotsFilled >= 2 && allJoinersReady;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / iframe contexts may block clipboard. The
      // input below is selectable as a fallback.
    }
  }

  // Ready is one-way — once a joiner commits, they stay ready. The only
  // way out is to change characters (which the PATCH handler resets the
  // flag for). This avoids ready-spam right before the creator starts.
  async function markReady() {
    if (!myPlayer || myPlayer.is_ready) return;
    setTogglingReady(true);
    try {
      const res = await fetch(`/api/campaign/${campaignId}/player`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ready: true }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("mark ready failed", res.status, text);
        return;
      }
      onChanged();
    } catch (err) {
      console.error("mark ready threw", err);
    } finally {
      setTogglingReady(false);
    }
  }

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/campaign/${campaignId}/start`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text();
        setStartError(`Failed to start (${res.status}): ${text}`);
        return;
      }
      onStarted();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-start justify-center p-6">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-center font-mono text-2xl font-bold uppercase tracking-widest md:text-3xl">
          Campaign Lobby
        </h1>

        {isCreator ? (
          <div className="relative flex flex-col gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 font-mono">
            <p className="text-sm text-muted-foreground">
              Share this link with a friend. They'll need to be signed in to
              join.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteUrl}
                className="flex-1 rounded-md border border-zinc-300 bg-background px-3 py-2 text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button onClick={copyInvite}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 font-mono">
          <p className="text-sm font-bold uppercase tracking-widest">
            Players ({slotsFilled}/{MAX_PLAYERS})
          </p>
          <ul className="flex flex-col gap-2">
            {players.map((p) => {
              const isMe = p.user_id === userId;
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                >
                  <div className="flex flex-1 flex-col">
                    <span className="font-bold">
                      {p.character_snapshot.name}
                      {isMe ? (
                        <span className="ml-2 text-xs uppercase tracking-widest text-muted-foreground">
                          (You)
                        </span>
                      ) : null}
                      {p.user_id !== campaign.created_by && p.is_ready ? (
                        <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-700">
                          Ready
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      {p.character_snapshot.race} ·{" "}
                      {p.character_snapshot.class} · Lv{" "}
                      {p.character_snapshot.level}
                    </span>
                  </div>
                  {isMe ? (
                    <Button onClick={() => setPickerOpen(true)}>
                      Change
                    </Button>
                  ) : null}
                </li>
              );
            })}
            {Array.from({ length: MAX_PLAYERS - slotsFilled }).map((_, i) => (
              <li
                key={`empty-${i}`}
                className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm text-muted-foreground"
              >
                Waiting for a player…
              </li>
            ))}
          </ul>
        </div>

        {isCreator ? (
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleStart}
              disabled={!canStart || starting}
              className="bg-emerald-500 text-foreground hover:bg-emerald-500/90"
            >
              {starting ? "Starting…" : "Start Campaign"}
            </Button>
            {slotsFilled < MIN_PLAYERS_TO_START ? (
              <p className="text-center text-xs text-muted-foreground">
                Need {MIN_PLAYERS_TO_START - slotsFilled} more player
                {MIN_PLAYERS_TO_START - slotsFilled === 1 ? "" : "s"} before
                you can start.
              </p>
            ) : !allJoinersReady ? (
              <p className="text-center text-xs text-muted-foreground">
                Waiting for other players to ready up…
              </p>
            ) : null}
            {startError ? (
              <p className="text-center text-sm text-rose-600">{startError}</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              onClick={markReady}
              disabled={togglingReady || !myPlayer || myPlayer.is_ready}
              className={
                myPlayer?.is_ready
                  ? "bg-emerald-500 text-foreground hover:bg-emerald-500/90"
                  : ""
              }
            >
              {togglingReady
                ? "Saving…"
                : myPlayer?.is_ready
                  ? "Ready ✓"
                  : "I'm Ready"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {myPlayer?.is_ready
                ? "Waiting for the campaign creator to start…"
                : "Tap ready when you've picked your character."}
            </p>
          </div>
        )}
      </div>
      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentCharacterId={
          players.find((p) => p.user_id === userId)?.character_snapshot.id ??
          ""
        }
        onSelect={async (characterId) => {
          try {
            const res = await fetch(`/api/campaign/${campaignId}/player`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ characterId }),
            });
            if (!res.ok) {
              const text = await res.text();
              console.error("change character failed", res.status, text);
              return;
            }
            setPickerOpen(false);
            onChanged();
          } catch (err) {
            console.error("change character threw", err);
          }
        }}
      />
    </main>
  );
}

function JoinPrompt({
  campaignId,
  onJoined,
}: {
  campaignId: string;
  onJoined: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    const characterId = getActiveCharacterId();
    if (!characterId) {
      setError(
        "No active character — open the home page first to pick or create one.",
      );
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaign/${campaignId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!res.ok) {
        const text = await res.text();
        setError(`Failed to join (${res.status}): ${text}`);
        return;
      }
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoining(false);
    }
  }

  return (
    <CenteredCard>
      <p className="font-bold uppercase tracking-widest">
        Join this campaign?
      </p>
      <Button onClick={handleJoin} disabled={joining}>
        {joining ? "Joining…" : "Join Campaign"}
      </Button>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 text-center font-mono">
        {children}
      </div>
    </main>
  );
}
