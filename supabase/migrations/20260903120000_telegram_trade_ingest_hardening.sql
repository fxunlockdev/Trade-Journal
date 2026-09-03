-- Hardening from the review of the Telegram trade-ingest feature.
--
-- Every change here closes a specific finding; the comment above each says
-- which. Applied to production BEFORE the code that relies on it is merged,
-- because `dev` deploys on merge.

-- ── 1. Instruments the app already knows about could not be saved ────────
-- The TypeScript type has emitted "commodity" and "index" since the MT5 sync
-- shipped (US30, NAS100, USOIL are all in the instrument catalogue), but this
-- CHECK still only allowed the original three. Every such insert died with a
-- raw constraint violation, from the form and the AI chat as well as the bot.
alter table public.trades drop constraint if exists trades_asset_type_check;
alter table public.trades add constraint trades_asset_type_check
  check (asset_type = any (array['forex'::text, 'crypto'::text, 'metal'::text, 'commodity'::text, 'index'::text]));

-- ── 2. A Telegram save is idempotent ─────────────────────────────────────
-- The bot consumes a draft, then inserts the trade. A crash between the two
-- left a draft that said "already saved" with no trade; an insert whose error
-- was a false negative (the row committed, the reply was lost) invited a
-- duplicate on retry. Keyed on the pending id, a second insert for the same
-- draft is refused by the index, and the handler treats that refusal as
-- "already saved" and looks the trade up.
alter table public.trades add column if not exists telegram_pending_id text;
create unique index if not exists trades_telegram_pending_key
  on public.trades (telegram_pending_id)
  where telegram_pending_id is not null;

-- ── 3. The draft table ───────────────────────────────────────────────────
-- message_id was declared, selected and never written. message_text is the
-- exact text typed, kept so a wrong figure on a poster can be traced back to
-- what was said rather than to what the parser made of it.
alter table public.telegram_pending_trades drop column if exists message_id;
alter table public.telegram_pending_trades add column if not exists message_text text;

-- NOT NULL on a uuid[] rejects neither '{}' nor '{NULL}'. Same guard as
-- report_desks.journal_ids, same coalesce spelling: array_length of an empty
-- array is NULL, and a NULL CHECK passes.
alter table public.telegram_pending_trades
  add constraint telegram_pending_trades_journals_present
    check (coalesce(array_length(journal_ids, 1), 0) between 1 and 20);
-- jsonb 'null' satisfies NOT NULL. A draft is always an object.
alter table public.telegram_pending_trades
  add constraint telegram_pending_trades_draft_object
    check (jsonb_typeof(draft) = 'object');

-- A partial index on the primary key column serves no lookup the PK does not.
drop index if exists public.telegram_pending_trades_open_idx;
create index if not exists telegram_pending_trades_expiry_idx
  on public.telegram_pending_trades (expires_at);

-- ── 4. Link codes ────────────────────────────────────────────────────────
drop index if exists public.telegram_account_links_open_idx;
-- The mint route reuses an outstanding code rather than issuing another; this
-- is what makes that true under concurrent requests rather than best-effort.
create unique index if not exists telegram_account_links_one_open_per_user
  on public.telegram_account_links (user_id)
  where claimed_at is null;
create index if not exists telegram_account_links_expiry_idx
  on public.telegram_account_links (expires_at);

-- ── 5. Grants ────────────────────────────────────────────────────────────
-- The baseline grants ALL to authenticated and anon on every new table. The
-- earlier revokes removed the row-level verbs and left TRUNCATE, REFERENCES
-- and TRIGGER, and left anon everything but writes. TRUNCATE bypasses RLS
-- entirely. Same posture as public.users (20260816120000).
revoke all on public.telegram_accounts from anon;
revoke insert, update, truncate, references, trigger on public.telegram_accounts from authenticated;
revoke all on public.telegram_account_links from anon;
revoke insert, update, delete, truncate, references, trigger on public.telegram_account_links from authenticated;
revoke all on public.telegram_pending_trades from anon;
revoke insert, update, delete, truncate, references, trigger on public.telegram_pending_trades from authenticated;

-- ── 6. Linking is one transaction ────────────────────────────────────────
-- telegram_accounts is unique in BOTH directions (PK on telegram_user_id,
-- unique on user_id). The webhook upserted on user_id only, so moving a
-- Telegram account to a different app account hit the PK, after the code had
-- already been marked claimed -- a burned code and a dead end on every retry.
--
-- Here the code is locked, checked, the row is replaced in both directions,
-- and the code is claimed, all or nothing. Returns the linked app user, or
-- null when the code was wrong, used or expired (one answer for all three, so
-- probing learns nothing). Under READ COMMITTED a second caller waiting on
-- the row lock re-evaluates `claimed_at is null` and gets null.
create or replace function public.link_telegram_account(p_code text, p_telegram_user_id bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select user_id into v_user
    from public.telegram_account_links
   where code = p_code
     and claimed_at is null
     and expires_at > now()
   for update;
  if v_user is null then
    return null;
  end if;

  delete from public.telegram_accounts
   where telegram_user_id = p_telegram_user_id
      or user_id = v_user;
  insert into public.telegram_accounts (telegram_user_id, user_id, linked_at)
  values (p_telegram_user_id, v_user, now());

  update public.telegram_account_links
     set claimed_at = now(),
         telegram_user_id = p_telegram_user_id
   where code = p_code;

  return v_user;
end;
$$;
revoke execute on function public.link_telegram_account(text, bigint) from public, anon, authenticated;

-- ── 7. Nothing ever deleted the ephemera ─────────────────────────────────
-- Codes and drafts were filtered by expiry and never removed, so all three
-- tables grew with every use forever. Called from the scheduler tick.
create or replace function public.prune_telegram_ephemera()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.telegram_account_links where expires_at < now() - interval '7 days';
  delete from public.telegram_pending_trades where expires_at < now() - interval '7 days';
  delete from public.telegram_chat_claims where expires_at < now() - interval '7 days';
$$;
revoke execute on function public.prune_telegram_ephemera() from public, anon, authenticated;
