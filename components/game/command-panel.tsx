import { Fragment, type ReactNode } from "react";

import {
  CommandButton,
  type CommandButtonProps,
} from "@/components/game/command-button";
import { PanelLabel } from "@/components/game/panel-label";
import { cn } from "@/lib/utils";

// A CommandPanel item is either a CommandButton descriptor or a pre-built
// node (used for special controls like the "Show N more" popover that don't
// fit the button shape). Both carry a stable `key` for React diffing.
export type CommandItem =
  | ({ key: string } & CommandButtonProps)
  | { key: string; render: ReactNode };

export function CommandPanel({
  commands,
  className,
}: {
  commands: CommandItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3",
        className,
      )}
    >
      <PanelLabel>Commands</PanelLabel>
      {commands.map((item) => {
        if ("render" in item) {
          return <Fragment key={item.key}>{item.render}</Fragment>;
        }
        const { key, ...props } = item;
        return <CommandButton key={key} {...props} />;
      })}
    </div>
  );
}
