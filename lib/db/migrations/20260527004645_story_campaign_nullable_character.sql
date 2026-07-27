-- Coop Story Mode: a coop story created by the DM has no character
-- on the campaign row (the DM runs the world; players bring their
-- own characters via story_players). story_campaigns.character_id was
-- defined NOT NULL back when every story was solo, so inserting a
-- DM-seat campaign blew up trying to coerce "" into a uuid.
--
-- Drop the NOT NULL so a DM-run coop campaign can leave it null. The
-- roster (story_players) is the source of truth for who's playing;
-- character_id stays as a solo / coop-as-player convenience.
alter table story_campaigns
  alter column character_id drop not null;
