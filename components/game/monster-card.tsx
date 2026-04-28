import Image from "next/image";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HealthBar } from "@/components/game/health-bar";
import type { Monster } from "@/lib/game/types";

export function MonsterCard({ monster }: { monster: Monster }) {
  return (
    <Card className="w-full rounded-md border-2 border-zinc-900">
      <CardHeader>
        <CardTitle className="text-center font-mono text-base font-bold uppercase tracking-widest">
          {monster.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-3">
        <div
          className="flex size-36 items-center justify-center overflow-hidden rounded-md"
          style={{
            background:
              "radial-gradient(circle, rgba(213,233,233,1) 0%, rgba(88,218,223,1) 100%)",
          }}
        >
          {monster.avatar ? (
            <Image
              src={monster.avatar}
              alt={monster.name}
              width={144}
              height={144}
              className="size-full object-contain"
              unoptimized
            />
          ) : (
            <span className="text-4xl">??</span>
          )}
        </div>
        <p className="font-mono text-sm tabular-nums text-muted-foreground">
          {monster.health} / {monster.maxHealth} HP · {monster.damageDice}
        </p>
        <HealthBar current={monster.health} max={monster.maxHealth} />
      </CardContent>
    </Card>
  );
}
