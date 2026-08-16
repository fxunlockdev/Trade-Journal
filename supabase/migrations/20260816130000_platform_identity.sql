-- 20260816130000_platform_identity.sql
-- W1 · FXU Home platform identity & entitlements.
--
-- Introduces the ONLY authority for product access: public.users.platform_role.
--
--   affiliate (default) -> Trade Journal only
--   ib                  -> Trade Journal + Affiliate CRM
--   admin (staff)       -> everything + platform administration
--
-- public.users.role (user|trader|admin) is DELIBERATELY LEFT ALONE. It remains a
-- journal-internal capability flag ('trader' gates signal publishing). Any new
-- code that reads users.role to decide PRODUCT access is a bug — read
-- platform_role / public.has_product() instead.
--
-- Access is data, not code: the products x role_products matrix means adding a
-- tier later is one seeded row, not a schema change.
--
-- Additive and reversible. No DROP, no destructive UPDATE. The only writes to
-- existing rows are the platform_role backfill (a new, previously-NULL column)
-- and the app_metadata claim seed, both re-runnable and idempotent.

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. platform_role
-- ───────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'platform_role') then
    create type public.platform_role as enum ('affiliate', 'ib', 'admin');
  end if;
end $$;

alter table public.users
  add column if not exists platform_role public.platform_role
    not null default 'affiliate';

comment on column public.users.platform_role is
  'SOLE authority for product access (affiliate|ib|admin). Server-set only: '
  'authenticated has no UPDATE grant on this column. Do not confuse with '
  'users.role, which is a journal-internal capability flag.';

comment on column public.users.role is
  'Journal-internal capability only (user|trader|admin) — trader gates signal '
  'publishing. NEVER use for product access; use platform_role/has_product().';

-- ───────────────────────────────────────────────────────────────
-- 2. Access matrix as data
-- ───────────────────────────────────────────────────────────────
create table if not exists public.products (
  key         text primary key,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.role_products (
  platform_role public.platform_role not null,
  product_key   text not null references public.products(key) on delete cascade,
  primary key (platform_role, product_key)
);

insert into public.products (key, name, description) values
  ('journal', 'Trade Journal',  'Trading journal, analytics, insights and imports'),
  ('crm',     'Affiliate CRM',  'Affiliate roster, commissions and partner tracking'),
  ('admin',   'Platform Admin', 'User, role and invite administration')
on conflict (key) do nothing;

insert into public.role_products (platform_role, product_key) values
  ('affiliate', 'journal'),
  ('ib',        'journal'),
  ('ib',        'crm'),
  ('admin',     'journal'),
  ('admin',     'crm'),
  ('admin',     'admin')
on conflict do nothing;

-- Both tables are public reference data (no user data), but RLS is mandatory
-- (P5). Readable by signed-in users so the UI can render the matrix; writable
-- by nobody through the API — seeding happens in migrations only.
alter table public.products      enable row level security;
alter table public.role_products enable row level security;

drop policy if exists products_read on public.products;
create policy products_read on public.products
  for select to authenticated using (true);

drop policy if exists role_products_read on public.role_products;
create policy role_products_read on public.role_products
  for select to authenticated using (true);

revoke all on public.products      from anon, authenticated;
revoke all on public.role_products from anon, authenticated;
grant select on public.products      to authenticated;
grant select on public.role_products to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3. has_product() — the entitlement oracle
--    SECURITY DEFINER + pinned empty search_path (Supabase's #1 escalation
--    footgun) + fully schema-qualified references.
-- ───────────────────────────────────────────────────────────────
create or replace function public.has_product(
  p_user_id uuid,
  p_product text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    join public.role_products rp on rp.platform_role = u.platform_role
    where u.id = p_user_id
      and rp.product_key = p_product
  );
$$;

comment on function public.has_product(uuid, text) is
  'True when the user''s platform_role grants the product. Authoritative for '
  'RLS and server code — always reads the DB, never a JWT claim, so a role '
  'change takes effect immediately even on an already-issued token.';

revoke execute on function public.has_product(uuid, text) from public, anon;
grant  execute on function public.has_product(uuid, text) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────
-- 4. JWT claim sync (UX only — never authorization)
--    Mirrors platform_role into auth.users.raw_app_meta_data so middleware can
--    gate routes without a DB round-trip. app_metadata is server-controlled;
--    users cannot edit it. Authorization still always re-checks the DB.
-- ───────────────────────────────────────────────────────────────
create or replace function public.sync_platform_role_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update auth.users
     set raw_app_meta_data =
           coalesce(raw_app_meta_data, '{}'::jsonb)
           || jsonb_build_object('platform_role', new.platform_role::text)
   where id = new.id;
  return new;
end;
$$;

revoke execute on function public.sync_platform_role_claim() from public, anon, authenticated;

drop trigger if exists sync_platform_role_claim_on_users on public.users;
create trigger sync_platform_role_claim_on_users
  after insert or update of platform_role on public.users
  for each row execute function public.sync_platform_role_claim();

-- ───────────────────────────────────────────────────────────────
-- 5. Backfill existing users
--    Existing journal users keep journal-only access (platform_role default
--    'affiliate' already applied by the ADD COLUMN). The established platform
--    owner (users.role = 'admin') is preserved as admin.
--    Nobody is granted CRM access here — IB promotion is a deliberate,
--    audited admin action.
-- ───────────────────────────────────────────────────────────────
update public.users
   set platform_role = 'admin'
 where role = 'admin'
   and platform_role <> 'admin';

-- Seed the claim for every existing row (the trigger only fires on write).
update public.users set platform_role = platform_role;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop trigger if exists sync_platform_role_claim_on_users on public.users;
--     drop function if exists public.sync_platform_role_claim();
--     drop function if exists public.has_product(uuid, text);
--     drop table if exists public.role_products;
--     drop table if exists public.products;
--     alter table public.users drop column if exists platform_role;
--     drop type if exists public.platform_role;
--     -- optional: clear the mirrored claim
--     -- update auth.users set raw_app_meta_data = raw_app_meta_data - 'platform_role';
--   commit;
-- ───────────────────────────────────────────────────────────────
