"use client";

import { InfoIcon } from "lucide-react";
import { useMemo, useReducer } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { findClass, type DnDClass } from "@/lib/dnd/classes";
import {
  ABILITY_DESCRIPTIONS,
  ABILITY_KEYS,
  ABILITY_LABELS,
  abilityModifier,
} from "@/lib/dnd/derive";
import { RACES } from "@/lib/dnd/races";
import type { AbilityScores } from "@/lib/db/schema";

type Mode = "plus2" | "plus1plus1";

type State = {
  mode: Mode;
  one: keyof AbilityScores | null;
  twoA: keyof AbilityScores | null;
  twoB: keyof AbilityScores | null;
};

type Action =
  | { type: "SET_MODE"; mode: Mode }
  | { type: "SET_ONE"; ability: keyof AbilityScores }
  | { type: "SET_TWO_A"; ability: keyof AbilityScores }
  | { type: "SET_TWO_B"; ability: keyof AbilityScores }
  | { type: "CLEAR_TWO_A" }
  | { type: "CLEAR_TWO_B" };

const initialState: State = {
  mode: "plus2",
  one: null,
  twoA: null,
  twoB: null,
};

function asiReducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_MODE":
      return { mode: action.mode, one: null, twoA: null, twoB: null };
    case "SET_ONE":
      return { ...state, one: action.ability };
    case "SET_TWO_A":
      return { ...state, twoA: action.ability };
    case "SET_TWO_B":
      return { ...state, twoB: action.ability };
    case "CLEAR_TWO_A":
      // Clearing the first pick also resets the second so the user can
      // pick again from scratch without keeping a stale second ability.
      return { ...state, twoA: null, twoB: null };
    case "CLEAR_TWO_B":
      return { ...state, twoB: null };
  }
}

type Props = {
  level: number;
  classId: string;
  raceId: string;
  currentScores: AbilityScores;
  // Player's current character level and max HP, used to preview the
  // retroactive CON-mod-driven HP gain on the Constitution buttons.
  playerLevel: number;
  currentMaxHp: number;
  onConfirm: (deltas: Partial<AbilityScores>) => void;
};

const ASI_CAP = 20;

function buildDeltas(
  mode: Mode,
  one: keyof AbilityScores | null,
  two: [keyof AbilityScores | null, keyof AbilityScores | null],
): Partial<AbilityScores> | null {
  if (mode === "plus2") {
    if (!one) return null;
    return { [one]: 2 };
  }
  const [a, b] = two;
  if (!a || !b || a === b) return null;
  return { [a]: 1, [b]: 1 };
}

function resultingScore(
  current: number,
  delta: number,
): { ok: boolean; next: number } {
  const next = current + delta;
  return { ok: next <= ASI_CAP, next };
}

type AbilityHint = "primary" | "spellcasting" | "con" | null;

function abilityHint(
  key: keyof AbilityScores,
  primaryAbility: keyof AbilityScores | undefined,
  spellcastingAbility: keyof AbilityScores | undefined,
): AbilityHint {
  if (key === primaryAbility) return "primary";
  if (key === spellcastingAbility && key !== primaryAbility) {
    return "spellcasting";
  }
  if (key === "con") return "con";
  return null;
}

function HintBadge({
  hint,
  className,
}: {
  hint: AbilityHint;
  className?: string;
}) {
  if (!hint) return null;
  const text =
    hint === "primary"
      ? "★ Primary"
      : hint === "spellcasting"
        ? "★ Spellcasting"
        : "Affects HP";
  const tone =
    hint === "con"
      ? "text-muted-foreground"
      : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";
  return (
    <span
      className={`rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest ${tone} ${className ?? ""}`}
    >
      {text}
    </span>
  );
}

function AbilityInfoIcon({ ability }: { ability: keyof AbilityScores }) {
  // The icon sits inside a clickable AbilityChoice button. Without this,
  // tapping it on mobile both fails to show the description (Tooltip is
  // hover-only) and selects the ability. Stopping propagation prevents
  // the parent select; the click also pops the mobile-only Popover.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const label = `About ${ABILITY_LABELS[ability]}`;
  const description = ABILITY_DESCRIPTIONS[ability];

  return (
    <>
      {/* Desktop: hover-driven Tooltip. */}
      <span className="hidden md:inline-flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={label}
                onClick={stop}
                className="inline-flex cursor-help transition-colors hover:text-foreground"
              />
            }
          >
            <InfoIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {description}
          </TooltipContent>
        </Tooltip>
      </span>
      {/* Mobile: tap-to-open Popover; closes on outside click. */}
      <span className="inline-flex md:hidden">
        <Popover>
          <PopoverTrigger
            render={
              <span
                aria-label={label}
                onClick={stop}
                className="inline-flex cursor-pointer transition-colors hover:text-foreground"
              />
            }
          >
            <InfoIcon className="size-3.5" />
          </PopoverTrigger>
          <PopoverContent side="top" className="w-64 text-sm">
            {description}
          </PopoverContent>
        </Popover>
      </span>
    </>
  );
}

