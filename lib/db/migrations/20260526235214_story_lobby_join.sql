-- Coop Story Mode, Phase 4: tighten the roster INSERT policy.
--
-- The join flow itself (POST /api/story/[id]/join) and lobby viewing
-- for non-members are handled server-side with supabaseAdmin +
-- explicit checks, so reads stay locked to members at the RLS layer.
-- We deliberately do NOT widen the story_campaigns SELECT policy:
-- GET /api/story (the "my stories" list) leans on RLS for its "mine"
-- filter, so opening reads to every 'lobby' row would leak strangers'
-- lobbies into everyone's list.
--
-- What we do fix here is the story_players INSERT policy. It used to
-- allow inserting your own row into *any* campaign regardless of
-- status, which would let a client (talking to the Data API directly,
-- bypassing the join route's cap / lobby checks) bolt themselves onto
-- an already-active story. Restrict inserts to the create path (you
-- own the campaign — covers solo's 'active' first row) or the join
-- path (the campaign is in the lobby).

drop policy if exists "users insert their own story_player" on story_players;
create policy "join lobby or owner insert story_player"
on story_players
for insert
with check (
  auth.uid() = user_id
  and exists (
    select 1 from story_campaigns c
    where c.id = story_players.campaign_id
      and (auth.uid() = c.user_id or c.status = 'lobby')
  )
);
