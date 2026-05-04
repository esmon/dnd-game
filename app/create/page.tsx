"use client";

import { useReducer, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

import { RaceStep } from "@/components/create/race-step";
import { ClassStep } from "@/components/create/class-step";
import { BackgroundStep } from "@/components/create/background-step";
import { AbilitiesStep } from "@/components/create/abilities-step";
import { ReviewStep } from "@/components/create/review-step";

import { RACES } from "@/lib/dnd/races";
import { findClass } from "@/lib/dnd/classes";
import { BACKGROUNDS } from "@/lib/dnd/backgrounds";
import { mintArmorByBaseId, mintArmor, armorByBaseId } from "@/lib/dnd/armor";
import { mintWeapon, weaponsByBaseId } from "@/lib/dnd/weapons";
import {
  mintSpell,
  slotsForLevel,
  spellsByBaseId,
} from "@/lib/dnd/spells";
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
import {
  clearActiveCharacterId,
  fetchWithSession,
  setActiveCharacterId,
} from "@/lib/session";
import { useUser } from "@/lib/auth/use-user";
import {
  clearLocalCharacter,
  setLocalCharacter,
} from "@/lib/storage/local-character";
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
  const { user, loading: authLoading } = useUser();
  const [state, dispatch] = useReducer(createReducer, initialCreateState);
  const showAnonymousNotice = !authLoading && !user;

  const race = useMemo(
    () => RACES.find((r) => r.id === state.raceId) ?? null,
    [state.raceId],
  );
  const klass = useMemo(
    () => (state.classId ? findClass(state.classId) ?? null : null),
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
    const starterWeapons = klass.weapons
      .map((ref) => {
        const def = weaponsByBaseId[ref.baseId];
        if (!def) return null;
        return mintWeapon(def, ref.bonus);
      })
      .filter((w): w is NonNullable<typeof w> => w !== null);
    const starterSpells = klass.isCaster
      ? (klass.spellsByLevel?.[1] ?? [])
          .map((baseId) => {
            const def = spellsByBaseId[baseId];
            if (!def) return null;
            return mintSpell(def);
          })
          .filter((s): s is NonNullable<typeof s> => s !== null)
      : [];
    const allSlots = klass.isCaster ? slotsForLevel(1) : {};
    // Filter to spell levels the caster has spells for (cantrips are free).
    const accessibleLevels = new Set(
      starterSpells.filter((s) => s.level > 0).map((s) => String(s.level)),
    );
    const filteredSlots: Record<string, number> = {};
    for (const [k, v] of Object.entries(allSlots)) {
      if (accessibleLevels.has(k)) filteredSlots[k] = v;
    }
    // Auto-equip the class's starting armor / shield if the kit
    // calls for it. Wizard / Sorcerer / Monk have no starting armor
    // and stay unarmored — playerAC handles that case via Unarmored
    // Defense overrides for Monks (and the bare 10+DEX baseline).
    const starterArmor = mintArmorByBaseId(klass.startingArmor);
    const starterShield = klass.startingShield
      ? mintArmor(armorByBaseId["shield"])
      : null;
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
      weapons: starterWeapons,
      inventory: starterWeapons,
      known_spells: starterSpells,
      equipped_spells: starterSpells,
      spell_slots: filteredSlots,
      consumables: [],
      equipped_armor: starterArmor,
      equipped_shield: starterShield,
      avatar_url: null,
    };

    // Anonymous users get a single local-only character. Creating a new
    // one overrides the previous (per product decision). Signed-in users
    // POST to Supabase via the existing flow.
    if (!user) {
      const now = new Date().toISOString();
      const localCharacter: Character = {
        ...payload,
        id: crypto.randomUUID(),
        user_id: null,
        created_at: now,
        updated_at: now,
      };
      // Replace any prior local character; clear the legacy active-id
      // pointer too since multi-character is signed-in only.
      clearLocalCharacter();
      clearActiveCharacterId();
      setLocalCharacter(localCharacter);
      dispatch({ type: "SUBMIT_DONE" });
      router.push("/");
      return;
    }

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
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <h1 className="text-center font-mono text-2xl font-bold uppercase tracking-widest">
          DND 5e — Character Creation
        </h1>
        {showAnonymousNotice ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100">
            <span className="font-bold uppercase tracking-widest">
              Heads up:
            </span>{" "}
            without an account, only one character is saved — creating a new
            one will replace your current character.{" "}
            <Link
              href="/auth/sign-in"
              className="font-bold underline underline-offset-2"
            >
              Sign in
            </Link>{" "}
            to keep multiple characters, access them from any device, and play
            co-op campaigns with friends.
          </div>
        ) : null}
        <Card className="w-full overflow-visible">
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
                klass={klass}
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

            <div className="sticky bottom-0 -mx-4 -mb-4 flex items-center justify-between rounded-b-xl border-t-2 border-zinc-900 bg-card px-4 py-4 shadow-[0_-4px_8px_-2px_rgba(0,0,0,0.04)]">
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
      </div>
    </main>
  );
}
