import Link from "next/link";
import { redirect } from "next/navigation";
import { TradeForm } from "@/components/trade/trade-form";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";

export default async function NewTradePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal, role } = await getActiveJournal(supabase, user.id);

  // Viewers cannot create trades — bounce back to the journal list with a
  // toast via query param (UI handles if needed)
  if (role === "viewer") {
    redirect("/journal?viewer_readonly=1");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4 md:p-6 lg:p-8">
      <div className="flex items-center gap-4">
        <Link
          href="/journal"
          className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">New Trade</h1>
      </div>

      <TradeForm defaultJournalId={journal.id} />
    </div>
  );
}
