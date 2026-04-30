"use client";

import { useEffect, useReducer } from "react";

import {
  FlagIcon,
  FlaskConicalIcon,
  FootprintsIcon,
  HeartIcon,
  ScrollTextIcon,
  SparklesIcon,
  SwordIcon,
} from "lucide-react";

import { CommandPanel, type CommandItem } from "@/components/game/command-panel";
import { HealthBar } from "@/components/game/health-bar";
import { PanelLabel } from "@/components/game/panel-label";
import { TurnLine } from "@/components/game/turn-line";
import { ScrollArea } from "@/components/ui/scroll-area";
import { findClass } from "@/lib/dnd/classes";
import { findLowestSlot } from "@/lib/dnd/spells";
import { useShakeOnNonce, shakeIntensity } from "@/lib/use-shake-on-nonce";
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
}

type BattleAction =
  | { type: "SELECT_MONSTER"; index: number }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_DONE" }
  | { type: "SUBMIT_ERROR"; message: string }
  | { type: "REVEAL_NEXT_ACTION" };

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
  // Init the reveal cursor at the count of *this encounter's* actions,
  // so a mid-encounter reload doesn't replay every past turn but the
  // start of a fresh encounter (whose action log within this encounter
  // is empty) still paces leading monster swings.
  const initialEncounterCount = actions.filter(
    (a) => a.encounter_number === campaign.encounter_number,
  ).length;
  const [state, dispatch] = useReducer(battleReducer, undefined, () =>
    initBattleState(campaign, initialEncounterCount),
  );
  const { submitting, actionError } = state;

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
  useEffect(() => {
    if (isEnded && pendingDrained) onAllActionsRevealed?.();
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
        const text = await res.text();
        dispatch({
          type: "SUBMIT_ERROR",
          message: `Action failed (${res.status}): ${text}`,
        });
        return;
      }
      dispatch({ type: "SUBMIT_DONE" });
      onActionComplete();
    } catch (err) {
      dispatch({
        type: "SUBMIT_ERROR",
        message: err instanceof Error ? err.message : String(err),
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
        const text = await res.text();
        dispatch({
          type: "SUBMIT_ERROR",
          message: `Forfeit failed (${res.status}): ${text}`,
        });
        return;
      }
      dispatch({ type: "SUBMIT_DONE" });
      onActionComplete();
    } catch (err) {
      dispatch({
        type: "SUBMIT_ERROR",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Map server-side campaign_actions → the existing TurnLine shape so we
  // can reuse the solo log styling (color by kind, crit highlight).
  // Only the displayed slice — pending actions appear as their reveal
  // timer fires.
  const turns: Turn[] = displayedActions.map((a) =>
    actionToTurn(a, displayedPlayers),
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
        <div className="flex flex-col items-center gap-1">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
          <h1 className="text-center font-mono text-2xl font-bold uppercase tracking-widest md:text-3xl">
            {turnDescription}
          </h1>
        </div>

        <InitiativeStrip
          campaign={campaign}
          players={displayedPlayers}
          monsters={displayedMonsters}
          currentSlot={currentSlot}
          userId={userId}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <PartyRow
            players={displayedPlayers}
            actions={displayedActions}
            currentTurnUserId={
              currentSlot?.slot.kind === "player"
                ? players[currentSlot.slot.index]?.user_id
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
              currentSlot?.slot.kind === "monster"
                ? currentSlot.slot.index
                : undefined
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <CombatLogPanel turns={turns} />
          <CommandPanel
            commands={buildCommands({
              viewerPlayer:
                displayedPlayers.find((p) => p.user_id === userId) ?? null,
              isMyTurn: isMyTurn && pendingActions.length === 0,
              submitting,
              selectedMonster: displayedMonsters[selectedMonsterIndex] ?? null,
              selectedMonsterIndex,
              hasAnyLivingMonster: displayedMonsters.some(
                (m) => m.health > 0,
              ),
              submit,
            })}
          />
        </div>
        {actionError ? (
          <p className="text-center text-sm text-rose-600">{actionError}</p>
        ) : null}
        <button
          type="button"
          onClick={forfeit}
          disabled={submitting}
          className="mx-auto inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-background px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-rose-400 hover:text-rose-600 disabled:opacity-50 dark:border-zinc-700"
        >
          <FlagIcon className="size-3.5 shrink-0" />
          Forfeit Campaign
        </button>
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
    const aoeReason = spell.aoe
      ? hasAnyLivingMonster
        ? null
        : "No living targets"
      : targetReason;
    const labelSuffix = spell.aoe ? " (AoE)" : "";
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
      kind: "primary",
      icon: HeartIcon,
      label: "HEAL",
      onClick: () => submit({ kind: "heal" }),
      disabled: baseDisabled || !!reason,
      disabledReason: turnReason ?? reason,
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

function PartyRow({
  players,
  actions,
  currentTurnUserId,
  myUserId,
}: {
  players: CampaignPlayer[];
  actions: CampaignAction[];
  currentTurnUserId: string | undefined;
  myUserId: string;
}) {
  return (
    <div className="relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3 font-mono">
      <PanelLabel>Party</PanelLabel>
      <div className="flex flex-col gap-2 pt-2">
        {players.map((p) => (
          <PartyMember
            key={p.id}
            player={p}
            actions={actions}
            isCurrent={p.user_id === currentTurnUserId}
            isMe={p.user_id === myUserId}
          />
        ))}
      </div>
    </div>
  );
}

// One row in the party panel. Pulls its own shake nonce/intensity out of
// the action log so a hit on this player jiggles only this card, scaled
// to the damage it took.
function PartyMember({
  player,
  actions,
  isCurrent,
  isMe,
}: {
  player: CampaignPlayer;
  actions: CampaignAction[];
  isCurrent: boolean;
  isMe: boolean;
}) {
  const dead = player.current_hp <= 0;
  const hits = actions.filter(
    (a) => a.target_kind === "player" && a.target_player_id === player.id,
  );
  const lastDamage = hits.length
    ? Number(
        (hits[hits.length - 1].payload as Record<string, unknown>).damage ?? 0,
      )
    : 0;
  const ref = useShakeOnNonce(
    hits.length,
    shakeIntensity(lastDamage, player.character_snapshot.max_hp),
  );
  const snap = player.character_snapshot;
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2",
        isCurrent ? "border-2 border-zinc-900" : "border-muted-foreground/20",
        dead ? "opacity-50" : "",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold uppercase tracking-widest">
          {snap.name}
          {isMe ? (
            <span className="ml-2 text-xs text-muted-foreground">(You)</span>
          ) : null}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {player.current_hp}/{snap.max_hp}
        </span>
      </div>
      <HealthBar
        current={player.current_hp}
        max={snap.max_hp}
        className="h-2"
      />
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {snap.race} · {snap.class} · Lv: {snap.level}
      </p>
    </div>
  );
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
  const lastDamage = hits.length ? hits[hits.length - 1].damage : 0;
  const ref = useShakeOnNonce<HTMLButtonElement>(
    hits.length,
    shakeIntensity(lastDamage, monster.maxHealth),
  );
  return (
    <button
      ref={ref}
      type="button"
      disabled={dead}
      onClick={() => onSelect(index)}
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors",
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
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-bold uppercase tracking-widest">
          {monster.name}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {monster.health}/{monster.maxHealth}
        </span>
      </div>
      <HealthBar
        current={monster.health}
        max={monster.maxHealth}
        className="h-2"
      />
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
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
          return (
            <li
              key={`${slot.kind}:${slot.index}`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-xs uppercase tracking-widest",
                isCurrent
                  ? "border-2 border-zinc-900 bg-card font-bold"
                  : "border-muted-foreground/20 bg-card/50 text-muted-foreground",
                dead ? "line-through opacity-50" : "",
              )}
            >
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  slot.kind === "player" ? "bg-emerald-500" : "bg-rose-500",
                )}
              />
              <span className="truncate max-w-[10ch]">{name}</span>
              {isMe ? (
                <span className="text-[10px] text-muted-foreground">
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

function CombatLogPanel({ turns }: { turns: Turn[] }) {
  // Reverse for newest-first to match the solo log convention.
  const reversed = [...turns].reverse();
  return (
    <div className="relative h-80 w-full rounded-md border-2 border-zinc-900 bg-card">
      <PanelLabel>Logs</PanelLabel>
      <ScrollArea className="h-full w-full p-3">
        {reversed.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            The arena is silent... for now.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {reversed.map((turn) => (
              <TurnLine key={turn.id} turn={turn} />
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

// Translate a server-side action row into the local Turn shape that
// TurnLine knows how to render. Maps actor/target to a readable line
// and pulls hit/crit/miss flags into the existing color buckets.
function actionToTurn(
  action: CampaignAction,
  _players: CampaignPlayer[],
): Turn {
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
          ? `CRIT — ${actorName} attacks ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}`
          : `${actorName} attacks ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}`;
      }
      break;
    case "spell": {
      const targets = payload.targets;
      if (Array.isArray(targets) && targets.length > 0) {
        // AoE — summarize all hits in one log line.
        const summary = (targets as Array<Record<string, unknown>>)
          .map((t) => `${t.name} (${t.damage}hp)`)
          .join(", ");
        text = `${actorName} casts ${spellName}${typeSuffix} — ${summary}`;
      } else if (missed) {
        text = `${actorName} casts ${spellName} at ${targetName} — MISS (d20 ${payload.d20})`;
      } else {
        text = crit
          ? `CRIT — ${actorName} casts ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}`
          : `${actorName} casts ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}`;
      }
      break;
    }
    case "scroll":
      if (missed) {
        text = `${actorName} reads Scroll of ${spellName} at ${targetName} — MISS (d20 ${payload.d20})`;
      } else {
        text = crit
          ? `CRIT — ${actorName} reads Scroll of ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}`
          : `${actorName} reads Scroll of ${spellName} at ${targetName} for ${damage}hp${typeSuffix}${noteSuffix}`;
      }
      break;
    case "heal":
      text = `${actorName} heals for ${amount}hp`;
      break;
    case "potion":
      text = `${actorName} drinks ${potionName} for ${amount}hp`;
      break;
    default:
      text = `${actorName} does ${action.kind}`;
  }

  return {
    id: action.turn_number,
    isPlayer,
    text,
    kind: crit ? "crit" : undefined,
  };
}
