-- Deleting an album from the chat, without pretending it never went.
alter table public.report_deliveries
  add column if not exists retracted_at timestamptz;

comment on column public.report_deliveries.retracted_at is
  'When the album was deleted from the chat. The row is KEPT rather than removed: it is still the record that this period was published, and the claim function must go on refusing to re-publish it. Deleting the messages is not the same as never having sent them.';
