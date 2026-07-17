"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  ChevronRightIcon,
  ClockIcon,
  CompassIcon,
  EyeIcon,
  FlameIcon,
  FootprintsIcon,
  GiftIcon,
  HandIcon,
  HeartPulseIcon,
  KeyRoundIcon,
  LeafIcon,
  MessageCircleIcon,
  MusicIcon,
  PlayIcon,
  SearchIcon,
  ShieldIcon,
  SkullIcon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
  TargetIcon,
  TrophyIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useReducer, useRef } from "react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StoryCombatDialog } from "@/components/story/story-combat-dialog";
import { StoryLobby } from "@/components/story/story-lobby";
import { PartyRow } from "@/components/shared/party-row";
import { PanelLabel } from "@/components/shared/panel-label";
import type { CampaignPlayer } from "@/lib/coop/types";
import { useUser } from "@/lib/auth/use-user";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import type { Character } from "@/lib/db/schema";
import { findCampaign } from "@/lib/dm/campaigns";
import type { StoryCampaign, StoryMessage, StoryPlayer } from "@/lib/dm/db";
import {
  FAILURE_END,
  SUCCESS_END,
  type Encounter,
  type PlayerAction,
  type PlayerActionIcon,
  type Scene,
} from "@/lib/dm/types";
import { cn } from "@/lib/utils";

type Snapshot = {
  campaign: StoryCampaign;
  messages: StoryMessage[];
  // Party roster — drives the lobby and (later) the coop party
  // panel. Always present; solo stories have a single entry.
  players: StoryPlayer[];
  // The character driving this story. Returned by the snapshot
  // route so the party panel renders without a separate fetch.
  // Null if the row vanished (shouldn't normally happen).
  character: Character | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Snapshot }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

type ComposerRole = "player" | "narrative";

interface PageState {
  load: LoadState;
  input: string;
  composerRole: ComposerRole;
  submitting: boolean;
  advanceOpen: boolean;
  advancing: boolean;
  triggeringEncounter: boolean;
  // True while a /action POST is in flight. Used to disable every
  // command-menu button so a fast double-tap doesn't fire the same
  // action twice (each fire would re-post the response and re-apply
  // the effect — encounters would double-spawn).
  runningAction: boolean;
  // True while a lobby join / ready / start POST is in flight, so the
  // StoryLobby's buttons disable to block double-fires.
  lobbyBusy: boolean;
}

type PageAction =
  | { type: "SET_LOAD"; load: LoadState }
  | { type: "SET_INPUT"; input: string }
  | { type: "SET_COMPOSER_ROLE"; role: ComposerRole }
  | { type: "SUBMIT_BEGIN" }
  | { type: "SUBMIT_END" }
  | { type: "APPEND_MESSAGE"; message: StoryMessage }
  | { type: "SET_ADVANCE_OPEN"; open: boolean }
  | { type: "ADVANCE_BEGIN" }
  | { type: "ADVANCE_END" }
  | {
      type: "APPLY_ADVANCE";
      campaign: StoryCampaign;
      newMessages: StoryMessage[];
    }
  | { type: "TRIGGER_ENCOUNTER_BEGIN" }
  | { type: "TRIGGER_ENCOUNTER_END" }
  | { type: "RUN_ACTION_BEGIN" }
  | { type: "RUN_ACTION_END" }
  | { type: "LOBBY_BUSY_BEGIN" }
  | { type: "LOBBY_BUSY_END" }
  | { type: "SET_ACTIVE_COMBAT"; campaignId: string | null };

function pageReducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case "SET_LOAD":
      return { ...state, load: action.load };
    case "SET_INPUT":
      return { ...state, input: action.input };
    case "SET_COMPOSER_ROLE":
      return { ...state, composerRole: action.role };
    case "SUBMIT_BEGIN":
      return { ...state, submitting: true };
    case "SUBMIT_END":
      return { ...state, submitting: false };
    case "APPEND_MESSAGE":
      if (state.load.kind !== "ready") return state;
      return {
        ...state,
        load: {
          ...state.load,
          data: {
            ...state.load.data,
            messages: [...state.load.data.messages, action.message],
          },
        },
      };
    case "SET_ADVANCE_OPEN":
      return { ...state, advanceOpen: action.open };
    case "ADVANCE_BEGIN":
      return { ...state, advancing: true };
    case "ADVANCE_END":
      return { ...state, advancing: false };
    case "APPLY_ADVANCE":
      if (state.load.kind !== "ready") return state;
      return {
        ...state,
        advanceOpen: false,
        advancing: false,
        load: {
          ...state.load,
          data: {
            ...state.load.data,
            campaign: action.campaign,
            messages: [...state.load.data.messages, ...action.newMessages],
          },
        },
      };
    case "TRIGGER_ENCOUNTER_BEGIN":
      return { ...state, triggeringEncounter: true };
    case "TRIGGER_ENCOUNTER_END":
      return { ...state, triggeringEncounter: false };
    case "RUN_ACTION_BEGIN":
      return { ...state, runningAction: true };
    case "RUN_ACTION_END":
      return { ...state, runningAction: false };
    case "LOBBY_BUSY_BEGIN":
      return { ...state, lobbyBusy: true };
    case "LOBBY_BUSY_END":
      return { ...state, lobbyBusy: false };
    case "SET_ACTIVE_COMBAT":
      if (state.load.kind !== "ready") return state;
      return {
        ...state,
        load: {
          ...state.load,
          data: {
            ...state.load.data,
            campaign: {
              ...state.load.data.campaign,
              active_combat_campaign_id: action.campaignId,
            },
          },
        },
      };
  }
}

