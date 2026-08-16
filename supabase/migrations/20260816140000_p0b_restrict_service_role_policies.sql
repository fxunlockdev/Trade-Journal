-- 20260816140000_p0b_restrict_service_role_policies.sql
-- W1 · P0-b: live unauthenticated data exposure on chat_messages / trade_insights.
--
-- FOUND (verified against production with only the PUBLIC anon key and no
-- session): `GET /rest/v1/chat_messages?select=*` returned every user's AI chat
-- history, and `/rest/v1/trade_insights` returned every insights row.
--
-- CAUSE: four policies were created without a TO clause:
--
--   CREATE POLICY "Service role all messages" ON public.chat_messages
--     USING (true) WITH CHECK (true);          -- no TO clause!
--
-- A policy with no TO clause applies to PUBLIC — every role, including `anon`
-- and `authenticated`. They are PERMISSIVE and FOR ALL, and permissive policies
-- are OR'd together, so `USING (true)` swallowed the adjacent owner-scoped
-- policies and made both tables world-readable and world-writable through
-- PostgREST. The names show the intent was service-role-only.
--
-- FIX: restrict all four to the service_role. (service_role bypasses RLS
-- anyway, so they become no-ops; the owner-scoped policies then actually
-- govern user access.) ALTER, not DROP — reversible and non-destructive.
--
-- AFTER this migration the effective rules are:
--   chat_messages  : chat_messages_own (ALL, auth.uid() = user_id)
--                    + read-own SELECT policies
--   trade_insights : read-own SELECT policies; writes only via service_role
--                    (which is how the app already writes them)

begin;

alter policy "Service role all messages"     on public.chat_messages  to service_role;
alter policy "Service role manages messages" on public.chat_messages  to service_role;
alter policy "Service role all insights"     on public.trade_insights to service_role;
alter policy "Service role manages insights" on public.trade_insights to service_role;

commit;

-- rollback: (restores the INSECURE world-readable state — do not run)
-- begin;
--   alter policy "Service role all messages"     on public.chat_messages  to public;
--   alter policy "Service role manages messages" on public.chat_messages  to public;
--   alter policy "Service role all insights"     on public.trade_insights to public;
--   alter policy "Service role manages insights" on public.trade_insights to public;
-- commit;
