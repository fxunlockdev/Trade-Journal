-- 20260901180000_telegram_destinations.sql
-- Where generated marketing images get published.
--
-- V1 is deliberately ONE destination per owner: every desk's images go to the
-- same marketing group shared with IBs and partners. The table is keyed by
-- owner rather than by desk so that stays true by construction, and adding a
-- per-desk override later is a nullable desk_id column, not a reshape.
--
-- The chat id is NOT typed as a number. Telegram supergroup ids are negative
-- and beyond 2^53 in some cases (-100xxxxxxxxxxxx), so JavaScript cannot hold
-- them exactly as a Number. Storing text avoids a silent precision loss that
-- would address the wrong chat.
--
-- No bot token lives here. It stays in the server environment; nothing in this
-- table is a secret, which is why the browser may read its own row.

begin;

create table if not exists public.telegram_destinations (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  chat_id       text not null,
  chat_title    text,
  -- 'connected' once a test message has actually been delivered. Until then it
  -- is only a chat we were told about, which is not the same as one we can
  -- reach: the bot may have been removed, or muted, between pick and publish.
  status        text not null default 'pending',
  last_error    text,
  connected_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint telegram_destinations_status_allowed
    check (status in ('pending', 'connected', 'error')),
  constraint telegram_destinations_chat_id_len
    check (char_length(chat_id) between 1 and 64)
);

-- One destination per owner, enforcing the V1 rule in the schema rather than
-- in a code path that could be called twice.
create unique index if not exists telegram_destinations_owner_idx
  on public.telegram_destinations (owner_user_id);

drop trigger if exists telegram_destinations_updated_at on public.telegram_destinations;
create trigger telegram_destinations_updated_at
  before update on public.telegram_destinations
  for each row execute function public.set_updated_at();

alter table public.telegram_destinations enable row level security;

-- Readable by its owner so the settings card can show connection status
-- without a round trip through the server. WRITES ARE SERVER-ONLY: connecting
-- a destination requires talking to Telegram with the bot token to confirm the
-- chat is reachable, and a client-side insert would record a "connected"
-- destination that was never verified.
drop policy if exists telegram_destinations_select on public.telegram_destinations;
create policy telegram_destinations_select on public.telegram_destinations
  for select to authenticated
  using (owner_user_id = auth.uid());

revoke insert, update, delete on public.telegram_destinations from anon, authenticated;

comment on table public.telegram_destinations is
  'The Telegram chat a user publishes marketing images to. One per owner in V1. '
  'Writes are server-only because connecting requires verifying reachability '
  'with the bot token.';
comment on column public.telegram_destinations.chat_id is
  'Telegram chat id as TEXT. Supergroup ids exceed JavaScript''s safe integer '
  'range, so a numeric type would silently address the wrong chat.';

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop table if exists public.telegram_destinations;
--   commit;
-- ───────────────────────────────────────────────────────────────