// Out of combat the story has no real coop campaign, but PartyRow
// is shaped around CampaignPlayer. Adapt a story roster row into one
// — only fields PartyMember actually reads (snapshot, current_hp,
// user_id, position) need real values; the rest are stub-only
// because actions=[] means the per-player hit / current-turn paths
// never execute. Returns null for the DM seat (no character).
function storyPlayerToPartyMember(p: StoryPlayer): CampaignPlayer | null {
  const snap = p.character_snapshot;
  if (!snap) return null;
  return {
    id: p.id,
    campaign_id: p.campaign_id,
    user_id: p.user_id,
    position: p.position,
    character_snapshot: snap,
    current_hp: snap.current_hp,
    is_ready: p.is_ready,
    continue_ready: false,
    joined_at: p.created_at,
  };
}

const INITIAL: PageState = {
  load: { kind: "loading" },
  input: "",
  composerRole: "player",
  submitting: false,
  advanceOpen: false,
  advancing: false,
  triggeringEncounter: false,
  runningAction: false,
  lobbyBusy: false,
};

export default function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: campaignId } = use(params);
  const router = useRouter();
  const { user, loading: authLoading } = useUser();
  const [state, dispatch] = useReducer(pageReducer, INITIAL);
  const {
    load,
    input,
    composerRole,
    submitting,
    advanceOpen,
    advancing,
    triggeringEncounter,
    runningAction,
    lobbyBusy,
  } = state;

  // Auto-scroll the message log to the bottom whenever a new
  // message lands. Pin lives at the end of the ScrollArea's
  // content; scrollIntoView bubbles to the nearest scrollable
  // ancestor (the base-ui Viewport) so the window itself doesn't
  // jump.
  const logBottomRef = useRef<HTMLDivElement>(null);
  // Scene id we've already auto-advanced from on victory, so the
  // fight-gate auto-advance fires once (not on every re-render while
  // the advance request is in flight).
  const autoAdvancedSceneRef = useRef<string | null>(null);
  const messageCount = load.kind === "ready" ? load.data.messages.length : 0;
  useEffect(() => {
    if (load.kind !== "ready") return;
    logBottomRef.current?.scrollIntoView({ block: "end" });
  }, [load.kind, messageCount]);

  // Sign-in gated. Anonymous browsers get sent to sign-in with a
  // `next` back to this page (same pattern coop uses).
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const next = encodeURIComponent(`/story/${campaignId}`);
      router.replace(`/auth/sign-in?next=${next}`);
    }
  }, [authLoading, user, campaignId, router]);

  // Initial load. Ongoing updates arrive via the Realtime channel +
  // polling fallback below; this just fills the page on first mount.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/story/${campaignId}`);
        if (cancelled) return;
        if (res.status === 404) {
          dispatch({ type: "SET_LOAD", load: { kind: "not-found" } });
          return;
        }
        if (!res.ok) {
          dispatch({
            type: "SET_LOAD",
            load: { kind: "error", message: `Failed to load (${res.status})` },
          });
          return;
        }
        const data = (await res.json()) as Snapshot;
        dispatch({ type: "SET_LOAD", load: { kind: "ready", data } });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: "SET_LOAD",
          load: {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, authLoading, user]);

  const send = useCallback(
    async (role: ComposerRole) => {
    const trimmed = input.trim();
    if (!trimmed || submitting) return;
    dispatch({ type: "SUBMIT_BEGIN" });
    try {
      const res = await fetch(`/api/story/${campaignId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content: trimmed }),
      });
      if (!res.ok) {
        console.error("post message failed", res.status);
        return;
      }
      const message = (await res.json()) as StoryMessage;
      dispatch({ type: "APPEND_MESSAGE", message });
      dispatch({ type: "SET_INPUT", input: "" });
    } catch (err) {
      console.error("post message threw", err);
    } finally {
      dispatch({ type: "SUBMIT_END" });
    }
  },
    [campaignId, input, submitting],
  );

  const triggerEncounter = useCallback(
    async (encounter: Encounter) => {
      if (triggeringEncounter) return;
      dispatch({ type: "TRIGGER_ENCOUNTER_BEGIN" });
      try {
        // /combat/start spins up a coop campaign + posts the
        // "encounter begins" system message in one round-trip.
        // Response carries both the new coop campaign id (which
        // unlocks the dialog) and the seed message.
        const res = await fetch(`/api/story/${campaignId}/combat/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            monsterIndex: encounter.monsterIndex,
            count: encounter.count,
            intent: encounter.intent,
          }),
        });
        if (!res.ok) {
          console.error("combat start failed", res.status);
          return;
        }
        const data = (await res.json()) as {
          combatCampaignId: string;
          message: StoryMessage | null;
        };
        if (data.message) {
          dispatch({ type: "APPEND_MESSAGE", message: data.message });
        }
        dispatch({
          type: "SET_ACTIVE_COMBAT",
          campaignId: data.combatCampaignId,
        });
      } catch (err) {
        console.error("combat start threw", err);
      } finally {
        dispatch({ type: "TRIGGER_ENCOUNTER_END" });
      }
    },
    [campaignId, triggeringEncounter],
  );

  // Called by the combat dialog after /combat/end succeeds. Clears
  // the active combat pointer so the dialog unmounts, then refetches
  // the snapshot so the outcome system message + updated character
  // state (HP, XP, loot) land on the page.
  const handleCombatResolved = useCallback(async () => {
    dispatch({ type: "SET_ACTIVE_COMBAT", campaignId: null });
    try {
      const res = await fetch(`/api/story/${campaignId}`);
      if (!res.ok) return;
      const data = (await res.json()) as Snapshot;
      dispatch({ type: "SET_LOAD", load: { kind: "ready", data } });
    } catch (err) {
      console.error("post-combat refetch threw", err);
    }
  }, [campaignId]);

  // Re-pull the whole snapshot. Used by the lobby (after join / ready
  // / start), the lobby poll, and after a scene reward grant (to sync
  // the party panel's level / HP). Silently no-ops on failure — the
  // next poll tick retries.
  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/story/${campaignId}`);
      if (!res.ok) return;
      const data = (await res.json()) as Snapshot;
      dispatch({ type: "SET_LOAD", load: { kind: "ready", data } });
    } catch (err) {
      console.error("story refetch threw", err);
    }
  }, [campaignId]);

  // A scene-reward grant mutated the character row (xp / level / loot)
  // server-side; refetch so the party panel reflects it instead of
  // waiting on the poll.
  const syncIfRewarded = useCallback(
    (newMessages: StoryMessage[]) => {
      const rewarded = newMessages.some(
        (m) =>
          (m.metadata as Record<string, unknown>)?.kind === "scene_rewards",
      );
      if (rewarded) void refetch();
    },
    [refetch],
  );

  // Resolve an authored player action against the current scene.
  // The route handles posting the response message, applying any
  // effect (advance scene / start encounter), and returns the
  // updated campaign + new messages + optional combat campaign id.
  // We translate that into the existing reducer events:
  //   APPLY_ADVANCE — updates campaign + appends new messages
  //   SET_ACTIVE_COMBAT — opens the locked combat dialog when an
  //   encounter effect fired
  const runAction = useCallback(
    async (action: PlayerAction) => {
      if (runningAction) return;
      dispatch({ type: "RUN_ACTION_BEGIN" });
      try {
        const res = await fetch(`/api/story/${campaignId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionId: action.id }),
        });
        if (!res.ok) {
          console.error("player action failed", res.status);
          return;
        }
        const data = (await res.json()) as {
          campaign: StoryCampaign;
          newMessages: StoryMessage[];
          combatCampaignId: string | null;
        };
        dispatch({
          type: "APPLY_ADVANCE",
          campaign: data.campaign,
          newMessages: data.newMessages,
        });
        syncIfRewarded(data.newMessages);
        if (data.combatCampaignId) {
          dispatch({
            type: "SET_ACTIVE_COMBAT",
            campaignId: data.combatCampaignId,
          });
        }
      } catch (err) {
        console.error("player action threw", err);
      } finally {
        dispatch({ type: "RUN_ACTION_END" });
      }
    },
    [campaignId, runningAction, syncIfRewarded],
  );

  const advance = useCallback(
    async (to: string) => {
      if (advancing) return;
      dispatch({ type: "ADVANCE_BEGIN" });
      try {
        const res = await fetch(`/api/story/${campaignId}/advance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to }),
        });
        if (!res.ok) {
          console.error("advance failed", res.status);
          return;
        }
        const data = (await res.json()) as {
          campaign: StoryCampaign;
          newMessages: StoryMessage[];
        };
        dispatch({
          type: "APPLY_ADVANCE",
          campaign: data.campaign,
          newMessages: data.newMessages,
        });
        syncIfRewarded(data.newMessages);
      } catch (err) {
        console.error("advance threw", err);
      } finally {
        dispatch({ type: "ADVANCE_END" });
      }
    },
    [campaignId, advancing, syncIfRewarded],
  );

  const handleReady = useCallback(
    async (ready: boolean) => {
      dispatch({ type: "LOBBY_BUSY_BEGIN" });
      try {
        const res = await fetch(`/api/story/${campaignId}/player`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ready }),
        });
        if (!res.ok) {
          console.error("set ready failed", res.status);
          return;
        }
        await refetch();
      } catch (err) {
        console.error("set ready threw", err);
      } finally {
        dispatch({ type: "LOBBY_BUSY_END" });
      }
    },
    [campaignId, refetch],
  );

  const handleStart = useCallback(async () => {
    dispatch({ type: "LOBBY_BUSY_BEGIN" });
    try {
      const res = await fetch(`/api/story/${campaignId}/start`, {
        method: "POST",
      });
      if (!res.ok) {
        console.error("start story failed", res.status);
        return;
      }
      // Status flips to 'active' — refetch swaps the lobby for the
      // play surface (and pulls in the seeded opening narrative).
      await refetch();
    } catch (err) {
      console.error("start story threw", err);
    } finally {
      dispatch({ type: "LOBBY_BUSY_END" });
    }
  }, [campaignId, refetch]);

  // Join an open lobby — as a player (with a chosen character) or by
  // claiming the open DM seat. The lobby SELECT policy lets a
  // non-member read the row to get here; the join route validates and
  // performs the privileged insert / seat claim.
  const handleJoin = useCallback(
    async (opts: { role: "player" | "dm"; characterId?: string }) => {
      dispatch({ type: "LOBBY_BUSY_BEGIN" });
      try {
        const res = await fetch(`/api/story/${campaignId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts),
        });
        if (!res.ok) {
          console.error("join story failed", res.status);
          return;
        }
        await refetch();
      } catch (err) {
        console.error("join story threw", err);
      } finally {
        dispatch({ type: "LOBBY_BUSY_END" });
      }
    },
    [campaignId, refetch],
  );

  // The story is "in motion" (worth syncing) while it's assembling
  // in the lobby or actively being played. Concluded / abandoned
  // stories are static, so we stop syncing them.
  const inMotion =
    load.kind === "ready" &&
    (load.data.campaign.status === "lobby" ||
      load.data.campaign.status === "active");

  // Subscribe to the story's Realtime broadcast channel so any
  // member's mutating route (message, action, advance, ready, join,
  // start, combat start/end) refetches us in <100ms. Mirrors coop's
  // campaign:<id> channel. The poll below is the slow fallback for a
  // dropped broadcast.
  useEffect(() => {
    if (!inMotion) return;
    const supabase = createSupabaseClient();
    const channel = supabase
      .channel(`story:${campaignId}`)
      .on("broadcast", { event: "updated" }, () => {
        void refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [inMotion, campaignId, refetch]);

  // Slow polling fallback. The broadcast does the heavy lifting; this
  // just guarantees convergence after a missed message. The lobby
  // ticks a touch faster since readying up is the only signal there.
  useEffect(() => {
    if (!inMotion) return;
    const intervalMs =
      load.kind === "ready" && load.data.campaign.status === "lobby"
        ? 5000
        : 10000;
    const interval = setInterval(() => {
      void refetch();
    }, intervalMs);
    return () => clearInterval(interval);
  }, [inMotion, load, refetch]);

  // Fight-gate auto-advance (solo): when a scene declares
  // advanceOnVictory and its encounter has been won, move the story
  // on without a manual tap. Fires once per scene via the ref guard.
  // Solo only — coop's DM drives scene changes.
  useEffect(() => {
    if (load.kind !== "ready") return;
    const { campaign, messages } = load.data;
    if (
      campaign.mode !== "solo" ||
      campaign.status !== "active" ||
      campaign.active_combat_campaign_id
    ) {
      return;
    }
    const template = findCampaign(campaign.campaign_template_id);
    const scene = template?.scenes.find(
      (s) => s.id === campaign.current_scene_id,
    );
    if (!scene?.advanceOnVictory) return;
    if (autoAdvancedSceneRef.current === scene.id) return;
    const won = messages.some((m) => {
      const meta = m.metadata as Record<string, unknown>;
      return (
        m.role === "system" &&
        meta.kind === "encounter_resolved" &&
        meta.scene_id === scene.id &&
        meta.outcome === "won"
      );
    });
    if (!won) return;
    autoAdvancedSceneRef.current = scene.id;
    void advance(scene.advanceOnVictory);
  }, [load, advance]);

  if (authLoading || load.kind === "loading") {
    return <CenteredCard>Loading campaign…</CenteredCard>;
  }
  if (!user) {
    return <CenteredCard>Redirecting…</CenteredCard>;
  }
  if (load.kind === "not-found") {
    return (
      <CenteredCard>
        <p>Campaign not found.</p>
        <Link href="/" className="font-bold underline">
          Back to home
        </Link>
      </CenteredCard>
    );
  }
  if (load.kind === "error") {
    return (
      <CenteredCard>
        <p className="text-rose-600">Error: {load.message}</p>
        <Button onClick={() => router.refresh()}>Retry</Button>
      </CenteredCard>
    );
  }

  const { campaign, messages, character, players } = load.data;
  const template = findCampaign(campaign.campaign_template_id);

  // Coop story waiting in the lobby: render the assembly screen
  // (invite link, roster, ready toggles, DM start) instead of the
  // play surface. Solo stories are created 'active' and skip this.
  if (campaign.status === "lobby") {
    return (
      <StoryLobby
        campaign={campaign}
        template={template}
        players={players}
        userId={user.id}
        busy={lobbyBusy}
        onReady={handleReady}
        onStart={handleStart}
        onJoin={handleJoin}
      />
    );
  }

  const currentScene =
    template?.scenes.find((s) => s.id === campaign.current_scene_id) ?? null;
  // DM seat check — only a coop human DM gets the DM surfaces (notes
  // panel, Advance Scene, Narrate composer). Solo (dm_kind 'self') is
  // a pure player experience: the campaign's authored player actions
  // drive scene transitions and encounters, so the solo player never
  // sees DM tooling or its spoilers.
  const isDm =
    campaign.dm_kind === "human" && campaign.dm_user_id === user.id;
  const isFinished = campaign.status !== "active";
  // Solo is button-driven — the player progresses entirely through
  // the authored action menu, and there's no DM or party to read free
  // text. So the free-text composer (textarea + Send) is coop-only;
  // solo keeps just the action buttons.
  const isSolo = campaign.mode === "solo";

  // The party panel renders every roster player (solo = one row,
  // coop = many). The DM seat has no character and is excluded.
  const partyMembers = players
    .map(storyPlayerToPartyMember)
    .filter((p): p is CampaignPlayer => p !== null);
  const hasParty = partyMembers.length > 0;

  // The viewer's own character drives the action menu's class gate.
  // Resolved from their roster row, falling back to the legacy
  // single-character snapshot for solo stories. Null for a coop DM.
  const myPlayer = players.find((p) => p.user_id === user.id) ?? null;
  const myCharacter = myPlayer?.character_snapshot ?? character;

  // Composer capabilities. A coop DM can only narrate; a player can
  // only speak as their character; the solo self-DM does both and so
  // gets the role toggle. effectiveRole is what a send actually posts.
  const canPlay = myCharacter !== null && myPlayer?.role !== "dm";
  const canNarrate = isDm;
  const showRoleTabs = canNarrate && canPlay;
  const effectiveRole: ComposerRole = showRoleTabs
    ? composerRole
    : canNarrate
      ? "narrative"
      : "player";

  // Player-message attribution. Solo shows "You"; coop shows the
  // author's character name (or "You" for the viewer's own lines).
  const nameByUser = new Map<string, string>();
  for (const p of players) {
    if (p.character_snapshot) nameByUser.set(p.user_id, p.character_snapshot.name);
  }

  // Coop is turn-based: a player may act / speak only on their turn,
  // and one move auto-passes to the next player. Solo has no turns,
  // so it's always "your turn". The DM is never turn-gated (they
  // narrate via the composer, which isn't blocked here).
  const isMyTurn = isSolo || campaign.active_turn_user_id === user.id;
  const activeTurnPlayer =
    players.find((p) => p.user_id === campaign.active_turn_user_id) ?? null;
  const activeTurnName =
    activeTurnPlayer?.character_snapshot?.name ?? "another player";
  // Lock the composer for a player who's off-turn. A DM narrating
  // (effectiveRole 'narrative') is never turn-gated.
  const composerLocked = effectiveRole === "player" && !isMyTurn;

  // Build the set of action ids already taken in the *current*
  // scene from message metadata. PlayerCommands uses this to hide
  // one-shot actions (the default) and leave repeatable ones in
  // place. Filtering by scene_id means each scene starts with a
  // fresh menu — taken state doesn't leak across transitions.
  const takenActionIds = new Set<string>();
  // Whether the current scene's scripted encounter has been resolved
  // with a win. /combat/end posts a system "encounter_resolved"
  // message tagged with the scene + outcome; PlayerCommands uses this
  // to gate `requiresVictory` actions (claim-the-kill beats) so a
  // player can't claim a victory they didn't earn.
  let sceneEncounterWon = false;
  for (const m of messages) {
    const meta = m.metadata as Record<string, unknown>;
    if (
      m.role === "narrative" &&
      meta.kind === "player_action_response" &&
      meta.scene_id === campaign.current_scene_id &&
      typeof meta.action_id === "string"
    ) {
      takenActionIds.add(meta.action_id);
    }
    if (
      m.role === "system" &&
      meta.kind === "encounter_resolved" &&
      meta.scene_id === campaign.current_scene_id &&
      meta.outcome === "won"
    ) {
      sceneEncounterWon = true;
    }
  }

  return (
    <main className="relative flex min-h-screen items-start justify-center p-4 md:p-6">
      <Link
        href="/"
        aria-label="Back to home"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "absolute right-4 top-4 md:right-6 md:top-6",
        )}
      >
        <ArrowLeftIcon className="size-3.5 shrink-0" />
        <span className="hidden md:inline">Back to home</span>
      </Link>
      {/* max-w accommodates three side-by-side columns on desktop:
          party (240px) · chat (flex) · DM notes (320px). On mobile
          the grid collapses; explicit md:order-* puts the chat
          first in the stack (primary play surface), then the party
          panel, then DM notes — so HP / inventory glances live one
          scroll away on a phone instead of pushing the conversation
          below the fold. */}
      <div className="flex w-full max-w-[100rem] flex-col gap-4 pt-12 md:pt-0">
        <header className="flex flex-col gap-1 text-center font-mono">
          <h1 className="text-2xl font-bold uppercase tracking-widest md:text-3xl">
            {template?.title ?? "Story"}
          </h1>
          {currentScene ? (
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Scene · {currentScene.title}
              {isFinished
                ? ` · ${campaign.status === "completed_success" ? "Concluded" : "Ended"}`
                : null}
            </p>
          ) : null}
        </header>

        <div
          className={cn(
            // md:h-[calc(100vh-9rem)] pins the whole grid row to
            // fit-the-fold on desktop (the ~9rem subtracts page
            // padding + header + gap). Every grid item (chat,
            // party, DM notes) stretches to that row height by
            // default; chat / DM notes use flex-1 + min-h-0
            // internally so their scrollable areas absorb whatever
            // space is left after their fixed bits. Mobile keeps
            // natural stacking — no row height — and the inner
            // ScrollArea reverts to its old h-[55vh] fallback.
            "grid gap-4 md:h-[calc(100vh-9rem)]",
            // Solo is a single reading column — cap the chat at 700px
            // (so the card hugs the text, not the full viewport) and
            // center the whole grid. With a party, it sits beside the
            // capped chat; the pair stays centered.
            isSolo
              ? hasParty
                ? "md:grid-cols-[400px_minmax(0,700px)] md:justify-center"
                : "md:grid-cols-[minmax(0,700px)] md:justify-center"
              : // Coop. Three-column when the DM is viewing: party
                // 400px, chat flex, notes 400px. Two-column (party +
                // chat) when not DM. Single column on mobile.
                hasParty && isDm && currentScene
                ? "md:grid-cols-[400px_minmax(0,1fr)_400px]"
                : hasParty
                  ? "md:grid-cols-[400px_minmax(0,1fr)]"
                  : isDm && currentScene
                    ? "md:grid-cols-[minmax(0,1fr)_400px]"
                    : null,
          )}
        >
          {hasParty ? (
            <aside className="md:order-1">
              <PartyRow
                players={partyMembers}
                actions={[]}
                currentTurnUserId={
                  isSolo ? undefined : campaign.active_turn_user_id ?? undefined
                }
                myUserId={user.id}
              />
            </aside>
          ) : null}
          <div className="flex flex-col gap-3 overflow-hidden rounded-xl border-2 border-foreground bg-card p-4 font-mono md:order-2 md:h-full md:min-h-0">
          <ScrollArea className="h-[55vh] pr-2 md:h-auto md:min-h-0 md:flex-1">
            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  icon={
                    m.role === "narrative"
                      ? iconForNarrative(m, template)
                      : null
                  }
                  authorLabel={
                    m.role === "player"
                      ? m.author_user_id === user.id
                        ? "You"
                        : (m.author_user_id
                            ? nameByUser.get(m.author_user_id)
                            : null) ?? "Player"
                      : undefined
                  }
                />
              ))}
              {messages.length === 0 ? (
                <li className="text-center text-sm">
                  The page is blank. Begin.
                </li>
              ) : null}
            </ul>
            {/* Auto-scroll sentinel — useEffect scrolls this into
                view whenever messages.length changes. */}
            <div ref={logBottomRef} aria-hidden />
          </ScrollArea>

          {isFinished ? (
            <div className="rounded-md border border-muted-foreground/20 bg-muted/40 p-3 text-center text-sm">
              This campaign has ended.{" "}
              <Link href="/" className="font-bold underline">
                Return home
              </Link>
              .
            </div>
          ) : (
            <>
              {canPlay && currentScene?.playerActions?.length ? (
                isMyTurn ? (
                  <PlayerCommands
                    actions={currentScene.playerActions}
                    characterClassId={myCharacter?.class ?? null}
                    takenIds={takenActionIds}
                    encounterWon={sceneEncounterWon}
                    // Coop: the DM owns encounters + scene changes, so
                    // players only see narration / skill actions.
                    hideEffectActions={!isSolo}
                    onRun={runAction}
                    busy={runningAction}
                  />
                ) : (
                  <p className="text-center text-xs uppercase tracking-widest text-muted-foreground">
                    {activeTurnName}&apos;s turn…
                  </p>
                )
              ) : null}
              {/* Free-text composer is coop-only — solo plays through
                  the action buttons above. */}
              {!isSolo ? (
                <>
                  {showRoleTabs ? (
                    <ComposerRoleTabs
                      role={composerRole}
                      onChange={(role) =>
                        dispatch({ type: "SET_COMPOSER_ROLE", role })
                      }
                    />
                  ) : null}
                  <textarea
                    value={input}
                    onChange={(e) =>
                      dispatch({ type: "SET_INPUT", input: e.target.value })
                    }
                    placeholder={
                      effectiveRole === "narrative"
                        ? "Describe what happens next."
                        : "What does your character do?"
                    }
                    rows={3}
                    maxLength={4000}
                    disabled={submitting || composerLocked}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send(effectiveRole);
                      }
                    }}
                    className="min-h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      {composerLocked
                        ? `${activeTurnName}'s turn…`
                        : "Cmd / Ctrl + Enter to send."}
                    </p>
                    <div className="flex items-center gap-2">
                      {isDm && currentScene?.transitions.length ? (
                        <Button
                          variant="outline"
                          onClick={() =>
                            dispatch({ type: "SET_ADVANCE_OPEN", open: true })
                          }
                          disabled={advancing}
                        >
                          <CompassIcon className="size-4" />
                          Advance Scene
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => send(effectiveRole)}
                        disabled={!input.trim() || submitting || composerLocked}
                      >
                        {submitting ? "Sending…" : "Send"}
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          )}
          </div>

          {isDm && currentScene ? (
            <div className="md:order-3 md:h-full md:min-h-0">
              <DmNotesPanel
                scene={currentScene}
                onTriggerEncounter={triggerEncounter}
                triggering={triggeringEncounter}
              />
            </div>
          ) : null}
        </div>
      </div>

      {currentScene ? (
        <AdvanceSceneDialog
          open={advanceOpen}
          onOpenChange={(open) => dispatch({ type: "SET_ADVANCE_OPEN", open })}
          scene={currentScene}
          onAdvance={advance}
          busy={advancing}
        />
      ) : null}

      {/* Combat dialog mounts whenever the story has an active
          coop campaign attached. Locks the page until the fight
          resolves (win / lose / forfeit) — see StoryCombatDialog. */}
      {campaign.active_combat_campaign_id ? (
        <StoryCombatDialog
          storyCampaignId={campaign.id}
          combatCampaignId={campaign.active_combat_campaign_id}
          userId={user.id}
          onResolved={handleCombatResolved}
        />
      ) : null}
    </main>
  );
}

