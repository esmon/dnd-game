-- Co-op MVP: 2 signed-in players vs 1+ monsters via invite link.
--
-- Three new tables, all keyed off a parent matches row:
--
--   matches         — one row per match. Holds match-wide state (status,
--                     monsters, whose turn it is). Source of truth.
--   match_players   — one row per (match, user). Contains a frozen
--                     character snapshot taken at join time so neither
--                     player can level mid-match. Mutable HP lives here
--                     too (smaller surface than re-snapshotting).
--   match_actions   — append-only log of every action taken. Each row
--                     is a server-authoritative result (rolls, damage,
--                     hit/crit) — clients render from this log via
--                     Realtime instead of computing damage themselves.
--
-- RLS: anyone in match_players for a given match can read its rows;
-- writes go through service-role API routes (existing pattern in this
-- project) so per-table write policies stay permissive.

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('waiting', 'active', 'finished')),
  -- Creator is the inviter; needed to gate the "Start" action and to
  -- show the lobby owner.
  created_by uuid not null references auth.users(id) on delete cascade,
  -- Frozen monster pool for this match. jsonb array of monster snapshots
  -- (`{ index, name, max_hp, hp, ac, ...}`). Mutated on each hit so we
  -- don't need a separate match_monsters table for v1; can extract later
  -- if we need richer per-monster state.
  monsters jsonb not null default '[]'::jsonb,
  -- Round-robin index into the combined [players-by-position, monsters]
  -- list. Server picks "next alive actor" rather than relying on this
  -- modulo-style — see comment in match_actions logic.
  turn_pointer integer not null default 0,
  -- Optional deadline so we can auto-skip turns when a player AFKs
  -- (Phase M5). Null while waiting / finished.
  turn_deadline timestamptz,
  outcome text check (outcome in ('won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_matches_created_by on matches (created_by);
create index if not exists idx_matches_status_created_at
  on matches (status, created_at desc);

create trigger matches_set_updated_at
  before update on matches
  for each row
  execute function set_updated_at();

create table if not exists match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Stable join order — drives turn rotation. Position 0 is the creator.
  position integer not null,
  -- Frozen at join time. The match doesn't see future level-ups / loot.
  -- Stored as a Character snapshot so the existing characterToPlayer()
  -- helper works unchanged in match UIs.
  character_snapshot jsonb not null,
  -- Mutable HP through the match. Everything else lives in the
  -- snapshot. When current_hp <= 0 the player is "out" but stays in
  -- the row (so the UI can render a grayed-out panel + log).
  current_hp integer not null,
  joined_at timestamptz not null default now(),
  -- (match_id, user_id) prevents a user from joining the same match
  -- twice. (match_id, position) keeps positions unique within a match.
  unique (match_id, user_id),
  unique (match_id, position)
);

create index if not exists idx_match_players_match_id on match_players (match_id);
create index if not exists idx_match_players_user_id on match_players (user_id);

create table if not exists match_actions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  -- Monotonic per match. The server enforces ordering, but clients use
  -- this to detect missed Realtime events and replay.
  turn_number integer not null,
  -- Who acted: a player (actor_player_id set, actor_monster_index null)
  -- or a monster (the inverse).
  actor_kind text not null check (actor_kind in ('player', 'monster')),
  actor_player_id uuid references match_players(id) on delete cascade,
  actor_monster_index integer,
  -- What was hit (same dichotomy as above). Some actions like "run away"
  -- have no target; both fields null in that case.
  target_kind text check (target_kind in ('player', 'monster')),
  target_player_id uuid references match_players(id) on delete cascade,
  target_monster_index integer,
  -- e.g. 'attack', 'spell', 'scroll', 'heal', 'run-away', 'skip'
  kind text not null,
  -- Server-rolled result: { hit, crit, missed, d20, damage, note?, ... }.
  -- Client trusts this and never recomputes. Same shape as the existing
  -- PLAYER_ATTACK / MONSTER_ATTACK reducer payloads, plus a few extras
  -- (e.g. spell name) for log rendering.
  payload jsonb not null,
  created_at timestamptz not null default now(),
  -- Each (match, turn_number) pair is unique — if two writes race, one
  -- loses, which is desired; the server validates current turn before
  -- inserting.
  unique (match_id, turn_number),
  -- Ensure the actor / target half-pairs are mutually exclusive.
  check (
    (actor_kind = 'player' and actor_player_id is not null and actor_monster_index is null) or
    (actor_kind = 'monster' and actor_monster_index is not null and actor_player_id is null)
  ),
  check (
    target_kind is null or
    (target_kind = 'player' and target_player_id is not null and target_monster_index is null) or
    (target_kind = 'monster' and target_monster_index is not null and target_player_id is null)
  )
);

create index if not exists idx_match_actions_match_id_turn
  on match_actions (match_id, turn_number);

-- RLS: members of a match see its data; non-members see nothing.
-- Writes funnel through the API (service-role bypass), matching the
-- existing characters table pattern.

alter table matches enable row level security;
alter table match_players enable row level security;
alter table match_actions enable row level security;

create policy "Members can read their match"
  on matches for select
  using (
    exists (
      select 1 from match_players
      where match_players.match_id = matches.id
        and match_players.user_id = auth.uid()
    )
    or matches.created_by = auth.uid()
  );

create policy "Members can read match_players for their match"
  on match_players for select
  using (
    exists (
      select 1 from match_players me
      where me.match_id = match_players.match_id
        and me.user_id = auth.uid()
    )
  );

create policy "Members can read match_actions for their match"
  on match_actions for select
  using (
    exists (
      select 1 from match_players
      where match_players.match_id = match_actions.match_id
        and match_players.user_id = auth.uid()
    )
  );

-- Service-role writes bypass these. Permissive policies match the
-- characters-table convention so the API can use the publishable client
-- for reads when convenient.
create policy "Allow service role insert matches"
  on matches for insert with check (true);
create policy "Allow service role update matches"
  on matches for update using (true) with check (true);
create policy "Allow service role delete matches"
  on matches for delete using (true);

create policy "Allow service role insert match_players"
  on match_players for insert with check (true);
create policy "Allow service role update match_players"
  on match_players for update using (true) with check (true);
create policy "Allow service role delete match_players"
  on match_players for delete using (true);

create policy "Allow service role insert match_actions"
  on match_actions for insert with check (true);
create policy "Allow service role update match_actions"
  on match_actions for update using (true) with check (true);
create policy "Allow service role delete match_actions"
  on match_actions for delete using (true);

-- Realtime: clients subscribe to changes on these tables for live
-- updates. Enable replication on each.
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table match_players;
alter publication supabase_realtime add table match_actions;
