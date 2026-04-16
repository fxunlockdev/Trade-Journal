import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { Trade } from "@/types/database";

import { JournalClient } from "./journal-client";

interface JournalPageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    instrument?: string;
    pnl_filter?: string;
    tags?: string;
    page?: string;
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

  let query = supabase
    .from("trades")
    .select("*", { count: "exact" })
    .eq("user_id", user.id);

  if (params.from) {
    query = query.gte("entry_time", params.from);
  }
  if (params.to) {
    query = query.lte("entry_time", params.to);
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
    <div className="space-y-6">
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
