"use client";

import { use, useCallback, useEffect, useReducer, useState } from "react";
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

// Page-level state. Bundles the four flags that previously lived as
// parallel useState calls so the latching rules (seenActive,
// actionsRevealed) live in the reducer instead of useEffects that
// chase the snapshot — both transitions are derivable from the
// incoming snapshot, so deriving them at the dispatch site avoids
// the setState-in-useEffect anti-pattern.
interface PageState {
  load: LoadState;
  refreshTick: number;
  seenActive: boolean;
  actionsRevealed: boolean;
}

type PageAction =
  | { type: "REFRESH" }
  | { type: "SET_LOAD"; load: LoadState }
  | { type: "ACTIONS_REVEALED" };

function pageReducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case "REFRESH":
      return { ...state, refreshTick: state.refreshTick + 1 };
    case "SET_LOAD": {
      const next: PageState = { ...state, load: action.load };
      // Latch seenActive the first time we observe an active fight,
      // so a later flip to finished/between_encounters routes through
      // the battle screen long enough to play out the killing blow.
      if (
        action.load.kind === "ready" &&
        action.load.data.campaign.status === "active"
      ) {
        next.seenActive = true;
        // Each fresh encounter resets the reveal gate so the next
        // killing blow can latch it again.
        const prevEncounter =
          state.load.kind === "ready" &&
          state.load.data.campaign.status === "active"
            ? state.load.data.campaign.encounter_number
            : null;
        const nextEncounter = action.load.data.campaign.encounter_number;
        if (prevEncounter !== nextEncounter) {
          next.actionsRevealed = false;
        }
      }
      return next;
    }
    case "ACTIONS_REVEALED":
      return { ...state, actionsRevealed: true };
  }
}

