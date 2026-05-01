"use client";

import { CheckIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { RACES } from "@/lib/dnd/races";
import { ABILITY_LABELS } from "@/lib/dnd/derive";
import type { AbilityScores } from "@/lib/db/schema";

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function asiSummary(asi: Partial<AbilityScores>): string {
  const parts: string[] = [];
  (Object.keys(asi) as Array<keyof AbilityScores>).forEach((key) => {
    const v = asi[key];
    if (typeof v === "number" && v !== 0) {
      parts.push(`+${v} ${ABILITY_LABELS[key].slice(0, 3).toUpperCase()}`);
    }
  });
  return parts.join(", ");
}

export function RaceStep({ selectedId, onSelect }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {RACES.map((race) => {
        const selected = selectedId === race.id;
        return (
          <button
            key={race.id}
            type="button"
            onClick={() => onSelect(race.id)}
            className="cursor-pointer text-left"
          >
            <Card
              className={cn(
                "relative h-full transition-colors hover:bg-muted/40",
                selected && "ring-2 ring-primary",
              )}
            >
              {selected ? (
                <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white">
                  <CheckIcon className="size-4" />
                </span>
              ) : null}
              <CardHeader>
                <CardTitle>{race.name}</CardTitle>
                <CardDescription>{asiSummary(race.asi)} · Speed {race.speed}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{race.description}</p>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
