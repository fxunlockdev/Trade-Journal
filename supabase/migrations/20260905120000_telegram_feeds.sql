-- Signal rooms the bot listens in, and what it did with each message.
--
-- A feed is one room (a group, a channel, or one topic of a forum) mapped to
-- one journal. The bot reads every message in it, logs signals as trades
-- owned by the person who connected the feed, applies result replies to the
-- trade they answer, and never posts. Anything it is not sure about is kept
-- with a reason for a person to look at.

-- ── trades know where they came from ─────────────────────────────────────
alter table public.trades drop constraint if exists trades_source_check;
alter table public.trades add constraint trades_source_check
  check (source = any (array['manual'::text, 'csv'::text, 'mt5_webhook'::text, 'telegram'::text]));

alter table public.trades add column if not exists telegram_chat_id text;
alter table public.trades add column if not exists telegram_message_id bigint;
-- One trade per signal message, whatever Telegram redelivers.
create unique index if not exists trades_telegram_message_key
  on public.trades (telegram_chat_id, telegram_message_id)
  where telegram_message_id is not null;

-- ── feeds ────────────────────────────────────────────────────────────────
create table if not exists public.telegram_feeds (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  /** null = the whole chat; a number = one forum topic in it. */
  thread_id bigint,
  title text,
  journal_id uuid not null references public.journals (id) on delete cascade,
  /** Owner: the trades are written as this person. Must be able to edit the journal. */
  user_id uuid not null references public.users (id) on delete cascade,
  /** Signals carry no size; this is the lots every trade from this room gets. */
  default_lots numeric not null default 1 check (default_lots > 0 and default_lots <= 1000),
  enabled boolean not null default true,
  /** React to a logged signal with an emoji. Off: the bot stays invisible. */
  react boolean not null default false,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists telegram_feeds_source_key
  on public.telegram_feeds (chat_id, coalesce(thread_id, 0));
create index if not exists telegram_feeds_user_idx on public.telegram_feeds (user_id);

alter table public.telegram_feeds enable row level security;
create policy "users see their own feeds"
  on public.telegram_feeds for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate, references, trigger on public.telegram_feeds from authenticated;
revoke all on public.telegram_feeds from anon;

-- ── what the bot did with each message ───────────────────────────────────
create table if not exists public.telegram_feed_messages (
  chat_id text not null,
  message_id bigint not null,
  thread_id bigint,
  feed_id uuid references public.telegram_feeds (id) on delete cascade,
  kind text not null check (kind in ('signal', 'result', 'noise', 'unreadable')),
  status text not null check (status in ('applied', 'review', 'ignored', 'superseded')),
  reason text,
  trade_id uuid references public.trades (id) on delete set null,
  reply_to_message_id bigint,
  sender text,
  text text,
  posted_at timestamptz not null,
  edited boolean not null default false,
  processed_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create index if not exists telegram_feed_messages_review_idx
  on public.telegram_feed_messages (feed_id, status, posted_at desc);
create index if not exists telegram_feed_messages_trade_idx
  on public.telegram_feed_messages (trade_id);

alter table public.telegram_feed_messages enable row level security;
create policy "users see messages of their own feeds"
  on public.telegram_feed_messages for select to authenticated
  using (exists (
    select 1 from public.telegram_feeds f
     where f.id = telegram_feed_messages.feed_id
       and f.user_id = (select auth.uid())
  ));
revoke insert, update, delete, truncate, references, trigger on public.telegram_feed_messages from authenticated;
revoke all on public.telegram_feed_messages from anon;

-- ── a claim code can now be for a feed, which the bot confirms silently ──
alter table public.telegram_chat_claims add column if not exists purpose text not null default 'destination'
  check (purpose in ('destination', 'feed'));
