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
        className="border-2 border-zinc-900 sm:max-w-5xl"
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