const INITIAL_PAGE_STATE: PageState = {
  load: { kind: "loading" },
  refreshTick: 0,
  seenActive: false,
  actionsRevealed: false,
};

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

  const [pageState, pageDispatch] = useReducer(pageReducer, INITIAL_PAGE_STATE);
  const { load: state, refreshTick, seenActive, actionsRevealed } = pageState;

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
        pageDispatch({ type: "SET_LOAD", load: { kind: "needs-join" } });
        return;
      }
      if (res.status === 404) {
        pageDispatch({ type: "SET_LOAD", load: { kind: "not-found" } });
        return;
      }
      if (!res.ok) {
        pageDispatch({
          type: "SET_LOAD",
          load: {
            kind: "error",
            message: `Failed to load (${res.status})`,
          },
        });
        return;
      }
      const data = (await res.json()) as Snapshot;
      pageDispatch({ type: "SET_LOAD", load: { kind: "ready", data } });
    } catch (err) {
      pageDispatch({
        type: "SET_LOAD",
        load: {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }, [authLoading, user, campaignId]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot, refreshTick]);

  // Stable callback refs so child components' effects (notably
  // CampaignBattle's onAllActionsRevealed deps array) don't re-run
  // on every parent render — pageDispatch is already stable, these
  // wrappers just give the dispatch a constant identity at the JSX
  // call site.
  const refresh = useCallback(() => pageDispatch({ type: "REFRESH" }), []);
  const markActionsRevealed = useCallback(
    () => pageDispatch({ type: "ACTIONS_REVEALED" }),
    [],
  );

  // seenActive + actionsRevealed used to live in their own
  // useEffects that watched `state` and called setState to latch /
  // reset the flags. That setState-in-useEffect chain is now folded
  // into pageReducer's SET_LOAD case — the latching rules fire at
  // the dispatch site, not on a render-driven effect, so there's no
  // cascading-render anti-pattern.

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
        pageDispatch({ type: "REFRESH" });
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
      refresh,
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
        <Button onClick={refresh}>
          Retry
        </Button>
      </CenteredCard>
    );
  }

  if (state.kind === "needs-join") {
    return (
      <JoinPrompt
        campaignId={campaignId}
        onJoined={refresh}
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
        onChanged={refresh}
        onStarted={refresh}
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
        onActionComplete={refresh}
        onAllActionsRevealed={markActionsRevealed}
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
        onContinue={refresh}
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

// Lobby's local UI state — mirrors the same "≤3 useState; 4+ go to
// useReducer" rule used elsewhere in the project. Five flags
// (start submission, ready toggle, picker open, copy confirmation,
// start error) collapsed into one reducer.
interface LobbyState {
  starting: boolean;
  startError: string | null;
  copied: boolean;
  pickerOpen: boolean;
  togglingReady: boolean;
}

type LobbyAction =
  | { type: "PICKER"; open: boolean }
  | { type: "COPY_FLASH"; copied: boolean }
  | { type: "READY_BEGIN" }
  | { type: "READY_END" }
  | { type: "START_BEGIN" }
  | { type: "START_END" }
  | { type: "START_ERROR"; message: string };

function lobbyReducer(state: LobbyState, action: LobbyAction): LobbyState {
  switch (action.type) {
    case "PICKER":
      return { ...state, pickerOpen: action.open };
    case "COPY_FLASH":
      return { ...state, copied: action.copied };
    case "READY_BEGIN":
      return { ...state, togglingReady: true };
    case "READY_END":
      return { ...state, togglingReady: false };
    case "START_BEGIN":
      return { ...state, starting: true, startError: null };
    case "START_END":
      return { ...state, starting: false };
    case "START_ERROR":
      return { ...state, starting: false, startError: action.message };
  }
}

const INITIAL_LOBBY_STATE: LobbyState = {
  starting: false,
  startError: null,
  copied: false,
  pickerOpen: false,
  togglingReady: false,
};

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
  // 5 useState (start submission, ready toggle, picker open, copy
  // confirmation, start error) collapsed into a single reducer per
  // the project's "≤3 useState; 4+ go to useReducer" rule. Keeps
  // related transitions colocated and easy to scan.
  const [lobbyState, lobbyDispatch] = useReducer(
    lobbyReducer,
    INITIAL_LOBBY_STATE,
  );
  const { starting, startError, copied, pickerOpen, togglingReady } =
    lobbyState;

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
      lobbyDispatch({ type: "COPY_FLASH", copied: true });
      setTimeout(() => lobbyDispatch({ type: "COPY_FLASH", copied: false }), 1500);
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
    lobbyDispatch({ type: "READY_BEGIN" });
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
      lobbyDispatch({ type: "READY_END" });
    }
  }

  async function handleStart() {
    lobbyDispatch({ type: "START_BEGIN" });
    try {
      const res = await fetch(`/api/campaign/${campaignId}/start`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text();
        lobbyDispatch({ type: "START_ERROR", message: `Failed to start (${res.status}): ${text}` });
        return;
      }
      onStarted();
    } catch (err) {
      lobbyDispatch({ type: "START_ERROR", message: err instanceof Error ? err.message : String(err) });
    } finally {
      lobbyDispatch({ type: "START_END" });
    }
  }

  return (
    <main className="relative flex min-h-screen items-start justify-center p-6">
      <Link
        href="/"
        className="absolute left-6 top-6 font-mono text-xs uppercase tracking-widest underline underline-offset-4 hover:text-foreground"
      >
        ← Back to home
      </Link>
      <div className="flex w-full max-w-xl flex-col gap-6">
        <h1 className="text-center font-mono text-2xl font-bold uppercase tracking-widest md:text-3xl">
          Campaign Lobby
        </h1>

        {isCreator ? (
          <div className="relative flex flex-col gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 font-mono">
            <p className="text-sm">
              Share this link with a friend. They&apos;ll need to be signed in to
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
                        <span className="ml-2 text-xs uppercase tracking-widest">
                          (You)
                        </span>
                      ) : null}
                      {p.user_id !== campaign.created_by && p.is_ready ? (
                        <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-700">
                          Ready
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs uppercase tracking-widest">
                      {p.character_snapshot.race} ·{" "}
                      {p.character_snapshot.class} · Lv{" "}
                      {p.character_snapshot.level}
                    </span>
                  </div>
                  {isMe ? (
                    <Button size="sm" onClick={() => lobbyDispatch({ type: "PICKER", open: true })}>
                      Change
                    </Button>
                  ) : null}
                </li>
              );
            })}
            {Array.from({ length: MAX_PLAYERS - slotsFilled }).map((_, i) => (
              <li
                key={`empty-${i}`}
                className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-sm"
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
              <p className="text-center text-xs">
                Need {MIN_PLAYERS_TO_START - slotsFilled} more player
                {MIN_PLAYERS_TO_START - slotsFilled === 1 ? "" : "s"} before
                you can start.
              </p>
            ) : !allJoinersReady ? (
              <p className="text-center text-xs">
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
            <p className="text-center text-sm">
              {myPlayer?.is_ready
                ? "Waiting for the campaign creator to start…"
                : "Tap ready when you've picked your character."}
            </p>
          </div>
        )}
      </div>
      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => lobbyDispatch({ type: "PICKER", open })}
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
            lobbyDispatch({ type: "PICKER", open: false });
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
