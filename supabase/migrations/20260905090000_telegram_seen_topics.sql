-- Topics the bot has seen messages in.
--
-- The signals group is a forum: one supergroup, one topic per trader (Gold
-- scalp, Gold intraday, Bitcoin, Forex). Every message carries the topic id,
-- and this is where those ids are recorded, with the topic's name when
-- Telegram sends it and a short sample of the latest text when it does not,
-- so a person can recognise a topic and map it to a journal. Nothing is
-- posted; this is listening only.
--
-- Deny-all like telegram_seen_chats: read through a server route, written by
-- the webhook with the service role.
create table if not exists public.telegram_seen_topics (
  chat_id text not null,
  thread_id bigint not null,
  name text,
  sample text,
  message_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (chat_id, thread_id)
);

create index if not exists telegram_seen_topics_recent_idx
  on public.telegram_seen_topics (last_seen_at desc);

alter table public.telegram_seen_topics enable row level security;
revoke all on public.telegram_seen_topics from anon, authenticated;

-- One statement per message: bump the count, keep the newest sample, keep a
-- name once one is known.
create or replace function public.touch_seen_topic(
  p_chat_id text,
  p_thread_id bigint,
  p_name text,
  p_sample text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.telegram_seen_topics (chat_id, thread_id, name, sample, message_count, last_seen_at)
  values (p_chat_id, p_thread_id, p_name, p_sample, 1, now())
  on conflict (chat_id, thread_id) do update
    set name = coalesce(excluded.name, public.telegram_seen_topics.name),
        sample = coalesce(excluded.sample, public.telegram_seen_topics.sample),
        message_count = public.telegram_seen_topics.message_count + 1,
        last_seen_at = now();
$$;
revoke execute on function public.touch_seen_topic(text, bigint, text, text) from public, anon, authenticated;
