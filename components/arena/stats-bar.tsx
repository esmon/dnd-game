import { Badge } from "@/components/ui/badge";
import type { GameStats } from "@/lib/game/types";

export function StatsBar({ stats }: { stats: GameStats }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Badge variant="secondary">wins: {stats.wins}</Badge>
      <Badge variant="secondary">losses: {stats.losses}</Badge>
      <Badge variant="secondary">run aways: {stats.runaways}</Badge>
    </div>
  );
}
