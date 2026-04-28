import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HealthBar } from "@/components/game/health-bar";
import { MAX_LEVEL, xpProgressInLevel } from "@/lib/dnd/leveling";
import type { Player } from "@/lib/game/types";

export function PlayerCard({ player }: { player: Player }) {
  const atMax = player.level >= MAX_LEVEL;
  const { inLevel, needed } = xpProgressInLevel(player.xp, player.level);
  const pct = needed > 0 ? Math.min(100, (inLevel / needed) * 100) : 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-center gap-2 text-center text-lg">
          <span>{player.name}</span>
          <Badge variant="secondary">Lvl {player.level}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div
          className="flex size-36 items-center justify-center overflow-hidden rounded-xl"
          style={{
            background:
              "radial-gradient(circle, rgba(213,233,233,1) 0%, rgba(88,218,223,1) 100%)",
          }}
        >
          {player.avatar ? (
            <Image
              src={player.avatar}
              alt={player.name}
              width={144}
              height={144}
              className="size-full object-contain"
              unoptimized
            />
          ) : (
            <span className="text-4xl">@</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{player.health}hp</p>
        <HealthBar current={player.health} max={player.maxHealth} />

        <div className="w-full">
          {atMax ? (
            <p className="text-center text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              MAX LEVEL
            </p>
          ) : (
            <>
              <Progress value={pct} />
              <p className="mt-1 text-center text-xs text-muted-foreground tabular-nums">
                {inLevel} / {needed} XP
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
