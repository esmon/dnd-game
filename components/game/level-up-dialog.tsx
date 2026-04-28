"use client";

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
import { ABILITY_KEYS, ABILITY_LABELS } from "@/lib/dnd/derive";
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
  | { type: "SET_TWO_B"; ability: keyof AbilityScores };

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
  }
}

type Props = {
  level: number;
  currentScores: AbilityScores;
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

export function LevelUpDialog({ level, currentScores, onConfirm }: Props) {
  const [{ mode, one, twoA, twoB }, dispatch] = useReducer(
    asiReducer,
    initialState,
  );

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

  return (
    <Dialog
      open
      modal
      // ASI is mandatory once granted; ignore any close attempt.
      onOpenChange={() => {}}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Level {level} — Ability Score Improvement
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
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
            <div className="grid grid-cols-2 gap-2">
              {ABILITY_KEYS.map((k) => {
                const cur = currentScores[k];
                const { ok, next } = resultingScore(cur, 2);
                const selected = one === k;
                const disabled = !ok;
                return (
                  <Button
                    key={k}
                    type="button"
                    variant={selected ? "default" : "outline"}
                    size="sm"
                    disabled={disabled}
                    onClick={() => dispatch({ type: "SET_ONE", ability: k })}
                    className="justify-between"
                  >
                    <span>{ABILITY_LABELS[k]}</span>
                    <span className="tabular-nums text-xs">
                      {cur} → {next}
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">
                  First ability (+1)
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {ABILITY_KEYS.map((k) => {
                    const cur = currentScores[k];
                    const { ok, next } = resultingScore(cur, 1);
                    const selected = twoA === k;
                    const disabled = !ok || twoB === k;
                    return (
                      <Button
                        key={k}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        disabled={disabled}
                        onClick={() => dispatch({ type: "SET_TWO_A", ability: k })}
                        className="justify-between"
                      >
                        <span>{ABILITY_LABELS[k]}</span>
                        <span className="tabular-nums text-xs">
                          {cur} → {next}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="mb-1 block text-xs text-muted-foreground">
                  Second ability (+1)
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {ABILITY_KEYS.map((k) => {
                    const cur = currentScores[k];
                    const { ok, next } = resultingScore(cur, 1);
                    const selected = twoB === k;
                    const disabled = !ok || twoA === k;
                    return (
                      <Button
                        key={k}
                        type="button"
                        variant={selected ? "default" : "outline"}
                        size="sm"
                        disabled={disabled}
                        onClick={() => dispatch({ type: "SET_TWO_B", ability: k })}
                        className="justify-between"
                      >
                        <span>{ABILITY_LABELS[k]}</span>
                        <span className="tabular-nums text-xs">
                          {cur} → {next}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
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
