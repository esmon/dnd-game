-- Coop Story Mode. A story can now be played solo or by a party
-- with a human DM:
--   solo  → dm_kind='self', one player (the owner), status starts
--           'active' (no lobby).
--   coop  → status starts 'lobby'; the party + DM assemble before
--           play. dm_kind='human' with dm_user_id pointing at the
--           DM seat (the DM has no character — they run the world).
--
-- story_players is the party roster (one row per participant). The
-- legacy story_campaigns.character_id stays for the existing solo
-- rows but new code reads the roster from story_players.

-- ── story_campaigns: mode + lobby status ───────────────────────
alter table story_campaigns
  add column if not exists mode text not null default 'solo'
    check (mode in ('solo', 'coop'));

-- Inline CHECK constraints are auto-named {table}_{column}_check.
-- Drop + re-add to allow the new 'lobby' value.
alter table story_campaigns
  drop constraint if exists story_campaigns_status_check;
alter table story_campaigns
  add constraint story_campaigns_status_check
  check (
    status in (
      'lobby',
      'active',
      'completed_success',
      'completed_failure',
      'abandoned'
    )
  );

-- ── story_players: the party roster ────────────────────────────
create table story_players (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  campaign_id uuid not null references story_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'player' brings a character + takes actions; 'dm' runs the
  -- world (no character) and sees DM notes. App enforces at most
  -- one dm row per campaign.
  role text not null check (role in ('player', 'dm')),
  -- The character a player brings. Null for the DM seat.
  character_id uuid references characters(id) on delete set null,
  -- Frozen at join so mid-campaign level-ups don't retro-change a
  -- story in progress (mirrors campaign_players.character_snapshot).
  character_snapshot jsonb,
  is_ready boolean not null default false,
  position int not null default 0,
  unique (campaign_id, user_id)
);

create index story_players_campaign_idx
  on story_players(campaign_id, position);

create trigger story_players_touch
before update on story_players
for each row execute function story_campaigns_touch_updated_at();

-- ── membership helper (recursion-safe, à la coop) ──────────────
-- story_players RLS can't reference story_players without infinite
-- recursion; a SECURITY DEFINER helper in the unexposed `private`
-- schema sidesteps it. Mirrors private.user_is_in_campaign.
create or replace function private.user_is_in_story(
  target_campaign_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.story_players
    where campaign_id = target_campaign_id
      and user_id = auth.uid()
  );
$$;

revoke all on function private.user_is_in_story(uuid) from public;
grant execute on function private.user_is_in_story(uuid) to authenticated;

-- ── widen existing story RLS so party members (not just owner /
--    dm) can read the campaign + its messages, and post messages ─
drop policy if exists "owner can read campaign" on story_campaigns;
create policy "members read campaign"
on story_campaigns
for select
using (
  auth.uid() = user_id
  or auth.uid() = dm_user_id
  or private.user_is_in_story(id)
);

drop policy if exists "owner or dm can read messages" on story_messages;
create policy "members read messages"
on story_messages
for select
using (
  private.user_is_in_story(story_messages.campaign_id)
  or exists (
    select 1 from story_campaigns c
    where c.id = story_messages.campaign_id
      and (auth.uid() = c.user_id or auth.uid() = c.dm_user_id)
  )
);

drop policy if exists "owner or dm can insert messages" on story_messages;
create policy "members insert messages"
on story_messages
for insert
with check (
  private.user_is_in_story(story_messages.campaign_id)
  or exists (
    select 1 from story_campaigns c
    where c.id = story_messages.campaign_id
      and (auth.uid() = c.user_id or auth.uid() = c.dm_user_id)
  )
);

-- ── story_players RLS ──────────────────────────────────────────
alter table story_players enable row level security;

create policy "members read story_players"
on story_players
for select
using (
  auth.uid() = user_id
  or private.user_is_in_story(campaign_id)
  or exists (
    select 1 from story_campaigns c
    where c.id = story_players.campaign_id
      and (auth.uid() = c.user_id or auth.uid() = c.dm_user_id)
  )
);

create policy "users insert their own story_player"
on story_players
for insert
with check (auth.uid() = user_id);

create policy "users update their own story_player"
on story_players
for update
using (auth.uid() = user_id);

-- Either the player themselves or the campaign owner can remove a
-- roster row (owner can kick; player can leave).
create policy "self or owner delete story_player"
on story_players
for delete
using (
  auth.uid() = user_id
  or exists (
    select 1 from story_campaigns c
    where c.id = story_players.campaign_id and auth.uid() = c.user_id
  )
);

-- ── backfill: existing stories get a roster row so the play page
--    can read from story_players uniformly once it's updated ─────
insert into story_players (
  campaign_id, user_id, role, character_id, character_snapshot, is_ready, position
)
select c.id, c.user_id, 'player', c.character_id, to_jsonb(ch.*), true, 0
from story_campaigns c
join characters ch on ch.id = c.character_id
on conflict (campaign_id, user_id) do nothing;
