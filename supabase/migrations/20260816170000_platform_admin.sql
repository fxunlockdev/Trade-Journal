-- 20260816170000_platform_admin.sql
-- W5 · Platform administration — list users and change platform_role.
--
-- Role changes must write public.users.platform_role, which `authenticated` has
-- NO grant on (by design — the P0 fix). Rather than introduce a new service-role
-- call site, both admin operations are SECURITY DEFINER functions that check the
-- caller is an active admin, act, and write an append-only audit row. This keeps
-- authorization in one place and never widens client grants.
--
-- Guards (anti-lockout): an admin cannot change their OWN role, and the LAST
-- remaining admin cannot be demoted.
--
-- Additive and reversible.

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. platform_audit — append-only ledger of admin actions.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.platform_audit (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid,
  target_user_id uuid,
  action         text not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists platform_audit_created_idx on public.platform_audit(created_at desc);

alter table public.platform_audit enable row level security;

-- Admins read the ledger. Nobody writes it directly (definer functions do,
-- running as the table owner, which bypasses RLS). No UPDATE/DELETE policy.
drop policy if exists platform_audit_select on public.platform_audit;
create policy platform_audit_select on public.platform_audit
  for select to authenticated
  using ((select public.has_product((select auth.uid()), 'admin')));

revoke all on public.platform_audit from anon, authenticated;
grant select on public.platform_audit to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2. admin_list_users() — admin-only directory read.
-- ───────────────────────────────────────────────────────────────
create or replace function public.admin_list_users()
returns table (
  id             uuid,
  email          text,
  full_name      text,
  company_name   text,
  platform_role  public.platform_role,
  last_active_at timestamptz,
  created_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_product((select auth.uid()), 'admin') then
    raise exception 'forbidden';
  end if;
  return query
    select u.id, u.email, u.full_name, u.company_name, u.platform_role,
           u.last_active_at, u.created_at
    from public.users u
    order by u.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant  execute on function public.admin_list_users() to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. admin_set_platform_role() — the only way to change a tier.
-- ───────────────────────────────────────────────────────────────
create or replace function public.admin_set_platform_role(
  p_target uuid,
  p_role   public.platform_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_old   public.platform_role;
  v_admin_count int;
begin
  if not public.has_product(v_admin, 'admin') then
    raise exception 'forbidden';
  end if;
  if p_target = v_admin then
    raise exception 'you cannot change your own role';
  end if;

  select platform_role into v_old from public.users where id = p_target;
  if not found then
    raise exception 'user not found';
  end if;

  -- Never demote the last admin.
  if v_old = 'admin' and p_role <> 'admin' then
    select count(*) into v_admin_count from public.users where platform_role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'cannot demote the last admin';
    end if;
  end if;

  update public.users set platform_role = p_role where id = p_target;

  insert into public.platform_audit(actor_user_id, target_user_id, action, detail)
  values (v_admin, p_target, 'platform_role_change',
          jsonb_build_object('from', v_old::text, 'to', p_role::text));
end;
$$;

revoke execute on function public.admin_set_platform_role(uuid, public.platform_role) from public, anon;
grant  execute on function public.admin_set_platform_role(uuid, public.platform_role) to authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.admin_set_platform_role(uuid, public.platform_role);
--     drop function if exists public.admin_list_users();
--     drop table if exists public.platform_audit;
--   commit;
-- ───────────────────────────────────────────────────────────────
