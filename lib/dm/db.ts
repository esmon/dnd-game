// Row shapes for the Story Mode tables. Mirrors lib/db/schema.ts's
// style: snake_case fields matching the columns, optional fields
// optional in TS. Keep this aligned with the migration in
// lib/db/migrations/*_add_story_mode_tables.sql.

import type { Character } from "@/lib/db/schema";

export type StoryCampaignStatus =
  | "lobby"
  | "active"
  | "completed_success"
  | "completed_failure"
  | "abandoned";

export type DmKind = "self" | "human" | "ai";

export type StoryMode = "solo" | "coop";

export type StoryPlayerRole = "player" | "dm";

export interface StoryCampaign {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  // Legacy: the owner's character for solo stories created before
  // story_players existed. New code reads the roster from
  // story_players; keep this for backward compat / quick solo
  // lookups. Null for a coop DM-seat campaign (the DM has no
  // character).
  character_id: string | null;
  campaign_template_id: string;
  current_scene_id: string;
  world_state: Record<string, unknown>;
  dm_kind: DmKind;
  dm_user_id: string | null;
  // 'solo' (one player, dm_kind self) vs 'coop' (a party + a human
  // DM seat). Drives whether creation lands in a lobby first.
  mode: StoryMode;
  status: StoryCampaignStatus;
  // Set while a combat encounter is in flight — points at the coop
  // campaigns row spawned by /api/story/[id]/combat/start. Cleared
  // when /combat/end runs after the fight resolves. Null when no
  // combat is active. Used by the story page to know whether a
  // locked combat dialog should be open.
  active_combat_campaign_id: string | null;
  // Coop narrative-phase turn: the roster player whose turn it is to
  // act. Players take one move (action or message) per turn, then it
  // auto-advances in roster order. Null for solo (no turns) and until
  // a coop story starts. The DM is not in the rotation.
  active_turn_user_id: string | null;
}

export interface StoryPlayer {
  id: string;
  created_at: string;
  updated_at: string;
  campaign_id: string;
  user_id: string;
  role: StoryPlayerRole;
  // Null for the DM seat (they run the world, no character).
  character_id: string | null;
  // Frozen character at join time; null for the DM seat.
  character_snapshot: Character | null;
  is_ready: boolean;
  position: number;
}

export type NewStoryPlayer = Omit<
  StoryPlayer,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type StoryMessageRole = "narrative" | "player" | "system" | "tool";

export interface StoryMessage {
  id: string;
  created_at: string;
  updated_at: string;
  campaign_id: string;
  role: StoryMessageRole;
  content: string;
  author_user_id: string | null;
  metadata: Record<string, unknown>;
}

export type NewStoryCampaign = Omit<
  StoryCampaign,
  | "id"
  | "created_at"
  | "updated_at"
  | "active_combat_campaign_id"
  | "active_turn_user_id"
  | "mode"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
  // SQL defaults these; callers pass them only when overriding.
  active_combat_campaign_id?: string | null;
  active_turn_user_id?: string | null;
  mode?: StoryMode;
};

export type NewStoryMessage = Omit<
  StoryMessage,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