function PickedRow({
  label,
  ability,
  current,
  onChange,
}: {
  label: string;
  ability: keyof AbilityScores;
  current: number;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-widest">
          {label}
        </span>
        <span className="text-sm font-bold tabular-nums">
          {ABILITY_LABELS[ability]} {current} → {current + 1}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onChange}
      >
        Change
      </Button>
    </div>
  );
}

function AbilityChoice({
  ability,
  current,
  delta,
  selected,
  disabled,
  hint,
  hpPreview,
  onSelect,
}: {
  ability: keyof AbilityScores;
  current: number;
  delta: number;
  selected: boolean;
  disabled: boolean;
  hint: AbilityHint;
  hpPreview?: { from: number; to: number };
  onSelect: () => void;
}) {
  const { next } = resultingScore(current, delta);
  const showHp = hpPreview && hpPreview.from !== hpPreview.to;
  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      size="sm"
      disabled={disabled}
      onClick={onSelect}
      className="h-auto justify-between gap-2 py-1.5 leading-tight"
    >
      <span className="flex flex-col items-start gap-1">
        <span className="flex items-center gap-1.5">
          <span>{ABILITY_LABELS[ability]}</span>
          <AbilityInfoIcon ability={ability} />
        </span>
        <span className="text-xs tabular-nums opacity-80">
          {current} → {next}
        </span>
      </span>
      {hint || showHp ? (
        <span className="flex flex-col items-end gap-1">
          {hint ? <HintBadge hint={hint} /> : <span />}
          {showHp ? (
            <span className="text-xs tabular-nums opacity-80">
              Max HP {hpPreview.from} → {hpPreview.to}
            </span>
          ) : null}
        </span>
      ) : null}
    </Button>
  );
}

// Compute the Max HP a player would end up with if they apply `delta` to
// their CON score. Returns null if the modifier doesn't change.
function conHpPreview(
  currentCon: number,
  delta: number,
  playerLevel: number,
  currentMaxHp: number,
): { from: number; to: number } {
  const modDelta =
    abilityModifier(currentCon + delta) - abilityModifier(currentCon);
  return { from: currentMaxHp, to: currentMaxHp + modDelta * playerLevel };
}

// Renders one of the three ability-pick lists: the +2 list, the +1+1 first
// pick, or the +1+1 second pick. `excludedAbility` filters one out (used
// when the second pick can't repeat the first).
function AbilityList({
  delta,
  scores,
  klass,
  selectedAbility,
  excludedAbility,
  playerLevel,
  currentMaxHp,
  onSelect,
}: {
  delta: number;
  scores: AbilityScores;
  klass: DnDClass | undefined;
  selectedAbility: keyof AbilityScores | null;
  excludedAbility?: keyof AbilityScores | null;
  playerLevel: number;
  currentMaxHp: number;
  onSelect: (ability: keyof AbilityScores) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {ABILITY_KEYS.filter((k) => k !== excludedAbility).map((k) => {
        const cur = scores[k];
        const { ok } = resultingScore(cur, delta);
        return (
          <AbilityChoice
            key={k}
            ability={k}
            current={cur}
            delta={delta}
            selected={selectedAbility === k}
            disabled={!ok}
            hint={abilityHint(
              k,
              klass?.primaryAbility,
              klass?.spellcastingAbility,
            )}
            hpPreview={
              k === "con"
                ? conHpPreview(cur, delta, playerLevel, currentMaxHp)
                : undefined
            }
            onSelect={() => onSelect(k)}
          />
        );
      })}
    </div>
  );
}

