import type { AbilityScores } from "@/lib/db/schema";
import type { Alignment } from "@/lib/dnd/alignments";

export type StepIndex = 0 | 1 | 2 | 3 | 4;

export type AbilityAssignments = Record<keyof AbilityScores, number | null>;

export type CreateState = {
  step: StepIndex;
  raceId: string | null;
  classId: string | null;
  backgroundId: string | null;
  abilities: AbilityAssignments;
  name: string;
  alignment: Alignment | null;
  // Staged on the Review step; uploaded after the character row is
  // created (we need an id to scope the storage path). Null = use
  // initials. Signed-in only — anonymous users have no row to attach
  // the file to and see initials instead.
  avatarFile: File | null;
  submitting: boolean;
  error: string | null;
};

export const initialAbilities: AbilityAssignments = {
  str: null,
  dex: null,
  con: null,
  int: null,
  wis: null,
  cha: null,
};

export const initialCreateState: CreateState = {
  step: 0,
  raceId: null,
  classId: null,
  backgroundId: null,
  abilities: initialAbilities,
  name: "",
  alignment: null,
  avatarFile: null,
  submitting: false,
  error: null,
};

export type CreateAction =
  | { type: "SET_RACE"; raceId: string }
  | { type: "SET_CLASS"; classId: string }
  | { type: "SET_BACKGROUND"; backgroundId: string }
  | { type: "SET_ABILITY"; ability: keyof AbilityAssignments; value: number | null }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_ALIGNMENT"; alignment: Alignment }
  | { type: "SET_AVATAR_FILE"; file: File | null }
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "SUBMIT_DONE" };

const MAX_STEP: StepIndex = 4;

function clampStep(n: number): StepIndex {
  if (n <= 0) return 0;
  if (n >= MAX_STEP) return MAX_STEP;
  return n as StepIndex;
}

export function createReducer(
  state: CreateState,
  action: CreateAction,
): CreateState {
  switch (action.type) {
    case "SET_RACE":
      return { ...state, raceId: action.raceId };
    case "SET_CLASS":
      return { ...state, classId: action.classId };
    case "SET_BACKGROUND":
      return { ...state, backgroundId: action.backgroundId };
    case "SET_ABILITY":
      return {
        ...state,
        abilities: { ...state.abilities, [action.ability]: action.value },
      };
    case "SET_NAME":
      return { ...state, name: action.name };
    case "SET_ALIGNMENT":
      return { ...state, alignment: action.alignment };
    case "SET_AVATAR_FILE":
      return { ...state, avatarFile: action.file };
    case "NEXT_STEP":
      return { ...state, step: clampStep(state.step + 1) };
    case "PREV_STEP":
      return { ...state, step: clampStep(state.step - 1) };
    case "SUBMIT_START":
      return { ...state, submitting: true, error: null };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, error: action.error };
    case "SUBMIT_DONE":
      return { ...state, submitting: false, error: null };
    default:
      return state;
  }
}
