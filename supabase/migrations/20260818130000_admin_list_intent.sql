-- 20260818130000_admin_list_intent.sql
-- Surface signup intent and pending IB requests in the admin directory.
-- Additive: same function, three more columns.

begin;

drop function if exists public.admin_list_users();

create or replace function public.admin_list_users()
returns table (
  id                uuid,
  email             text,
  full_name         text,
  company_name      text,
  platform_role     public.platform_role,
  last_active_at    timestamptz,
  created_at        timestamptz,
  signup_intent     public.signup_intent,
  ib_request_status public.ib_request_status,
  ib_requested_at   timestamptz
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
           u.last_active_at, u.created_at,
           u.signup_intent, u.ib_request_status, u.ib_requested_at
    from public.users u
    -- Pending requests first: they are the ones needing an action.
    order by (u.ib_request_status = 'pending') desc, u.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant  execute on function public.admin_list_users() to authenticated;

commit;

-- rollback: re-create the previous 7-column version from migration 20260816170000.
