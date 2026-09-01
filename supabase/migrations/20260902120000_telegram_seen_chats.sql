-- Groups the bot has been seen in.
--
-- Connecting a group requires listing the bot's chats, and Telegram gives a bot
-- no way to ask. The only route was getUpdates, which returns 409 the moment a
-- webhook is registered. Registering one for /daily would therefore have
-- silently broken "Find my groups" for everyone who had not connected yet.
--
-- So the webhook records what it sees here, and discovery reads this instead.
-- Same information, different source, and it survives the swap.
create table if not exists public.telegram_seen_chats (
  chat_id text primary key,
  title text,
  chat_type text,
  last_seen_at timestamptz not null default now()
);

create index if not exists telegram_seen_chats_recent_idx
  on public.telegram_seen_chats (last_seen_at desc);

-- No owner column, because at this point nobody has claimed the chat: this is
-- "the bot is in this group", not "this group belongs to someone". Claiming
-- happens in telegram_destinations, which IS owner-scoped.
--
-- RLS on with a read policy for signed-in users, deliberately: seeing that a
-- group exists is what the connect picker needs, and the group's title is
-- already visible to anyone the bot shares a room with. Writes are service-role
-- only, since there is no policy for them.
alter table public.telegram_seen_chats enable row level security;

create policy "signed-in users can list chats the bot has seen"
  on public.telegram_seen_chats
  for select
  to authenticated
  using (true);