// Class id → lucide icon. Mirrors the ACTION_ICON pattern from
// TurnLine so a class-gated player action reads visually as
// "this is a Class affordance" the same way a combat log row
// reads "this is an attack / heal / spell."
const CLASS_ICON: Record<string, LucideIcon> = {
  barbarian: SwordIcon,
  bard: MusicIcon,
  cleric: SunIcon,
  druid: LeafIcon,
  fighter: ShieldIcon,
  monk: HandIcon,
  paladin: HeartPulseIcon,
  ranger: TargetIcon,
  rogue: KeyRoundIcon,
  sorcerer: ZapIcon,
  warlock: FlameIcon,
  wizard: SparklesIcon,
};

// Action-flavor slug → lucide icon. Authors set
// PlayerAction.icon = "sword" / "footprints" / etc. and we
// resolve to the matching lucide here. Same shape as CLASS_ICON;
// class-gated actions take the class icon, universal actions
// take this one, anything else falls back to a neutral chevron.
const ACTION_ICON: Record<PlayerActionIcon, LucideIcon> = {
  sword: SwordIcon,
  footprints: FootprintsIcon,
  search: SearchIcon,
  eye: EyeIcon,
  talk: MessageCircleIcon,
  advance: ArrowRightIcon,
  retreat: ArrowLeftIcon,
  wait: ClockIcon,
  intimidate: SkullIcon,
  trophy: TrophyIcon,
  give: GiftIcon,
};

