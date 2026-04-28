"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BACKGROUNDS } from "@/lib/dnd/backgrounds";

type Props = {
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function BackgroundStep({ selectedId, onSelect }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {BACKGROUNDS.map((bg) => {
        const selected = selectedId === bg.id;
        return (
          <button
            key={bg.id}
            type="button"
            onClick={() => onSelect(bg.id)}
            className="text-left"
          >
            <Card
              className={cn(
                "h-full transition-colors hover:bg-muted/40",
                selected && "ring-2 ring-primary",
              )}
            >
              <CardHeader>
                <CardTitle>{bg.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{bg.description}</p>
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
