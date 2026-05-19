"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  BackpackIcon,
  FlagIcon,
  FlaskConicalIcon,
  FootprintsIcon,
  HeartIcon,
  ScrollTextIcon,
  SkullIcon,
  SparklesIcon,
  SunIcon,
  SwordIcon,
} from "lucide-react";

import { readApiError } from "@/lib/coop/api-error";
import { useHideAuthButton } from "@/lib/ui/auth-button-visibility";
import {
  BattleCommands,
  type BattleTile,
} from "@/components/shared/battle-commands";
import { CommandButton } from "@/components/shared/command-button";
import { type CommandItem } from "@/components/shared/command-panel";
import { HealthBar } from "@/components/shared/health-bar";
import { MobileCombatLog } from "@/components/shared/mobile-combat-log";
import { PanelLabel } from "@/components/shared/panel-label";
import { TurnLine } from "@/components/shared/turn-line";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PartyRow } from "@/components/shared/party-row";
import { findClass, prefersSpellsForClass } from "@/lib/dnd/classes";
import { findLowestSlot, isAoeSpell } from "@/lib/dnd/spells";
import { useShakeOnNonce } from "@/lib/use-shake-on-nonce";
import { cn } from "@/lib/utils";
import type {
  Campaign,
  CampaignAction,
  CampaignPlayer,
} from "@/lib/coop/types";
import {
  nextAliveSlot,
  slotsForCampaign,
  type TurnSlot,
} from "@/lib/coop/turn-order";
import type {
  Monster,
  Potion,
  Scroll,
  Turn,
  TurnAction,
} from "@/lib/game/types";

// Local UI state for the battle screen. Everything authoritative lives
// on the server; the reducer just tracks the bits that don't round-trip
// (the user's clicked monster, in-flight submit state, last error,
// and a paced cursor over the action log so monster counter-attacks
// don't all flash in at once when polling sees them together).
interface BattleState {
  selectedMonsterIndex: number;
  submitting: boolean;
  actionError: string | null;
  displayedActionCount: number;
  // Mobile combat log toggle — collapsed shows the two latest entries;
  // expanded swaps in a scrollable area with the full log.
  logExpanded: boolean;
}

type BattleAction =
  | { type: "SELECT_MONSTER"; index: number }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_DONE" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "REVEAL_NEXT_ACTION" }
  | { type: "SET_LOG_EXPANDED"; expanded: boolean };

function initBattleState(
  campaign: Campaign,
  initialActionCount: number,
): BattleState {
  const firstAlive = campaign.monsters.findIndex((m) => m.health > 0);
  return {
    selectedMonsterIndex: firstAlive >= 0 ? firstAlive : 0,
    submitting: false,
    actionError: null,
    // Mid-fight reload shouldn't replay every past turn — only NEW
    // actions (those that arrive while this component is mounted) get
    // paced.
    displayedActionCount: initialActionCount,
    logExpanded: false,
  };
}

function battleReducer(state: BattleState, action: BattleAction): BattleState {
  switch (action.type) {
    case "SELECT_MONSTER":
      return { ...state, selectedMonsterIndex: action.index };
    case "SUBMIT_START":
      return { ...state, submitting: true, actionError: null };
    case "SUBMIT_DONE":
      return { ...state, submitting: false };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, actionError: action.message };
    case "REVEAL_NEXT_ACTION":
      return {
        ...state,
        displayedActionCount: state.displayedActionCount + 1,
      };
    case "SET_LOG_EXPANDED":
      return { ...state, logExpanded: action.expanded };
  }
}

// Solo paces monster swings with a setTimeout in the reducer; coop
// can't do that without splitting the action route, so the same beat
// happens on the client by holding back un-displayed actions. ~700ms
// per reveal feels close to solo's 1s monster suspense without making
// long monster chains drag.
const ACTION_REVEAL_MS = 700;

// Compute displayed monster HP purely from the action log instead of
// rewinding server state. The previous approach (server.health +
// pending damage) was correct only when server.health was already
// post-action; if a poll caught the server mid-write — actions
// inserted but campaign.monsters not yet updated — the rewind would
// double-count and the bar visibly shot up before reveal dropped it
// again. Deriving from actions sidesteps the race entirely: the bar
// only reflects what's been displayed, regardless of server-side
// inconsistency between action log and HP rows.
// 5e CR is stored as a number on the Monster row but displayed in
// fractional form for the < 1 tier. Converts back to "1/8" / "1/4" /
// "1/2" / integer.
function formatCr(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}

// Walk the action log for damage events landing on a specific
// monster index. Handles both single-target hits (target_monster_index
// column) and AoE hits (payload.targets array). Returned in
// chronological order so callers can read "latest hit" off the end.
function collectMonsterHits(
  actions: CampaignAction[],
  index: number,
): Array<{ action: CampaignAction; damage: number }> {
  const hits: Array<{ action: CampaignAction; damage: number }> = [];
  for (const a of actions) {
    const payload = a.payload as Record<string, unknown>;
    const targets = payload.targets;
    if (Array.isArray(targets)) {
      for (const t of targets as Array<Record<string, unknown>>) {
        if (Number(t.monster_index) === index) {
          hits.push({ action: a, damage: Number(t.damage ?? 0) });
        }
      }
      continue;
    }
    if (a.target_kind === "monster" && a.target_monster_index === index) {
      hits.push({ action: a, damage: Number(payload.damage ?? 0) });
    }
  }
  return hits;
}

function deriveDisplayedMonsters(
  monsters: Monster[],
  displayedActions: CampaignAction[],
): Monster[] {
  const damageByIndex = new Map<number, number>();
  for (const a of displayedActions) {
    const payload = a.payload as Record<string, unknown>;
    // AoE actions land damage on multiple monsters via payload.targets;
    // single-target actions use the column + payload.damage.
    const targets = payload.targets;
    if (Array.isArray(targets)) {
      for (const t of targets as Array<Record<string, unknown>>) {
        const idx = Number(t.monster_index);
        const damage = Number(t.damage ?? 0);
        if (Number.isFinite(idx) && damage > 0) {
          damageByIndex.set(idx, (damageByIndex.get(idx) ?? 0) + damage);
        }
      }
      continue;
    }
    if (a.target_kind !== "monster" || a.target_monster_index == null) continue;
    const damage = Number(payload.damage ?? 0);
    if (damage <= 0) continue;
    damageByIndex.set(
      a.target_monster_index,
      (damageByIndex.get(a.target_monster_index) ?? 0) + damage,
    );
  }
  return monsters.map((m, i) => {
    const taken = damageByIndex.get(i) ?? 0;
    return { ...m, health: Math.max(0, m.maxHealth - taken) };
  });
}

