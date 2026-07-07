-- Myfxbook bridge: free MT5 auto-sync without desktop/VPS.
--
-- One row per linked Myfxbook account -> journal. Myfxbook's API is
-- login-based (no OAuth), so the user's Myfxbook credentials are stored
-- AES-256-GCM ENCRYPTED with the server-side CREDENTIALS_ENCRYPTION_KEY —
-- never plaintext. The session token is cached and refreshed on expiry.
-- Trades land via the existing idempotent ingest (trades_mt5_dedupe index);
-- no changes to the trades table are needed.
create table if not exists public.myfxbook_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journal_id uuid not null references public.journals(id) on delete cascade,
  email_encrypted text not null,
  password_encrypted text not null,
  session_token text,
  myfxbook_account_id text not null,
  account_name text,
  broker text,
  -- Myfxbook reports times in the BROKER's timezone (not UTC); the user picks
  -- the offset at connect time (default 0). Applied when converting to UTC.
  broker_utc_offset_minutes integer not null default 0,
  last_sync_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.myfxbook_connections is
  'Myfxbook-linked MT4/MT5 accounts for free auto-sync. Credentials encrypted app-side (AES-256-GCM).';

alter table public.myfxbook_connections enable row level security;

-- Owner-only access; the API uses the service-role client after cookie
-- verification — RLS is the defense-in-depth net.
create policy "myfxbook_connections_select_own"
  on public.myfxbook_connections for select
  using (auth.uid() = user_id);

create policy "myfxbook_connections_insert_own"
  on public.myfxbook_connections for insert
  with check (auth.uid() = user_id);

create policy "myfxbook_connections_update_own"
  on public.myfxbook_connections for update
  using (auth.uid() = user_id);

create policy "myfxbook_connections_delete_own"
  on public.myfxbook_connections for delete
  using (auth.uid() = user_id);
