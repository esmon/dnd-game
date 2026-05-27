-- Coop Story Mode: turn-based narrative play. During the narrative
-- phase (out of combat) coop players act one at a time in roster
-- order. active_turn_user_id is the player whose turn it is; null for
-- solo (no turns) and until a coop story starts. The DM is outside
-- the rotation — they narrate freely and drive the world from the DM
-- panel.
alter table story_campaigns
  add column if not exists active_turn_user_id uuid
    references auth.users(id) on delete set null;
