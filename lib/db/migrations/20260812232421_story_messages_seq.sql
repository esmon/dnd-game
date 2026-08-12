-- Stable ordering for the story log.
--
-- story_messages was ordered by created_at alone, but a scene's
-- read-aloud passages are batch-inserted in one statement, so they all
-- share the same created_at (Postgres now() is constant per statement),
-- and the action response / reward / read-aloud rows within one action
-- often tie at sub-millisecond resolution too. With id being a random
-- uuid there was no tiebreaker, so a refetch (every action broadcasts,
-- which makes the client re-fetch + re-sort) returned tied rows in
-- arbitrary order — the narrative reshuffled and could land after the
-- actions/response ("acting before the story").
--
-- Add a monotonic `seq` (insertion order) to order by instead. Ties
-- become impossible.

alter table story_messages add column seq bigint;

-- Backfill existing rows chronologically (created_at, then id for any
-- ties) so in-progress stories keep a sensible order.
update story_messages m
set seq = o.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from story_messages
) o
where m.id = o.id;

-- Auto-increment for new rows, continuing after the backfilled max.
-- setval's third arg (is_called) is false when the table is empty so the
-- first nextval yields 1; true otherwise so it yields max + 1. (Passing
-- value 0 with is_called=true would violate the sequence minvalue of 1.)
create sequence story_messages_seq_seq;
select setval(
  'story_messages_seq_seq',
  coalesce((select max(seq) from story_messages), 1),
  (select count(*) > 0 from story_messages)
);
alter table story_messages alter column seq set default nextval('story_messages_seq_seq');
alter table story_messages alter column seq set not null;
alter sequence story_messages_seq_seq owned by story_messages.seq;

-- Read path is always scoped to one campaign, ordered by seq.
create index story_messages_campaign_seq_idx on story_messages(campaign_id, seq);
