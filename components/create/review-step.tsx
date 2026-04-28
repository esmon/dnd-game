"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ALIGNMENTS, type Alignment } from "@/lib/dnd/alignments";
import type { Background } from "@/lib/dnd/backgrounds";
import type { DnDClass } from "@/lib/dnd/classes";
import type { Race } from "@/lib/dnd/races";
import type { AbilityScores } from "@/lib/db/schema";
import { ABILITY_KEYS, ABILITY_LABELS, abilityModifier } from "@/lib/dnd/derive";

type Props = {
  name: string;
  alignment: Alignment | null;
  race: Race;
  klass: DnDClass;
  background: Background;
  finalAbilities: AbilityScores;
  maxHp: number;
  onNameChange: (n: string) => void;
  onAlignmentChange: (a: Alignment) => void;
};

function formatMod(m: number): string {
  return m >= 0 ? `+${m}` : `${m}`;
}

export function ReviewStep({
  name,
  alignment,
  race,
  klass,
  background,
  finalAbilities,
  maxHp,
  onNameChange,
  onAlignmentChange,
}: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="character-name">Character name</Label>
        <Input
          id="character-name"
          value={name}
          maxLength={32}
          placeholder="e.g. Tharivol"
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Alignment</Label>
        <Select
          value={alignment ?? ""}
          onValueChange={(v: string | null) => {
            if (v) onAlignmentChange(v as Alignment);
          }}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="Pick alignment" />
          </SelectTrigger>
          <SelectContent>
            {ALIGNMENTS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex flex-col gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <span className="text-muted-foreground">Race:</span> <strong>{race.name}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Class:</span> <strong>{klass.name}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Background:</span>{" "}
            <strong>{background.name}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Max HP:</span> <strong>{maxHp}</strong>
          </div>
        </div>

        <div>
          <p className="mb-2 text-muted-foreground">Ability scores</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {ABILITY_KEYS.map((key) => {
              const score = finalAbilities[key];
              return (
                <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                  <span>{ABILITY_LABELS[key]}</span>
                  <span>
                    <strong>{score}</strong>{" "}
                    <span className="text-muted-foreground">
                      ({formatMod(abilityModifier(score))})
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <p className="mb-2 text-muted-foreground">Starting weapons</p>
          <div className="flex flex-wrap gap-1.5">
            {klass.weapons.map((w) => (
              <Badge key={w.name} variant="secondary">
                {w.name} ({w.damage})
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
