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
-- journal_ids is an ARRAY rather than a join table on purpose. A desk's whole
-- meaning is "these journals, together" — it is read as one value, always in
-- full, and never joined against. A join table would buy referential integrity
-- we do not otherwise get (arrays cannot carry a foreign key), so membership is
-- validated in the API against the caller's own journals; every write path
-- already does exactly that for trades, where RLS is likewise not the gate.

begin;

create table if not exists public.report_desks (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  name           text not null,
  -- Storage path inside the `journal-logos` bucket. Null prints `name` instead,
  -- which is exactly how the poster behaves today when no logo is uploaded.
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

  constraint report_desks_name_len
    check (char_length(name) between 1 and 40),
  -- 40 is not arbitrary: it is GROUP_NAME_MAX in lib/posters/scope.ts, the
  -- width the poster header and the name input were designed around. A longer
  -- name does not wrap, it overruns the canvas.
  constraint report_desks_journals_present
    check (array_length(journal_ids, 1) between 1 and 10),
  constraint report_desks_timezone_len
    check (char_length(timezone) between 1 and 64)
);

-- One desk per name per owner, so a duplicate cannot quietly publish twice.
create unique index if not exists report_desks_owner_name_idx
  on public.report_desks (owner_user_id, lower(name));

create index if not exists report_desks_owner_idx
  on public.report_desks (owner_user_id) where is_active;

-- Matching a live journal selection back to its desk is a containment lookup,
-- so index the array for it.
create index if not exists report_desks_journal_ids_idx
  on public.report_desks using gin (journal_ids);

alter table public.report_desks enable row level security;

-- A desk is owned outright: it names and brands the owner's own journals, and
-- there is no sharing story for it yet. Unlike `trades` (deliberate deny-all,
-- server-only), desks are read directly by the browser to render the poster
-- header, so they need real policies.
create policy report_desks_select on public.report_desks
  for select to authenticated
  using (owner_user_id = auth.uid());

create policy report_desks_insert on public.report_desks
  for insert to authenticated
  with check (owner_user_id = auth.uid());

create policy report_desks_update on public.report_desks
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy report_desks_delete on public.report_desks
  for delete to authenticated
  using (owner_user_id = auth.uid());

create trigger report_desks_updated_at
  before update on public.report_desks
  for each row execute function public.set_updated_at();

comment on table public.report_desks is
  'A named, branded group of journals that posters are published for. Replaces '
  'the browser-local group name and logo so a server can render a branded '
  'poster with no browser present.';
comment on column public.report_desks.journal_ids is
  'The journals this desk reports on, read as one value. Membership is '
  'validated in the API against the caller''s journals; arrays cannot carry a '
  'foreign key.';
comment on column public.report_desks.timezone is
  'IANA zone deciding what "yesterday" means for this desk''s reports.';

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop trigger if exists report_desks_updated_at on public.report_desks;
--     drop table if exists public.report_desks;
--   commit;
-- ───────────────────────────────────────────────────────────────