// Same idea for player HP — start from the per-player join HP
// (snapshot.current_hp captures the moment they joined the campaign,
// before any combat) and apply damage/heal from each displayed action
// targeting them.
function deriveDisplayedPlayers(
  players: CampaignPlayer[],
  displayedActions: CampaignAction[],
): CampaignPlayer[] {
  const deltaByPlayer = new Map<string, number>();
  for (const a of displayedActions) {
    if (a.target_kind !== "player" || a.target_player_id == null) continue;
    const payload = a.payload as Record<string, unknown>;
    if (a.kind === "attack") {
      const damage = Number(payload.damage ?? 0);
      if (damage > 0) {
        deltaByPlayer.set(
          a.target_player_id,
          (deltaByPlayer.get(a.target_player_id) ?? 0) - damage,
        );
      }
    } else if (a.kind === "heal" || a.kind === "potion") {
      const amount = Number(payload.amount ?? 0);
      if (amount > 0) {
        deltaByPlayer.set(
          a.target_player_id,
          (deltaByPlayer.get(a.target_player_id) ?? 0) + amount,
        );
      }
    }
  }
  return players.map((p) => {
    const delta = deltaByPlayer.get(p.id) ?? 0;
    const startHp = p.character_snapshot.current_hp;
    const maxHp = p.character_snapshot.max_hp;
    return {
      ...p,
      current_hp: Math.max(0, Math.min(maxHp, startHp + delta)),
    };
  });
}

// If the user's last-clicked monster has died, fall through to the
// next living one. Pure derivation — no setState in render — so click
// intent is preserved if the original target is still alive.
function effectiveSelectedIndex(
  intent: number,
  monsters: Monster[],
): number {
  const m = monsters[intent];
  if (m && m.health > 0) return intent;
  const fallback = monsters.findIndex((m) => m.health > 0);
  return fallback >= 0 ? fallback : intent;
}

