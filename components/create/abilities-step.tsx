"use client";

import { InfoIcon } from "lucide-react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AbilityScores } from "@/lib/db/schema";
import type { DnDClass } from "@/lib/dnd/classes";
import type { Race } from "@/lib/dnd/races";
import {
  ABILITY_DESCRIPTIONS,
  ABILITY_KEYS,
  ABILITY_LABELS,
  STANDARD_ARRAY,
  abilityModifier,
} from "@/lib/dnd/derive";
import type { AbilityAssignments } from "@/lib/create/reducer";

type Props = {
  abilities: AbilityAssignments;
  race: Race | null;
  klass: DnDClass | null;
  onChange: (ability: keyof AbilityScores, value: number | null) => void;
};

const NONE_VALUE = "__none__";

function formatMod(m: number): string {
  return m >= 0 ? `+${m}` : `${m}`;
}

export function AbilitiesStep({ abilities, race, klass, onChange }: Props) {
  const usedValues = new Set<number>(
    Object.values(abilities).filter((v): v is number => v !== null),
  );
  const primaryAbilities = new Set<keyof AbilityScores>();
  if (klass) {
    primaryAbilities.add(klass.primaryAbility);
    if (klass.isCaster && klass.spellcastingAbility) {
      primaryAbilities.add(klass.spellcastingAbility);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
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
                <div className="flex items-center gap-2">
                  <Label>{ABILITY_LABELS[key]}</Label>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`About ${ABILITY_LABELS[key]}`}
                          className="inline-flex cursor-help transition-colors hover:text-foreground"
                        />
                      }
                    >
                      <InfoIcon className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      {ABILITY_DESCRIPTIONS[key]}
                    </TooltipContent>
                  </Tooltip>
                  {primaryAbilities.has(key) && klass ? (
                    <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                      ★ Primary for {klass.name}
                    </span>
                  ) : null}
                  {key === "con" ? (
                    <span className="font-mono text-[10px] uppercase tracking-widest">
                      Affects HP
                    </span>
                  ) : null}
                </div>
                <span className="text-xs">
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
                    <span>—</span>
                  ) : (
                    <span>
                      {assigned}
                      {bonus > 0 ? ` + ${bonus}` : ""} = <strong>{finalScore}</strong>{" "}
                      <span>({formatMod(mod ?? 0)})</span>
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
