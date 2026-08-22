import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { AppShell } from "@/components/layout/app-shell";
import { ActivityPing } from "@/components/activity-ping";
import type {
  Journal,
  JournalRole,
  JournalWithRole,
} from "@/types/database";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    redirect("/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch profile, journals list, and active journal in parallel. Active
  // journal resolution is tolerant — if the cookie is stale or missing, it
  // falls back to the user's Personal journal (guaranteed by signup trigger).
  const [profileResult, journalsResult, activeJournalResult] =
    await Promise.allSettled([
      supabase
        .from("users")
        // signup_intent rides along on a query that already runs, so gating on
        // it below costs nothing extra.
        .select("id, email, full_name, avatar_url, role, signup_intent")
        .eq("id", user.id)
        .single(),
      supabase
        .from("journal_members")
        .select("role, journals!inner(*)")
        .eq("user_id", user.id),
      getActiveJournal(supabase, user.id),
    ]);

  const profile =
    profileResult.status === "fulfilled" ? profileResult.value.data : null;

  // The same gate FXU Home applies, so deep-linking to /dashboard cannot walk
  // around it. Only when the row actually loaded: a failed read must not send
  // someone who already answered back to a step they have finished.
  if (profile !== null && profile.signup_intent == null) {
    redirect("/welcome");
  }

  const userProfile = profile ?? {
    id: user.id,
    email: user.email ?? "",
    full_name:
      user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
    avatar_url:
      user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? null,
    role: "user" as const,
  };

  type MembershipRow = { readonly role: JournalRole; readonly journals: Journal };
  const membershipRows =
    journalsResult.status === "fulfilled"
      ? ((journalsResult.value.data as unknown as MembershipRow[]) ?? [])
      : [];

  // Hide archived journals from the switcher list by default.
  const journals: JournalWithRole[] = membershipRows
    .filter((r) => r.journals && !r.journals.is_archived)
    .map((r) => ({ ...r.journals, my_role: r.role }))
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.created_at.localeCompare(b.created_at),
    );

  const activeJournalId =
    activeJournalResult.status === "fulfilled"
      ? activeJournalResult.value.journal.id
      : (journals[0]?.id ?? null);

  // If we somehow have no journal at all (migration/trigger broken), force a
  // logout so the user gets a clean re-signin path that re-fires the trigger.
  if (!activeJournalId) {
    redirect("/login?reason=no-journal");
  }

  return (
    <>
      <ActivityPing />
      <AppShell
        profile={userProfile}
        journals={journals}
        activeJournalId={activeJournalId}
      >
        {children}
      </AppShell>
    </>
  );
}
