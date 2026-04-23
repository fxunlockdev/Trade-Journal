import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Trade } from "@/types/database";

import { TradeForm } from "@/components/trade/trade-form";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  // Admin client read + manual membership check (SSR auth flaky on Vercel).
  const admin = createAdminClient();
  const { data: trade } = await admin
    .from("trades")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!trade) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("journal_members")
    .select("role")
    .eq("journal_id", (trade as Trade).journal_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership || membership.role === "viewer") {
    // Viewers can't edit; non-members shouldn't even see the page.
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
