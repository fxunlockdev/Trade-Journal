-- A trade that has been read but not yet confirmed.
--
-- NOTHING IS SAVED WITHOUT A PERSON SEEING IT FIRST. Free text is where this
-- kind of feature goes wrong, so the bot shows what it understood and asks
-- which journal; the draft has to survive from that message to the tap, and
-- Telegram's callback data is 64 bytes, so it lives here. The journals offered
-- are stored WITH it, so a button need only carry an index -- a uuid beside the
-- pending id would not fit.
--
-- Single-use: consumed_at is set with a conditional update before the trade is
-- written, so a double-tap cannot save twice. Short-lived: a draft nobody
-- confirmed in half an hour is not one they want.
create table if not exists public.telegram_pending_trades (
  id text primary key,
  telegram_user_id bigint not null,
  user_id uuid not null references public.users (id) on delete cascade,
  chat_id text not null,
  message_id bigint,
  draft jsonb not null,
  journal_ids uuid[] not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  consumed_at timestamptz,
  trade_id uuid
);

create index if not exists telegram_pending_trades_user_idx
  on public.telegram_pending_trades (user_id, created_at desc);

create index if not exists telegram_pending_trades_open_idx
  on public.telegram_pending_trades (id) where consumed_at is null;

alter table public.telegram_pending_trades enable row level security;

-- Readable by its owner, so a "what did I log from Telegram" view is possible.
-- Writes are service-role only: a client that could insert here could put a
-- draft in front of somebody else's Save button.
create policy "users read their own pending trades"
  on public.telegram_pending_trades
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.telegram_pending_trades from anon, authenticated;
