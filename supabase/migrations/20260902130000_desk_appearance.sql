-- How a saved poster setup should LOOK, not just which journals it covers.
--
-- Until now the renderer hardcoded `getTheme("obsidian-gold")` and `logo={null}`,
-- so what published to Telegram was never what the user designed on screen.
-- Someone could pick Blue Violet, upload a logo, publish, and get Obsidian Gold
-- with a text name. Appearance lives on the row so the preview, the scheduled
-- post and the Telegram command all read the SAME source and agree by
-- construction rather than by three code paths happening to match.

alter table public.report_desks
  add column if not exists theme_id text not null default 'obsidian-gold';

alter table public.report_desks
  add column if not exists template_ids text[] not null
    default array['design-a', 'design-b', 'design-c'];

-- NOTE THE coalesce. `array_length('{}', 1)` returns NULL, and a CHECK that
-- evaluates to NULL PASSES, so the obvious `array_length(...) between 1 and 3`
-- would silently allow an empty array and publish nothing at all.
alter table public.report_desks
  drop constraint if exists report_desks_template_ids_bounded;
alter table public.report_desks
  add constraint report_desks_template_ids_bounded
  check (coalesce(array_length(template_ids, 1), 0) between 1 and 3);

-- theme_id deliberately has NO check constraint. The theme list lives in
-- TypeScript and gains entries there (Blue Violet was added that way); a
-- database enum would drift from it, which this codebase has already been
-- bitten by. Writes are validated in the API, and `getTheme` falls back to the
-- default for an unknown id, so a bad value degrades to a plain poster rather
-- than a failed render.

-- Logos, at last.
--
-- `logo_path` has existed since desks shipped with nothing ever writing to it:
-- logos lived in localStorage, so a poster rendered anywhere but the uploader's
-- own browser silently printed the name instead. Private bucket, because a
-- brand asset is not something to expose on a guessable public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('desk-logos', 'desk-logos', false, 2097152, array['image/png'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path convention is `<owner_user_id>/<desk_id>.png`, which is what makes the
-- policy below expressible: the first folder segment IS the owner, so storage
-- can enforce tenancy without a join back to report_desks.
drop policy if exists "owners read their desk logos" on storage.objects;
create policy "owners read their desk logos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'desk-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owners write their desk logos" on storage.objects;
create policy "owners write their desk logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'desk-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owners replace their desk logos" on storage.objects;
create policy "owners replace their desk logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'desk-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "owners delete their desk logos" on storage.objects;
create policy "owners delete their desk logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'desk-logos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