export function LevelUpDialog({
  level,
  classId,
  raceId,
  currentScores,
  playerLevel,
  currentMaxHp,
  onConfirm,
}: Props) {
  const [{ mode, one, twoA, twoB }, dispatch] = useReducer(
    asiReducer,
    initialState,
  );

  const klass = findClass(classId);
  const race = RACES.find((r) => r.id === raceId);

  const deltas = useMemo(
    () => buildDeltas(mode, one, [twoA, twoB]),
    [mode, one, twoA, twoB],
  );

  const valid = useMemo(() => {
    if (!deltas) return false;
    for (const key of ABILITY_KEYS) {
      const d = deltas[key] ?? 0;
      if (d === 0) continue;
      if (currentScores[key] + d > ASI_CAP) return false;
    }
    return true;
  }, [deltas, currentScores]);

  function handleConfirm() {
    if (!deltas || !valid) return;
    onConfirm(deltas);
  }

  // Top recommended ability — drives the inline "Recommended:" hint at the
  // top of the dialog. Class primary first, then spellcasting (if caster
  // and different), then CON. Skips abilities already at cap.
  const recommendation = useMemo(() => {
    const candidates: Array<keyof AbilityScores> = [];
    if (klass) {
      candidates.push(klass.primaryAbility);
      if (klass.isCaster && klass.spellcastingAbility) {
        candidates.push(klass.spellcastingAbility);
      }
    }
    candidates.push("con");
    for (const k of candidates) {
      if (currentScores[k] < ASI_CAP) return k;
    }
    return null;
  }, [klass, currentScores]);

  return (
    <Dialog
      open
      modal
      // ASI is mandatory once granted; ignore any close attempt.
      onOpenChange={() => {}}
      disablePointerDismissal
    >
      <DialogContent
        showCloseButton={false}
        className="border-2 border-foreground max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>
            Level {level} — Ability Score Improvement
          </DialogTitle>
          {race || klass ? (
            <p className="font-mono text-xs uppercase tracking-widest">
              {race?.name ?? raceId} · {klass?.name ?? classId}
            </p>
          ) : null}
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto pr-1">
          {recommendation ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
              <span className="font-bold uppercase tracking-widest">
                Recommended:
              </span>{" "}
              put your points into{" "}
              <span className="font-bold">{ABILITY_LABELS[recommendation]}</span>
              {recommendation === klass?.primaryAbility
                ? ` — your ${klass.name} primary ability.`
                : recommendation === klass?.spellcastingAbility
                  ? ` — your ${klass?.name} spellcasting ability.`
                  : recommendation === "con"
                    ? " — boosts max HP every level."
                    : "."}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant={mode === "plus2" ? "default" : "outline"}
              size="sm"
              onClick={() => dispatch({ type: "SET_MODE", mode: "plus2" })}
            >
              +2 to one ability
            </Button>
            <Button
              type="button"
              variant={mode === "plus1plus1" ? "default" : "outline"}
              size="sm"
              onClick={() => dispatch({ type: "SET_MODE", mode: "plus1plus1" })}
            >
              +1 to two abilities
            </Button>
          </div>

          {mode === "plus2" ? (
            <AbilityList
              delta={2}
              scores={currentScores}
              klass={klass}
              selectedAbility={one}
              playerLevel={playerLevel}
              currentMaxHp={currentMaxHp}
              onSelect={(k) => dispatch({ type: "SET_ONE", ability: k })}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {twoA ? (
                <PickedRow
                  label="First ability"
                  ability={twoA}
                  current={currentScores[twoA]}
                  onChange={() => dispatch({ type: "CLEAR_TWO_A" })}
                />
              ) : (
                <div>
                  <Label className="mb-1 block text-xs">
                    First ability (+1)
                  </Label>
                  <AbilityList
                    delta={1}
                    scores={currentScores}
                    klass={klass}
                    selectedAbility={null}
                    playerLevel={playerLevel}
                    currentMaxHp={currentMaxHp}
                    onSelect={(k) =>
                      dispatch({ type: "SET_TWO_A", ability: k })
                    }
                  />
                </div>
              )}

              {twoA ? (
                twoB ? (
                  <PickedRow
                    label="Second ability"
                    ability={twoB}
                    current={currentScores[twoB]}
                    onChange={() => dispatch({ type: "CLEAR_TWO_B" })}
                  />
                ) : (
                  <div>
                    <Label className="mb-1 block text-xs">
                      Second ability (+1)
                    </Label>
                    <AbilityList
                      delta={1}
                      scores={currentScores}
                      klass={klass}
                      selectedAbility={null}
                      excludedAbility={twoA}
                      playerLevel={playerLevel}
                      currentMaxHp={currentMaxHp}
                      onSelect={(k) =>
                        dispatch({ type: "SET_TWO_B", ability: k })
                      }
                    />
                  </div>
                )
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleConfirm} disabled={!valid}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
