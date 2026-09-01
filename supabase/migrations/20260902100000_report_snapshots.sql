-- 20260902100000_report_snapshots.sql
-- The numbers a report states, frozen once.
--
-- A report renders three poster styles from one set of statistics. Recomputing
-- per style would let a trade logged mid-render land in one image and not the
-- other two, publishing three pictures that disagree about the same day. So the
-- metrics are computed once, written here, and every style renders from this
-- row.
--
-- The unique key is the idempotency mechanism, not a nicety. The scheduler runs
-- every 15 minutes and asks "is anything due?", so it will reach the same
-- (desk, cadence, period) 96 times a day. One row per period means the second
-- through ninety-sixth attempts collide and stop, without any coordination
-- between invocations.
--
-- Writes are server-only. A snapshot is a claim about what happened, produced
-- by the reporting engine from the database; a client-supplied one would be a
-- published performance figure that nothing verified.

begin;

create table if not exists public.report_snapshots (
  id             uuid primary key default gen_random_uuid(),
  desk_id        uuid not null references public.report_desks(id) on delete cascade,
  -- Denormalised from the desk so RLS and every listing query avoid a join.
  owner_user_id  uuid not null references public.users(id) on delete cascade,

  cadence        text not null,
  -- DATE, not timestamptz: a reporting period is a span of calendar days in
  -- the desk's own timezone, and storing an instant would reintroduce exactly
  -- the ambiguity resolveReportPeriod exists to remove.
  period_start   date not null,
  period_end     date not null,
  -- The timezone those dates were resolved in, kept so a report can be
  -- re-rendered or audited later even if the desk's zone is changed.
  timezone       text not null,

  metrics        jsonb not null,
  trade_count    integer not null default 0,

  status         text not null default 'pending',
  error          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint report_snapshots_cadence_allowed
    check (cadence in ('daily', 'weekly', 'monthly')),
  constraint report_snapshots_status_allowed
    check (status in ('pending','rendering','rendered','publishing','published','skipped','failed')),
  constraint report_snapshots_period_ordered
    check (period_end >= period_start)
);

-- THE idempotency guarantee: one report per desk per period, ever.
create unique index if not exists report_snapshots_period_idx
  on public.report_snapshots (desk_id, cadence, period_start, period_end);

-- The scheduler's own lookup: what is outstanding for this owner?
create index if not exists report_snapshots_owner_status_idx
  on public.report_snapshots (owner_user_id, status, created_at desc);

drop trigger if exists report_snapshots_updated_at on public.report_snapshots;
create trigger report_snapshots_updated_at
  before update on public.report_snapshots
  for each row execute function public.set_updated_at();

alter table public.report_snapshots enable row level security;

-- Readable by its owner, for report history in the app.
drop policy if exists report_snapshots_select on public.report_snapshots;
create policy report_snapshots_select on public.report_snapshots
  for select to authenticated
  using (owner_user_id = auth.uid());

-- Server-only writes: see the header. The scheduler uses the service role.
revoke insert, update, delete on public.report_snapshots from anon, authenticated;

comment on table public.report_snapshots is
  'Statistics for one report, frozen so every poster style renders identical '
  'numbers. The unique index on (desk, cadence, period) is what makes a '
  'scheduler that runs every 15 minutes produce exactly one report per period.';

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop table if exists public.report_snapshots;
--   commit;
-- ───────────────────────────────────────────────────────────────
