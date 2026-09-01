-- What was posted, where, and whether it landed.
--
-- Numbered AFTER 20260902100000_report_snapshots because it references that
-- table. An earlier draft sorted before it and would have failed on any fresh
-- database (db reset, a new preview branch, disaster recovery) while working
-- fine in production, where the migrations happened to be applied by hand in
-- the right order.

create table if not exists public.report_deliveries (
  id uuid primary key default gen_random_uuid(),

  snapshot_id uuid not null
    references public.report_snapshots (id) on delete cascade,

  -- THE CHAT, not the destination row, is the identity of "where this went".
  --
  -- Keying on destination_id looked right and was wrong: disconnecting a group
  -- hard-deletes that row, and reconnecting the SAME group mints a new id (the
  -- destinations table is unique on owner_user_id alone). So a disconnect and
  -- reconnect made an already-published report look unpublished, and it would
  -- go out to the same audience twice.
  chat_id text not null,

  -- Which destination row was used, kept for diagnostics only. Nulled rather
  -- than cascaded on disconnect, so removing a group never erases the proof of
  -- what was already sent to it.
  destination_id uuid
    references public.telegram_destinations (id) on delete set null,

  -- public.users, matching report_desks / report_snapshots / telegram_destinations.
  owner_user_id uuid not null references public.users (id) on delete cascade,

  -- 'in_doubt' is the state that makes this table honest.
  --
  -- Every other status answers "did we send it?" with yes or no. The dangerous
  -- case answers "we don't know": the album was handed to Telegram and the
  -- response never came back (socket reset, a 300s platform kill, an HTML error
  -- page where JSON was expected). Recording that as 'failed' invites a retry,
  -- and the retry posts a second album to a room full of partners. Recording it
  -- as 'sent' hides a report that may never have arrived.
  --
  -- So it gets its own state, and the claim below refuses to re-claim it. A
  -- human looks at the group and decides. That is the correct owner of this
  -- decision, because only they can see what is actually in the chat.
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped', 'in_doubt')),

  -- Telegram's ids for the album. The archive lives in Telegram, not here.
  message_ids jsonb not null default '[]'::jsonb,

  error text,
  attempts integer not null default 0 check (attempts >= 0),

  -- When the claim was taken, and when bytes started moving. The pair is what
  -- lets a dead invocation be classified: a stale claim that never reached the
  -- send is safe to retry, one that did is not.
  claimed_at timestamptz,
  send_started_at timestamptz,

  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One delivery per report per CHAT. The real guard against double-posting is
-- claim_report_delivery() below; this index is what makes that claim atomic.
create unique index if not exists report_deliveries_snapshot_chat_key
  on public.report_deliveries (snapshot_id, chat_id);

create index if not exists report_deliveries_owner_idx
  on public.report_deliveries (owner_user_id, created_at desc);

create index if not exists report_deliveries_destination_idx
  on public.report_deliveries (destination_id);

alter table public.report_deliveries enable row level security;

-- READ ONLY for the owner, deliberately.
--
-- The Supabase baseline grants ALL on public tables to `authenticated`, so RLS
-- policies are the only real gate: a table with no policy for an operation
-- denies it. There is a select policy and nothing else, so a signed-in user can
-- see their own delivery history and cannot write to it. Every write goes
-- through the service role, from server code that has already checked
-- authorisation.
create policy "owners read their own deliveries"
  on public.report_deliveries
  for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

create or replace function public.touch_report_deliveries_updated_at()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists report_deliveries_touch_updated_at on public.report_deliveries;
create trigger report_deliveries_touch_updated_at
  before update on public.report_deliveries
  for each row execute function public.touch_report_deliveries_updated_at();

-- Claiming a delivery, atomically.
--
-- A unique index stops duplicate ROWS. It does not stop duplicate SENDS, which
-- is the failure that matters:
--
--   R1 reads: nothing sent yet        R2 reads: nothing sent yet
--   R1 writes 'pending'               R2 writes 'pending' over it
--   R1 renders and posts              R2 renders and posts
--                                     -> two albums in the partners' group
--
-- No application-side read-then-write can close that, because the gap between
-- the read and the write IS the bug. So the claim is one statement: INSERT ..
-- ON CONFLICT DO UPDATE .. WHERE, which takes a row lock and lets exactly one
-- caller through.
--
-- Returns the delivery id to the winner and NULL to everyone else. A caller
-- that gets NULL must not render and must not post.
--
-- The owner is derived from the snapshot rather than taken from the caller, so
-- the column the RLS read policy trusts can never disagree with the snapshot
-- the delivery is for, whatever a future call site passes.
create or replace function public.claim_report_delivery(
  p_snapshot_id uuid,
  p_chat_id text,
  p_destination_id uuid
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.report_deliveries
    (snapshot_id, chat_id, destination_id, owner_user_id, status, attempts, claimed_at)
  select
    s.id, p_chat_id, p_destination_id, s.owner_user_id, 'pending', 1, now()
  from public.report_snapshots s
  where s.id = p_snapshot_id
  on conflict (snapshot_id, chat_id) do update
    set status         = 'pending',
        error          = null,
        -- The row's OWN prior value, so a third attempt records 3. The
        -- application cannot compute this without re-reading, which is exactly
        -- the race this function exists to remove.
        attempts       = public.report_deliveries.attempts + 1,
        destination_id = excluded.destination_id,
        claimed_at     = now(),
        send_started_at = null,
        updated_at     = now()
    where
      -- Retryable: it failed before anything was published.
      public.report_deliveries.status in ('failed', 'skipped')
      -- Or: a claim was taken and the invocation died without ever reaching
      -- the send. Safe to retry precisely BECAUSE send_started_at is null;
      -- nothing was handed to Telegram. A stale claim that DID start sending
      -- is left alone and must be resolved by a person.
      or (
        public.report_deliveries.status = 'pending'
        and public.report_deliveries.send_started_at is null
        and public.report_deliveries.claimed_at < now() - interval '15 minutes'
      )
  returning id;
$$;

revoke all on function public.claim_report_delivery(uuid, text, uuid) from public;
revoke all on function public.claim_report_delivery(uuid, text, uuid) from anon;
revoke all on function public.claim_report_delivery(uuid, text, uuid) from authenticated;
-- Revoking from PUBLIC also drops the default grant the server relies on.
grant execute on function public.claim_report_delivery(uuid, text, uuid) to service_role;
