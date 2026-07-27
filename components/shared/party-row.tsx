"use client";

import { CharacterAvatar } from "@/components/shared/character-avatar";
import { HealthBar } from "@/components/shared/health-bar";
import { PanelLabel } from "@/components/shared/panel-label";
import { findClass } from "@/lib/dnd/classes";
import { playerAC } from "@/lib/dnd/combat";
import { useShakeOnNonce } from "@/lib/use-shake-on-nonce";
import { cn } from "@/lib/utils";
import type { CampaignAction, CampaignPlayer } from "@/lib/coop/types";

// Party panel + member rows. Pulled out of campaign-battle so the
// story-mode page can reuse the same chrome for the "your party"
// column without dragging in the whole coop battle component.
//
// Out-of-combat callers pass actions=[] and leave currentTurnUserId
// undefined; the shake-on-hit logic naturally goes quiet when no
// actions reference the player, and the active-turn highlight stays
// off without a current turn id.

export function PartyRow({
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
    <div className="relative flex flex-col gap-2 rounded-md border-2 border-foreground bg-card p-3 font-mono">
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
export function PartyMember({
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
  const ref = useShakeOnNonce(hits.length);
  const snap = player.character_snapshot;
  // Blue border when it's the viewer's own active turn — same hue
  // the InitiativeStrip's "you" pill uses, so the eye traces the
  // "this is you, act now" cue from the strip down to the party row
  // without a color shift.
  const isMyActive = isCurrent && isMe;
  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2",
        isMyActive
          ? "border-2 border-blue-600"
          : isCurrent
            ? "border-2 border-foreground"
            : "border-muted-foreground/20",
        dead ? "opacity-50" : "",
      )}
    >
      <CharacterAvatar
        src={snap.avatar_url ?? null}
        name={snap.name}
        size="sm"
        className="shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-bold uppercase tracking-widest">
            {snap.name}
            {isMe ? <span className="ml-2 text-xs">(You)</span> : null}
          </span>
          <span className="font-mono text-xs tabular-nums">
            {player.current_hp}/{snap.max_hp}
          </span>
        </div>
        <HealthBar
          current={player.current_hp}
          max={snap.max_hp}
          className="h-2"
        />
        <p className="text-[10px] uppercase tracking-widest">
          {snap.race} · {snap.class} · Lv: {snap.level} · AC:{" "}
          {playerAC(
            findClass(snap.class) ?? null,
            snap.ability_scores,
            snap.equipped_armor ?? null,
            snap.equipped_shield ?? null,
          )}
        </p>
      </div>
    </div>
  );
}
