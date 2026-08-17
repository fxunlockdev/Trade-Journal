-- 20260817100000_platform_ib_invites.sql
-- IB access is invite-only. An admin issues a link; whoever signs up and
-- accepts it is upgraded affiliate -> ib (Journal + CRM). Trade Journal itself
-- stays open to every signup, so the link only ever ADDS the CRM.
--
-- Why a link and not a self-service choice at signup: letting a user pick their
-- own tier is privilege escalation — anyone could self-grant the CRM. The link
-- IS the approval, and only an admin can mint one.
--
-- Security properties (proved on shadow before this hit production):
--   * Tokens are 32 bytes of CSPRNG entropy; only the SHA-256 hash is stored.
--   * Single-use, 14-day TTL, revocable at any time.
--   * role is CHECKed to 'ib' — an invite link can never grant admin.
--   * Accepting never DOWNGRADES: an existing ib/admin is left alone.
--   * Only admins can create/see/revoke invites (RLS + a definer-side check).
--
-- Additive and reversible. Ships RLS in this same file.

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. platform_invites
-- ───────────────────────────────────────────────────────────────
create table if not exists public.platform_invites (
  id                  uuid primary key default gen_random_uuid(),
  created_by          uuid not null references public.users(id) on delete cascade,
  -- Hard ceiling: a link may only ever grant 'ib'. Admin is promoted by hand.
  role                public.platform_role not null default 'ib'
                      check (role = 'ib'),
  label               text,
  email               text,
  token_hash          text not null unique,
  expires_at          timestamptz not null,
  accepted_at         timestamptz,
  accepted_by_user_id uuid references public.users(id) on delete set null,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists platform_invites_created_by_idx
  on public.platform_invites(created_by, created_at desc);

alter table public.platform_invites enable row level security;

-- Admin-only. Acceptance runs through a definer function, not these policies,
-- because the invitee is (by definition) not an admin.
drop policy if exists platform_invites_select on public.platform_invites;
create policy platform_invites_select on public.platform_invites
  for select to authenticated
  using ((select public.has_product((select auth.uid()), 'admin')));

drop policy if exists platform_invites_insert on public.platform_invites;
create policy platform_invites_insert on public.platform_invites
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select public.has_product((select auth.uid()), 'admin'))
  );

drop policy if exists platform_invites_update on public.platform_invites;
create policy platform_invites_update on public.platform_invites
  for update to authenticated
  using ((select public.has_product((select auth.uid()), 'admin')))
  with check ((select public.has_product((select auth.uid()), 'admin')));

revoke all on public.platform_invites from anon, authenticated;
grant select, insert, update on public.platform_invites to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2. accept_platform_invite() — the invitee's side.
--    SECURITY DEFINER: the accepting user owns neither the invite row nor the
--    right to write their own platform_role (authenticated has no grant on it).
-- ───────────────────────────────────────────────────────────────
create or replace function public.accept_platform_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv  public.platform_invites%rowtype;
  v_current public.platform_role;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_inv
    from public.platform_invites
   where token_hash = p_token_hash
   for update;

  if not found                     then raise exception 'invalid invite'; end if;
  if v_inv.revoked_at  is not null then raise exception 'this invite was revoked'; end if;
  if v_inv.accepted_at is not null then raise exception 'this invite has already been used'; end if;
  if v_inv.expires_at  <  now()    then raise exception 'this invite has expired'; end if;

  select platform_role into v_current from public.users where id = v_user;

  -- Never downgrade. An admin opening an IB link keeps admin; an existing IB
  -- just consumes the link harmlessly.
  if v_current = 'affiliate' then
    update public.users set platform_role = v_inv.role where id = v_user;
  end if;

  update public.platform_invites
     set accepted_at = now(), accepted_by_user_id = v_user
   where id = v_inv.id;

  insert into public.platform_audit(actor_user_id, target_user_id, action, detail)
  values (v_user, v_user, 'ib_invite_accepted',
          jsonb_build_object('invite_id', v_inv.id, 'from', v_current::text,
                             'to', case when v_current = 'affiliate' then v_inv.role::text else v_current::text end));

  return jsonb_build_object('ok', true, 'role', case when v_current = 'affiliate' then v_inv.role::text else v_current::text end);
end;
$$;

revoke execute on function public.accept_platform_invite(text) from public, anon;
grant  execute on function public.accept_platform_invite(text) to authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.accept_platform_invite(text);
--     drop table if exists public.platform_invites;
--   commit;
-- ───────────────────────────────────────────────────────────────
