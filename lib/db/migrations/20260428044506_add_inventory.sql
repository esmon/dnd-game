alter table characters
  add column if not exists inventory jsonb not null default '[]'::jsonb;
