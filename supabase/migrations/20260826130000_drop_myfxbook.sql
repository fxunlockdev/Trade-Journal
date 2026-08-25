-- 20260826130000_drop_myfxbook.sql
-- Remove the Myfxbook auto-sync bridge.
--
-- MetaTrader history now arrives one way: the user exports a statement and
-- uploads it on /import. That path is untouched by this migration and does not
-- read this table.
--
-- The bridge stored a user's Myfxbook email and password (AES-256-GCM
-- encrypted) plus a live session token, so dropping it also retires the only
-- place the app held third-party credentials at rest -- and with it the
-- CREDENTIALS_ENCRYPTION_KEY and MYFXBOOK_PROXY_URL environment variables.
--
-- Trades already imported through the bridge are NOT touched. They live in
-- `trades` with source 'mt5_webhook' and are indistinguishable from any other
-- closed trade to every reader; only the connection that produced them goes.
--
-- Destructive but scoped: this drops one table that nothing else references.
-- Re-adding the bridge would mean restoring the migration below AND the
-- application code, so the rollback is a schema rollback only.

begin;

drop table if exists public.myfxbook_connections;

commit;

-- rollback:
--   Re-run 20260706180000_myfxbook_connections.sql, which recreates the table
--   with its RLS policies. Stored credentials are NOT recoverable -- they were
--   encrypted with a key that is no longer configured, so every user would
--   have to reconnect.
