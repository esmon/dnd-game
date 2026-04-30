-- Persist the rolled difficulty for the current encounter so the
-- battle UI can show players what they're walking into. Updated on
-- /start and /next-encounter; null on older active campaigns and
-- when status is not 'active' (no in-flight encounter to label).
alter table campaigns
  add column if not exists current_difficulty text
  check (
    current_difficulty is null
    or current_difficulty in ('easy', 'medium', 'hard', 'deadly')
  );
