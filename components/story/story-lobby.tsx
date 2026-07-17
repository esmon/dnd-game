"use client";

import { ArrowLeftIcon, CheckIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { CharacterAvatar } from "@/components/shared/character-avatar";
import { CharacterPickerDialog } from "@/components/shared/character-picker-dialog";
import { PanelLabel } from "@/components/shared/panel-label";
import type { StoryCampaign, StoryPlayer } from "@/lib/dm/db";
import type { Campaign } from "@/lib/dm/types";
import { cn } from "@/lib/utils";

// Coop story lobby — the assembly screen between "Create Lobby" and
// the DM starting play. Mirrors the coop combat lobby: an invite
// link, a roster (DM seat + players), ready toggles, and a
// DM-only Start button. Players who land here without a roster row
// see a Join affordance (Phase 4 wires the join action).
export function StoryLobby({
  campaign,
  template,
  players,
  userId,
  busy,
  onReady,
  onStart,
  onJoin,
}: {
  campaign: StoryCampaign;
  template: Campaign | null;
  players: StoryPlayer[];
  userId: string;
  busy: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onJoin: (opts: { role: "player" | "dm"; characterId?: string }) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const me = players.find((p) => p.user_id === userId) ?? null;
  const dm = players.find((p) => p.role === "dm") ?? null;
  const partyPlayers = players.filter((p) => p.role === "player");
  const isDm = campaign.dm_user_id === userId;
  const allReady =
    partyPlayers.length >= 1 && partyPlayers.every((p) => p.is_ready);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/story/${campaign.id}`
      : "";

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (older browsers / iframe) — the input is
      // selectable as a fallback.
    }
  }

  return (
    <main className="relative flex min-h-screen items-start justify-center p-6">
      <Link
        href="/"
        aria-label="Back to home"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "absolute left-6 top-6",
        )}
      >
        <ArrowLeftIcon className="size-3.5 shrink-0" />
        <span className="hidden md:inline">Back to home</span>
      </Link>

      <div className="flex w-full max-w-xl flex-col gap-6 pt-12 md:pt-0">
        <header className="flex flex-col gap-1 text-center font-mono">
          <h1 className="text-2xl font-bold uppercase tracking-widest md:text-3xl">
            {template?.title ?? "Story"}
          </h1>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Co-op Lobby
          </p>
          {template ? (
            <p className="mt-1 text-sm">{template.premise}</p>
          ) : null}
        </header>

        {/* Invite — any member can share the link. */}
        <div className="relative flex flex-col gap-3 rounded-md border-2 border-foreground bg-card p-6 font-mono">
          <p className="text-sm">
            Share this link. Anyone signed in can join as a player.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={copyInvite}>{copied ? "Copied" : "Copy"}</Button>
          </div>
        </div>

        {/* Roster */}
        <div className="relative flex flex-col gap-3 rounded-md border-2 border-foreground bg-card p-6 font-mono">
          <PanelLabel>Party</PanelLabel>

          {/* DM seat */}
          <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
                Dungeon Master
              </span>
              <span className="font-bold">
                {dm ? (dm.user_id === userId ? "You" : "Seated") : "Open"}
              </span>
            </span>
            {!dm && !me ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onJoin({ role: "dm" })}
                disabled={busy}
              >
                {busy ? "Claiming…" : "Claim Seat"}
              </Button>
            ) : null}
          </div>

          {/* Players */}
          <ul className="flex flex-col gap-2">
            {partyPlayers.map((p) => {
              const isMe = p.user_id === userId;
              const snap = p.character_snapshot;
              return (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <CharacterAvatar
                    src={snap?.avatar_url ?? null}
                    name={snap?.name ?? "?"}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-bold">
                      {snap?.name ?? "Player"}
                      {isMe ? (
                        <span className="ml-2 text-xs uppercase tracking-widest">
                          (You)
                        </span>
                      ) : null}
                    </span>
                    {snap ? (
                      <span className="text-xs uppercase tracking-widest text-muted-foreground">
                        {snap.race} · {snap.class} · Lv {snap.level}
                      </span>
                    ) : null}
                  </div>
                  {p.is_ready ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-700">
                      <CheckIcon className="size-3" /> Ready
                    </span>
                  ) : null}
                </li>
              );
            })}
            {partyPlayers.length === 0 ? (
              <li className="rounded-md border border-dashed border-border px-3 py-2 text-sm">
                Waiting for players…
              </li>
            ) : null}
          </ul>
        </div>

        {/* Controls */}
        {!me ? (
          // Non-member landed via the invite link. Joining as a
          // player picks a character first; claiming the DM seat (if
          // open) is the button on the DM row above.
          <Button
            className="bg-action text-action-foreground hover:bg-action/90"
            onClick={() => setPickerOpen(true)}
            disabled={busy}
          >
            {busy ? "Joining…" : "Join as a Player"}
          </Button>
        ) : isDm ? (
          <div className="flex flex-col gap-2">
            <Button
              className="bg-action text-action-foreground hover:bg-action/90"
              onClick={onStart}
              disabled={busy || !allReady}
            >
              {busy ? "Starting…" : "Start the Story"}
            </Button>
            {partyPlayers.length === 0 ? (
              <p className="text-center text-xs">
                Need at least one player before you can start.
              </p>
            ) : !allReady ? (
              <p className="text-center text-xs">
                Waiting for players to ready up…
              </p>
            ) : null}
          </div>
        ) : (
          // I'm a player — ready toggle.
          <div className="flex flex-col gap-2">
            <Button
              className="bg-action text-action-foreground hover:bg-action/90"
              onClick={() => onReady(!me.is_ready)}
              disabled={busy}
            >
              {me.is_ready ? "Ready ✓" : "I'm Ready"}
            </Button>
            <p className="text-center text-sm">
              {dm
                ? me.is_ready
                  ? "Waiting for the DM to start…"
                  : "Ready up when you've got your character."
                : "Waiting for a DM to take the seat…"}
            </p>
          </div>
        )}
      </div>

      <CharacterPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentCharacterId=""
        title="Choose Your Character"
        selectLabel="Join"
        onSelect={(characterId) => {
          setPickerOpen(false);
          onJoin({ role: "player", characterId });
        }}
      />
    </main>
  );
}
