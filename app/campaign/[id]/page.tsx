"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useUser } from "@/lib/auth/use-user";
import type { Campaign, CampaignPlayer } from "@/lib/coop/types";
import { getActiveCharacterId } from "@/lib/session";

const MAX_PLAYERS = 2;

type Snapshot = { campaign: Campaign; players: CampaignPlayer[] };
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

  // Poll while the campaign is `waiting` so the lobby reflects new
  // joins. Switches to Realtime in M3 once we're sending action
  // updates anyway.
  useEffect(() => {
    if (state.kind !== "ready" || state.data.campaign.status !== "waiting") {
      return;
    }
    const interval = setInterval(() => setRefreshTick((t) => t + 1), 3000);
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
        <Button variant="outline" onClick={() => setRefreshTick((t) => t + 1)}>
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

  const { campaign, players } = state.data;
  const isCreator = campaign.created_by === user.id;

  if (campaign.status === "waiting") {
    return (
      <Lobby
        campaignId={campaignId}
        campaign={campaign}
        players={players}
        isCreator={isCreator}
        onStarted={() => setRefreshTick((t) => t + 1)}
      />
    );
  }

  if (campaign.status === "active") {
    return (
      <CenteredCard>
        <p className="font-bold">Campaign in progress!</p>
        <p className="text-sm text-muted-foreground">
          The combat view ships in the next phase. Players: {players.length}.
          Monsters: {campaign.monsters.length}.
        </p>
      </CenteredCard>
    );
  }

  // Finished.
  return (
    <CenteredCard>
      <p className="font-bold">
        Campaign finished — {campaign.outcome === "won" ? "Victory!" : "Defeat."}
      </p>
      <Link href="/" className="font-bold underline">
        Back to home
      </Link>
    </CenteredCard>
  );
}

function Lobby({
  campaignId,
  players,
  isCreator,
  onStarted,
}: {
  campaignId: string;
  campaign: Campaign;
  players: CampaignPlayer[];
  isCreator: boolean;
  onStarted: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/campaign/${campaignId}`
      : "";

  const slotsFilled = players.length;
  const canStart = isCreator && slotsFilled >= 2;

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
            <Button variant="outline" size="sm" onClick={copyInvite}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 font-mono">
          <p className="text-sm font-bold uppercase tracking-widest">
            Players ({slotsFilled}/{MAX_PLAYERS})
          </p>
          <ul className="flex flex-col gap-2">
            {players.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-md border border-zinc-300 px-3 py-2 text-sm"
              >
                <span className="font-bold">
                  {p.character_snapshot.name}
                </span>
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  {p.character_snapshot.race} · {p.character_snapshot.class} ·
                  Lv {p.character_snapshot.level}
                </span>
              </li>
            ))}
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
              className="bg-emerald-500 text-white hover:bg-emerald-500/90"
            >
              {starting ? "Starting…" : "Start Campaign"}
            </Button>
            {!canStart ? (
              <p className="text-center text-xs text-muted-foreground">
                Need {MAX_PLAYERS - slotsFilled} more player
                {MAX_PLAYERS - slotsFilled === 1 ? "" : "s"} before you can
                start.
              </p>
            ) : null}
            {startError ? (
              <p className="text-center text-sm text-rose-600">{startError}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Waiting for the campaign creator to start…
          </p>
        )}
      </div>
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
      <p className="text-sm text-muted-foreground">
        You'll join with your active character. To use a different one,
        switch character on the home page first.
      </p>
      <Button onClick={handleJoin} disabled={joining}>
        {joining ? "Joining…" : "Join with active character"}
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
