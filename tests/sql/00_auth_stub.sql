-- Minimal Supabase-compatible `auth` schema for CI.
--
-- A bare Postgres has no `auth` schema, so the baseline's FKs to auth.users and
-- every policy calling auth.uid() fail to apply — which made the I7 RLS job
-- report "0 policies" on tables that are fully protected in production. This
-- stub provides just enough of Supabase's surface for the schema to load, so
-- the RLS assertion tests the real thing.
--
-- CI-only. Never applied to a real Supabase database (which ships its own).

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Roles Supabase defines for PostgREST.
do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
-- The dump GRANTs to these Supabase-internal roles; without them psql emits
-- errors that mask real failures.
do $$ begin create role supabase_admin nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator nologin noinherit; exception when duplicate_object then null; end $$;

-- The subset of auth.users the app's FKs and triggers reference.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Request-context helpers. Real Supabase reads these from the JWT; here they
-- read the same GUCs, so policies behave identically under test.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

create or replace function auth.email() returns text
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.email', true), '') $$;

create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
