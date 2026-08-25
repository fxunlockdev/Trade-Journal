import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { computeCurrentBalance } from "@/lib/trades/balance";
import { JournalGeneralForm } from "@/components/journals/journal-general-form";
import type { Trade } from "@/types/database";

export default async function JournalGeneralSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal, role } = await getActiveJournal(supabase, user.id);

  // The live balance so the risk line can show what a trade costs TODAY, not
  // only what it cost at the starting capital. Derived here because
  // getActiveJournal returns the raw journals row, which has no balance on it.
  // Admin client per the codebase convention — getActiveJournal has already
  // established this user's membership and role.
  let currentBalance: number | null = null;
  if (journal.initial_capital != null) {
    const admin = createAdminClient();
    const { data: pnlRows, error } = await admin
      .from("trades")
      .select("pnl_absolute")
      .eq("journal_id", journal.id)
      .not("pnl_absolute", "is", null);

    if (error) {
      console.error("[TRDR] settings balance query failed:", error.message);
    } else {
      currentBalance = computeCurrentBalance(
        journal.initial_capital,
        (pnlRows ?? []) as unknown as Trade[],
      );
    }
  }

  return (
    <JournalGeneralForm
      journal={journal}
      canManage={role === "owner"}
      currentBalance={currentBalance}
    />
  );
}
