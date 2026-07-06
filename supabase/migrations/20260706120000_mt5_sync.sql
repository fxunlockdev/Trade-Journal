-- MT5 auto-sync: per-user connector tokens + trade idempotency columns.
--
-- mt5_connections: one row per "Connect MT5" token. The plaintext token is
-- shown to the user exactly once; only its sha256 hash is stored. Revocation
-- is a soft-delete (revoked_at) so history/audit stays intact.
create table if not exists public.mt5_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journal_id uuid not null references public.journals(id) on delete cascade,
  label text,
  token_hash text not null unique,   -- sha256 hex of the bearer token
  token_prefix text not null,        -- e.g. "fxu_ab12cd34" for display only
  account_login text,                -- "{ACCOUNT_SERVER}:{login}", pinned on first sync
  broker text,                       -- ACCOUNT_COMPANY, filled on first sync
  last_sync_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.mt5_connections is
  'MT5 connector tokens. One per MT5 account -> journal link; token stored as sha256 hash.';

alter table public.mt5_connections enable row level security;

-- Owner-only access. The API uses the service-role client (bypasses RLS)
-- after cookie/bearer verification; these policies are the defense-in-depth
-- net for any direct PostgREST access.
create policy "mt5_connections_select_own"
  on public.mt5_connections for select
  using (auth.uid() = user_id);

create policy "mt5_connections_insert_own"
  on public.mt5_connections for insert
  with check (auth.uid() = user_id);

create policy "mt5_connections_update_own"
  on public.mt5_connections for update
  using (auth.uid() = user_id);

create policy "mt5_connections_delete_own"
  on public.mt5_connections for delete
  using (auth.uid() = user_id);

-- Trade idempotency columns. mt5_ticket = MT5 POSITION_IDENTIFIER (stable
-- across partial closes); mt5_account = "{ACCOUNT_SERVER}:{login}" since
-- login numbers are only unique per broker server.
alter table public.trades
  add column if not exists mt5_account text,
  add column if not exists mt5_ticket bigint;

comment on column public.trades.mt5_ticket is
  'MT5 position identifier (DEAL_POSITION_ID). Dedupe key for the MT5 connector.';
comment on column public.trades.mt5_account is
  'MT5 source account as "{server}:{login}". Dedupe key component.';

-- Plain (non-partial) unique index: Postgres treats NULLs as distinct, so
-- manual/CSV trades (null ticket) never collide; MT5 retries/backfill can
-- never duplicate. Deliberately NOT a partial index — PostgREST upsert
-- inference cannot use partial indexes.
create unique index if not exists trades_mt5_dedupe
  on public.trades (journal_id, mt5_account, mt5_ticket);
