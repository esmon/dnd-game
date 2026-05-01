// Database row shapes for the co-op tables. Uses snake_case to match
// the SQL columns directly so route handlers don't need a translation
// layer. `monsters` and `character_snapshot` are jsonb columns; we
// reuse the runtime Monster / Character shapes verbatim there since
// jsonb is unchecked and keeping a single shape avoids conversion
// boilerplate.
import type { Character } from "@/lib/db/schema";
import type { Monster } from "@/lib/game/types";

export type CampaignStatus =
  | "waiting"
  | "active"
  | "between_encounters"
  | "finished";
export type CampaignOutcome = "won" | "lost";

// Persisted turn order — set by the start route from rolled
// initiative. Older active campaigns predating M9b have null here and
// fall back to position-order round-robin in nextAliveSlot. The
// optional `roll` carries the d20 + DEX result for display in the
// initiative strip; older slots (or round-robin fallbacks) leave it
// undefined.
export type TurnSlot =
  | { kind: "player"; index: number; roll?: number }
  | { kind: "monster"; index: number; roll?: number };

export interface Campaign {
  id: string;
  status: CampaignStatus;
  created_by: string;
  monsters: Monster[];
  turn_pointer: number;
  turn_deadline: string | null;
  outcome: CampaignOutcome | null;
  initiative_order: TurnSlot[] | null;
  // 1-indexed; the encounter currently being fought (or just
  // finished, when status === "between_encounters"). Increments
  // when /next-encounter is called.
  encounter_number: number;
  // Rolled difficulty tier for the current/last encounter, surfaced
  // in the battle UI. Null on pre-M10 active rows (the column was
  // added later) — UI just hides the badge in that case.
  current_difficulty: "easy" | "medium" | "hard" | "deadly" | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignPlayer {
  id: string;
  campaign_id: string;
  user_id: string;
  position: number;
  character_snapshot: Character;
  current_hp: number;
  is_ready: boolean;
  // Per-player "Play Again" vote on the defeat screen. When every
  // member's flag is true, /continue resets the run and clears all
  // the flags back to false.
  continue_ready: boolean;
  joined_at: string;
}

export type CampaignActorKind = "player" | "monster";

export type CampaignActionKind =
  | "attack"
  | "spell"
  | "scroll"
  | "heal"
  | "potion"
  | "smite"
  | "run-away"
  | "skip";

// Payload schema is intentionally loose for now — different action
// kinds have different shapes and we'll narrow per kind at the
// rendering / processing boundaries. All payloads include enough
// context to render a log line without re-loading the actor /
// target.
export type CampaignActionPayload = Record<string, unknown>;

export interface CampaignAction {
  id: string;
  campaign_id: string;
  turn_number: number;
  encounter_number: number;
  actor_kind: CampaignActorKind;
  actor_player_id: string | null;
  actor_monster_index: number | null;
  target_kind: CampaignActorKind | null;
  target_player_id: string | null;
  target_monster_index: number | null;
  kind: CampaignActionKind;
  payload: CampaignActionPayload;
  created_at: string;
}
