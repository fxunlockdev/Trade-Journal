-- What the webhook was last registered with.
--
-- Registering is not a one-off. Anything that changes the registration -- the
-- URL, the secret, which update types Telegram sends -- has to be pushed to
-- Telegram again, and Telegram will not tell you it is stale. It simply stops
-- delivering the updates you did not subscribe to, silently, which is exactly
-- how a user posted three claim codes into a channel and got nothing back.
--
-- Twice now that has meant asking a person to re-run a setup step after a
-- deploy. This row is what lets the scheduler notice instead.
--
-- Stores a FINGERPRINT, never the secret. getWebhookInfo does not return the
-- secret token, so drift in it cannot be detected by asking Telegram; comparing
-- a hash of what we last sent against a hash of what we would send now is the
-- only way to catch a secret change.
create table if not exists public.telegram_webhook_state (
  -- Single-row table. The CHECK is what enforces that: one bot, one
  -- registration, so a second row would be two competing sources of truth.
  id boolean primary key default true check (id),
  fingerprint text not null,
  url text not null,
  registered_at timestamptz not null default now()
);

alter table public.telegram_webhook_state enable row level security;

-- No policy, deliberately: this is server bookkeeping, not user data. RLS on
-- with zero policies denies every client; only the service role touches it.
-- Listed in tests/sql/rls_coverage.test.sql alongside the other deny-alls.
