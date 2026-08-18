-- 20260818120000_signup_intent.sql
-- "Who is an IB?" — captured at signup, granted by an admin.
--
-- Until now everyone arrived as an identical affiliate, so the only IBs we knew
-- about were the ones we had already invited. New users now say which they are,
-- which turns an unknown into either a known trader or a reviewable request.
--
-- THE SECURITY LINE: signup_intent is a STATED INTENT, never an entitlement.
-- Saying "I'm an IB" sets ib_request_status = 'pending'; it does not touch
-- platform_role. Only an admin (or an invite link) grants CRM access. Letting a
-- signup pick its own tier is precisely the privilege escalation closed in
-- migration 20260816120000, and this must not reopen it.
--
-- Additive and reversible.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'signup_intent') then
    create type public.signup_intent as enum ('trader', 'ib');
  end if;
  if not exists (select 1 from pg_type where typname = 'ib_request_status') then
    create type public.ib_request_status as enum ('none', 'pending', 'approved', 'declined');
  end if;
end $$;

alter table public.users
  add column if not exists signup_intent public.signup_intent,
  add column if not exists ib_request_status public.ib_request_status not null default 'none',
  add column if not exists ib_requested_at timestamptz;

comment on column public.users.signup_intent is
  'What the user said they are at signup. NOT an entitlement: read platform_role '
  'for access. Null means they have not answered yet.';
comment on column public.users.ib_request_status is
  'Lifecycle of a self-declared IB request. Only an admin moves it past pending.';

create index if not exists users_ib_pending_idx
  on public.users(ib_requested_at desc)
  where ib_request_status = 'pending';

-- ───────────────────────────────────────────────────────────────
-- record_signup_intent() — the user's own answer.
--
-- SECURITY DEFINER because `authenticated` has no UPDATE grant on these columns
-- (deliberately: the same lockdown that stops role self-assignment). Write-once,
-- so nobody can flip-flop to spam the admin queue, and it can only ever write
-- the two intent columns.
-- ───────────────────────────────────────────────────────────────
create or replace function public.record_signup_intent(p_intent text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_existing public.signup_intent;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_intent not in ('trader', 'ib') then
    raise exception 'invalid intent';
  end if;

  select signup_intent into v_existing from public.users where id = v_user;
  if v_existing is not null then
    return; -- already answered; write-once
  end if;

  update public.users
     set signup_intent = p_intent::public.signup_intent,
         -- An IB claim becomes a request for review. platform_role is untouched:
         -- the user still has journal-only access until an admin says otherwise.
         ib_request_status = case when p_intent = 'ib' then 'pending'::public.ib_request_status
                                  else ib_request_status end,
         ib_requested_at   = case when p_intent = 'ib' then now() else ib_requested_at end
   where id = v_user;
end;
$$;

revoke execute on function public.record_signup_intent(text) from public, anon;
grant  execute on function public.record_signup_intent(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- admin_decide_ib_request() — approve or decline, admin only.
-- Approving grants the ib tier through the same path as everything else, so the
-- users.role sync and the audit row still happen.
-- ───────────────────────────────────────────────────────────────
create or replace function public.admin_decide_ib_request(
  p_target uuid,
  p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_status public.ib_request_status;
begin
  if not public.has_product(v_admin, 'admin') then
    raise exception 'forbidden';
  end if;

  select ib_request_status into v_status from public.users where id = p_target;
  if not found then
    raise exception 'user not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'no pending request for this user';
  end if;

  update public.users
     set ib_request_status = case when p_approve then 'approved'::public.ib_request_status
                                  else 'declined'::public.ib_request_status end
   where id = p_target;

  if p_approve then
    -- Reuse the one sanctioned promotion path: it re-checks admin, blocks
    -- self-changes and last-admin demotion, syncs users.role and audits.
    perform public.admin_set_platform_role(p_target, 'ib'::public.platform_role);
  else
    insert into public.platform_audit(actor_user_id, target_user_id, action, detail)
    values (v_admin, p_target, 'ib_request_declined', '{}'::jsonb);
  end if;
end;
$$;

revoke execute on function public.admin_decide_ib_request(uuid, boolean) from public, anon;
grant  execute on function public.admin_decide_ib_request(uuid, boolean) to authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.admin_decide_ib_request(uuid, boolean);
--     drop function if exists public.record_signup_intent(text);
--     alter table public.users
--       drop column if exists signup_intent,
--       drop column if exists ib_request_status,
--       drop column if exists ib_requested_at;
--     drop type if exists public.signup_intent;
--     drop type if exists public.ib_request_status;
--   commit;
-- ───────────────────────────────────────────────────────────────
