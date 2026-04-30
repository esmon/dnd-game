-- The original campaign RLS policies recursed: campaigns checks
-- campaign_players, and campaign_players checks itself. Postgres throws
-- "infinite recursion detected in policy" and the API 500s on every
-- read.
--
-- Standard Supabase fix: a SECURITY DEFINER helper that bypasses RLS,
-- placed in an unexposed schema (private) so it isn't reachable through
-- the Data API per project security guidance.

create schema if not exists private;

create or replace function private.user_is_in_campaign(
  target_campaign_id uuid
)
returns boolean
language sql
security definer
stable
-- An empty search_path forbids unqualified table references inside the
-- function body, so a malicious schema in the user's search_path can't
-- shadow public tables. References below must be fully-qualified.
set search_path = ''
as $$
  select exists (
    select 1 from public.campaign_players
    where campaign_id = target_campaign_id
      and user_id = auth.uid()
  );
$$;

revoke all on function private.user_is_in_campaign(uuid) from public;
grant execute on function private.user_is_in_campaign(uuid) to authenticated;

-- Drop and recreate the affected SELECT policies using the helper.
drop policy if exists "Members can read their campaign" on campaigns;
drop policy if exists "Members can read campaign_players for their campaign"
  on campaign_players;
drop policy if exists "Members can read campaign_actions for their campaign"
  on campaign_actions;

create policy "Members can read their campaign"
  on campaigns for select
  using (
    private.user_is_in_campaign(id)
    or created_by = auth.uid()
  );

create policy "Members can read campaign_players for their campaign"
  on campaign_players for select
  using (private.user_is_in_campaign(campaign_id));

create policy "Members can read campaign_actions for their campaign"
  on campaign_actions for select
  using (private.user_is_in_campaign(campaign_id));