// Active-state UI for a campaign. Two rows of mini panels (players +
// monsters), a target selector, the command panel for whoever's turn it
// is, and the action log on the side.
//
// Combat state is fully driven from props (server is source of truth);
// this component just renders + dispatches actions back via fetch.
export function CampaignBattle({
  campaign,
  players,
  actions,
  userId,
  onActionComplete,
  onAllActionsRevealed,
}: {
  campaign: Campaign;
  players: CampaignPlayer[];
  actions: CampaignAction[];
  userId: string;
  onActionComplete: () => void;
  onAllActionsRevealed?: () => void;
}) {
  // Init the reveal cursor: skip replay of pre-mount actions on a
  // mid-encounter reload, BUT play out leading monster swings if
  // initiative put a monster ahead of every player and we're loading
  // for the first time. Detection: every action in this encounter
  // is a monster action — meaning no player has acted yet, so what
  // we see is the leading-monster-chain straight off /start. In that
  // case start at 0 so the bars + log + shakes animate in instead of
  // snapping to "you took damage and missed it."
  const encounterActionsForInit = actions.filter(
    (a) => a.encounter_number === campaign.encounter_number,
  );
  const noPlayerHasActed =
    encounterActionsForInit.length > 0 &&
    encounterActionsForInit.every((a) => a.actor_kind === "monster");
  const initialEncounterCount = noPlayerHasActed
    ? 0
    : encounterActionsForInit.length;
  const [state, dispatch] = useReducer(battleReducer, undefined, () =>
    initBattleState(campaign, initialEncounterCount),
  );
  const { submitting, actionError } = state;

  // Hide the global AuthButton while CampaignBattle is mounted so
  // the floating top-right control doesn't crowd the battle UI.
  useHideAuthButton(true);

  // Per-encounter view: action log spans the whole campaign across
  // multiple fights, but each encounter renders independently — past
  // encounters' damage shouldn't show up on the new fight's HP bars
  // or in the current log panel.
  const encounterActions = actions.filter(
    (a) => a.encounter_number === campaign.encounter_number,
  );

  // Pace incoming actions: when polling brings new rows, reveal them
  // one at a time on a timer so the action log, shake animations, and
  // HP bars all step forward together — same beat solo gets from its
  // setTimeout-driven monster swing.
  const displayedCount = Math.min(
    state.displayedActionCount,
    encounterActions.length,
  );
  useEffect(() => {
    if (displayedCount >= encounterActions.length) return;
    const timer = setTimeout(() => {
      dispatch({ type: "REVEAL_NEXT_ACTION" });
    }, ACTION_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [displayedCount, encounterActions.length]);

  // Slice the action log at the displayed cursor and derive monster/
  // player HP purely from the displayed actions. UI children consume
  // only the displayed slice, so bars + shakes + log lines all advance
  // in sync — and we sidestep the GET race where action rows can land
  // before campaign.monsters / campaign_players.current_hp are
  // updated.
  const displayedActions = encounterActions.slice(0, displayedCount);
  const pendingActions = encounterActions.slice(displayedCount);
  const displayedMonsters = deriveDisplayedMonsters(
    campaign.monsters,
    displayedActions,
  );
  const displayedPlayers = deriveDisplayedPlayers(players, displayedActions);

  // Tell the parent when the final swing/heal of an *ending* encounter
  // has actually animated in, so it can hold off swapping to the rest
  // screen or outcome panel until the killing blow is visible. Both
  // between_encounters and finished trigger a screen swap; we gate on
  // either to keep the killing blow on-screen long enough.
  const pendingDrained = pendingActions.length === 0;
  const isEnded =
    campaign.status === "finished" ||
    campaign.status === "between_encounters";
  // Hold the killing-blow frame on screen for a beat after the last
  // action reveals — without the delay, an AoE wipe by a teammate
  // animates in for ~700ms and then the rest screen takes over,
  // leaving the viewer wondering what happened. Long enough for the
  // shake + 0/N HP + skull icon to register, short enough not to
  // feel like the UI's stuck.
  const ENCOUNTER_END_LINGER_MS = 1500;
  useEffect(() => {
    if (!isEnded || !pendingDrained) return;
    const timer = setTimeout(() => {
      onAllActionsRevealed?.();
    }, ENCOUNTER_END_LINGER_MS);
    return () => clearTimeout(timer);
  }, [isEnded, pendingDrained, onAllActionsRevealed]);

  // Effective target: the user's last-clicked monster if it's still
  // alive, otherwise auto-fall-through to the first living monster.
  // Derived on each render rather than synced via useEffect — no
  // setState-during-render footgun, and click intent is preserved.
  const selectedMonsterIndex = effectiveSelectedIndex(
    state.selectedMonsterIndex,
    displayedMonsters,
  );

  const currentSlot = nextAliveSlot(
    campaign.turn_pointer,
    campaign,
    players,
    campaign.monsters,
  );
  const isMyTurn =
    currentSlot?.slot.kind === "player" &&
    players[currentSlot.slot.index]?.user_id === userId;

  // Pre-fight log copy: list the monsters so the empty log reads as
  // an encounter intro rather than dead silence. Falls back to the
  // existing copy when there's nothing to name.
  const encounterIntro = ((): string => {
    const names = displayedMonsters
      .filter((m) => m.health > 0)
      .map((m) => m.name);
    if (names.length === 0) return "The arena is silent... for now.";
    if (names.length === 1) return `${names[0]} appears.`;
    if (names.length === 2) return `${names[0]} and ${names[1]} appear.`;
    return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]} appear.`;
  })();

  // Highlight slot for the InitiativeStrip / PartyRow / MonsterRow.
  // While action reveals are still pacing in, follow the next-to-
  // -reveal action's actor so the highlight tracks what the user is
  // currently watching — without this, the highlight jumps straight
  // to the post-chain turn pointer (e.g. the next player) and the
  // monster's swing animates with no one marked as "currently
  // acting." Falls back to the server's turn pointer once the queue
  // drains.
  const narratedSlot: { pointer: number; slot: TurnSlot } | null = (() => {
    if (pendingActions.length === 0) return currentSlot;
    const next = pendingActions[0];
    const slots = slotsForCampaign(campaign, players, campaign.monsters);
    if (next.actor_kind === "monster" && next.actor_monster_index !== null) {
      const idx = next.actor_monster_index;
      const pointer = slots.findIndex(
        (s) => s.kind === "monster" && s.index === idx,
      );
      if (pointer >= 0) {
        return { pointer, slot: { kind: "monster", index: idx } };
      }
    }
    if (next.actor_kind === "player" && next.actor_player_id !== null) {
      const idx = players.findIndex((p) => p.id === next.actor_player_id);
      const pointer = slots.findIndex(
        (s) => s.kind === "player" && s.index === idx,
      );
      if (idx >= 0 && pointer >= 0) {
        return { pointer, slot: { kind: "player", index: idx } };
      }
    }
    return currentSlot;
  })();

  // While there are still un-displayed actions in flight, the action
  // log narrates whose move the audience is currently watching — feels
  // weirder to flash "Your turn" before the monster's swing has even
  // animated in.
  const turnDescription = (() => {
    if (pendingActions.length > 0) {
      const next = pendingActions[0];
      const actorName =
        (next.payload as Record<string, unknown>).actor_name as string ?? "";
      if (next.actor_kind === "monster") return `${actorName}'s turn`;
      return next.actor_player_id ===
        players.find((p) => p.user_id === userId)?.id
        ? "Your turn"
        : `${actorName}'s turn`;
    }
    if (!currentSlot) return "Turn over.";
    if (currentSlot.slot.kind === "monster") {
      const m = campaign.monsters[currentSlot.slot.index];
      return `${m.name}'s turn`;
    }
    const p = players[currentSlot.slot.index];
    return p.user_id === userId
      ? "Your turn"
      : `${p.character_snapshot.name}'s turn`;
  })();

  async function submit(body: object) {
    dispatch({ type: "SUBMIT_START" });
    try {
      const res = await fetch(`/api/campaign/${campaign.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const message = await readApiError(
          res,
          "Couldn't submit your action. Try again in a second.",
        );
        dispatch({ type: "SUBMIT_ERROR", message });
        // 409s are stale-state collisions (turn timer fired, someone
        // else's action raced ours, etc.) — refetch so the UI shows
        // the new turn pointer instead of leaving the stale buttons
        // active.
        if (res.status === 409) onActionComplete();
        return;
      }
      dispatch({ type: "SUBMIT_DONE" });
      onActionComplete();
    } catch {
      dispatch({
        type: "SUBMIT_ERROR",
        message: "Network hiccup. Check your connection and try again.",
      });
    }
  }

  async function forfeit() {
    if (
      !window.confirm(
        "End this campaign with a defeat? Loot and XP earned this fight will be lost.",
      )
    ) {
      return;
    }
    dispatch({ type: "SUBMIT_START" });
    try {
      const res = await fetch(`/api/campaign/${campaign.id}/forfeit`, {
        method: "POST",
      });
      if (!res.ok) {
        const message = await readApiError(
          res,
          "Couldn't end the campaign. Try again.",
        );
        dispatch({ type: "SUBMIT_ERROR", message });
        return;
      }
      dispatch({ type: "SUBMIT_DONE" });
      onActionComplete();
    } catch {
      dispatch({
        type: "SUBMIT_ERROR",
        message: "Network hiccup. Check your connection and try again.",
      });
    }
  }

  // Map server-side campaign_actions → the existing TurnLine shape so we
  // can reuse the solo log styling (color by kind, crit highlight).
  // Only the displayed slice — pending actions appear as their reveal
  // timer fires.
  const turns: Turn[] = displayedActions.map(actionToTurn);

  // Build commands once so the BattleCommands tiles render the exact
  // same kit at every viewport (no chance of drift).
  const viewerPlayer =
    displayedPlayers.find((p) => p.user_id === userId) ?? null;
  const commands = buildCommands({
    viewerPlayer,
    isMyTurn: isMyTurn && pendingActions.length === 0,
    submitting,
    selectedMonster: displayedMonsters[selectedMonsterIndex] ?? null,
    selectedMonsterIndex,
    hasAnyLivingMonster: displayedMonsters.some((m) => m.health > 0),
    submit,
  });
  const viewerClass = viewerPlayer
    ? findClass(viewerPlayer.character_snapshot.class)
    : undefined;
  const prefersSpells = prefersSpellsForClass(viewerClass);
  // Skip Turn lives outside the 4-tile grid (no solo analog) — pull
  // the command item the panel would have rendered so the secondary
  // button below shares its disabled/onClick wiring.
  const skipItem = commands.find(
    (item): item is Extract<CommandItem, { key: string; kind: unknown }> =>
      !("render" in item) && item.key === "skip",
  );

  // "Encounter 2 · Hard" header so the table knows which fight it's
  // in and what kind of trouble was rolled. Color-codes by difficulty
  // so a quick glance signals the threat level.
  const difficultyColor =
    campaign.current_difficulty === "deadly"
      ? "text-rose-600"
      : campaign.current_difficulty === "hard"
        ? "text-amber-600"
        : campaign.current_difficulty === "medium"
          ? "text-foreground"
          : "text-muted-foreground";

  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-6">
      <div className="flex w-full max-w-5xl flex-col gap-6">
        {/* Sticky on mobile so a small viewport (e.g. an in-app
            browser like Pulse) keeps "Your Turn" + the auto-skip
            timer visible while the player scrolls through party /
            monster panels. Static at md+ where the layout fits in
            one screen. */}
        <div className="sticky top-0 z-10 -mx-4 flex flex-col items-center gap-1 bg-background px-4 pb-2 pt-4 md:static md:m-0 md:p-0">
          <p className="font-mono text-xs uppercase tracking-widest">
            Encounter {campaign.encounter_number}
            {campaign.current_difficulty ? (
              <>
                {" · "}
                <span className={cn("font-bold", difficultyColor)}>
                  {campaign.current_difficulty}
                </span>
              </>
            ) : null}
          </p>
          <h1
            className={cn(
              "text-center font-mono text-2xl font-bold uppercase tracking-widest md:text-3xl",
              // Glance-read "it's my turn" cue. Only when the reveal
              // queue has drained — otherwise we'd flash green while
              // the player is still watching a teammate's swing
              // animate in.
              isMyTurn && pendingActions.length === 0
                ? "text-blue-600"
                : null,
            )}
          >
            {turnDescription}
          </h1>
          <TurnTimer
            deadline={campaign.turn_deadline}
            campaignId={campaign.id}
            active={
              campaign.status === "active" && pendingActions.length === 0
            }
          />
        </div>

        <InitiativeStrip
          campaign={campaign}
          players={displayedPlayers}
          monsters={displayedMonsters}
          currentSlot={narratedSlot}
          userId={userId}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <PartyRow
            players={displayedPlayers}
            actions={displayedActions}
            currentTurnUserId={
              narratedSlot?.slot.kind === "player"
                ? players[narratedSlot.slot.index]?.user_id
                : undefined
            }
            myUserId={userId}
          />
          <MonsterRow
            monsters={displayedMonsters}
            actions={displayedActions}
            selectedIndex={selectedMonsterIndex}
            onSelect={(index) => dispatch({ type: "SELECT_MONSTER", index })}
            currentTurnMonsterIndex={
              narratedSlot?.slot.kind === "monster"
                ? narratedSlot.slot.index
                : undefined
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <CombatLogPanel
            className="hidden md:block"
            turns={turns}
            emptyMessage={encounterIntro}
          />
          <BattleCommands
            tiles={buildBattleTiles({
              commands,
              forfeit,
              submitting,
              prefersSpells,
              baseDisabled:
                !(isMyTurn && pendingActions.length === 0) || submitting,
              baseDisabledReason: isMyTurn ? null : "Wait for your turn",
            })}
          />
        </div>

        <MobileCombatLog
          turns={turns}
          expanded={state.logExpanded}
          onToggle={(expanded) =>
            dispatch({ type: "SET_LOG_EXPANDED", expanded })
          }
          emptyMessage={encounterIntro}
        />
        {actionError ? (
          <p className="text-center text-sm text-rose-600">{actionError}</p>
        ) : null}
        {skipItem ? (
          <button
            type="button"
            onClick={skipItem.onClick}
            disabled={skipItem.disabled}
            title={skipItem.disabledReason ?? undefined}
            className="mx-auto inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-background px-3 py-2 text-xs uppercase tracking-widest transition-colors hover:border-foreground disabled:opacity-50 dark:border-zinc-700"
          >
            <FootprintsIcon className="size-3.5 shrink-0" />
            Skip Turn
          </button>
        ) : null}
      </div>
    </main>
  );
}

// Build the command list for the *viewer* — i.e. the signed-in user
// looking at the screen, not whoever's turn it currently is. Mirrors
// the solo Command panel: weapons → smite (TODO) → spells → scrolls →
// heal → potions → skip. Disabled state surfaces a reason (not your
// turn / out of slots / out of consumables / etc.); the panel always
// shows your own kit so it doesn't flicker between players' loadouts
// each round.
function buildCommands({
  viewerPlayer,
  isMyTurn,
  submitting,
  selectedMonster,
  selectedMonsterIndex,
  hasAnyLivingMonster,
  submit,
}: {
  viewerPlayer: CampaignPlayer | null;
  isMyTurn: boolean;
  submitting: boolean;
  selectedMonster: Monster | null;
  selectedMonsterIndex: number;
  hasAnyLivingMonster: boolean;
  submit: (body: object) => void;
}): CommandItem[] {
  // Spectator (not a member of this campaign) — shouldn't normally
  // happen since the page gates on membership, but render a stub so
  // the panel isn't empty if it does.
  if (!viewerPlayer) {
    return [
      {
        key: "skip",
        kind: "neutral",
        icon: FootprintsIcon,
        label: "Skip Turn",
        disabled: true,
        disabledReason: "Spectating",
      },
    ];
  }

  const snap = viewerPlayer.character_snapshot;
  const klass = findClass(snap.class);
  const targetReason = !selectedMonster
    ? "No target selected"
    : selectedMonster.health <= 0
      ? "Pick a living target"
      : null;
  const turnReason = isMyTurn ? null : "Wait for your turn";
  const baseDisabled = !isMyTurn || submitting;

  const commands: CommandItem[] = [];

  // One button per weapon — solo only shows the first; coop lets you
  // pick. Disabled when target is dead/missing.
  for (const weapon of snap.weapons) {
    commands.push({
      key: `weapon:${weapon.id}`,
      kind: "weapon",
      icon: SwordIcon,
      label: weapon.name,
      subtitle: `${weapon.damage} ${weapon.damageType}`,
      onClick: () =>
        submit({
          kind: "attack",
          weaponId: weapon.id,
          targetMonsterIndex: selectedMonsterIndex,
        }),
      disabled: baseDisabled || !!targetReason,
      disabledReason: turnReason ?? targetReason,
      // No living target → hide; "wait your turn" is a resource-ish
      // reason (keep visible so the player still sees their kit).
      hideWhenDisabled: !!targetReason,
    });
  }

  // Paladin Divine Smite: weapon attack + (slotLevel + 1)d8 radiant.
  // Slot is consumed only on hit (5e RAW: smite declared after the
  // hit lands). Available from level 2; we always default to the
  // lowest available slot, matching the solo arena.
  const smiteEligible =
    klass?.id === "paladin" && snap.level >= 2 && snap.weapons.length > 0;
  if (smiteEligible) {
    const lowestSlot = findLowestSlot(snap.spell_slots);
    const smiteWeapon = snap.weapons[0];
    const outOfSlots = !lowestSlot;
    const smiteReason = outOfSlots
      ? "Out of spell slots"
      : null;
    const slotLevel = lowestSlot?.level ?? 1;
    commands.push({
      key: "smite",
      kind: "smite",
      icon: SunIcon,
      label: outOfSlots ? "Smite" : `Smite (L${slotLevel})`,
      subtitle: outOfSlots
        ? "+?d8 radiant"
        : `+${slotLevel + 1}d8 radiant`,
      onClick: () =>
        submit({
          kind: "smite",
          weaponId: smiteWeapon.id,
          slotLevel,
          targetMonsterIndex: selectedMonsterIndex,
        }),
      disabled: baseDisabled || outOfSlots || !!targetReason,
      disabledReason: turnReason ?? smiteReason ?? targetReason,
      // Hide on no-target state; out-of-slots is a resource reason
      // worth seeing (so the player knows they have Smite at all).
      hideWhenDisabled: !!targetReason && !outOfSlots,
    });
  }

  // Equipped spells. Cantrips (level 0) are free; higher levels need
  // an available slot. AoE spells skip the per-target gating — they
  // hit every alive monster in one cast, so they only need *any*
  // living target on the board.
  for (const spell of snap.equipped_spells) {
    const slotsLeft =
      spell.level === 0
        ? Infinity
        : (snap.spell_slots[String(spell.level)] ?? 0);
    const slotInfo =
      spell.level === 0 ? "cantrip" : `L${spell.level} · ${slotsLeft}`;
    const outOfSlots = spell.level > 0 && slotsLeft <= 0;
    const aoe = isAoeSpell(spell);
    const aoeReason = aoe
      ? hasAnyLivingMonster
        ? null
        : "No living targets"
      : targetReason;
    const labelSuffix = aoe ? " (AoE)" : "";
    commands.push({
      key: `spell:${spell.id}`,
      kind: "spell",
      icon: SparklesIcon,
      label: spell.name + labelSuffix,
      subtitle: `${spell.damage} · ${slotInfo}`,
      onClick: () =>
        submit({
          kind: "spell",
          spellId: spell.id,
          targetMonsterIndex: selectedMonsterIndex,
        }),
      disabled: baseDisabled || outOfSlots || !!aoeReason,
      disabledReason:
        turnReason ??
        (outOfSlots ? `Out of L${spell.level} spell slots` : aoeReason),
      // Hide on state (no living target / no living anyone for AoE);
      // keep visible when out-of-slots so the player sees the spell.
      hideWhenDisabled: !!aoeReason && !outOfSlots,
    });
  }

  // Scrolls (consumables that target a monster).
  const scrolls = snap.consumables.filter(
    (c): c is Scroll => c.kind === "scroll",
  );
  for (const scroll of scrolls) {
    commands.push({
      key: `scroll:${scroll.id}`,
      kind: "scroll",
      icon: ScrollTextIcon,
      label: scroll.spellName,
      subtitle: `Scroll · ${scroll.damage}`,
      onClick: () =>
        submit({
          kind: "scroll",
          scrollId: scroll.id,
          targetMonsterIndex: selectedMonsterIndex,
        }),
      disabled: baseDisabled || !!targetReason,
      disabledReason: turnReason ?? targetReason,
      hideWhenDisabled: !!targetReason,
    });
  }

  // Heal — gated by class flags and slot availability.
  if (klass?.canSelfHealInCombat) {
    const minLevel = klass.healMinLevel ?? 1;
    const underMinLevel = snap.level < minLevel;
    const lowestSlot = klass.healCostsSlot
      ? findLowestSlot(snap.spell_slots)
      : undefined;
    const outOfSlots = !!klass.healCostsSlot && !lowestSlot;
    const fullHp = viewerPlayer.current_hp >= snap.max_hp;
    const reason = underMinLevel
      ? `Available at level ${minLevel}`
      : outOfSlots
        ? "Out of spell slots"
        : fullHp
          ? "Already at full HP"
          : null;
    commands.push({
      key: "heal",
      kind: "heal",
      icon: HeartIcon,
      label: "Heal",
      onClick: () => submit({ kind: "heal" }),
      disabled: baseDisabled || !!reason,
      disabledReason: turnReason ?? reason,
      // Full HP is a state reason — hide. Out-of-slots and
      // under-min-level are informative (keep visible).
      hideWhenDisabled: fullHp && !outOfSlots && !underMinLevel,
    });
  }

  // Potions (self-heal consumables). Don't need a target.
  const potions = snap.consumables.filter(
    (c): c is Potion => c.kind === "potion",
  );
  for (const potion of potions) {
    const fullHp = viewerPlayer.current_hp >= snap.max_hp;
    commands.push({
      key: `potion:${potion.id}`,
      kind: "potion",
      icon: FlaskConicalIcon,
      label: potion.name,
      subtitle: `Potion · ${potion.healDice}`,
      onClick: () => submit({ kind: "potion", potionId: potion.id }),
      disabled: baseDisabled || fullHp,
      disabledReason: turnReason ?? (fullHp ? "Already at full HP" : null),
      hideWhenDisabled: fullHp,
    });
  }

  commands.push({
    key: "skip",
    kind: "neutral",
    icon: FootprintsIcon,
    label: "Skip Turn",
    onClick: () => submit({ kind: "skip" }),
    disabled: baseDisabled,
    disabledReason: turnReason,
  });

  return commands;
}

// Slice the flat command list into the four tiles the battle panel
// expects: Attack (weapons + smite), Spell (spells + scrolls + heal),
// Inventory (potions) — matching solo — and Forfeit as the red panic
// tile. Skip Turn is a coop-only action with no solo analog; the
// caller renders it as a small text button below the panel.
function buildBattleTiles({
  commands,
  forfeit,
  submitting,
  prefersSpells,
  baseDisabled,
  baseDisabledReason,
}: {
  commands: CommandItem[];
  forfeit: () => void;
  submitting: boolean;
  prefersSpells: boolean;
  baseDisabled: boolean;
  baseDisabledReason: string | null;
}): BattleTile[] {
  const attackKinds = new Set(["weapon", "smite"]);
  const spellKinds = new Set(["spell", "scroll", "heal"]);
  const inventoryKinds = new Set(["potion"]);

  // Items contributing to each tile, after the same hide-when-disabled
  // filter the desktop panel applies. The tile is disabled when the
  // resulting list is empty so the popover never opens with nothing
  // inside it (matches solo).
  const itemsFor = (match: Set<string>) =>
    commands.flatMap((item) => {
      if ("render" in item) return [];
      if (!match.has(item.kind)) return [];
      if (item.disabled && item.hideWhenDisabled) return [];
      return [item];
    });
  const toNodes = (items: ReturnType<typeof itemsFor>) =>
    items.map((item) => {
      const { key, ...props } = item;
      return <CommandButton key={key} {...props} />;
    });

  const attackItems = itemsFor(attackKinds);
  const spellItems = itemsFor(spellKinds);
  const inventoryItems = itemsFor(inventoryKinds);

  const attackTile: BattleTile = {
    key: "attack",
    kind: "attack",
    icon: SwordIcon,
    label: "Attack",
    disabled: baseDisabled || attackItems.length === 0,
    disabledReason: baseDisabled
      ? baseDisabledReason
      : attackItems.length === 0
        ? "No weapons available"
        : null,
    popover: toNodes(attackItems),
  };
  const spellTile: BattleTile = {
    key: "spell",
    kind: "spell",
    icon: SparklesIcon,
    label: "Spells",
    disabled: baseDisabled || spellItems.length === 0,
    disabledReason: baseDisabled
      ? baseDisabledReason
      : spellItems.length === 0
        ? "No spells available"
        : null,
    popover: toNodes(spellItems),
  };

  return [
    ...(prefersSpells ? [spellTile, attackTile] : [attackTile, spellTile]),
    {
      key: "inventory",
      kind: "neutral",
      icon: BackpackIcon,
      label: "Inventory",
      disabled: inventoryItems.length === 0,
      disabledReason:
        inventoryItems.length === 0 ? "No items available" : null,
      popover: toNodes(inventoryItems),
    },
    {
      key: "forfeit",
      kind: "danger",
      icon: FlagIcon,
      label: "Forfeit",
      disabled: submitting,
      onClick: forfeit,
    },
  ];
}

function MonsterRow({
  monsters,
  actions,
  selectedIndex,
  onSelect,
  currentTurnMonsterIndex,
}: {
  monsters: Monster[];
  actions: CampaignAction[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  currentTurnMonsterIndex: number | undefined;
}) {
  return (
    <div className="relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3 font-mono">
      <PanelLabel>Monsters</PanelLabel>
      <div className="flex flex-col gap-2 pt-2">
        {monsters.map((m, i) => (
          <MonsterButton
            key={i}
            monster={m}
            index={i}
            actions={actions}
            selected={i === selectedIndex}
            acting={i === currentTurnMonsterIndex}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

// One monster row in the monster panel. Same pattern as PartyMember:
// derives its own shake nonce/intensity from actions targeting this
// monster index, so attacks visibly land on the right body.
function MonsterButton({
  monster,
  index,
  actions,
  selected,
  acting,
  onSelect,
}: {
  monster: Monster;
  index: number;
  actions: CampaignAction[];
  selected: boolean;
  acting: boolean;
  onSelect: (index: number) => void;
}) {
  const dead = monster.health <= 0;
  // Include both single-target hits (column-targeted) and AoE hits
  // (payload.targets array). AoE shakes need to fire for every monster
  // a Fireball lands on, not just the first one stamped on the row.
  const hits = collectMonsterHits(actions, index);
  const ref = useShakeOnNonce<HTMLButtonElement>(hits.length);
  return (
    <button
      ref={ref}
      type="button"
      disabled={dead}
      onClick={() => onSelect(index)}
      className={cn(
        "relative flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors",
        acting
          ? "border-2 border-zinc-900"
          : selected && !dead
            ? "border-2 border-rose-500"
            : "border-muted-foreground/20",
        dead
          ? "cursor-not-allowed opacity-50"
          : "cursor-pointer hover:bg-muted",
      )}
    >
      {selected && !dead ? (
        <span className="absolute -top-3 left-3 bg-card px-1.5 font-mono text-xs font-bold uppercase tracking-widest text-rose-500">
          Target
        </span>
      ) : null}
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {dead ? (
            <SkullIcon
              className="size-4 shrink-0"
              aria-label="Defeated"
            />
          ) : null}
          <span className="truncate text-sm font-bold uppercase tracking-widest">
            {monster.name}
          </span>
        </span>
        <span className="font-mono text-xs tabular-nums">
          {monster.health}/{monster.maxHealth}
        </span>
      </div>
      <HealthBar
        current={monster.health}
        max={monster.maxHealth}
        className="h-2"
      />
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-widest">
        <span>CR: {formatCr(monster.challengeRating)}</span>
        <span>· AC: {monster.ac}</span>
        <span>· ATK: {monster.damageType}</span>
        {monster.damageVulnerabilities.length > 0 ? (
          <span className="text-amber-600">
            · VUL: {monster.damageVulnerabilities.join(", ")}
          </span>
        ) : null}
        {monster.damageResistances.length > 0 ? (
          <span className="text-sky-600">
            · RES: {monster.damageResistances.join(", ")}
          </span>
        ) : null}
        {monster.damageImmunities.length > 0 ? (
          <span className="text-violet-600">
            · IMM: {monster.damageImmunities.join(", ")}
          </span>
        ) : null}
      </p>
    </button>
  );
}

// Horizontal initiative pill strip. Up to 6 PCs + several monsters
// in any DEX-rolled order makes "whose turn is up next" hard to track
// from the turn header alone — this exposes the order so players can
// plan around it (heal the next-acting low-HP teammate, save a spell
// for the monster about to swing, etc.).
// Per-turn idle countdown. Renders the seconds remaining until the
// active player's turn auto-skips. When the deadline passes, the
// first connected client posts /timeout — server is idempotent so
// duplicate calls from racing clients just 409. A small jitter (0–1.5s)
// after expiry stops every client from posting in the same instant.
function TurnTimer({
  deadline,
  campaignId,
  active,
}: {
  deadline: string | null;
  campaignId: string;
  active: boolean;
}) {
  // Hold wall-clock `now` in state so the render path stays pure
  // (no Date.now() during render, which the lint rule blocks). The
  // tick that advances `now` is fired from setInterval — canonical
  // "external system" setState — so it doesn't trip the in-effect
  // setState rule either. secondsLeft is derived from now + deadline,
  // which falls back to null when active/deadline drop without
  // needing an explicit setState clear.
  const [now, setNow] = useState(() => Date.now());
  const firedFor = useRef<string | null>(null);
  const secondsLeft =
    active && deadline
      ? Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000))
      : null;

  useEffect(() => {
    if (!active || !deadline) return;
    const deadlineMs = new Date(deadline).getTime();
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= deadlineMs && firedFor.current !== deadline) {
        firedFor.current = deadline;
        // Jitter 0–1500ms so two browsers watching the same fight
        // don't both fire at the exact same millisecond. Whichever
        // lands first wins; the other gets a 409 because turn_deadline
        // has already been reset by the timeout endpoint.
        const wait = Math.floor(Math.random() * 1500);
        setTimeout(() => {
          void fetch(`/api/campaign/${campaignId}/timeout`, {
            method: "POST",
          });
        }, wait);
      }
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, active, campaignId]);

  // Reserve the timer's vertical space even when inactive — between
  // an action submitting and the new turn_deadline arriving, this
  // component flickers from "shown" → null → "shown" and the layout
  // below would jump if we returned null. `invisible` keeps it
  // occupying space without painting.
  const visible = active && secondsLeft !== null;
  const display = secondsLeft ?? 0;
  const tone = !visible
    ? "invisible"
    : display <= 5
      ? "text-rose-600"
      : display <= 15
        ? "text-amber-600"
        : "text-muted-foreground";
  return (
    <p
      aria-hidden={!visible}
      className={cn(
        "font-mono text-xs uppercase tracking-widest tabular-nums",
        tone,
      )}
    >
      Auto-skip in {display}s
    </p>
  );
}

function InitiativeStrip({
  campaign,
  players,
  monsters,
  currentSlot,
  userId,
}: {
  campaign: Campaign;
  players: CampaignPlayer[];
  monsters: Monster[];
  currentSlot: { pointer: number; slot: TurnSlot } | null;
  userId: string;
}) {
  const slots = slotsForCampaign(campaign, players, monsters);
  if (slots.length === 0) return null;
  const currentIndex = currentSlot?.pointer ?? -1;

  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ol className="flex min-w-max items-stretch gap-1.5 font-mono">
        {slots.map((slot, i) => {
          const isCurrent = i === currentIndex;
          let name = "";
          let isMe = false;
          let dead = false;
          if (slot.kind === "player") {
            const p = players[slot.index];
            if (!p) return null;
            name = p.character_snapshot.name;
            isMe = p.user_id === userId;
            dead = p.current_hp <= 0;
          } else {
            const m = monsters[slot.index];
            if (!m) return null;
            name = m.name;
            dead = m.health <= 0;
          }
          // The viewer's own active turn fills emerald instead of
          // the default border treatment so it pops at a glance —
          // the friend who flagged "I can't tell when it's my turn"
          // was on a small viewport where the bordered version
          // didn't read as different enough.
          const isMyActive = isCurrent && slot.kind === "player" && isMe;
          return (
            <li
              key={`${slot.kind}:${slot.index}`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs uppercase tracking-widest",
                isMyActive
                  ? "border-2 border-blue-600 bg-blue-600 font-bold text-white"
                  : isCurrent
                    ? "border-2 border-zinc-900 bg-card font-bold"
                    : "border-muted-foreground/20 bg-card/50",
                dead ? "line-through opacity-50" : "",
              )}
            >
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  isMyActive
                    ? "bg-white"
                    : slot.kind === "player"
                      ? "bg-emerald-500"
                      : "bg-rose-500",
                )}
              />
              <span className="truncate max-w-[10ch]">{name}</span>
              {typeof slot.roll === "number" ? (
                <span className="font-mono tabular-nums text-[10px]">
                  {slot.roll}
                </span>
              ) : null}
              {isMe ? (
                <span className="text-[10px]">
                  (You)
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CombatLogPanel({
  turns,
  className,
  emptyMessage = "The arena is silent... for now.",
}: {
  turns: Turn[];
  className?: string;
  emptyMessage?: string;
}) {
  // Reverse for newest-first to match the solo log convention.
  const reversed = [...turns].reverse();
  // Desktop-only panel now: mobile uses MobileCombatLog (collapsible),
  // so we just have to fit the grid row whose height the BattleCommands
  // sibling sets. Absolute-position the scroll area so log content
  // doesn't push the row taller than the commands.
  return (
    <div
      className={cn(
        "relative h-auto min-h-0 w-full rounded-md border-2 border-zinc-900 bg-card",
        className,
      )}
    >
      <PanelLabel>Logs</PanelLabel>
      <div className="absolute inset-0 overflow-hidden">
        <ScrollArea className="h-full w-full p-3">
          {reversed.length === 0 ? (
            <p className="text-center text-sm">{emptyMessage}</p>
          ) : (
            <ul className="space-y-1.5">
              {reversed.map((turn) => (
                <TurnLine key={turn.id} turn={turn} />
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

// Translate a server-side action row into the local Turn shape that
// TurnLine knows how to render. Maps actor/target to a readable line
// and pulls hit/crit/miss flags into the existing color buckets.
function actionToTurn(action: CampaignAction): Turn {
  const payload = action.payload as Record<string, unknown>;
  const actorName = (payload.actor_name as string) ?? "Someone";
  const targetName = (payload.target_name as string) ?? "—";
  const damage = (payload.damage as number) ?? 0;
  const missed = (payload.missed as boolean) ?? false;
  const crit = (payload.crit as boolean) ?? false;
  const note = (payload.note as string) ?? "";
  const damageType = (payload.damage_type as string) ?? "";
  const isPlayer = action.actor_kind === "player";

  const spellName = (payload.spell_name as string) ?? "";
  const potionName = (payload.potion_name as string) ?? "";
  const amount = (payload.amount as number) ?? 0;
  const noteSuffix = note ? ` (${note})` : "";
  const typeSuffix = damageType ? ` ${damageType}` : "";

  // Loot tail for kill-bearing actions. AoE spells stamp each
  // kill's loot under payload.kills[]; single-target hits use the
  // legacy payload.loot field. Either way the names get appended
  // so a teammate's mid-fight Plate drop reads in the combat log
  // instead of waiting for the rest screen.
  const lootTail = ((): string => {
    const kills = payload.kills;
    if (Array.isArray(kills)) {
      const names = (kills as Array<Record<string, unknown>>)
        .map((k) => (k.loot as { name?: string } | null)?.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
      if (names.length > 0) return ` — picks up ${names.join(", ")}`;
    }
    const loot = payload.loot as { name?: string } | null;
    if (loot && typeof loot.name === "string" && loot.name.length > 0) {
      return ` — picks up ${loot.name}`;
    }
    return "";
  })();

  let text: string;
  switch (action.kind) {
    case "skip":
      text = `${actorName} skips their turn`;
      break;
    case "attack":
      if (missed) {
        text = `${actorName} attacks ${targetName} — MISS (d20 ${payload.d20})`;
      } else {
        text = crit
          ? `CRIT — ${actorName} attacks ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}${lootTail}`
          : `${actorName} attacks ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}${lootTail}`;
      }
      break;
    case "spell": {
      const targets = payload.targets;
      if (Array.isArray(targets) && targets.length > 0) {
        // AoE — summarize all hits in one log line.
        const summary = (targets as Array<Record<string, unknown>>)
          .map((t) => `${t.name} (${t.damage}hp)`)
          .join(", ");
        text = `${actorName} casts ${spellName}${typeSuffix} — ${summary}${lootTail}`;
      } else if (missed) {
        text = `${actorName} casts ${spellName} at ${targetName} — MISS (d20 ${payload.d20})`;
      } else {
        text = crit
          ? `CRIT — ${actorName} casts ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}${lootTail}`
          : `${actorName} casts ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}${lootTail}`;
      }
      break;
    }
    case "scroll":
      if (missed) {
        text = `${actorName} reads Scroll of ${spellName} at ${targetName} — MISS (d20 ${payload.d20})`;
      } else {
        text = crit
          ? `CRIT — ${actorName} reads Scroll of ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}${lootTail}`
          : `${actorName} reads Scroll of ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}${lootTail}`;
      }
      break;
    case "heal":
      text = `${actorName} heals for ${amount}hp`;
      break;
    case "potion":
      text = `${actorName} drinks ${potionName} for ${amount}hp`;
      break;
    case "smite": {
      const weaponName = (payload.weapon_name as string) ?? "their weapon";
      const slotLevel = (payload.slot_level as number) ?? 1;
      const smiteDamage = (payload.smite_damage as number) ?? 0;
      if (missed) {
        text = `${actorName} smites ${targetName} with ${weaponName} — MISS (d20 ${payload.d20})`;
      } else {
        const smiteSuffix = ` (L${slotLevel} smite +${smiteDamage} radiant)`;
        text = crit
          ? `CRIT — ${actorName} smites ${targetName} with ${weaponName} for ${damage}hp${smiteSuffix}${lootTail}`
          : `${actorName} smites ${targetName} with ${weaponName} for ${damage}hp${smiteSuffix}${lootTail}`;
      }
      break;
    }
    default:
      text = `${actorName} does ${action.kind}`;
  }

  // Map server-side CampaignActionKind to the client TurnAction so
  // the combat log row can render the matching icon. "run-away"
  // collapses to "skip" (nothing distinguishes it visually for now).
  const turnAction: TurnAction | undefined =
    action.kind === "attack"
      ? "attack"
      : action.kind === "spell"
        ? "spell"
        : action.kind === "scroll"
          ? "scroll"
          : action.kind === "smite"
            ? "smite"
            : action.kind === "heal"
              ? "heal"
              : action.kind === "potion"
                ? "potion"
                : action.kind === "skip" || action.kind === "run-away"
                  ? "skip"
                  : undefined;

  return {
    id: action.turn_number,
    isPlayer,
    text,
    kind: crit ? "crit" : undefined,
    action: turnAction,
  };
}
