import Image from "next/image";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthBar } from "@/components/game/health-bar";
import type { Player } from "@/lib/game/types";

export function PlayerCard({ player }: { player: Player }) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-center text-lg">{player.name}</CardTitle>
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
        <p className="text-sm text-muted-foreground">
          {player.health}hp - {player.xp}/1000xp
        </p>
        <HealthBar current={player.health} max={player.maxHealth} />
      </CardContent>
    </Card>
  );
}
