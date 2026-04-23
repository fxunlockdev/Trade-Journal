import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { redirect } from "next/navigation";
import type { Trade } from "@/types/database";

import { JournalClient } from "./journal-client";

// Dynamic — trades list changes on every insert/delete.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface JournalPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    instrument?: string;
    pnl_filter?: string;
    tags?: string;
    page?: string;
    journal?: string;
  }>;
}

export default async function JournalPage({ searchParams }: JournalPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Scope the journal list to the active journal (cookie-based, with optional
  // `?journal=<id>` override for deep links). getActiveJournal verifies
  // caller membership before returning, so any journal it gives us back is
  // one the user is authorized to see.
  const { journal: activeJournal } = await getActiveJournal(
    supabase,
    user.id,
    params.journal,
  );

  // Use admin client for the trades read. SSR cookie-based auth was
  // intermittently failing RLS on trades SELECT on Vercel deploys, causing
  // "trade logged but not visible" reports. Safe because:
  //   1. getActiveJournal verified the user is a member of activeJournal
  //   2. We only return rows WHERE journal_id = activeJournal.id
  //   3. No user-controlled ids reach the query other than the journal the
  //      user is already authorized for.
  const admin = createAdminClient();
  let query = admin
    .from("trades")
    .select("*", { count: "exact" })
    .eq("journal_id", activeJournal.id);

  if (params.from) {
    query = query.gte("entry_time", params.from);
  }
  if (params.to) {
    // Append end-of-day so trades logged after midnight on the selected date
    // are included. Mirrors the same fix in /api/trades GET.
    query = query.lte("entry_time", `${params.to}T23:59:59.999Z`);
  }
  if (params.instrument) {
    query = query.ilike("instrument", `%${params.instrument}%`);
  }
  if (params.pnl_filter === "profit") {
    query = query.gt("pnl_absolute", 0);
  } else if (params.pnl_filter === "loss") {
    query = query.lt("pnl_absolute", 0);
  }
  if (params.tags) {
    const tagList = params.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tagList.length > 0) {
      query = query.overlaps("tags", tagList);
    }
  }

  const page = Math.max(1, Number(params.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;

  query = query
    .order("entry_time", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: trades, count, error } = await query;

  if (error) {
    console.error("[TRDR] Journal trades error:", error.message);
  }

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade Journal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {count ?? 0} {(count ?? 0) === 1 ? "trade" : "trades"} total
          </p>
        </div>
        <Link
          href="/journal/new"
          className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          New Trade
        </Link>
      </div>

      <JournalClient trades={(trades as Trade[]) ?? []} />
    </div>
  );
}
