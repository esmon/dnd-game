-- Phase 1 of cross-device characters: add an optional auth.users link to
-- characters so signed-in users can claim their session-bound characters
-- and access them from any browser.
--
-- Anonymous play stays the default — user_id is nullable, and existing
-- characters retain their session_id-only access path. RLS is left as-is
-- (the API routes already mediate access via session_id ownership checks);
-- a later phase will add user_id to those API checks.
--
-- ON DELETE SET NULL: if a user deletes their auth.users row, their
-- characters survive but become session-only orphans rather than dangling
-- references. Better than CASCADE for a casual game.

alter table characters
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_characters_user_id on characters (user_id);
