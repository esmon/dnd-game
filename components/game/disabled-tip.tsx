"use client";

import type { ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Wraps a button (or anything) with a tooltip ONLY when a reason is supplied —
// typically "this is why this control is disabled." The TooltipTrigger renders
// as an inline-flex span around the child so the tooltip still fires on hover
// even when the button itself is disabled (disabled buttons swallow events).
export function DisabledTip({
  reason,
  children,
}: {
  reason: string | null;
  children: ReactNode;
}) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
