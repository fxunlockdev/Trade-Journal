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

## W1 — COMPLETE (2026-08-16)

- Migration `20260816130000_platform_identity.sql` (platform_role enum, products
  + role_products matrix, `has_product()`, JWT sync trigger). Applied prod;
  rollback + idempotent re-apply tested on shadow. Backfill: owner stays admin,
  other 2 users = affiliate (journal only). JWT claims synced.
- **P0-b breach** (chat_messages/trade_insights world-readable) found by the W1
  security review, verified live with the anon key, fixed by migration
  `20260816140000`. See SECURITY-LEDGER.
- App layer: `middleware.ts` gates (/crm→locked, /admin→404, claim-based UX),
  `src/lib/auth/entitlements.ts` (DB-authoritative `hasProduct`/`requireProduct`),
  `/locked` page + `src/lib/copy/products.ts` (D1 labels in one file),
  bootstrap route reworked to service-role + sets platform_role.
- Tests: I5/I6/I7/I10 proven (SQL suite `tests/sql/w1_identity.test.sql`);
  I7 enumerator `tests/sql/rls_coverage.test.sql` + `.github/workflows/ci.yml`
  (first CI in the repo).

## Deferred (added W1)

- **Middleware → proxy.ts:** Next 16 deprecated `middleware.ts` in favour of
  `proxy.ts` (`npx @next/codemod middleware-to-proxy .`). Works as-is; rename in a
  cleanup pass (P10).
- **Pre-existing eslint error** on the base commit (not in our diff) — 1 error,
  ~13 warnings across the untouched codebase. Triage in W6.
- **admin/users PATCH** manages journal `role` only; platform_role assignment UI
  is W5 (admin panel).
- **trades RLS:** intentional deny-all (server-only via service-role). If we ever
  want client-side trade reads, add an owner policy; until then it's allowlisted
  in the I7 check.

## Open threads / next

- **W2 — FXU Home face** (awaiting "go W2"): port the FXNUHOME landing to `/`
  (strip the Risk Calculator product), `/education`, unified auth screens,
  `?next=` open-redirect allowlist, keep the waitlist wired.
