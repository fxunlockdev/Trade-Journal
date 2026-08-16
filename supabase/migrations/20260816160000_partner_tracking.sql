-- 20260816160000_partner_tracking.sql
-- W4 · Partner tracking & access control (new feature).
--
-- Lets an IB link a roster row to a real platform account, see whether that
-- person has joined and is actually using the Trade Journal, and revoke the
-- access they granted. The IB sees ACTIVITY COUNTS ONLY — never a member's
-- trades, P&L, notes, journals or chats. That boundary is enforced by a single
-- SECURITY DEFINER function (get_member_activity) with an explicit ownership +
-- entitlement check; there is NO RLS grant that lets an IB read member data.
--
-- Security invariants proven against this migration (see W4 shadow tests):
--   I3  IB reading a linked member's trades directly -> 0 rows.
--   I4  get_member_activity returns exactly the 6-field whitelist, owner-only.
--   F12 one active IB per member (partial unique index); self-link rejected.
--   F13 invite tokens are single-use, TTL'd, revocable, stored as SHA-256.
--
-- Additive and reversible. Every new table ships RLS in this file (P5).

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Link a roster row to a real account (the hierarchy edge).
-- ───────────────────────────────────────────────────────────────
alter table public.affiliates
  add column if not exists member_user_id uuid references public.users(id) on delete set null;

-- One ACTIVE IB per member. A member may be re-linked only after the prior link
-- is cleared or its affiliate row goes INACTIVE. NULLs are excluded, so many
-- unlinked roster rows coexist.
create unique index if not exists affiliates_member_active_uniq
  on public.affiliates(member_user_id)
  where member_user_id is not null and status <> 'INACTIVE';

-- ───────────────────────────────────────────────────────────────
-- 2. last_active_at — debounced heartbeat (middleware writes <= 1/hour/user).
-- ───────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists last_active_at timestamptz;

