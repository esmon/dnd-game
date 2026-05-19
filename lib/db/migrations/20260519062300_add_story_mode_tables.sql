-- Story Mode (Phase 0): durable storage for AI/human-DM campaigns.
-- This migration sets up the bones; the workflow + DM action loop
-- come in later phases. Sign-in-gated for now (anonymous players
-- have no Supabase row to attach a campaign to).

create table story_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Owner of the campaign. Story Mode is sign-in-only by design:
  -- campaigns span multiple sessions and the workflow + AI calls
  -- need durable state we can't put in localStorage.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The character playing through the campaign. Solo for now;
  -- a future migration adds a `party_id` for coop Story Mode.
  character_id uuid not null references characters(id) on delete cascade,
  -- Id from lib/dm/campaigns/* — the template the DM is running.
  campaign_template_id text not null,
  -- Scene id within the template. Set on creation to the first
  -- scene; advanced by DM actions.
  current_scene_id text not null,
  -- Flexible per-campaign state (chosen options, NPC dispositions,
  -- inventory of clues, etc.). Empty object at creation; phases
  -- 1/2 will populate as the DM acts.
  world_state jsonb not null default '{}'::jsonb,
  -- 'self' = player narrates their own story for now; 'human'
  -- = another user is the DM (Phase 1); 'ai' = workflow drives
  -- via streamText (Phase 2). Default 'self' for Phase 0.
  dm_kind text not null default 'self'
    check (dm_kind in ('self', 'human', 'ai')),
  -- Set only when dm_kind = 'human'. The user_id of whoever's
  -- running the DM seat. Null otherwise.
  dm_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'completed_success', 'completed_failure', 'abandoned'))
);

create index story_campaigns_user_idx on story_campaigns(user_id, updated_at desc);
create index story_campaigns_character_idx on story_campaigns(character_id);

-- BEFORE UPDATE trigger to keep updated_at fresh on every write.
create or replace function story_campaigns_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger story_campaigns_touch
before update on story_campaigns
for each row execute function story_campaigns_touch_updated_at();

create table story_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- updated_at is unusual for an append-only log, but cheap to
  -- carry and useful if we ever support edits (tool-call result
  -- being rewritten by a follow-up, etc.).
  updated_at timestamptz not null default now(),
  campaign_id uuid not null references story_campaigns(id) on delete cascade,
  -- 'narrative' = DM-published prose; 'player' = a player's response;
  -- 'system' = scene transitions, scripted readAloud auto-publishes;
  -- 'tool' = DM tool invocations (start_combat, award_loot) once
  -- those exist in later phases.
  role text not null
    check (role in ('narrative', 'player', 'system', 'tool')),
  content text not null,
  -- Who posted. Null for system-generated rows (scene seeds, tool
  -- result placeholders).
  author_user_id uuid references auth.users(id) on delete set null,
  -- For tool rows: the tool name + arguments + result. For
  -- system rows: the scene id transition belongs to. Open shape
  -- so phases 1/2 can extend without another migration.
  metadata jsonb not null default '{}'::jsonb
);

create index story_messages_campaign_idx on story_messages(campaign_id, created_at);

create trigger story_messages_touch
before update on story_messages
for each row execute function story_campaigns_touch_updated_at();

-- RLS: campaign owner reads/writes their own rows. DM (when
-- dm_user_id is set) also reads/writes. Other users can't see the
-- campaign at all.
alter table story_campaigns enable row level security;
alter table story_messages enable row level security;

create policy "owner can read campaign"
on story_campaigns
for select
using (auth.uid() = user_id or auth.uid() = dm_user_id);

create policy "owner can insert campaign"
on story_campaigns
for insert
with check (auth.uid() = user_id);

create policy "owner or dm can update campaign"
on story_campaigns
for update
using (auth.uid() = user_id or auth.uid() = dm_user_id);

create policy "owner can delete campaign"
on story_campaigns
for delete
using (auth.uid() = user_id);

create policy "owner or dm can read messages"
on story_messages
for select
using (
  exists (
    select 1
    from story_campaigns c
    where c.id = story_messages.campaign_id
      and (auth.uid() = c.user_id or auth.uid() = c.dm_user_id)
  )
);

create policy "owner or dm can insert messages"
on story_messages
for insert
with check (
  exists (
    select 1
    from story_campaigns c
    where c.id = story_messages.campaign_id
      and (auth.uid() = c.user_id or auth.uid() = c.dm_user_id)
  )
);
