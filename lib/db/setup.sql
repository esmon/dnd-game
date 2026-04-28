-- Run this in the Supabase SQL Editor to create the characters table

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  name text not null,
  race text not null,
  subrace text,
  class text not null,
  subclass text,
  background text not null,
  alignment text not null,
  level integer not null default 1,
  xp integer not null default 0,
  ability_scores jsonb not null,
  max_hp integer not null,
  current_hp integer not null,
  proficiency_bonus integer not null default 2,
  weapons jsonb not null default '[]'::jsonb,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_characters_session_id on characters (session_id);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists characters_set_updated_at on characters;
create trigger characters_set_updated_at
  before update on characters
  for each row
  execute function set_updated_at();

-- Enable RLS but allow reads for everyone (publishable key)
alter table characters enable row level security;

create policy "Allow public read access"
  on characters for select
  using (true);

create policy "Allow service role insert"
  on characters for insert
  with check (true);

create policy "Allow service role update"
  on characters for update
  using (true)
  with check (true);

create policy "Allow service role delete"
  on characters for delete
  using (true);
