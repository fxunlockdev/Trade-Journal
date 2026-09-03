# SECURITY-LEDGER

Living proof-of-security record for the FXU Home platform. Each invariant is an
assertion that must be backed by a test or command output. Updated at the end of
every wave.

| ID | Invariant | Status | Evidence |
|----|-----------|--------|----------|
| **I1** | User B reads **zero** rows of user A on every table | partial | W1: proved for chat_messages/trade_insights (P0-b — anon now gets 0 rows, authenticated sees only own); full per-table adversarial suite lands W6 |
| **I2** | User B writes/updates/deletes **zero** of A's rows | not yet proven | W6 |
| **I3** | IB reads **nothing** of a linked member's journal data | not yet proven | needs the CRM + partner feature (W3/W4) |
| **I4** | `get_member_activity()` returns exactly the 6-field whitelist | not yet proven | W4 |
| **I5** | Demoted IB loses CRM data access immediately (old JWT) | **PROVEN** | W1 shadow test T4: flip ib→affiliate, `has_product(crm)` false immediately (reads DB, not JWT) |
| **I6** | Crafted signup payload cannot set role/platform_role/app_metadata | **PROVEN** | W1 shadow test T7/T8: hostile signup metadata `{role:admin,platform_role:admin}` → user is `affiliate`, role unchanged |
| **I7** | Every `public` table has `rowsecurity=true` **and** ≥1 policy | **PROVEN** | `tests/sql/rls_coverage.test.sql` — PASS on prod, exit 3 on an injected unprotected table (proven by breaking once); wired into `.github/workflows/ci.yml`. `trades` documented as intentional deny-all |
| **I8** | `anon` has no privileges beyond policy; `authenticated` least-privilege | partial | W0: `public.users` least-privileged. W1: chat_messages/trade_insights policies restricted to `service_role` (P0-b). Other tables' `GRANT ALL` (RLS-guarded) — W6 |
| **I9** | Journal sharing is the ONLY cross-user read path (opt-in/TTL/single-use/revocable) | not yet proven | enumerate non-`auth.uid()` policies at W6 |
| **I10** | Role / privilege columns are never self-writable by a user | **PROVEN (users)** | P0 fix `20260816120000`; prod `role self-writable = false`; W1 test T5: authenticated self-set `platform_role` → permission denied |

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

## P0-b — unauthenticated data breach on chat_messages / trade_insights (CLOSED)

- **Found (W1, via security review):** four policies named "Service role …" were
  created with **no `TO` clause**, so they applied to `PUBLIC` (incl. `anon`)
  with `USING(true)`. Being permissive and OR'd, they nullified the owner-scoped
  policies. **Verified live with only the public anon key, no login:**
  `GET /rest/v1/chat_messages` returned all 14 users' AI chat rows;
  `/rest/v1/trade_insights` returned the insights row.
- **Fixed (prod, 2026-08-16):** migration `20260816140000_p0b_restrict_service_role_policies.sql`
  → `alter policy … to service_role` on all four. Re-ran the exploit: anon now
  gets **0 rows** on both; an authenticated user still sees all 14 of their own.
  Data intact. `ALTER`, not `DROP` — reversible.

## Service-role call sites (P2 — must stay at zero new)

Baseline confined to `src/lib/supabase/admin.ts` consumers. Enumerated fully at W6.
New service-role usages introduced this wave: **0**.

Telegram trade-ingest (2026-09-03): **3** new admin-client call sites, each on a
table that revokes writes from `authenticated` so the client cannot claim to be
anybody — `POST /api/telegram/link` (mints into `telegram_account_links`),
`DELETE /api/telegram/link` (retires that user's open codes and drafts on
unlink), and `src/lib/telegram/pending-store.ts` (the webhook's drafts in
`telegram_pending_trades` and the `trades` insert, both after the
`handleTradeTap` chain re-verifies author, chat, link and membership).
