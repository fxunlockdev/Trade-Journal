-- Which Telegram account belongs to which Trade Journal account.
--
-- The reporting feature only ever needed to know "which account owns this
-- CHAT", which telegram_destinations answers: one chat, one owner. Logging
-- trades needs a different question -- "who is the person who just typed
-- this?" -- and nothing in the system could answer it. `from.id` was read
-- twice in the whole codebase and discarded both times.
--
-- Without this, Pierre and Nick in the same room are indistinguishable and
-- both resolve to whichever single owner the chat is connected to, so a trade
-- could not be routed to the right person's journals.
create table if not exists public.telegram_accounts (
  telegram_user_id bigint primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz
);

-- One Telegram account per app account, in BOTH directions: the primary key
-- stops one Telegram account being claimed by two people, and this stops one
-- person holding two links, so revoking is unambiguous.
create unique index if not exists telegram_accounts_user_key
  on public.telegram_accounts (user_id);

alter table public.telegram_accounts enable row level security;

create policy "users see their own telegram link"
  on public.telegram_accounts
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Deliberately deletable by its owner. A link is a standing grant to write
-- trades into their journals, so someone who loses a phone or leaves must be
-- able to sever it without asking anyone. Writes stay service-role only: a
-- client that could INSERT here could claim to be anybody.
create policy "users may unlink their own telegram account"
  on public.telegram_accounts
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update on public.telegram_accounts from anon, authenticated;

-- One-time codes that carry the link.
--
-- The proof is that the message arrives FROM the Telegram account being
-- linked: only that account can send from itself. Single-use and short-lived
-- for the same reason as the chat-connect codes -- a code that stays valid is
-- a standing invitation to link a stranger's account.
create table if not exists public.telegram_account_links (
  code text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  telegram_user_id bigint,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);

create index if not exists telegram_account_links_user_idx
  on public.telegram_account_links (user_id, created_at desc);

create index if not exists telegram_account_links_open_idx
  on public.telegram_account_links (code) where claimed_at is null;

alter table public.telegram_account_links enable row level security;

create policy "users read their own link codes"
  on public.telegram_account_links
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.telegram_account_links from anon, authenticated;
