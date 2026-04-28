import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function CommandPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border-2 border-zinc-900 bg-card p-3",
        className,
      )}
    >
      <p className="text-center font-mono text-sm font-bold uppercase tracking-widest">
        Command
      </p>
      {children}
    </div>
  );
}
