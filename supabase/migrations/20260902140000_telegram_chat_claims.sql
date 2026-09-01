-- Proving you are actually in the group you are connecting.
--
-- THE HOLE THIS CLOSES: the connect handler accepted any chat_id and verified
-- only that the BOT could post there, never that the CALLER had any
-- relationship to that chat. Paired with a picker that listed every chat the
-- bot had ever seen, one customer could select another customer's group and
-- publish their own results into it. Whoever clicked first owned it.
--
-- Telegram cannot answer "is this app user in that chat?", because a Trade
-- Journal account and a Telegram account are unrelated identities. So the user
-- proves the link the only way available: by posting a one-time code IN the
-- group, where only a member could put it.

create table if not exists public.telegram_chat_claims (
  code text primary key,
  user_id uuid not null references public.users (id) on delete cascade,

  -- Filled in by the webhook when it sees the code posted in a chat.
  chat_id text,
  chat_title text,
  claimed_at timestamptz,

  created_at timestamptz not null default now(),
  -- Short-lived. A code that stays valid forever is a standing invitation to
  -- attach a stranger's group to an account that once generated one.
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create index if not exists telegram_chat_claims_user_idx
  on public.telegram_chat_claims (user_id, created_at desc);

-- The webhook's lookup: find an unclaimed, unexpired code by its text.
create index if not exists telegram_chat_claims_open_idx
  on public.telegram_chat_claims (code) where claimed_at is null;

alter table public.telegram_chat_claims enable row level security;

-- Read-only, and only your own. Writes go through the service role: a client
-- that could insert a row could claim any chat by asserting it.
create policy "users read their own claims"
  on public.telegram_chat_claims
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- telegram_seen_chats becomes INTERNAL.
--
-- It was readable by every signed-in user so the picker could list groups. That
-- is precisely the leak: a group's existence and title is not public
-- information, and listing it invited the takeover above. The webhook still
-- records chats for its own bookkeeping; nothing reads them into a picker.
drop policy if exists "signed-in users can list chats the bot has seen" on public.telegram_seen_chats;
