-- Replacing an album a person has already seen.
--
-- Trades get corrected and imported late, so a published report can become
-- wrong after the fact. Until now there was no way to say so: the delivery
-- record refused a second send (correctly, it is what stops double-posting) and
-- the snapshot was frozen (correctly, so a poster cannot change meaning under
-- its readers). Together they meant a wrong report stayed wrong.
--
-- 'superseded' is the deliberate escape hatch. It differs from 'failed', which
-- means the album never landed. Only a human action sets it; the SCHEDULER
-- never does, because replacing something partners have already seen is a
-- decision, not a retry.
alter table public.report_deliveries
  drop constraint if exists report_deliveries_status_check;

alter table public.report_deliveries
  add constraint report_deliveries_status_check
  check (status in ('pending', 'sent', 'failed', 'skipped', 'in_doubt', 'superseded'));

comment on column public.report_deliveries.status is
  'superseded: a person deliberately replaced this album because the underlying trades changed. Distinct from failed, which means it never landed. Only a human action sets it; the scheduler never does.';

-- The claim may re-take a superseded row. Note what is still NOT re-takeable:
-- 'sent' (nothing to replace it with) and 'in_doubt' (we do not know what is in
-- the chat, so a person must look before anything else happens).
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
    set status          = 'pending',
        error           = null,
        attempts        = public.report_deliveries.attempts + 1,
        destination_id  = excluded.destination_id,
        claimed_at      = now(),
        send_started_at = null,
        updated_at      = now()
    where
      public.report_deliveries.status in ('failed', 'skipped', 'superseded')
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
grant execute on function public.claim_report_delivery(uuid, text, uuid) to service_role;
