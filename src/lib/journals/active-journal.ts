import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JournalRole, JournalWithRole } from "@/types/database";

/**
 * Active-journal context resolver.
 *
 * Every page / API route that shows trades needs to know which journal the
 * user is currently viewing. The active journal is tracked in a cookie
 * (`trdr_active_journal`) written by the workspace switcher. If the cookie is
 * missing, stale (points to a journal the user is no longer a member of), or
 * a URL override is passed, we fall back to the user's owned "Personal"
 * journal — which every user is guaranteed to have thanks to the
 * `create_personal_journal_for_user` signup trigger.
 *
 * This module is server-only (uses next/headers). Do NOT import from
 * client components.
 */

export const ACTIVE_JOURNAL_COOKIE = "trdr_active_journal";

// 1 year — cookie is non-sensitive (just a uuid pointer), refreshed whenever
// the user switches workspaces.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface ActiveJournalContext {
  readonly journal: JournalWithRole;
  readonly role: JournalRole;
}

/**
 * Resolve the active journal for the current user. Throws if the user isn't
 * a member of any journal (shouldn't happen — the signup trigger guarantees a
 * Personal journal — but we fail loud rather than silently returning null).
 *
 * Resolution order:
 *   1. `overrideJournalId` arg (from `?journal=<id>` URL param) — if membership verifies
 *   2. Cookie `trdr_active_journal` — if membership verifies
 *   3. User's owned Personal journal (or oldest non-archived journal they belong to)
 */
export async function getActiveJournal(
  supabase: SupabaseClient,
  userId: string,
  overrideJournalId?: string | null,
): Promise<ActiveJournalContext> {
  const cookieStore = await cookies();

  // Candidate resolution order: override → cookie → fallback
  const candidates: (string | undefined)[] = [
    overrideJournalId ?? undefined,
    cookieStore.get(ACTIVE_JOURNAL_COOKIE)?.value ?? undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = await fetchJournalWithMembership(
      supabase,
      userId,
      candidate,
    );
    if (resolved) return resolved;
  }

  // Fallback: user's oldest non-archived journal (created_at ASC). Personal
  // journal is always created first, so this naturally prefers it.
  const fallback = await fetchFallbackJournal(supabase, userId);
  if (!fallback) {
    throw new Error(
      "No journal found for user. Signup trigger `create_personal_journal_for_user` " +
        "should have created a Personal journal — check migration state.",
    );
  }
  return fallback;
}

async function fetchJournalWithMembership(
  supabase: SupabaseClient,
  userId: string,
  journalId: string,
): Promise<ActiveJournalContext | null> {
  // One round-trip: left-join journal_members so we get the role too.
  // RLS on journals ensures this returns nothing if the user isn't a member.
  // Also exclude archived journals — a stale cookie pointing to an archived
  // journal must fall through to the fallback (oldest non-archived journal)
  // so the user is never silently scoped to a read-only archived workspace.
  const { data: journal, error } = await supabase
    .from("journals")
    .select("*")
    .eq("id", journalId)
    .eq("is_archived", false)
    .maybeSingle();

  if (error || !journal) return null;

  const { data: membership } = await supabase
    .from("journal_members")
    .select("role")
    .eq("journal_id", journalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return null;

  const role = membership.role as JournalRole;
  return {
    journal: { ...journal, my_role: role } as JournalWithRole,
    role,
  };
}

async function fetchFallbackJournal(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveJournalContext | null> {
  // Inner-join on journals with is_archived = false so if the user's oldest
  // journal is archived we don't silently resolve to it (which would then
  // accept writes into an archived workspace).
  const { data: rows } = await supabase
    .from("journal_members")
    .select("role, joined_at, journals!inner(*)")
    .eq("user_id", userId)
    .eq("journals.is_archived", false)
    .order("joined_at", { ascending: true })
    .limit(1);

  const row = (rows as unknown as Array<{
    role: JournalRole;
    joined_at: string;
    journals: Omit<JournalWithRole, "my_role">;
  }> | null)?.[0];

  if (!row || !row.journals) return null;

  const role = row.role;
  return {
    journal: { ...row.journals, my_role: role } as JournalWithRole,
    role,
  };
}

/**
 * Write the active-journal cookie. Safe to call from Server Actions /
 * Route Handlers; no-op from Server Components (Next.js forbids cookie
 * mutation during render).
 */
export async function setActiveJournalCookie(journalId: string): Promise<void> {
  const cookieStore = await cookies();
  try {
    cookieStore.set(ACTIVE_JOURNAL_COOKIE, journalId, {
      httpOnly: false, // client-side switcher reads this directly to avoid a round-trip
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
  } catch {
    // Called from a Server Component where mutation is disallowed — harmless.
  }
}

/** Permission check helpers — keep the semantics in one place. */
export function canEditTrades(role: JournalRole): boolean {
  return role === "owner" || role === "member";
}

export function canManageJournal(role: JournalRole): boolean {
  return role === "owner";
}

export function canInviteMembers(role: JournalRole): boolean {
  return role === "owner";
}
