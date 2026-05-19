-- Story-mode combat integration: when the DM triggers an encounter
-- via /combat/start we spin up a coop campaign and stamp its id back
-- on the story_campaigns row. The story page reads this to know
-- whether a locked combat dialog should be open. Nullable because
-- most of the time no combat is in flight.
--
-- ON DELETE SET NULL because if a coop campaign row is cleaned up
-- by some future GC, the story should keep playing — the combat
-- record just disappears.
alter table story_campaigns
  add column if not exists active_combat_campaign_id uuid
    references campaigns(id) on delete set null;

-- Index so the (rare) lookup "is anyone in a fight right now?" stays
-- cheap. Partial index — most rows are null and don't need to live
-- in the index pages.
create index if not exists story_campaigns_active_combat_idx
  on story_campaigns(active_combat_campaign_id)
  where active_combat_campaign_id is not null;
