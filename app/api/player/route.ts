import { NextResponse } from "next/server";

import starter from "@/data/starter-player.json";
import type { StarterPlayerResponse, Weapon } from "@/lib/game/types";

// Narrow type for the slice of starter-player.json we actually consume.
type StarterFile = {
  character: {
    name: string;
    avatarUrl?: string | null;
    hitPoints: { max: number };
    inventory: {
      weapons: Array<{
        definition: {
          name: string;
          damage: { diceString: string };
        };
      }>;
    };
  };
};

export function GET() {
  const data = starter as unknown as StarterFile;
  const c = data.character;

  const weapons: Weapon[] = c.inventory.weapons.map((w) => ({
    name: w.definition.name,
    damage: w.definition.damage.diceString,
  }));

  const body: StarterPlayerResponse = {
    name: c.name,
    avatar: c.avatarUrl ?? null,
    maxHealth: c.hitPoints.max,
    weapons,
  };

  return NextResponse.json(body);
}
