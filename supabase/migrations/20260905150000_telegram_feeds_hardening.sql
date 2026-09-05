-- Who posted each room message, so a result counts only when it comes from
-- someone whose signal the feed has accepted (or from the channel itself,
-- where sender_id is null). A room stays one feed: a message exists once and
-- can belong to one journal, so the keys from 20260905120000 stand.
alter table public.telegram_feed_messages add column if not exists sender_id bigint;
create index if not exists telegram_feed_messages_sender_idx
  on public.telegram_feed_messages (feed_id, sender_id)
  where kind = 'signal' and status = 'applied';
