"use client";

import { CompassIcon, SwordsIcon } from "lucide-react";

import { CommandButton } from "@/components/shared/command-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Picker shown when a signed-in player taps the lobby's "Fight"
// command. Folds the old side-by-side "Fight Solo" / "Fight Co-op"
// buttons into one entry point. Anonymous players never see this —
// the lobby starts solo directly for them since co-op needs an
// account.
export function FightModeDialog({
  open,
  onOpenChange,
  onSolo,
  onCoop,
  creatingCampaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSolo: () => void;
  onCoop: () => void;
  // Co-op spins up a campaign over the network; the button shows a
  // pending label and disables while that's in flight.
  creatingCampaign: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-2 border-zinc-900 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center font-mono text-lg uppercase tracking-widest">
            Choose a Fight
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