// One source of truth for "what icon represents this player
// action." Shared between the button (PlayerCommands) and the
// narrative message that the action posts on resolution, so the
// click and the response carry the same visual signature.
function iconForAction(action: PlayerAction): LucideIcon {
  return (
    (action.classes && action.classes.length > 0
      ? CLASS_ICON[action.classes[0]]
      : undefined) ??
    (action.icon ? ACTION_ICON[action.icon] : undefined) ??
    ChevronRightIcon
  );
}

// Pick a leading icon for a narrative message based on what kind
// of beat it is. Action-response messages mirror the button that
// produced them (sword for charge, footprints for sneak, etc.);
// scene openings and free DM narration get the book; conclusions
// get a trophy or skull. Falls back to book when metadata is
// thin or the template can't be resolved.
function iconForNarrative(
  message: StoryMessage,
  template: ReturnType<typeof findCampaign>,
): LucideIcon {
  const meta = message.metadata as Record<string, unknown>;
  const kind = meta.kind;

  if (kind === "player_action_response" && template) {
    const sceneId = typeof meta.scene_id === "string" ? meta.scene_id : null;
    const actionId = typeof meta.action_id === "string" ? meta.action_id : null;
    if (sceneId && actionId) {
      const scene = template.scenes.find((s) => s.id === sceneId);
      const action = scene?.playerActions?.find((a) => a.id === actionId);
      if (action) return iconForAction(action);
    }
  }

  if (kind === "conclusion") {
    return meta.outcome === SUCCESS_END ? TrophyIcon : SkullIcon;
  }

  return BookOpenIcon;
}

