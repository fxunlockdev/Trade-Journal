import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Trade } from "@/types/database";

import { TradeForm } from "@/components/trade/trade-form";

interface EditTradePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditTradePage({ params }: EditTradePageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // RLS restricts to trades in journals the user is a member of. The form
  // itself also enforces edit-rights when submitting (viewers get 403 from
  // the API).
  const { data: trade } = await supabase
    .from("trades")
    .select("*")
    .eq("id", id)
    .single();

  if (!trade) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`/journal/${id}`}
          className="inline-flex h-7 items-center justify-center rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          &larr; Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          Edit Trade &mdash; {(trade as Trade).instrument}
        </h1>
      </div>

      <TradeForm trade={trade as Trade} defaultJournalId={(trade as Trade).journal_id} />
    </div>
  );
}
