"use client";

import { CompassIcon, SwordsIcon } from "lucide-react";
import { useState } from "react";

import { CommandButton } from "@/components/shared/command-button";
import { DisabledTip } from "@/components/shared/disabled-tip";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

// The lobby "Fight" command for signed-in players. Tapping it pops a
// Solo / Co-op menu out the side of the button — same pattern as the
// combat Spells / Attack menus — instead of opening a modal. Anonymous
// players don't get this (co-op needs an account, so their lobby starts
// solo directly); the caller renders a plain command button for them.
export function FightMenu({
  onSolo,
  onCoop,
  creatingCampaign,
  disabled = false,
  disabledReason = null,
}: {
  onSolo: () => void;
  onCoop: () => void;
  // Co-op spins up a campaign over the network; its button shows a
  // pending label and disables while that's in flight.
  creatingCampaign: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Trigger mirrors the primary CommandButton (bg-action fill, min-h-12,
  // left-aligned icon + label) so it sits flush in the command stack.
  const trigger = (
    <Button
      disabled={disabled}
      className={cn(
        "h-auto min-h-12 w-full justify-start py-1.5 text-left leading-tight",
        "bg-action text-action-foreground hover:bg-action/90",
      )}
    >
      <SwordsIcon className="size-5 shrink-0" />
      Fight
    </Button>
  );

  if (disabled) {
    return <DisabledTip reason={disabledReason}>{trigger}</DisabledTip>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        // Same placement as the combat command menus: out the side on
        // desktop (into the open middle column), below on mobile.
        side={isDesktop ? "left" : "bottom"}
        align={isDesktop ? "start" : "center"}
        className="flex w-72 flex-col gap-2"
        // A tap inside picks a mode and closes the menu.
        onClick={() => setOpen(false)}
      >
        <CommandButton
          kind="primary"
          icon={SwordsIcon}
          label="Solo"
          subtitle="One character against one monster"
          onClick={onSolo}
        />
        <CommandButton
          kind="primary"
          icon={CompassIcon}
          label={creatingCampaign ? "Starting Co-op…" : "Co-op"}
          subtitle="Invite a friend to fight beside you"
          onClick={onCoop}
          disabled={creatingCampaign}
        />
      </PopoverContent>
    </Popover>
  );
}
