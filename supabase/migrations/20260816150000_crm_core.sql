-- 20260816150000_crm_core.sql
-- W3 · Affiliate CRM core schema, folded into the platform DB.
--
-- Ported from the standalone Affiliate-CRM's supabase-schema.sql, adapted:
--   * owner_id references public.users(id), not auth.users (platform convention).
--   * NO profiles table and NO second on_auth_user_created trigger — the CRM's
--     profile fields collapse into public.users (company_name added here).
--   * RLS is double-scoped: a row is visible/writable only when it is yours AND
--     your platform_role grants the 'crm' product. A demoted IB (ib -> affiliate)
--     loses CRM data access immediately, on their existing session, because the
--     policy reads has_product() from the DB — not a JWT claim.
--
-- The tenant is the IB (owner_id). "affiliates" is that IB's roster of people
-- they introduce; "commissions" is the monthly earnings ledger per affiliate.
--
-- Additive and reversible (see rollback block). Every new table ships RLS +
-- policies in this same file (P5).

begin;

-- ───────────────────────────────────────────────────────────────
-- 0. Shared helper: keep updated_at fresh (idempotent).
-- ───────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- The IB's own company name (was profiles.company_name in the standalone CRM).
alter table public.users
  add column if not exists company_name text;

-- Let a user edit their own company_name from CRM settings. This EXTENDS the
-- least-privilege column grant set by the P0 fix (full_name, avatar_url,
-- has_onboarded) with one more self-editable, non-privilege column. RLS still
-- scopes it to the caller's own row; role stays un-writable.
grant update (company_name) on public.users to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 1. affiliates — the IB's roster
-- ───────────────────────────────────────────────────────────────
create table if not exists public.affiliates (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id) on delete cascade,
  name            text not null,
  email           text,
  phone           text,
  country         text,
  status          text not null default 'LEAD'
                  check (status in ('LEAD','ONBOARDING','ACTIVE','INACTIVE')),
  commission_type text default 'Revenue Share',
  commission_rate numeric,
  join_date       date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists affiliates_owner_id_idx on public.affiliates(owner_id);
create index if not exists affiliates_status_idx    on public.affiliates(owner_id, status);

drop trigger if exists affiliates_set_updated_at on public.affiliates;
create trigger affiliates_set_updated_at
  before update on public.affiliates
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────
-- 2. commissions — monthly earnings ledger
-- ───────────────────────────────────────────────────────────────
create table if not exists public.commissions (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.users(id) on delete cascade,
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  month        int  not null check (month between 1 and 12),
  year         int  not null check (year between 2000 and 2100),
  amount       numeric not null default 0,
  status       text not null default 'PENDING'
               check (status in ('PENDING','PAID','CANCELLED')),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists commissions_owner_id_idx     on public.commissions(owner_id);
create index if not exists commissions_affiliate_id_idx on public.commissions(affiliate_id);
create index if not exists commissions_period_idx       on public.commissions(owner_id, year, month);

drop trigger if exists commissions_set_updated_at on public.commissions;
create trigger commissions_set_updated_at
  before update on public.commissions
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────────────────────────
-- 3. Row-Level Security — owner-scoped AND crm-entitled.
--    has_product() reads the DB, so a role change cuts access immediately.
-- ───────────────────────────────────────────────────────────────
alter table public.affiliates  enable row level security;
alter table public.commissions enable row level security;

-- affiliates
drop policy if exists affiliates_select on public.affiliates;
create policy affiliates_select on public.affiliates
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists affiliates_insert on public.affiliates;
create policy affiliates_insert on public.affiliates
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists affiliates_update on public.affiliates;
create policy affiliates_update on public.affiliates
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')))
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists affiliates_delete on public.affiliates;
create policy affiliates_delete on public.affiliates
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

-- commissions
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions
  for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists commissions_insert on public.commissions;
create policy commissions_insert on public.commissions
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists commissions_update on public.commissions;
create policy commissions_update on public.commissions
  for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')))
  with check (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

drop policy if exists commissions_delete on public.commissions;
create policy commissions_delete on public.commissions
  for delete to authenticated
  using (owner_id = (select auth.uid()) and (select public.has_product((select auth.uid()), 'crm')));

-- ───────────────────────────────────────────────────────────────
-- 4. Grants — least privilege. Own-row DML is legitimate for the CRM UI, so
--    authenticated gets DML (RLS scopes it to owner + crm). No TRUNCATE/
--    REFERENCES/TRIGGER, no anon access.
-- ───────────────────────────────────────────────────────────────
revoke all on public.affiliates  from anon, authenticated;
revoke all on public.commissions from anon, authenticated;
grant select, insert, update, delete on public.affiliates  to authenticated;
grant select, insert, update, delete on public.commissions to authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop table if exists public.commissions;
--     drop table if exists public.affiliates;
--     alter table public.users drop column if exists company_name;
--     -- set_updated_at() is shared/idempotent; leave it in place.
--   commit;
-- ───────────────────────────────────────────────────────────────
