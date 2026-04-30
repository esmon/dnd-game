-- The previous fix put `user_is_in_campaign` in the `private` schema and
-- granted EXECUTE on the function, but missed granting USAGE on the
-- schema itself. Without USAGE the calling role can't even resolve the
-- function name when an RLS policy invokes it — Postgres throws
-- "permission denied for schema private" and PostgREST surfaces it as
-- the cryptic "Database connection error / schema cache" generic.
--
-- Both anon and authenticated need USAGE because campaign queries can
-- arrive on either role: route handlers issue queries via the
-- publishable client (anon) but the auth check happens up-front in the
-- handler, so the policy still has to evaluate cleanly under anon (it
-- just returns false because auth.uid() is null).

grant usage on schema private to anon, authenticated;

-- Reload PostgREST's schema cache so the new permissions take effect
-- without waiting for the periodic refresh.
notify pgrst, 'reload schema';
