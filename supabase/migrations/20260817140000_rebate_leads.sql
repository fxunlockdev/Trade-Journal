-- 20260817140000_rebate_leads.sql
-- Rebate Calculator lead capture.
--
-- The calculator is a free tool for IBs; the full result unlocks once they leave
-- a name, email and phone. Those leads land here.
--
-- The submitter is anonymous (not signed in), so the insert cannot go through
-- normal RLS — and we deliberately do NOT reach for the service-role key for it
-- (no new service-role call sites). Instead a SECURITY DEFINER function does the
-- insert with validation baked in, and it is the ONLY write path: anon has no
-- table grants at all, so nobody can read the lead list or forge arbitrary rows.
--
-- Reading leads is admin-only.

begin;

create table if not exists public.rebate_leads (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text not null,
  phone          text not null,
  asset_class    text not null check (asset_class in ('gold','forex','crypto','mixed')),
  monthly_lots   numeric not null check (monthly_lots >= 0 and monthly_lots <= 1000000),
  estimated_rebate numeric,
  -- Free-form context (referrer, which page, chosen currency) for follow-up.
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists rebate_leads_created_idx on public.rebate_leads(created_at desc);
create index if not exists rebate_leads_email_idx   on public.rebate_leads(lower(email));

alter table public.rebate_leads enable row level security;

-- Admin-only read. No insert/update/delete policy for anyone: writes happen
-- exclusively through capture_rebate_lead() below.
drop policy if exists rebate_leads_admin_select on public.rebate_leads;
create policy rebate_leads_admin_select on public.rebate_leads
  for select to authenticated
  using ((select public.has_product((select auth.uid()), 'admin')));

revoke all on public.rebate_leads from anon, authenticated;
grant select on public.rebate_leads to authenticated;

-- ───────────────────────────────────────────────────────────────
-- capture_rebate_lead() — the only write path.
-- Callable by anon (the whole point is capturing not-yet-users), but it can do
-- exactly one thing: append a validated lead row. It returns nothing useful, so
-- it cannot be used to probe existing data.
-- ───────────────────────────────────────────────────────────────
create or replace function public.capture_rebate_lead(
  p_name        text,
  p_email       text,
  p_phone       text,
  p_asset_class text,
  p_monthly_lots numeric,
  p_estimated_rebate numeric default null,
  p_meta        jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := btrim(coalesce(p_phone, ''));
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'name is required';
  end if;
  -- Deliberately permissive: an over-strict regex rejects valid addresses.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 200 then
    raise exception 'a valid email is required';
  end if;
  if length(v_phone) < 5 or length(v_phone) > 40 then
    raise exception 'a valid phone number is required';
  end if;
  if p_asset_class not in ('gold','forex','crypto','mixed') then
    raise exception 'invalid asset class';
  end if;
  if p_monthly_lots is null or p_monthly_lots < 0 or p_monthly_lots > 1000000 then
    raise exception 'invalid volume';
  end if;

  insert into public.rebate_leads
    (name, email, phone, asset_class, monthly_lots, estimated_rebate, meta)
  values
    (v_name, v_email, v_phone, p_asset_class, p_monthly_lots, p_estimated_rebate,
     coalesce(p_meta, '{}'::jsonb));
end;
$$;

revoke execute on function public.capture_rebate_lead(text,text,text,text,numeric,numeric,jsonb) from public;
grant  execute on function public.capture_rebate_lead(text,text,text,text,numeric,numeric,jsonb) to anon, authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.capture_rebate_lead(text,text,text,text,numeric,numeric,jsonb);
--     drop table if exists public.rebate_leads;
--   commit;
-- ───────────────────────────────────────────────────────────────
