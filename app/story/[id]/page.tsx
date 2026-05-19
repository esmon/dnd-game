"use client";

import { ArrowLeftIcon, CompassIcon, PlayIcon } from "lucide-react";
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
import { PartyRow } from "@/components/shared/party-row";
import { PanelLabel } from "@/components/shared/panel-label";
import type { CampaignPlayer } from "@/lib/coop/types";
import { useUser } from "@/lib/auth/use-user";
import type { Character } from "@/lib/db/schema";
import { findCampaign } from "@/lib/dm/campaigns";
import type { StoryCampaign, StoryMessage } from "@/lib/dm/db";
import {
  FAILURE_END,
  SUCCESS_END,
  type Encounter,
  type Scene,
} from "@/lib/dm/types";
import { cn } from "@/lib/utils";

type Snapshot = {
  campaign: StoryCampaign;
  messages: StoryMessage[];
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
// is shaped around CampaignPlayer. Build a synthetic one from the
// character row — only fields PartyMember actually reads (snapshot,
// current_hp, user_id) need real values; the rest are stub-only
// because actions=[] means the per-player hit / current-turn paths
// never execute.
function characterToPartyMember(
  c: Character,
  userId: string,
): CampaignPlayer {
  return {
    id: c.id,
    campaign_id: "",
    user_id: userId,
    position: 0,
    character_snapshot: c,
    current_hp: c.current_hp,
    is_ready: true,
    continue_ready: false,
    joined_at: c.created_at,
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
  } = state;

  // Auto-scroll the message log to the bottom whenever a new
  // message lands. Pin lives at the end of the ScrollArea's
  // content; scrollIntoView bubbles to the nearest scrollable
  // ancestor (the base-ui Viewport) so the window itself doesn't
  // jump.
  const logBottomRef = useRef<HTMLDivElement>(null);
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

  // One-shot load. Future phases will swap to a realtime channel
  // for incoming DM messages.
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

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || submitting) return;
    dispatch({ type: "SUBMIT_BEGIN" });
    try {
      const res = await fetch(`/api/story/${campaignId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: composerRole, content: trimmed }),
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
  }, [campaignId, input, composerRole, submitting]);

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
      } catch (err) {
        console.error("advance threw", err);
      } finally {
        dispatch({ type: "ADVANCE_END" });
      }
    },
    [campaignId, advancing],
  );

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

  const { campaign, messages, character } = load.data;
  const template = findCampaign(campaign.campaign_template_id);
  const currentScene =
    template?.scenes.find((s) => s.id === campaign.current_scene_id) ?? null;
  // DM seat check. dm_kind=self means the owner is also the DM —
  // they see notes + the advance affordance + the narrate composer
  // mode. When dm_kind='human'/'ai' lands later this gates the same
  // surface correctly without further changes.
  const isDm =
    (campaign.dm_kind === "self" && campaign.user_id === user.id) ||
    (campaign.dm_kind === "human" && campaign.dm_user_id === user.id);
  const isFinished = campaign.status !== "active";

  return (
    <main className="relative flex min-h-screen items-start justify-center p-4 md:p-6">
      <Link
        href="/"
        aria-label="Back to home"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "absolute left-4 top-4 md:left-6 md:top-6",
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
      <div className="flex w-full max-w-7xl flex-col gap-4 pt-12 md:pt-0">
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
            "grid gap-4",
            // Three-column layout when the DM is viewing: party
            // 320px, chat flex, notes 400px. Two-column (party +
            // chat) when not DM. Single column on mobile.
            character && isDm && currentScene
              ? "md:grid-cols-[320px_minmax(0,1fr)_400px]"
              : character
                ? "md:grid-cols-[320px_minmax(0,1fr)]"
                : isDm && currentScene
                  ? "md:grid-cols-[minmax(0,1fr)_400px]"
                  : null,
          )}
        >
          {character ? (
            <aside className="md:order-1">
              <PartyRow
                players={[characterToPartyMember(character, user.id)]}
                actions={[]}
                currentTurnUserId={undefined}
                myUserId={user.id}
              />
            </aside>
          ) : null}
          <div className="flex flex-col gap-3 rounded-xl border-2 border-zinc-900 bg-card p-4 font-mono md:order-2">
          <ScrollArea className="h-[55vh] pr-2">
            <ul className="flex flex-col gap-3">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} />
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
              {isDm ? (
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
                  composerRole === "narrative"
                    ? "Describe what happens next."
                    : "What does your character do?"
                }
                rows={3}
                maxLength={4000}
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className="min-h-20 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Cmd / Ctrl + Enter to send.
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
                  <Button onClick={send} disabled={!input.trim() || submitting}>
                    {submitting ? "Sending…" : "Send"}
                  </Button>
                </div>
              </div>
            </>
          )}
          </div>

          {isDm && currentScene ? (
            <div className="md:order-3">
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
              active ? "bg-zinc-900 text-white" : "hover:bg-muted/60",
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
    <div className="relative flex h-full max-h-[70vh] flex-col rounded-xl border-2 border-zinc-900 bg-amber-50/60 font-mono dark:bg-amber-950/20 md:max-h-none">
      <PanelLabel>DM Notes</PanelLabel>
      <div className="border-b border-zinc-900/20 px-4 py-3">
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
                          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-50"
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
      <DialogContent className="border-2 border-zinc-900 sm:max-w-lg">
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
                  "rounded-xl border-2 border-zinc-900 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/40 disabled:cursor-wait disabled:opacity-60",
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

function MessageRow({ message }: { message: StoryMessage }) {
  // Three visual styles. Narrative = DM voice, prose. Player =
  // chat-style bubble. System = small italic stage direction.
  // 'tool' rows aren't rendered for Phase 0 (don't exist yet);
  // when they do, they'll get their own block style.
  if (message.role === "narrative") {
    return (
      <li className="rounded-md border border-muted-foreground/20 bg-background p-3 text-sm leading-relaxed">
        {message.content}
      </li>
    );
  }
  if (message.role === "player") {
    return (
      <li className="ml-6 rounded-md bg-emerald-50 p-3 text-sm leading-relaxed dark:bg-emerald-950/40">
        <span className="block text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          You
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
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border-2 border-zinc-900 bg-card p-6 text-center font-mono">
        {children}
      </div>
    </main>
  );
}
