"use client";

import { useCallback, useEffect, useReducer } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CampaignBattle } from "@/components/coop/campaign-battle";
import { readApiError } from "@/lib/coop/api-error";
import { buildEncounterRecaps } from "@/lib/coop/encounter-recap";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

// Locked combat dialog. Mounted by the story page whenever the
// story_campaigns row has an active_combat_campaign_id. Fetches the
// underlying coop campaign snapshot, mounts CampaignBattle inside,
// and refuses to close until the coop campaign reports `finished`.
// When finished, shows an outcome banner + "Return to Story" button
// which calls /combat/end and lets the parent close the dialog.

type Snapshot = {
  campaign: Campaign;
  players: CampaignPlayer[];
  actions: CampaignAction[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Snapshot }
  | { kind: "error"; message: string };

interface State {
  load: LoadState;
  refreshTick: number;
  resolving: boolean;
}

type Action =
  | { type: "SET_LOAD"; load: LoadState }
  | { type: "REFRESH" }
  | { type: "RESOLVING_BEGIN" }
  | { type: "RESOLVING_END" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_LOAD":
      return { ...state, load: action.load };
    case "REFRESH":
      return { ...state, refreshTick: state.refreshTick + 1 };
    case "RESOLVING_BEGIN":
      return { ...state, resolving: true };
    case "RESOLVING_END":
      return { ...state, resolving: false };
  }
}

const INITIAL: State = {
  load: { kind: "loading" },
  refreshTick: 0,
  resolving: false,
};

