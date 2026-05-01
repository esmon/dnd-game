"use client";

import { CheckIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
                <CardTitle>{bg.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{bg.description}</p>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
