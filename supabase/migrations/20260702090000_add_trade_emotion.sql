-- Per-trade emotion tracking (entry + post-trade).
-- Two optional single-select fields; app validates values against the
-- EMOTION_VALUES enum in src/lib/constants/emotions.ts. Stored as text so
-- future option changes don't require a DB migration.
alter table public.trades
  add column if not exists emotion text,       -- felt when taking the trade (entry)
  add column if not exists emotion_post text;  -- felt after the trade closed / on review

comment on column public.trades.emotion is
  'Optional entry emotion (single-select). Allowed values enforced in app: calm, confident, disciplined, neutral, excited, overconfident, anxious, fearful, greedy, fomo, revenge, frustrated.';
comment on column public.trades.emotion_post is
  'Optional post-trade emotion (single-select). Same value set as emotion.';
