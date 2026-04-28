"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AbilityScores } from "@/lib/db/schema";
import type { Race } from "@/lib/dnd/races";
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  STANDARD_ARRAY,
  abilityModifier,
} from "@/lib/dnd/derive";
import type { AbilityAssignments } from "@/lib/create/reducer";

type Props = {
  abilities: AbilityAssignments;
  race: Race | null;
  onChange: (ability: keyof AbilityScores, value: number | null) => void;
};

const NONE_VALUE = "__none__";

function formatMod(m: number): string {
  return m >= 0 ? `+${m}` : `${m}`;
}

export function AbilitiesStep({ abilities, race, onChange }: Props) {
  const usedValues = new Set<number>(
    Object.values(abilities).filter((v): v is number => v !== null),
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Assign each value from the standard array {`[${STANDARD_ARRAY.join(", ")}]`} to one ability.
        Each value can only be used once. Race ASI is added on top.
      </p>
      <div className="grid gap-3">
        {ABILITY_KEYS.map((key) => {
          const assigned = abilities[key];
          const bonus = race?.asi[key] ?? 0;
          const finalScore =
            assigned === null ? null : assigned + bonus;
          const mod = finalScore === null ? null : abilityModifier(finalScore);
          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col">
                <Label>{ABILITY_LABELS[key]}</Label>
                <span className="text-xs text-muted-foreground">
                  {bonus > 0 ? `Race bonus +${bonus}` : "No race bonus"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Select
                  value={assigned === null ? NONE_VALUE : String(assigned)}
                  onValueChange={(v: string | null) => {
                    if (v === null || v === NONE_VALUE) {
                      onChange(key, null);
                    } else {
                      onChange(key, Number(v));
                    }
                  }}
                >
                  <SelectTrigger className="w-32">
                    <SelectValue placeholder="Pick value" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>Unassigned</SelectItem>
                    {STANDARD_ARRAY.map((v) => {
                      const taken = usedValues.has(v) && assigned !== v;
                      return (
                        <SelectItem
                          key={v}
                          value={String(v)}
                          disabled={taken}
                        >
                          {v}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <div className="min-w-28 text-right text-sm">
                  {finalScore === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span>
                      {assigned}
                      {bonus > 0 ? ` + ${bonus}` : ""} = <strong>{finalScore}</strong>{" "}
                      <span className="text-muted-foreground">({formatMod(mod ?? 0)})</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
