-- One chat belongs to one account.
--
-- Posting a claim code proves you are IN a chat, not that it is yours, and in
-- a group ANY member can post one -- including the business partners a
-- marketing channel is shared with. Without this index a member could attach
-- the shared channel to their own account and publish their own figures into
-- it, and the original owner would never be told.
create unique index if not exists telegram_destinations_chat_key
  on public.telegram_destinations (chat_id);

comment on index public.telegram_destinations_chat_key is
  'One chat belongs to one account. A claim code proves membership, not ownership, so without this a group member could attach a shared channel to a second account.';

-- IANA validity for a timezone, enforced in the database.
--
-- A CHECK constraint cannot contain a subquery, so this is a trigger. It
-- matters because the value is validated only in TypeScript today, the
-- Supabase baseline grants ALL to `authenticated` so RLS is the only real
-- write gate, and an unknown zone makes Intl throw INSIDE the scheduler's
-- per-desk loop. One tenant's bad row would abort the whole tick and skip
-- every other tenant's reports, every fifteen minutes, until someone found it.
create or replace function public.assert_valid_timezone()
returns trigger language plpgsql as $$
begin
  if new.timezone is null
     or not exists (select 1 from pg_timezone_names where name = new.timezone)
  then
    raise exception 'invalid timezone: %', new.timezone
      using hint = 'Use an IANA name such as Asia/Dubai or Europe/London.';
  end if;
  return new;
end;
$$;

drop trigger if exists report_desks_valid_timezone on public.report_desks;
create trigger report_desks_valid_timezone
  before insert or update of timezone on public.report_desks
  for each row execute function public.assert_valid_timezone();

-- Snapshots freeze the zone alongside the numbers, so the permanent audit
-- record gets the same guard as the live row.
drop trigger if exists report_snapshots_valid_timezone on public.report_snapshots;
create trigger report_snapshots_valid_timezone
  before insert or update of timezone on public.report_snapshots
  for each row execute function public.assert_valid_timezone();

-- Belt and braces, matching report_snapshots and telegram_destinations. RLS
-- with no write policy already denies these; the REVOKE means a future
-- permissive-looking policy cannot quietly open them.
revoke insert, update, delete on public.report_deliveries from anon, authenticated;