export function StoryCombatDialog({
  storyCampaignId,
  combatCampaignId,
  userId,
  onResolved,
}: {
  storyCampaignId: string;
  combatCampaignId: string;
  userId: string;
  // Called after /combat/end succeeds (or reports the combat was
  // already cleared). Parent uses this to clear its active_combat
  // pointer locally and refetch the story snapshot.
  onResolved: () => void;
}) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const { load, refreshTick, resolving } = state;

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaign/${combatCampaignId}`);
      if (!res.ok) {
        dispatch({
          type: "SET_LOAD",
          load: {
            kind: "error",
            message: await readApiError(res, "load combat"),
          },
        });
        return;
      }
      const data = (await res.json()) as Snapshot;
      dispatch({ type: "SET_LOAD", load: { kind: "ready", data } });
    } catch (err) {
      dispatch({
        type: "SET_LOAD",
        load: {
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }, [combatCampaignId]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot, refreshTick]);

  // Same realtime channel coop's page subscribes to. Each action /
  // status flip on the coop campaign fires `updated`, we refetch.
  useEffect(() => {
    if (load.kind !== "ready") return;
    const status = load.data.campaign.status;
    if (status !== "active" && status !== "finished" && status !== "between_encounters") {
      return;
    }
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`campaign:${combatCampaignId}`)
      .on("broadcast", { event: "updated" }, () => {
        dispatch({ type: "REFRESH" });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [combatCampaignId, load]);

  // Slow polling fallback so we converge even if the broadcast
  // misses. 5s during active, slower once finished (only the
  // status flip we already saw matters).
  useEffect(() => {
    if (load.kind !== "ready") return;
    const status = load.data.campaign.status;
    if (status !== "active" && status !== "finished" && status !== "between_encounters") {
      return;
    }
    const intervalMs = status === "active" ? 5000 : 15000;
    const handle = setInterval(() => dispatch({ type: "REFRESH" }), intervalMs);
    return () => clearInterval(handle);
  }, [load]);

  const refresh = useCallback(() => dispatch({ type: "REFRESH" }), []);

  const resolve = useCallback(async () => {
    if (resolving) return;
    dispatch({ type: "RESOLVING_BEGIN" });
    try {
      const res = await fetch(`/api/story/${storyCampaignId}/combat/end`, {
        method: "POST",
      });
      if (!res.ok) {
        console.error("combat end failed", res.status);
        return;
      }
      onResolved();
    } catch (err) {
      console.error("combat end threw", err);
    } finally {
      dispatch({ type: "RESOLVING_END" });
    }
  }, [storyCampaignId, onResolved, resolving]);

  const isFinished =
    load.kind === "ready" &&
    (load.data.campaign.status === "finished" ||
      load.data.campaign.status === "between_encounters");

  // Locked while combat is live. Three things together pin the
  // dialog open: open hardcoded to true, no-op onOpenChange so esc
  // / backdrop attempts don't propagate as a close request, and
  // showCloseButton=false hides the X. The parent already gates
  // rendering on active_combat_campaign_id existing, so we never
  // want a user-driven close to register.
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        className="border-2 border-foreground sm:max-w-5xl"
      >
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-base uppercase tracking-widest">
            {isFinished ? "Encounter Resolved" : "Encounter"}
          </DialogTitle>
        </DialogHeader>

        {load.kind === "loading" ? (
          <p className="py-12 text-center font-mono text-sm">
            Loading combat…
          </p>
        ) : load.kind === "error" ? (
          <div className="flex flex-col items-center gap-3 py-6 font-mono">
            <p className="text-sm text-rose-600">{load.message}</p>
            <Button variant="outline" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : isFinished ? (
          // Once resolved, replace the live-combat grid (which still
          // reads "your turn" / commands) with a clear outcome + loot
          // summary so the win and the drops are obvious.
          <CombatOutcome
            campaign={load.data.campaign}
            actions={load.data.actions}
          />
        ) : (
          <div className="max-h-[80vh] overflow-y-auto">
            <CampaignBattle
              campaign={load.data.campaign}
              players={load.data.players}
              actions={load.data.actions}
              userId={userId}
              onActionComplete={refresh}
            />
          </div>
        )}

        {isFinished ? (
          <div className="flex justify-center pt-2">
            <Button onClick={resolve} disabled={resolving}>
              {resolving ? "Returning…" : "Return to Story"}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// Story combat resolves to `between_encounters` on a win (single
// encounter, so no next-fight flow), `finished`+outcome on a
// forced end. Map both to a player-facing verdict.
function combatVerdict(c: Campaign): "won" | "lost" | "fled" {
  if (c.status === "between_encounters") return "won";
  if (c.outcome === "won") return "won";
  if (c.outcome === "lost") return "lost";
  return "fled";
}

// Post-fight summary shown in place of the combat grid once resolved:
// a clear VICTORY/DEFEAT verdict plus the XP and loot from this
// encounter (pulled from the same recap the coop rest screen uses).
function CombatOutcome({
  campaign,
  actions,
}: {
  campaign: Campaign;
  actions: CampaignAction[];
}) {
  const verdict = combatVerdict(campaign);
  const recaps = buildEncounterRecaps(actions);
  const recap =
    recaps.find((r) => r.encounterNumber === campaign.encounter_number) ??
    recaps[recaps.length - 1];
  const xp = recap?.xpPerPlayer ?? 0;
  const loot = recap ? Array.from(recap.lootByPlayer.values()).flat() : [];
  // Group killed monsters into "3 × Goblin" rather than repeating names.
  const killed = Object.entries(
    (recap?.killed ?? []).reduce<Record<string, number>>((m, n) => {
      m[n] = (m[n] ?? 0) + 1;
      return m;
    }, {}),
  ).map(([name, count]) => (count > 1 ? `${count} × ${name}` : name));

  return (
    <div className="flex flex-col items-center gap-5 py-8 font-mono">
      {verdict === "won" ? (
        <span className="rounded-md bg-action px-6 py-2.5 text-2xl font-bold uppercase tracking-[0.2em] text-action-foreground">
          Victory
        </span>
      ) : verdict === "lost" ? (
        <span className="rounded-md bg-rose-600 px-6 py-2.5 text-2xl font-bold uppercase tracking-[0.2em] text-white">
          Defeat
        </span>
      ) : (
        <span className="rounded-md border-2 border-foreground px-6 py-2.5 text-xl font-bold uppercase tracking-[0.2em]">
          You Slip Away
        </span>
      )}

      {killed.length > 0 ? (
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Defeated {killed.join(" · ")}
        </p>
      ) : null}

      {verdict === "won" ? (
        <>
          {xp > 0 ? (
            <p className="text-lg font-bold tracking-widest">+{xp} XP</p>
          ) : null}
          {loot.length > 0 ? (
            <div className="w-full max-w-sm rounded-md border-2 border-foreground bg-card p-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Loot
              </p>
              <ul className="flex flex-col gap-1">
                {loot.map((name, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-action">◆</span>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No loot this time.</p>
          )}
        </>
      ) : verdict === "lost" ? (
        <p className="text-sm text-muted-foreground">Your party has fallen.</p>
      ) : null}
    </div>
  );
}
