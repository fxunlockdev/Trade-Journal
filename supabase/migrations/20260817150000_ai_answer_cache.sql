-- 20260817150000_ai_answer_cache.sql
-- Shared answer cache for the FXU Home assistant.
--
-- Cost control, in order of cheapness:
--   1. Curated knowledge base in code  -> 0 tokens (covers "what is FXU", tiers,
--      pricing, what each app does — the questions visitors actually ask).
--   2. THIS TABLE                      -> 0 tokens on a repeat question, shared
--      across every serverless instance and every visitor.
--   3. OpenAI                          -> only for a genuinely new question.
--
-- Keyed by a SHA-256 of the normalised question, so "What is FXU?" and
-- "  what is fxu  " are one entry. Answers are generic product answers only —
-- the assistant never sees or caches user data, which is what makes a SHARED
-- cache safe here.

begin;

create table if not exists public.ai_answer_cache (
  question_hash text primary key,
  question      text not null,
  answer        text not null,
  model         text,
  hits          integer not null default 0,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz not null default now()
);

create index if not exists ai_answer_cache_last_used_idx
  on public.ai_answer_cache(last_used_at desc);

alter table public.ai_answer_cache enable row level security;

-- Nobody touches this table directly — reads and writes both go through the
-- definer functions below, so a visitor can never poison it with arbitrary rows
-- or enumerate it. Admins may inspect what's cached.
drop policy if exists ai_answer_cache_admin_select on public.ai_answer_cache;
create policy ai_answer_cache_admin_select on public.ai_answer_cache
  for select to authenticated
  using ((select public.has_product((select auth.uid()), 'admin')));

revoke all on public.ai_answer_cache from anon, authenticated;
grant select on public.ai_answer_cache to authenticated;

-- Look up a cached answer and count the hit. Returns null when absent.
create or replace function public.ai_cache_get(p_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer text;
begin
  update public.ai_answer_cache
     set hits = hits + 1, last_used_at = now()
   where question_hash = p_hash
   returning answer into v_answer;
  return v_answer;
end;
$$;

-- Store an answer. Upsert so concurrent misses converge on one row.
create or replace function public.ai_cache_put(
  p_hash text,
  p_question text,
  p_answer text,
  p_model text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(coalesce(p_question,'')) = 0 or length(coalesce(p_answer,'')) = 0 then
    return;
  end if;
  insert into public.ai_answer_cache (question_hash, question, answer, model)
  values (p_hash, left(p_question, 500), left(p_answer, 4000), p_model)
  on conflict (question_hash) do update
    set answer = excluded.answer,
        model  = excluded.model,
        last_used_at = now();
end;
$$;

revoke execute on function public.ai_cache_get(text) from public;
revoke execute on function public.ai_cache_put(text,text,text,text) from public;
grant  execute on function public.ai_cache_get(text) to anon, authenticated;
grant  execute on function public.ai_cache_put(text,text,text,text) to anon, authenticated;

commit;

-- ───────────────────────────────────────────────────────────────
-- rollback:
--   begin;
--     drop function if exists public.ai_cache_put(text,text,text,text);
--     drop function if exists public.ai_cache_get(text);
--     drop table if exists public.ai_answer_cache;
--   commit;
-- ───────────────────────────────────────────────────────────────