-- ───────────────────────────────────────────────────────────────
-- 3. crm_invites — the join links. Raw token NEVER stored (SHA-256 only).
-- ───────────────────────────────────────────────────────────────
create table if not exists public.crm_invites (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.users(id) on delete cascade,
  affiliate_id       uuid not null references public.affiliates(id) on delete cascade,
  email              text,
  token_hash         text not null unique,
  expires_at         timestamptz not null,
  accepted_at        timestamptz,
  accepted_by_user_id uuid references public.users(id) on delete set null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists crm_invites_owner_idx     on public.crm_invites(owner_id);
create index if not exists crm_invites_affiliate_idx on public.crm_invites(affiliate_id);

alter table public.crm_invites enable row level security;

-- The IB manages their own invites (create/read/revoke). Acceptance is handled
-- server-side by a SECURITY DEFINER function, not via these policies.
drop policy if exists crm_invites_select on public.crm_invites;
create policy crm_invites_select on public.crm_invites
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists crm_invites_insert on public.crm_invites;
create policy crm_invites_insert on public.crm_invites
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists crm_invites_update on public.crm_invites;
create policy crm_invites_update on public.crm_invites
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')))
  with check (owner_id = (select auth.uid()));

revoke all on public.crm_invites from anon, authenticated;
grant select, insert, update on public.crm_invites to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 4. crm_audit — append-only ledger of link/unlink/invite/revoke.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.crm_audit (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.users(id) on delete cascade,
  actor_user_id uuid,
  action       text not null check (action in ('invite','revoke','link','unlink')),
  affiliate_id uuid,
  target_user_id uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists crm_audit_owner_idx on public.crm_audit(owner_id, created_at desc);

alter table public.crm_audit enable row level security;

-- Append-only: the owner may INSERT and SELECT their own rows. No UPDATE and no
-- DELETE policy exists for anyone — the ledger cannot be rewritten.
drop policy if exists crm_audit_select on public.crm_audit;
create policy crm_audit_select on public.crm_audit
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists crm_audit_insert on public.crm_audit;
create policy crm_audit_insert on public.crm_audit
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

revoke all on public.crm_audit from anon, authenticated;
grant select, insert on public.crm_audit to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5. get_member_activity() — the ONLY window an IB has into a member.
--    Returns exactly 6 fields, counts only. Verifies the caller owns the
--    roster row AND has the crm product. SECURITY DEFINER with pinned empty
--    search_path and fully schema-qualified references.
-- ───────────────────────────────────────────────────────────────
create or replace function public.get_member_activity(p_affiliate_id uuid)
returns table (
  linked         boolean,
  joined_at      timestamptz,
  last_active_at timestamptz,
  trades_7d      integer,
  trades_30d     integer,
  last_trade_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner  uuid := (select auth.uid());
  v_member uuid;
begin
  -- Ownership + entitlement gate. Fail closed if the caller does not own this
  -- roster row or lacks crm — never leak another IB's linkage.
  select a.member_user_id into v_member
  from public.affiliates a
  where a.id = p_affiliate_id
    and a.owner_id = v_owner
    and public.has_product(v_owner, 'crm');

  if not found then
    raise exception 'affiliate not found or access denied';
  end if;

  if v_member is null then
    return query select false, null::timestamptz, null::timestamptz, 0, 0, null::timestamptz;
    return;
  end if;

  return query
    select
      true,
      u.created_at,
      u.last_active_at,
      (select count(*)::int from public.trades t
         where t.user_id = v_member and t.created_at > now() - interval '7 days'),
      (select count(*)::int from public.trades t
         where t.user_id = v_member and t.created_at > now() - interval '30 days'),
      (select max(t.created_at) from public.trades t where t.user_id = v_member)
    from public.users u
    where u.id = v_member;
end;
$$;

revoke execute on function public.get_member_activity(uuid) from public, anon;
grant  execute on function public.get_member_activity(uuid) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 6. accept_crm_invite() — the accept side of the join flow.
--    SECURITY DEFINER because the accepting user does NOT own the affiliate
--    row (the IB does). The app passes the SHA-256 hash of the raw token from
--    the /join/[token] URL; the raw token never reaches the DB. Single-use,
--    TTL'd, revocable, self-accept rejected, one-active-IB enforced by index.
-- ───────────────────────────────────────────────────────────────
create or replace function public.accept_crm_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_inv  public.crm_invites%rowtype;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into v_inv from public.crm_invites
   where token_hash = p_token_hash
   for update;

  if not found              then raise exception 'invalid invite'; end if;
  if v_inv.revoked_at  is not null then raise exception 'invite revoked'; end if;
  if v_inv.accepted_at is not null then raise exception 'invite already used'; end if;
  if v_inv.expires_at < now()      then raise exception 'invite expired'; end if;
  if v_inv.owner_id = v_user       then raise exception 'cannot accept your own invite'; end if;

  -- Link the roster row to the accepting account. The partial unique index
  -- (one active IB per member) raises unique_violation on a double-link.
  update public.affiliates
     set member_user_id = v_user, status = 'ACTIVE'
   where id = v_inv.affiliate_id;

  update public.crm_invites
     set accepted_at = now(), accepted_by_user_id = v_user
   where id = v_inv.id;

  insert into public.crm_audit(owner_id, actor_user_id, action, affiliate_id, target_user_id, detail)
  values (v_inv.owner_id, v_user, 'link', v_inv.affiliate_id, v_user,
          jsonb_build_object('via', 'invite', 'invite_id', v_inv.id));

  return jsonb_build_object('ok', true, 'owner_id', v_inv.owner_id);
exception
  when unique_violation then
    raise exception 'this account is already linked to another partner';
end;
$$;

revoke execute on function public.accept_crm_invite(text) from public, anon;
grant  execute on function public.accept_crm_invite(text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 7. touch_last_active() — debounced heartbeat. Writes at most once/hour/user.
--    authenticated has no UPDATE grant on last_active_at, so this definer fn is
--    the only writer. Called from the app layout on navigation.
-- ───────────────────────────────────────────────────────────────
create or replace function public.touch_last_active()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
     set last_active_at = now()
   where id = (select auth.uid())
     and (last_active_at is null or last_active_at < now() - interval '1 hour');
end;
$$;

revoke execute on function public.touch_last_active() from public, anon;
grant  execute on function public.touch_last_active() to authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.get_member_activity(uuid);
--     drop table if exists public.crm_audit;
--     drop table if exists public.crm_invites;
--     drop index if exists public.affiliates_member_active_uniq;
--     alter table public.affiliates drop column if exists member_user_id;
--     alter table public.users drop column if exists last_active_at;
--   commit;
-- ───────────────────────────────────────────────────────────────
