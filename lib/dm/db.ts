// Row shapes for the Story Mode tables. Mirrors lib/db/schema.ts's
// style: snake_case fields matching the columns, optional fields
// optional in TS. Keep this aligned with the migration in
// lib/db/migrations/*_add_story_mode_tables.sql.

export type StoryCampaignStatus =
  | "active"
  | "completed_success"
  | "completed_failure"
  | "abandoned";

export type DmKind = "self" | "human" | "ai";

export interface StoryCampaign {
  id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  character_id: string;
  campaign_template_id: string;
  current_scene_id: string;
  world_state: Record<string, unknown>;
  dm_kind: DmKind;
  dm_user_id: string | null;
  status: StoryCampaignStatus;
}

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
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type NewStoryMessage = Omit<
  StoryMessage,
  "id" | "created_at" | "updated_at"
> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};
