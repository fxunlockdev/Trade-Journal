# SECURITY-LEDGER

Living proof-of-security record for the FXU Home platform. Each invariant is an
assertion that must be backed by a test or command output. Updated at the end of
every wave.

| ID | Invariant | Status | Evidence |
|----|-----------|--------|----------|
| **I1** | User B reads **zero** rows of user A on every table | not yet proven | two-user adversarial suite lands W6 (partial: RLS enabled on all 13 tables — `rowsecurity=true`) |
| **I2** | User B writes/updates/deletes **zero** of A's rows | not yet proven | W6 |
| **I3** | IB reads **nothing** of a linked member's journal data | not yet proven | needs the CRM + partner feature (W3/W4) |
| **I4** | `get_member_activity()` returns exactly the 6-field whitelist | not yet proven | W4 |
| **I5** | Demoted IB loses CRM data access immediately (old JWT) | not yet proven | W1 (RLS reads `has_product()` from DB) |
| **I6** | Crafted signup payload cannot set role/platform_role/app_metadata | not yet proven | W1 |
| **I7** | Every `public` table has `rowsecurity=true` **and** ≥1 policy | partial | W0: all 13 tables `rowsecurity=true`, 39 policies present; automated CI enumerator lands W1 |
| **I8** | `anon` has no privileges beyond policy; `authenticated` least-privilege | partial | W0: `public.users` reduced to `SELECT`+`UPDATE(3 cols)` for authenticated, `SELECT` for anon (see P0). Other tables still `GRANT ALL` (RLS-guarded) — hardening tracked in NOTES |
| **I9** | Journal sharing is the ONLY cross-user read path (opt-in/TTL/single-use/revocable) | not yet proven | enumerate non-`auth.uid()` policies at W6 |
| **I10** | Role / privilege columns are never self-writable by a user | **PROVEN (users)** | P0 fix `20260816120000_p0_users_least_privilege.sql`; prod verify: `role self-writable by authenticated = false`; shadow RED→GREEN (self-promote denied, legit `full_name` update ok) |

## P0 — privilege escalation on `public.users` (CLOSED)

- **Found:** `anon`+`authenticated` held `GRANT ALL` on `public.users`, incl. the
  `role` column → an authenticated user could `UPDATE ... role='admin'` on self,
  or `DELETE` then `INSERT` their row with `role='admin'` (RLS `WITH CHECK` only
  verifies `id = auth.uid()`). Reachable via the public PostgREST API. 3 live users.
- **Fixed (prod, 2026-08-16):** migration `20260816120000_p0_users_least_privilege.sql`
  → `authenticated` = `SELECT` + `UPDATE(full_name, avatar_url, has_onboarded)`;
  `anon` = `SELECT`. Signup unaffected (definer triggers). Data untouched
  (users=3, trades=205, journals=12 before and after).
- **Verified:** faithful PG17 shadow RED (self-promote succeeded) → fix → GREEN
  (INSERT/DELETE/UPDATE-role all `permission denied`, legit update ok, signup ok).

## Service-role call sites (P2 — must stay at zero new)

Baseline confined to `src/lib/supabase/admin.ts` consumers. Enumerated fully at W6.
New service-role usages introduced this wave: **0**.
