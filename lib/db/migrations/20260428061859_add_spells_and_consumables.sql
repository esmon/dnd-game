alter table characters
  add column if not exists known_spells jsonb not null default '[]'::jsonb,
  add column if not exists spell_slots jsonb not null default '{}'::jsonb,
  add column if not exists equipped_spells jsonb not null default '[]'::jsonb,
  add column if not exists consumables jsonb not null default '[]'::jsonb;
