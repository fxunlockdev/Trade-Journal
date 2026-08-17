-- 20260817170000_rate_limits.sql
-- Rate limiting for the endpoints anonymous visitors can reach.
--
-- The obvious answer is Upstash/Redis, but that means new infrastructure, a new
-- secret and a new failure mode — and we already run Postgres. A single upserted
-- counter row per bucket is atomic, shared across every serverless instance
-- (which an in-memory limiter is NOT), and costs one round-trip we're already
-- paying for.
--
-- Buckets are ALWAYS constructed server-side from the request IP or the session
-- user. The client never supplies one.
--
-- Residual risk, stated plainly: check_rate_limit must be callable by anon (the
-- route's client runs as anon), so someone who guesses another visitor's IP
-- could burn that IP's bucket. The blast radius is one IP for one window, and
-- the alternative (service-role in a public route) is strictly worse.

begin;

create table if not exists public.api_rate_limits (
  bucket       text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

create index if not exists api_rate_limits_window_idx on public.api_rate_limits(window_start);

alter table public.api_rate_limits enable row level security;

-- No policies for anyone: the counter is only ever touched by the definer
-- function below, so it can't be read, reset or forged from a client.
revoke all on public.api_rate_limits from anon, authenticated;

-- ───────────────────────────────────────────────────────────────
-- check_rate_limit() -> true when the call is ALLOWED.
-- Fixed window: the first hit stamps the window, later hits increment, and a
-- hit after the window has elapsed starts a fresh one.
-- ───────────────────────────────────────────────────────────────
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_max            integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := now();
  v_count integer;
begin
  if p_bucket is null or length(p_bucket) = 0 then
    return false;
  end if;

  insert into public.api_rate_limits (bucket, window_start, count)
  values (left(p_bucket, 200), v_now, 1)
  on conflict (bucket) do update
    set count =
          case when public.api_rate_limits.window_start
                    < v_now - make_interval(secs => p_window_seconds)
               then 1
               else public.api_rate_limits.count + 1 end,
        window_start =
          case when public.api_rate_limits.window_start
                    < v_now - make_interval(secs => p_window_seconds)
               then v_now
               else public.api_rate_limits.window_start end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.check_rate_limit(text,integer,integer) from public;
grant  execute on function public.check_rate_limit(text,integer,integer) to anon, authenticated;

-- Housekeeping: drop counters whose window is long gone. Called opportunistically
-- by the API routes so no scheduler is needed.
create or replace function public.prune_rate_limits()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.api_rate_limits where window_start < now() - interval '1 day';
$$;

revoke execute on function public.prune_rate_limits() from public;
grant  execute on function public.prune_rate_limits() to anon, authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.prune_rate_limits();
--     drop function if exists public.check_rate_limit(text,integer,integer);
--     drop table if exists public.api_rate_limits;
--   commit;
-- ───────────────────────────────────────────────────────────────
