-- 20260816180000_harden_handle_new_user.sql
-- W6 · Pin search_path on the signup trigger function.
--
-- handle_new_user() is SECURITY DEFINER but was the ONE definer function in the
-- schema without a pinned search_path — the #1 Supabase privilege-escalation
-- footgun (a hostile object in an attacker-controlled schema earlier on the
-- path could shadow a reference). Its only reference is public.users (already
-- schema-qualified) plus NEW.* trigger fields, so pinning search_path = '' is
-- behaviour-preserving. Verified on shadow: signup still auto-creates the
-- public.users row (and the personal journal, via the separate trigger).
--
-- Additive/idempotent (CREATE OR REPLACE). Reversible.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', '')
  );
  return new;
end;
$$;

commit;

-- rollback: re-create without `set search_path = ''` (restores the footgun) — not advised.
