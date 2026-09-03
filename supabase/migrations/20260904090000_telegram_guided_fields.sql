-- The bot now asks for what the message left out -- size, date, and (unless
-- the person turns it off) mood, tags and notes -- before it saves. The
-- questions and answers are a conversation that outlives one request, so it
-- lives with the draft.

-- Which question is open and what has been answered. An object, always.
alter table public.telegram_pending_trades
  add column if not exists conversation jsonb not null default '{}'::jsonb;
alter table public.telegram_pending_trades
  drop constraint if exists telegram_pending_trades_conversation_object;
alter table public.telegram_pending_trades
  add constraint telegram_pending_trades_conversation_object
    check (jsonb_typeof(conversation) = 'object');

-- "Is there a draft waiting on this person's next message?" is asked on
-- every DM from a linked account.
create index if not exists telegram_pending_trades_open_by_user_idx
  on public.telegram_pending_trades (telegram_user_id)
  where consumed_at is null;

-- /quick: skip the optional questions (mood, tags, notes). Per person,
-- because the person who backfills 165 trades and the person who logs two a
-- day want different things from the same bot.
alter table public.telegram_accounts
  add column if not exists quick boolean not null default false;
