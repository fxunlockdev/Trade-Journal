# FAILURE-MODES

Live tracker for the failure catalog (plan.md §9, F1–F32) plus findings surfaced
during the build. Status: `open` | `countered` | `accepted` | `n/a`. A wave cannot
close with a failure mode assigned to it still `open`.

| ID | Failure | Status | Evidence / plan |
|----|---------|--------|-----------------|
| **P0** | `users.role` self-writable via broad grants (found live) | **countered** | migration `20260816120000`; prod verified; SECURITY-LEDGER I10 |
| **P0-b** | **Unauthenticated** read/write of chat_messages+trade_insights (found live) | **countered** | untyped `TO public` `USING(true)` policies; migration `20260816140000`; anon exploit now returns 0 rows |
| F1 | Role escalation via client signup metadata | **countered** | W1 — signup trigger must hardcode role, ignore `raw_user_meta_data` role |
| F2 | Two `auth.users` signup triggers collide | open | W0/W1 — prod currently has 2 triggers (`handle_new_user`, `create_personal_journal_for_user`), both journal-owned & wanted; CRM's trigger will NOT be ported |
| F3 | Stale JWT after promote/demote | **countered** | W1 |
| F4 | `BOOTSTRAP_SECRET` abuse | open | W1 rework (route currently depends on removed grant), unset at W7 (D9) |
| F5 | Open redirect via `?next=` | open | W2 |
| F6 | Invite/reset endpoints leak emails | open | W4 |
| F7 | Supabase auth redirect/site URL misconfig for new domain | open | W7 |
| F8 | IDOR on `[id]` API routes | open | W3–W6 |
| F9 | RLS gap on a new table | **countered** | W1 CI enumerator |
| F10 | IB reads member journal data | open | W4 (whitelist fn, no grants) |
| F11 | IB mutates member account | open | W4 (admin-only suspension) |
| F12 | Two IBs claim same member / self-link | open | W4 (unique-active index) |
| F13 | Invite token leak | open | W4 (SHA-256, 72h TTL, single-use) |
| F14 | Journal vs CRM invite namespaces cross | open | W4 (separate tables) |
| F15 | Demoted IB still reads CRM via old session | **countered** | W1 (`has_product()` in RLS) |
| F16 | Admin routes gated only by middleware | open | W5 (server re-check from DB) |
| F17 | AI chat/insights aggregate across users | open | W6 |
| F18 | Next caching leaks user-scoped data | open | W3/W6 |
| F19 | Baseline dump misses triggers/functions/policies | **countered** | shadow restore: signup→users row + personal journal auto-created; 39 policies, 19 funcs, 2 auth triggers present |
| F20 | Next 14→16 breakage in ported CRM | open | W3 |
| F21 | Tailwind v3→v4 / Radix→base-ui drift | open | W3 |
| F22 | Env drift / missing secrets | **countered** | `src/lib/env.ts` + `src/instrumentation.ts`; boot refuses on missing var (test: `tests/unit/env.test.ts`) |
| F23 | Supabase default SMTP is dev-grade | open | W4/W7 (Resend, D4) |
| F24 | Myfxbook batch sync endpoint abuse | open | W6 |
| F25 | Old Vercel deployments left alive | open | W7 |
| F26 | Repo rename breaks CI/remotes | open | W7 (D7, deferred) |
| F27 | Test junk in prod project | open | W7 (D6, sign-off) |
| F28 | `users.role` vs `platform_role` confusion | **countered** | W1 (D8 doc comments) |
| F29 | Affiliate hits `/crm`, thinks it's broken | **countered** | W1 (locked screen) |
| F30 | Label flip (IB vs affiliate wording) | open | W3 (`lib/copy/tiers.ts`, D1) |
| F31 | Landing port regresses perf/a11y | open | W2/W6 |
| F32 | Waitlist flow lost before launch | open | W2/W7 |
