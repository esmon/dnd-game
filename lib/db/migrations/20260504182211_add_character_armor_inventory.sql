-- Unequipped armor + shield drops carried between fights, mirroring
-- the existing `inventory` (weapons) + `consumables` arrays. Default
-- empty so legacy rows read as "no armor in storage" rather than
-- crashing on a null map / filter.
alter table characters
  add column if not exists armor_inventory jsonb not null default '[]'::jsonb;
