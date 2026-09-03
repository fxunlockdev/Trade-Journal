-- Hardening from the review of the guided questions.

-- One open draft per person. Two concurrent trade messages used to leave two
-- live question threads in one chat; now the second insert is refused and
-- the bot says "try again". Expired-but-unconsumed rows are retired first so
-- the index can be built.
update public.telegram_pending_trades
   set consumed_at = now()
 where consumed_at is null and expires_at < now();
drop index if exists public.telegram_pending_trades_open_by_user_idx;
create unique index if not exists telegram_pending_trades_one_open_per_user
  on public.telegram_pending_trades (telegram_user_id)
  where consumed_at is null;

-- Answers are MERGED, not replaced. A typed answer and a tapped one can land
-- at the same moment on different requests; a whole-object write from a
-- stale read put an earlier answer back to "not asked". The merge is
-- top-level for the flags and offered lists, and one level deeper for the
-- answers, so a concurrent write of a different key survives. Every answer
-- also extends the draft's life, because five questions do not fit in a
-- window sized for one.
create or replace function public.touch_pending_conversation(
  p_id text,
  p_patch jsonb,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.telegram_pending_trades
     set conversation = jsonb_set(
           coalesce(conversation, '{}'::jsonb) || (p_patch - 'answers'),
           '{answers}',
           coalesce(conversation -> 'answers', '{}'::jsonb) || coalesce(p_patch -> 'answers', '{}'::jsonb),
           true
         ),
         expires_at = greatest(expires_at, p_expires_at)
   where id = p_id
     and consumed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke execute on function public.touch_pending_conversation(text, jsonb, timestamptz) from public, anon, authenticated;

-- The tags a person uses most, counted in the database rather than by
-- shipping three hundred rows to count them in Node. Case-insensitive, so
-- "Scalp" and "scalp" are one button, spelled the way it was first seen.
create or replace function public.telegram_top_tags(p_user_id uuid)
returns table (tag text, n bigint)
language sql
security definer
set search_path = ''
as $$
  select min(t.tag) as tag, count(*) as n
    from public.trades tr, unnest(tr.tags) as t(tag)
   where tr.user_id = p_user_id
     and t.tag <> ''
   group by lower(t.tag)
   order by n desc, 1
   limit 6;
$$;
revoke execute on function public.telegram_top_tags(uuid) from public, anon, authenticated;
