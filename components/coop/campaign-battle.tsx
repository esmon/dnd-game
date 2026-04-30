"use client";

import { useState } from "react";

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
import { nextAliveSlot } from "@/lib/coop/turn-order";
import type {
  Monster,
  Potion,
  Scroll,
  Turn,
} from "@/lib/game/types";

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
}: {
  campaign: Campaign;
  players: CampaignPlayer[];
  actions: CampaignAction[];
  userId: string;
  onActionComplete: () => void;
}) {
  const [selectedMonsterIndex, setSelectedMonsterIndex] = useState<number>(
    () => campaign.monsters.findIndex((m) => m.health > 0) || 0,
  );
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const currentSlot = nextAliveSlot(
    campaign.turn_pointer,
    players,
    campaign.monsters,
  );
  const isMyTurn =
    currentSlot?.slot.kind === "player" &&
    players[currentSlot.slot.index]?.user_id === userId;

  const turnDescription = (() => {
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
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/campaign/${campaign.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        setActionError(`Action failed (${res.status}): ${text}`);
        return;
      }
      onActionComplete();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
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
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/campaign/${campaign.id}/forfeit`, {
        method: "POST",
      });
      if (!res.ok) {
        const text = await res.text();
        setActionError(`Forfeit failed (${res.status}): ${text}`);
        return;
      }
      onActionComplete();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Map server-side campaign_actions → the existing TurnLine shape so we
  // can reuse the solo log styling (color by kind, crit highlight).
  const turns: Turn[] = actions.map((a) => actionToTurn(a, players));

  return (
    <main className="flex min-h-screen flex-col items-center p-4 md:p-6">
      <div className="flex w-full max-w-5xl flex-col gap-6">
        <h1 className="text-center font-mono text-2xl font-bold uppercase tracking-widest md:text-3xl">
          {turnDescription}
        </h1>

        <div className="grid gap-4 md:grid-cols-2">
          <PartyRow
            players={players}
            actions={actions}
            currentTurnUserId={
              currentSlot?.slot.kind === "player"
                ? players[currentSlot.slot.index]?.user_id
                : undefined
            }
            myUserId={userId}
          />
          <MonsterRow
            monsters={campaign.monsters}
            actions={actions}
            selectedIndex={selectedMonsterIndex}
            onSelect={setSelectedMonsterIndex}
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
              viewerPlayer: players.find((p) => p.user_id === userId) ?? null,
              isMyTurn,
              submitting,
              selectedMonster: campaign.monsters[selectedMonsterIndex] ?? null,
              selectedMonsterIndex,
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
  submit,
}: {
  viewerPlayer: CampaignPlayer | null;
  isMyTurn: boolean;
  submitting: boolean;
  selectedMonster: Monster | null;
  selectedMonsterIndex: number;
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
  // an available slot.
  for (const spell of snap.equipped_spells) {
    const slotsLeft =
      spell.level === 0
        ? Infinity
        : (snap.spell_slots[String(spell.level)] ?? 0);
    const slotInfo =
      spell.level === 0 ? "cantrip" : `L${spell.level} · ${slotsLeft}`;
    const outOfSlots = spell.level > 0 && slotsLeft <= 0;
    commands.push({
      key: `spell:${spell.id}`,
      kind: "spell",
      icon: SparklesIcon,
      label: spell.name,
      subtitle: `${spell.damage} · ${slotInfo}`,
      onClick: () =>
        submit({
          kind: "spell",
          spellId: spell.id,
          targetMonsterIndex: selectedMonsterIndex,
        }),
      disabled: baseDisabled || outOfSlots || !!targetReason,
      disabledReason:
        turnReason ??
        (outOfSlots ? `Out of L${spell.level} spell slots` : targetReason),
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
          {player.character_snapshot.name}
          {isMe ? (
            <span className="ml-2 text-xs text-muted-foreground">(You)</span>
          ) : null}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {player.current_hp}/{player.character_snapshot.max_hp}
        </span>
      </div>
      <HealthBar
        current={player.current_hp}
        max={player.character_snapshot.max_hp}
        className="h-2"
      />
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
  const hits = actions.filter(
    (a) => a.target_kind === "monster" && a.target_monster_index === index,
  );
  const lastDamage = hits.length
    ? Number(
        (hits[hits.length - 1].payload as Record<string, unknown>).damage ?? 0,
      )
    : 0;
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
    </button>
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

  let text: string;
  if (action.kind === "skip") {
    text = `${actorName} skips their turn`;
  } else if (action.kind === "attack") {
    if (missed) {
      text = `${actorName} attacks ${targetName} — MISS (d20 ${payload.d20})`;
    } else {
      const noteSuffix = note ? ` (${note})` : "";
      text = crit
        ? `CRIT — ${actorName} attacks ${targetName} for ${damage}hp${damageType ? ` ${damageType}` : ""}${noteSuffix}`
        : `${actorName} attacks ${targetName} for ${damage}hp${damageType ? ` ${damageType}` : ""}${noteSuffix}`;
    }
  } else {
    text = `${actorName} does ${action.kind}`;
  }

  return {
    id: action.turn_number,
    isPlayer,
    text,
    kind: crit ? "crit" : undefined,
  };
}
