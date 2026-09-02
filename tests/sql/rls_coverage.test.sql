-- I7 — RLS coverage enumerator.
--
-- Asserts every table in `public` has row-level security ENABLED and is either
-- covered by >=1 policy OR on the documented intentional-deny-all allowlist.
--
-- A table with RLS on and zero policies is fail-closed (deny-all to non-owner
-- roles). Four tables are deliberately in that state, and all are listed below
-- so the check stays meaningful: any OTHER table that loses its policies, or
-- any new table shipped without RLS, fails the run.
--
--   trades              — all trade access goes through server routes using the
--                         service-role client, never the browser client.
--   api_rate_limits     — counters, not user data. Only check_rate_limit()
--                         (SECURITY DEFINER) touches them. Granting any policy
--                         would let a client read or reset its own limit, which
--                         defeats it.
--   telegram_seen_chats — chats the bot has been added to. It briefly HAD a
--                         `using (true)` select policy so the connect picker
--                         could list groups, and that was a cross-tenant leak:
--                         it exposed the existence and title of other
--                         customers' groups, and paired with a connect handler
--                         that did not check the caller's relationship to a
--                         chat, it let one customer attach another's group to
--                         their own account. The policy was removed rather than
--                         narrowed, because a chat has no owner until someone
--                         claims it, so there is no column to scope on. Clients
--                         read telegram_chat_claims (owner-scoped) instead;
--                         only the webhook writes here, as the service role.
--   telegram_webhook_state — server bookkeeping recording what the Telegram
--                         webhook was last registered with, so the scheduler
--                         can notice drift and re-register itself. Not user
--                         data, and holds a fingerprint rather than the secret.
--                         Only the service role touches it.
--
-- Run with:  psql "$DB_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_coverage.test.sql
-- A gap raises an exception -> psql exits non-zero -> CI fails.

do $$
declare
  v_gaps text;
begin
  select string_agg(relname || ' (' || reason || ')', '; ')
    into v_gaps
  from (
    select c.relname,
      case when not c.relrowsecurity then 'RLS DISABLED' else 'RLS on, 0 policies' end as reason
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and (
        not c.relrowsecurity
        or (
          not exists (
            select 1 from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname
          )
          and c.relname <> all (
            array[
              'trades', 'api_rate_limits',
              'telegram_seen_chats', 'telegram_webhook_state'
            ]
          )  -- documented deny-all, see header
        )
      )
  ) gaps;

  if v_gaps is not null then
    raise exception 'I7 RLS coverage FAIL -> %', v_gaps;
  end if;

  raise notice 'I7 RLS coverage: PASS (every public table has RLS + a policy, or is an allowlisted deny-all)';
end $$;
