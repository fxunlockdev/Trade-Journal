import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PortfolioClient } from "@/components/analytics/portfolio-client";
import type { Journal, JournalRole, JournalWithRole, Trade } from "@/types/database";

// Cross-journal totals depend on mutable DB state — never serve a cached copy.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Portfolio | FX Unlock" };

/**
 * Portfolio — every journal the user belongs to, in one place, with journal and
 * instrument filters. Lets two traders' journals be combined on a single asset
 * ("Yohan + Chris on Gold") without leaving either journal.
 */
export default async function PortfolioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Membership drives visibility: one row per journal the user belongs to.
  // RLS applies to both tables, so nothing outside their memberships returns.
  const { data: rows, error: journalsError } = await supabase
    .from("journal_members")
    .select("role, journals!inner(*)")
    .eq("user_id", user.id);

  if (journalsError) {
    console.error("[TRDR] Portfolio journals error:", journalsError.message);
  }

  type Row = { readonly role: JournalRole; readonly journals: Journal };
  const journals: JournalWithRole[] = ((rows as unknown as Row[]) ?? [])
    .filter((r) => !r.journals.is_archived)
    .map((r) => ({ ...r.journals, my_role: r.role }))
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at),
    );

  const journalIds = journals.map((j) => j.id);

  // Admin client for the trades read — SSR auth is flaky on Vercel. Membership
  // is already verified above and we filter strictly to those journal ids, so
  // no unauthorized rows can leak.
  let trades: Trade[] = [];
  if (journalIds.length > 0) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("trades")
      .select("*")
      .in("journal_id", journalIds)
      .order("entry_time", { ascending: true });
    if (error) {
      console.error("[TRDR] Portfolio trades error:", error.message);
    }
    trades = (data ?? []) as Trade[];
  }

  return <PortfolioClient journals={journals} trades={trades} />;
}
