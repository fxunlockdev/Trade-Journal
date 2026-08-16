-- 20260816120000_p0_users_least_privilege.sql
-- W0 · P0 security fix (privilege escalation on public.users).
--
-- BEFORE: anon + authenticated held GRANT ALL on public.users, so an
-- authenticated user could (a) UPDATE their own role -> 'admin', or
-- (b) DELETE their row and re-INSERT it with role='admin' (RLS WITH CHECK
-- only verifies id = auth.uid(), never the role). Both are reachable through
-- the public PostgREST API.
--
-- AFTER: authenticated keeps only SELECT + UPDATE(full_name, avatar_url,
-- has_onboarded) -- the exact columns the app writes. anon keeps only SELECT.
-- Signup is unaffected: handle_new_user + create_personal_journal_for_user
-- are SECURITY DEFINER and run as their owner, not as authenticated.
--
-- Verified on a faithful PostgreSQL 17 shadow restore of the production dump
-- before applying. Additive/reversible (see rollback block).

begin;
revoke insert, update, delete, truncate, references, trigger
  on public.users from anon, authenticated;
grant update (full_name, avatar_url, has_onboarded)
  on public.users to authenticated;
commit;

-- rollback: (restores the prior — INSECURE — state)
-- begin;
--   grant all on public.users to anon, authenticated;
-- commit;
