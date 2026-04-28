"use client";

import { useReducer, useMemo } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

import { RaceStep } from "@/components/create/race-step";
import { ClassStep } from "@/components/create/class-step";
import { BackgroundStep } from "@/components/create/background-step";
import { AbilitiesStep } from "@/components/create/abilities-step";
import { ReviewStep } from "@/components/create/review-step";

import { RACES } from "@/lib/dnd/races";
import { CLASSES } from "@/lib/dnd/classes";
import { BACKGROUNDS } from "@/lib/dnd/backgrounds";
import {
  ABILITY_KEYS,
  applyRaceASI,
  computeMaxHp,
} from "@/lib/dnd/derive";
import {
  createReducer,
  initialCreateState,
  type AbilityAssignments,
} from "@/lib/create/reducer";
import { fetchWithSession, setActiveCharacterId } from "@/lib/session";
import type { AbilityScores, Character, NewCharacter } from "@/lib/db/schema";

const STEP_LABELS = ["Race", "Class", "Background", "Abilities", "Review"];

function abilitiesComplete(a: AbilityAssignments): boolean {
  const values = ABILITY_KEYS.map((k) => a[k]);
  if (values.some((v) => v === null)) return false;
  const set = new Set(values);
  return set.size === ABILITY_KEYS.length;
}

function toAbilityScores(a: AbilityAssignments): AbilityScores {
  return {
    str: a.str ?? 0,
    dex: a.dex ?? 0,
    con: a.con ?? 0,
    int: a.int ?? 0,
    wis: a.wis ?? 0,
    cha: a.cha ?? 0,
  };
}

export default function CreatePage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(createReducer, initialCreateState);

  const race = useMemo(
    () => RACES.find((r) => r.id === state.raceId) ?? null,
    [state.raceId],
  );
  const klass = useMemo(
    () => CLASSES.find((c) => c.id === state.classId) ?? null,
    [state.classId],
  );
  const background = useMemo(
    () => BACKGROUNDS.find((b) => b.id === state.backgroundId) ?? null,
    [state.backgroundId],
  );

  const finalAbilities: AbilityScores | null = useMemo(() => {
    if (!race || !abilitiesComplete(state.abilities)) return null;
    return applyRaceASI(toAbilityScores(state.abilities), race);
  }, [race, state.abilities]);

  const maxHp = useMemo(() => {
    if (!klass || !finalAbilities) return null;
    return computeMaxHp(klass, finalAbilities.con);
  }, [klass, finalAbilities]);

  const trimmedName = state.name.trim();
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 32;

  const canAdvance = (() => {
    switch (state.step) {
      case 0:
        return race !== null;
      case 1:
        return klass !== null;
      case 2:
        return background !== null;
      case 3:
        return abilitiesComplete(state.abilities);
      case 4:
        return (
          nameValid &&
          state.alignment !== null &&
          finalAbilities !== null &&
          maxHp !== null
        );
      default:
        return false;
    }
  })();

  async function handleSubmit() {
    if (
      !race ||
      !klass ||
      !background ||
      !finalAbilities ||
      maxHp === null ||
      !state.alignment ||
      !nameValid
    ) {
      return;
    }
    dispatch({ type: "SUBMIT_START" });
    const payload: NewCharacter = {
      session_id: "",
      name: trimmedName,
      race: race.id,
      subrace: null,
      class: klass.id,
      subclass: null,
      background: background.id,
      alignment: state.alignment,
      level: 1,
      xp: 0,
      ability_scores: finalAbilities,
      max_hp: maxHp,
      current_hp: maxHp,
      proficiency_bonus: 2,
      weapons: klass.weapons,
      avatar_url: null,
    };
    try {
      const res = await fetchWithSession("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        dispatch({
          type: "SUBMIT_ERROR",
          error: `Failed to create character (${res.status}): ${text}`,
        });
        return;
      }
      const created = (await res.json()) as Character;
      setActiveCharacterId(created.id);
      dispatch({ type: "SUBMIT_DONE" });
      router.push("/");
    } catch (err) {
      dispatch({
        type: "SUBMIT_ERROR",
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  const progress = ((state.step + 1) / STEP_LABELS.length) * 100;
  const isLastStep = state.step === 4;

  return (
    <main className="flex min-h-screen flex-1 items-start justify-center bg-zinc-50 p-6 dark:bg-black">
      <Card className="w-full max-w-5xl">
        <CardHeader>
          <CardTitle>
            Step {state.step + 1} of {STEP_LABELS.length} · {STEP_LABELS[state.step]}
          </CardTitle>
          <Progress value={progress} className="mt-2" />
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {state.step === 0 ? (
            <RaceStep
              selectedId={state.raceId}
              onSelect={(id) => dispatch({ type: "SET_RACE", raceId: id })}
            />
          ) : null}
          {state.step === 1 ? (
            <ClassStep
              selectedId={state.classId}
              onSelect={(id) => dispatch({ type: "SET_CLASS", classId: id })}
            />
          ) : null}
          {state.step === 2 ? (
            <BackgroundStep
              selectedId={state.backgroundId}
              onSelect={(id) =>
                dispatch({ type: "SET_BACKGROUND", backgroundId: id })
              }
            />
          ) : null}
          {state.step === 3 ? (
            <AbilitiesStep
              abilities={state.abilities}
              race={race}
              onChange={(ability, value) =>
                dispatch({ type: "SET_ABILITY", ability, value })
              }
            />
          ) : null}
          {state.step === 4 && race && klass && background && finalAbilities && maxHp !== null ? (
            <ReviewStep
              name={state.name}
              alignment={state.alignment}
              race={race}
              klass={klass}
              background={background}
              finalAbilities={finalAbilities}
              maxHp={maxHp}
              onNameChange={(n) => dispatch({ type: "SET_NAME", name: n })}
              onAlignmentChange={(a) =>
                dispatch({ type: "SET_ALIGNMENT", alignment: a })
              }
            />
          ) : null}

          {state.error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </div>
          ) : null}

          <Separator />
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "PREV_STEP" })}
              disabled={state.step === 0 || state.submitting}
            >
              Back
            </Button>
            {isLastStep ? (
              <Button
                onClick={handleSubmit}
                disabled={!canAdvance || state.submitting}
              >
                {state.submitting ? "Creating..." : "Create Character"}
              </Button>
            ) : (
              <Button
                onClick={() => dispatch({ type: "NEXT_STEP" })}
                disabled={!canAdvance}
              >
                Next
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
