-- After a campaign defeat, both players opt in to retry. Mirrors the
-- lobby `is_ready` pattern: each player flips their own flag, and
-- when every member is ready the /continue route resets the run
-- (full HP / slots, fresh encounter at the same encounter_number)
-- and clears the flags back to false.
alter table campaign_players
  add column if not exists continue_ready boolean not null default false;
