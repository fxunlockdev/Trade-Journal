-- 20260901120000_report_desks.sql
-- A "desk" is the unit a poster is published for.
--
-- Until now a poster's identity lived in the browser: the group name and the
-- uploaded logo were keyed by journal COMBINATION in localStorage
-- (`trdr_poster_group:<ids>` / `trdr_poster_logo:<ids>`). That was right while a
-- human with that browser open was the only thing generating posters. It stops
-- working the moment anything else generates one — a scheduled job has no
-- browser, and the same trader on a phone is a different browser, so both would
-- publish a poster branded with nothing.
--
-- A desk moves that identity into the database and gives it a name that is not
-- derived. That matters most for combinations: "Gold Intraday" is two journals,
-- and without a stored name it publishes as
-- "TTC GOLD | CHRIS + TTC GOLD | YOHAN", which is accurate and unusable as
-- marketing.
--
-- SECURITY: THE API IS NOT THE ONLY DOOR.
-- The baseline grants ALL on public tables to `authenticated`
-- (baseline:2131-2134), so anyone holding the anon key their own browser
-- already has can POST straight to /rest/v1/report_desks. An application-level
-- membership check would therefore be advisory, not a gate — a user could name
-- someone else's journal in a desk, and once a scheduled renderer starts
-- publishing desks server-side that becomes cross-tenant publication of another
-- trader's results.
--
-- This is the opposite situation to `trades`, whose deny-all RLS means
-- PostgREST cannot write it at all and TypeScript really is the only path. Here
-- RLS PERMITS the write, so the predicate has to live in the policy:
-- `owns_all_journals(journal_ids)` is checked by the database on every insert
-- and update. The API keeps its own check purely to return a readable 403
-- instead of an opaque policy violation.
--
-- journal_ids is an ARRAY rather than a join table on purpose: a desk's whole
-- meaning is "these journals, together" — read as one value, always in full,
-- never joined against. Arrays cannot carry a foreign key, hence the policy
-- predicate above and the normalising trigger below.

begin;

-- ───────────────────────────────────────────────────────────────
-- Does the caller belong to EVERY journal in the array?
-- security definer so the policy can see journal_members regardless of the
-- caller's own visibility of it; stable so the planner may cache it per row.
-- bool_and over an empty set is NULL, so coalesce refuses an empty array too.
-- ───────────────────────────────────────────────────────────────
create or replace function public.owns_all_journals(p_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    bool_and(
      exists (
        select 1
        from public.journal_members m
        where m.journal_id = j
          and m.user_id = auth.uid()
      )
    ),
    false
  )
  from unnest(p_ids) as j;
$$;

revoke all on function public.owns_all_journals(uuid[]) from public, anon;
grant execute on function public.owns_all_journals(uuid[]) to authenticated;

create table if not exists public.report_desks (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  name           text not null,
  -- Storage path inside the `journal-logos` bucket. Null prints `name` instead,
  -- which is exactly how the poster behaves today when no logo is uploaded.
  -- Nothing writes this yet; the logo move is the next migration.
  logo_path      text,
  journal_ids    uuid[] not null,
  -- IANA zone. Reporting periods are calendar days, and "yesterday" is only
  -- meaningful in a timezone: a scheduler in UTC would give a London desk the
  -- wrong day for half the year. Stored per desk rather than per journal
  -- because the desk is what gets reported on.
  timezone       text not null default 'Europe/London',
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- 40 is not arbitrary: it is GROUP_NAME_MAX in lib/posters/scope.ts, the
  -- width the poster header and the name input were designed around. A longer
  -- name does not wrap on a 1080px canvas, it overruns it.
  constraint report_desks_name_len
    check (char_length(btrim(name)) between 1 and 40),
  -- coalesce, NOT a bare `array_length(...) between 1 and 10`: array_length of
  -- an empty array returns NULL, `NULL between 1 and 10` is NULL, and a CHECK
  -- that evaluates to NULL PASSES. Without the coalesce this constraint would
  -- happily store `'{}'`.
  constraint report_desks_journals_present
    check (coalesce(array_length(journal_ids, 1), 0) between 1 and 10),
  constraint report_desks_timezone_len
    check (char_length(timezone) between 1 and 64)
);

-- ───────────────────────────────────────────────────────────────
-- Canonical form, enforced rather than requested.
-- Sorted + de-duplicated + NULL-free, so the uniqueness index below actually
-- means "one desk per journal SET". A BEFORE row trigger runs ahead of the
-- CHECK constraints, so an array of nothing but NULLs becomes empty here and is
-- then correctly refused by report_desks_journals_present.
-- ───────────────────────────────────────────────────────────────
create or replace function public.report_desks_normalise()
returns trigger
language plpgsql
as $$
begin
  select coalesce(array_agg(distinct x order by x), '{}'::uuid[])
    into new.journal_ids
    from unnest(new.journal_ids) as x
   where x is not null;
  new.name := btrim(new.name);
  return new;
end;
$$;

drop trigger if exists report_desks_normalise on public.report_desks;
create trigger report_desks_normalise
  before insert or update on public.report_desks
  for each row execute function public.report_desks_normalise();

drop trigger if exists report_desks_updated_at on public.report_desks;
create trigger report_desks_updated_at
  before update on public.report_desks
  for each row execute function public.set_updated_at();

-- One desk per name per owner, so a duplicate cannot quietly publish twice.
create unique index if not exists report_desks_owner_name_idx
  on public.report_desks (owner_user_id, lower(name));

-- And one ACTIVE desk per journal set. Without this two differently-named desks
-- can cover the same journals, both match a selection, and which name gets
-- published depends on row order — so renaming one silently changes the other's
-- poster. Only active rows, so archiving a desk frees its set for a successor.
create unique index if not exists report_desks_owner_journals_idx
  on public.report_desks (owner_user_id, journal_ids) where is_active;

create index if not exists report_desks_owner_idx
  on public.report_desks (owner_user_id) where is_active;

-- Matching a live journal selection back to its desk is a containment lookup.
create index if not exists report_desks_journal_ids_idx
  on public.report_desks using gin (journal_ids);

alter table public.report_desks enable row level security;

-- Desks are read directly by the browser to render the poster header, so unlike
-- `trades` (deliberate deny-all, server-only) they need real policies.
drop policy if exists report_desks_select on public.report_desks;
create policy report_desks_select on public.report_desks
  for select to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists report_desks_insert on public.report_desks;
create policy report_desks_insert on public.report_desks
  for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    and public.owns_all_journals(journal_ids)
  );

drop policy if exists report_desks_update on public.report_desks;
create policy report_desks_update on public.report_desks
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (
    owner_user_id = auth.uid()
    and public.owns_all_journals(journal_ids)
  );

drop policy if exists report_desks_delete on public.report_desks;
create policy report_desks_delete on public.report_desks
  for delete to authenticated
  using (owner_user_id = auth.uid());

comment on table public.report_desks is
  'A named, branded group of journals that posters are published for. Replaces '
  'the browser-local group name and logo so a server can render a branded '
  'poster with no browser present.';
comment on column public.report_desks.journal_ids is
  'The journals this desk reports on, read as one value. Sorted and deduped by '
  'a trigger; membership is enforced by owns_all_journals() in the RLS policy, '
  'because arrays cannot carry a foreign key.';
comment on column public.report_desks.timezone is
  'IANA zone deciding what "yesterday" means for this desk''s reports.';

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop table if exists public.report_desks;
--     drop function if exists public.report_desks_normalise();
--     drop function if exists public.owns_all_journals(uuid[]);
--   commit;
-- ───────────────────────────────────────────────────────────────
