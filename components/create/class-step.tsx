"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CLASSES } from "@/lib/dnd/classes";
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
            className="text-left"
          >
            <Card
              className={cn(
                "h-full transition-colors hover:bg-muted/40",
                selected && "ring-2 ring-primary",
              )}
            >
              <CardHeader>
                <CardTitle>{klass.name}</CardTitle>
                <CardDescription>
                  d{klass.hitDie} hit die · {ABILITY_LABELS[klass.primaryAbility]}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">{klass.description}</p>
                <div className="flex flex-wrap gap-1.5">
                  {klass.weapons.map((w) => (
                    <Badge key={w.name} variant="secondary">
                      {w.name} ({w.damage})
                    </Badge>
                  ))}
                </div>
              </CardContent>
              {selected ? (
                <CardContent>
                  <Badge>Selected</Badge>
                </CardContent>
              ) : null}
            </Card>
          </button>
        );
      })}
    </div>
  );
}
