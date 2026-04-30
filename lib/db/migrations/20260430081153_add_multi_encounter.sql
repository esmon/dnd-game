-- Multi-encounter campaigns: a single campaign can chain multiple
-- fights with rest intervals between them. Adds:
--
--   campaigns.encounter_number — current/last fought encounter; starts
--     at 1, increments on next-encounter. Stays unchanged through win
--     → between_encounters → next_encounter (incremented THERE).
--
--   campaign_actions.encounter_number — stamped on insert with the
--     campaign's current encounter_number, so the battle UI can
--     filter the action log to just the current fight (per-monster
--     damage doesn't carry across encounters).
--
--   "between_encounters" status — slotted between active and
--     finished. While in this state players are revived to full HP,
--     loot/XP from the prior encounter is locked in to characters,
--     and the rest screen offers Next Encounter / End Campaign.

alter table campaigns
  add column if not exists encounter_number int not null default 1;

alter table campaign_actions
  add column if not exists encounter_number int not null default 1;

alter table campaigns
  drop constraint if exists campaigns_status_check;

alter table campaigns
  add constraint campaigns_status_check
  check (status in ('waiting', 'active', 'between_encounters', 'finished'));
