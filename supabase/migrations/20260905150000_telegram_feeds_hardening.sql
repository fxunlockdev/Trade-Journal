-- Hardening from the review of the signal-room listener.

-- One room can be listened to by more than one account, each into its own
-- journal; the first to connect no longer owns the room for everyone.
drop index if exists public.telegram_feeds_source_key;
create unique index if not exists telegram_feeds_source_user_key
  on public.telegram_feeds (chat_id, coalesce(thread_id, 0), user_id);

-- And a signal message is one trade PER JOURNAL, not one trade globally,
-- so a second listener's insert is not swallowed as a duplicate.
drop index if exists public.trades_telegram_message_key;
create unique index if not exists trades_telegram_message_key
  on public.trades (telegram_chat_id, telegram_message_id, journal_id)
  where telegram_message_id is not null;

-- Who posted each message, by Telegram user id. A result is only taken from
-- someone who has posted a signal in the room (or from the channel itself);
-- a display name is not identity, an id is.
alter table public.telegram_feed_messages add column if not exists sender_id bigint;
create index if not exists telegram_feed_messages_sender_idx
  on public.telegram_feed_messages (feed_id, sender_id)
  where kind = 'signal' and status = 'applied';
