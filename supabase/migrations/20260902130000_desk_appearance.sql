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
--
-- GUARDED, because `storage` is a SUPABASE schema, not a Postgres one. The RLS
-- coverage job replays every migration against a bare Postgres container where
-- storage.buckets does not exist, and an unguarded reference fails the whole
-- run. It did: CI went red here and stayed red for four merges.
--
-- Skipping storage there is correct rather than a workaround. That job exists
-- to prove every PUBLIC table has RLS and a policy; storage is Supabase's own
-- schema, already governed by its own policies, and nothing in it is part of
-- what the job checks.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'storage' and table_name = 'buckets'
  ) then
    raise notice 'storage schema absent (bare Postgres); skipping logo bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('desk-logos', 'desk-logos', false, 2097152, array['image/png'])
  on conflict (id) do update
    set file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Path convention is `<owner_user_id>/<desk_id>.png`, which is what makes
  -- these expressible: the first folder segment IS the owner, so storage
  -- enforces tenancy without a join back to report_desks.
  --
  -- EXECUTE because CREATE POLICY is not valid directly inside a conditional
  -- block; the statements are otherwise exactly as they would be written.
  execute 'drop policy if exists "owners read their desk logos" on storage.objects';
  execute $p$
    create policy "owners read their desk logos"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'desk-logos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )$p$;

  execute 'drop policy if exists "owners write their desk logos" on storage.objects';
  execute $p$
    create policy "owners write their desk logos"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'desk-logos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )$p$;

  execute 'drop policy if exists "owners replace their desk logos" on storage.objects';
  execute $p$
    create policy "owners replace their desk logos"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'desk-logos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )$p$;

  execute 'drop policy if exists "owners delete their desk logos" on storage.objects';
  execute $p$
    create policy "owners delete their desk logos"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'desk-logos'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )$p$;
end $$;
