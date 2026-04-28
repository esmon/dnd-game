"use client";

import { CheckIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CLASSES } from "@/lib/dnd/classes";
import { weaponsByBaseId } from "@/lib/dnd/weapons";
import { ABILITY_LABELS } from "@/lib/dnd/derive";

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function ClassStep({ selectedId, onSelect }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CLASSES.map((klass) => {
        const selected = selectedId === klass.id;
        return (
          <button
            key={klass.id}
            type="button"
            onClick={() => onSelect(klass.id)}
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
                <CardTitle>{klass.name}</CardTitle>
                <CardDescription>
                  d{klass.hitDie} hit die · {ABILITY_LABELS[klass.primaryAbility]}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">{klass.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {klass.weapons.map((w) => {
                    const def = weaponsByBaseId[w.baseId];
                    if (!def) return null;
                    return (
                      <Badge key={w.baseId} variant="secondary">
                        {def.name} ({def.damage})
                      </Badge>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