function PlayerCommands({
  actions,
  characterClassId,
  takenIds,
  encounterWon,
  hideEffectActions,
  onRun,
  busy,
}: {
  actions: PlayerAction[];
  characterClassId: string | null;
  // Set of action ids already taken in the current scene. Built in
  // the parent from message metadata; the panel uses it to hide
  // single-use actions after they've fired.
  takenIds: Set<string>;
  // Whether the current scene's encounter has been won. Gates
  // `requiresVictory` actions (claim-the-kill beats).
  encounterWon: boolean;
  // Coop: hide actions that change shared world state (advance scene
  // / start encounter) — the DM drives those. Players keep narration
  // and skill beats. Solo passes false (the lone player drives all).
  hideEffectActions: boolean;
  onRun: (action: PlayerAction) => void;
  busy: boolean;
}) {
  // Stack of buttons rendering the current scene's authored
  // player choices. Wraps to multi-row on narrow viewports. While
  // any action is in flight, the whole row disables so a fast
  // double-tap can't fire the same action (or two different ones)
  // before the first response lands.
  //
  // Filter chain (each must pass):
  //   1. Class gate — class-gated actions only show when the
  //      character's class id matches; universal ones always show.
  //   2. One-shot gate — actions vanish once taken in this scene
  //      unless they're explicitly `repeatable`. Resets when the
  //      scene advances because `takenIds` only collects responses
  //      whose metadata.scene_id matches the current scene.
  //   3. Victory gate — `requiresVictory` beats stay hidden until the
  //      scene's encounter is actually won, so "claim the kill" can't
  //      fire without the fight.
  //   4. Effect gate (coop) — actions that advance the scene or start
  //      a fight are hidden; the DM owns those.
  //   5. Spent-encounter gate — once this scene's fight is won, every
  //      encounter-triggering action vanishes (they all spawn the same
  //      fight); the player progresses via the advance action instead.
  //   6. Hide-after-victory gate — pre-combat / negotiate-the-enemy
  //      beats disappear once the fight is won (they no longer make
  //      sense), collapsing the menu to its post-combat options.
  const visible = actions.filter(
    (a) =>
      (!a.classes ||
        a.classes.length === 0 ||
        (characterClassId !== null && a.classes.includes(characterClassId))) &&
      (a.repeatable === true || !takenIds.has(a.id)) &&
      (!a.requiresVictory || encounterWon) &&
      !(
        hideEffectActions &&
        (a.effect?.kind === "advance" || a.effect?.kind === "encounter")
      ) &&
      !(a.effect?.kind === "encounter" && encounterWon) &&
      !(a.hideAfterVictory && encounterWon),
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Your move
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((a) => {
          const Icon = iconForAction(a);
          return (
            // Solid (default) variant so the action stack reads as
            // a row of pressable controls, not another set of
            // bordered cards stacked under the narrative log.
            // min-h-12 matches the fight arena's CommandButton height
            // so the two action surfaces feel consistent.
            <Button
              key={a.id}
              variant="default"
              size="sm"
              onClick={() => onRun(a)}
              disabled={busy}
              className="h-auto min-h-12 px-3 py-1.5 text-left"
            >
              <Icon className="size-4 shrink-0" />
              {a.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function ComposerRoleTabs({
  role,
  onChange,
}: {
  role: ComposerRole;
  onChange: (role: ComposerRole) => void;
}) {
  return (
    <div className="flex w-fit gap-1 rounded-md border border-input bg-muted/30 p-0.5 text-xs uppercase tracking-widest">
      {(
        [
          { key: "player", label: "Player" },
          { key: "narrative", label: "Narrate as DM" },
        ] as const
      ).map((tab) => {
        const active = role === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "rounded-sm px-3 py-1 transition-colors",
              active ? "bg-foreground text-white" : "hover:bg-muted/60",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function DmNotesPanel({
  scene,
  onTriggerEncounter,
  triggering,
}: {
  scene: Scene;
  // Optional so the panel still works in read-only contexts (e.g. a
  // future spectator mode). When provided, each encounter row gets
  // a ▶ Trigger button that posts a system message into the story
  // log marking the encounter as started.
  onTriggerEncounter?: (encounter: Encounter) => void;
  triggering?: boolean;
}) {
  // Always-open panel. `h-full` lets the grid row (sized by the
  // chat column to the left) determine the panel's total height so
  // both columns bottom out together on desktop; on mobile (no
  // grid row sizing), max-h keeps the panel from running off the
  // viewport. The inner ScrollArea (flex-1 + min-h-0) consumes
  // whatever's left after the static header so long scenes scroll
  // rather than bleed past the container.
  return (
    <div className="relative flex h-full max-h-[70vh] flex-col rounded-xl border-2 border-foreground bg-amber-50/60 font-mono dark:bg-amber-950/20 md:max-h-none">
      <PanelLabel>DM Notes</PanelLabel>
      <div className="border-b border-foreground/20 px-4 py-3">
        <span className="text-sm font-bold">{scene.title}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-4 py-3 text-sm leading-relaxed">
            <section>
              <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Background
              </h3>
              <p>{scene.dmBackground}</p>
            </section>

            {scene.readAloud.length > 0 ? (
              <section>
                <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Read-Aloud
                </h3>
                <ul className="flex flex-col gap-2">
                  {scene.readAloud.map((p, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-muted-foreground/20 bg-background p-2 text-xs italic"
                    >
                      “{p}”
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {scene.scripted.encounters?.length ? (
              <section>
                <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Encounters
                </h3>
                <ul className="flex flex-col gap-2 text-xs">
                  {scene.scripted.encounters.map((e, i) => (
                    <li
                      key={i}
                      className="flex items-start justify-between gap-2 rounded-md border border-muted-foreground/20 bg-background p-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p>
                          <span className="font-bold">{e.monsterIndex}</span>
                          {e.count ? ` × ${e.count}` : null} — {e.trigger}
                        </p>
                        {e.intent ? (
                          <p className="text-muted-foreground">{e.intent}</p>
                        ) : null}
                      </div>
                      {onTriggerEncounter ? (
                        <button
                          type="button"
                          onClick={() => onTriggerEncounter(e)}
                          disabled={triggering}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
                        >
                          <PlayIcon className="size-3" />
                          Trigger
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {scene.scripted.rewards?.length ? (
              <section>
                <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Rewards
                </h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {scene.scripted.rewards.map((r, i) => (
                    <li key={i}>
                      <span className="font-bold uppercase">{r.kind}</span>
                      {" — "}
                      {rewardSummary(r)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {scene.scripted.notes?.length ? (
              <section>
                <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                  Notes
                </h3>
                <ul className="list-disc pl-4 text-xs">
                  {scene.scripted.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </section>
            ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function rewardSummary(
  r: NonNullable<Scene["scripted"]["rewards"]>[number],
): string {
  switch (r.kind) {
    case "weapon":
    case "armor":
    case "potion":
      return `${r.baseId}${"bonus" in r && r.bonus ? ` +${r.bonus}` : ""}${r.note ? ` — ${r.note}` : ""}`;
    case "scroll":
      return `${r.spellBaseId}${r.note ? ` — ${r.note}` : ""}`;
    case "xp":
      return `${r.amount} XP${r.note ? ` — ${r.note}` : ""}`;
    case "story":
      return r.description;
  }
}

function AdvanceSceneDialog({
  open,
  onOpenChange,
  scene,
  onAdvance,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scene: Scene;
  onAdvance: (to: string) => void;
  busy: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-2 border-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            Advance the Story
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 font-mono">
          {scene.transitions.map((t) => {
            const isEnding = t.to === SUCCESS_END || t.to === FAILURE_END;
            return (
              <button
                key={t.to}
                type="button"
                onClick={() => onAdvance(t.to)}
                disabled={busy}
                className={cn(
                  "rounded-xl border-2 border-foreground bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 disabled:cursor-wait disabled:opacity-60",
                )}
              >
                <span className="block text-xs uppercase tracking-widest text-muted-foreground">
                  {isEnding
                    ? t.to === SUCCESS_END
                      ? "Conclude · Success"
                      : "Conclude · Failure"
                    : `Next Scene · ${t.to}`}
                </span>
                <span className="text-sm leading-snug">{t.when}</span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({
  message,
  icon,
  authorLabel,
}: {
  message: StoryMessage;
  // Resolved by iconForNarrative in the parent. For action-
  // response messages this is the same icon the button used,
  // so the click and its narrative consequence visually
  // correspond.
  icon: LucideIcon | null;
  // Display name for a player message's author ("You" for the
  // viewer's own lines, the character name for a teammate's).
  // Undefined for non-player rows.
  authorLabel?: string;
}) {
  // Three visual styles. Narrative = DM voice, prose. Player =
  // chat-style bubble. System = small italic stage direction.
  // 'tool' rows aren't rendered for Phase 0 (don't exist yet);
  // when they do, they'll get their own block style.
  if (message.role === "narrative") {
    const Icon = icon ?? BookOpenIcon;
    return (
      <li className="flex items-start gap-2 rounded-md border border-muted-foreground/20 bg-background p-3 text-sm leading-relaxed">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>{message.content}</span>
      </li>
    );
  }
  if (message.role === "player") {
    return (
      <li className="ml-6 rounded-md bg-emerald-50 p-3 text-sm leading-relaxed dark:bg-emerald-950/40">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          {authorLabel ?? "You"}
        </span>
        {message.content}
      </li>
    );
  }
  return (
    <li className="text-center text-xs italic text-muted-foreground">
      {message.content}
    </li>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border-2 border-foreground bg-card p-6 text-center font-mono">
        {children}
      </div>
    </main>
  );
}
