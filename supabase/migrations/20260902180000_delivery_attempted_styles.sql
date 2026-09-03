-- What the send SET OUT to publish, not just what survived.
--
-- A Bitcoin album went out with two images instead of three and recorded no
-- error, which made it undiagnosable: two message ids could mean one style
-- failed to render, or that only two styles were ever selected. The setup had
-- been edited since, so even its current styles could not settle it.
--
-- Recorded before anything renders, so comparing its length with message_ids
-- tells those two cases apart afterwards.
alter table public.report_deliveries
  add column if not exists attempted_styles text[] not null default '{}';

comment on column public.report_deliveries.attempted_styles is
  'Which poster styles this send set out to publish, recorded BEFORE any of them render. Without it a short album is undiagnosable: two message ids could mean one style failed, or that only two were ever selected, and the setup may have been edited since. Compare its length with message_ids to tell those apart.';
