import { cn } from "@/lib/utils";

type Props = {
  current: number;
  max: number;
  className?: string;
};

// Simple HP bar with color thresholds. We don't use shadcn's Progress here
// because we want the fill color to react to the HP percentage, and rolling
// a 20-line div is simpler than fighting the base-ui primitive's slot system.
export function HealthBar({ current, max, className }: Props) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const fillColor =
    pct > 50
      ? "bg-green-500"
      : pct >= 20
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10",
        className,
      )}
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn("h-full transition-[width] duration-500", fillColor)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
