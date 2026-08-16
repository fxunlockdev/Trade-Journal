-- 20260816190000_reconcile_admin_role.sql
-- Post-review fix (CRITICAL + LOW from the security review).
--
-- CRITICAL: the platform tier (users.platform_role) and the legacy journal
-- capability flag (users.role, values user|trader|admin) could DRIFT. The W1
-- backfill set platform_role='admin' for role='admin' users but never cleared
-- role, and admin_set_platform_role() only wrote platform_role — so a
-- platform-demoted admin kept role='admin', which the pre-existing service-role
-- /api/admin/users endpoint (and the settings admin panel) trusted. That route
-- is now repointed to has_product('admin'); this migration additionally keeps
-- the two flags in lockstep so they can never drift again, and reconciles any
-- existing drift.
--
-- The sync only touches the 'admin' meaning of users.role. 'trader' (signal
-- publishing) is preserved untouched.
--
-- LOW: crm_invites_update's WITH CHECK now re-asserts has_product('crm'), to
-- mirror the affiliates/commissions update policies exactly.
--
-- Additive/idempotent, reversible.

begin;

-- 1. Keep users.role in lockstep with platform_role's admin meaning.
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

  if v_old = 'admin' and p_role <> 'admin' then
    select count(*) into v_admin_count from public.users where platform_role = 'admin';
    if v_admin_count <= 1 then
      raise exception 'cannot demote the last admin';
    end if;
  end if;

  update public.users
     set platform_role = p_role,
         -- Sync the legacy admin flag; never disturb 'trader'.
         role = case
                  when p_role = 'admin' then 'admin'
                  when role = 'admin'   then 'user'
                  else role
                end
   where id = p_target;

  insert into public.platform_audit(actor_user_id, target_user_id, action, detail)
  values (v_admin, p_target, 'platform_role_change',
          jsonb_build_object('from', v_old::text, 'to', p_role::text));
end;
$$;

revoke execute on function public.admin_set_platform_role(uuid, public.platform_role) from public, anon;
grant  execute on function public.admin_set_platform_role(uuid, public.platform_role) to authenticated;

-- 2. Reconcile any EXISTING drift: a legacy admin who isn't a platform admin
--    loses the legacy admin flag (demoted to 'user'). Platform admins keep
--    role='admin'. 'trader' rows are untouched.
update public.users set role = 'user'
  where role = 'admin' and platform_role <> 'admin';
update public.users set role = 'admin'
  where platform_role = 'admin' and role <> 'admin';

-- 3. LOW: mirror the affiliates/commissions update policy — re-assert crm on WITH CHECK.
drop policy if exists crm_invites_update on public.crm_invites;
create policy crm_invites_update on public.crm_invites
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')))
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

commit;

-- rollback:
--   The role-sync in admin_set_platform_role and the reconciliation UPDATE are
--   not automatically reversible (they corrected real drift). The policy change
--   reverts by re-running 0003's crm_invites_update definition.
