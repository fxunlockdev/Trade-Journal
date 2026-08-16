# NOTES — FXU Home build

Working state, decisions, and deferred items. Checkpoint here rather than letting
context degrade silently.

## Current state (end of W0)

- Branch `fxu-home-platform` off `fxunlockdev/Trade-Journal` (working copy at
  `FXUApps11/fxu-home`). Planning + backups live one level up in `FXUApps11/`.
- Production DB `bzfdnuivrtqpfdiquomk` (PostgreSQL 17.6). **Live data**: 3 users
  (1 already `admin`), 12 journals, 205 trades, 359 audit rows — protect at all costs.
- Backups (gitignored, in `FXUApps11/backups/`): JSON row export
  `w0-20260816T143118Z` (SNAPSHOT_ID `eb09cfd4…`) + `pg_dump` custom-format +
  schema dump `w0-pgdump-20260816T143849Z`.
- Baseline snapshot committed at `supabase/baseline/0000_baseline.sql` (reference
  only — already applied to prod; do NOT re-run in sequence with the 4 existing
  incremental migrations).
- **P0 fixed on prod** (see SECURITY-LEDGER). Migration `20260816120000`.

## Deferred (P10 — do NOT do inline; schedule to the noted wave)

- **admin/users route** (`src/app/api/admin/users/route.ts:151`) updates
  `users.role` via the **cookie/RLS client** (`createClient()`), which the P0 fix
  now blocks. Intended end-state = role changes via service-role only. **Rework in
  W1** so the admin UI works (route already imports `createAdminClient`).
- **bootstrap route** (`src/app/api/admin/bootstrap/route.ts`) sets role via the
  cookie session → now blocked by the P0 fix. Rework/remove in W1; secret unset W7 (D9).
- **Broad `GRANT ALL`** to `anon`/`authenticated` on the other 12 public tables.
  RLS-guarded (owner-scoped), and `TRUNCATE`/`TRIGGER`/`REFERENCES` are not
  reachable via PostgREST — but they are unnecessary surface. **W6 hardening**:
  revoke `TRUNCATE, TRIGGER, REFERENCES` from anon/authenticated globally.
- **Workspace-root lockfile warning** from Next dev/build: a stray
  `/Users/viloljoshi/package-lock.json` and the FXEdu `pnpm-workspace.yaml` confuse
  turbopack root inference. Set `turbopack.root` in `next.config.ts` or remove the
  stray lockfile. Cosmetic; deferred.
- **e2e authenticated journey** needs `E2E_EMAIL`/`E2E_PASSWORD` (a dedicated test
  account, ideally on a non-prod project). Set up a test target before relying on
  the full upload→preview e2e.

## Security follow-through (owner actions)

- **Rotate** the `service_role` key and the DB password before go-live — both
  transited chat. (W7 checklist.)
- **Revoke** the GitHub PAT in the public `FXNUHOME` git history (commit `102aeb0`).

## Open threads / next

- **W1 — Identity & entitlements** (awaiting "go W1"): `platform_role` enum +
  `products`/`role_products` + `has_product()` (definer, `search_path=''`), JWT
  app_metadata sync, middleware gates, locked `/crm` screen, rework
  admin/bootstrap routes to service-role, backfill existing 3 users → `affiliate`
  (except the existing admin — confirm identity first), I5/I6/I7 tests.
