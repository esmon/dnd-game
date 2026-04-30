-- Per-player "I'm ready to start" flag for the lobby. The campaign
-- creator's row is auto-true (clicking Start is their ready signal);
-- joiners default to false and toggle their own row before the
-- creator can start.
alter table campaign_players
  add column if not exists is_ready boolean not null default false;

-- Backfill: any player on a `waiting` campaign whose user_id matches
-- the campaign's creator should be considered ready, so existing
-- lobbies don't get stuck on the new gate.
update campaign_players cp
set is_ready = true
from campaigns c
where c.id = cp.campaign_id
  and cp.user_id = c.created_by;
