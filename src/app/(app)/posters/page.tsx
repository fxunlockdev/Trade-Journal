import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { PostersClient } from "@/components/posters/posters-client";
import type { Trade } from "@/types/database";

// A poster is a public claim about performance, so it must never be built from
// a cached render — every load re-reads the journal's trades.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Posters | FX Unlock",
};

export default async function PostersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal } = await getActiveJournal(supabase, user.id);

  // Admin client for the trades read — SSR auth is flaky on Vercel, and
  // getActiveJournal has already verified membership. Filtered strictly by
  // journal id so no unauthorized rows can leak.
  //
  // Newest first, with a generous cap. GET /api/trades limits to 100, which a
  // monthly poster can exceed, so this reads directly — but "no limit" is not
  // safe either: PostgREST applies a max-rows ceiling (1000 by default on
  // hosted Supabase), and ASCENDING order would silently hand back the OLDEST
  // rows, leaving a long-standing journal with an empty poster for every recent
  // period. Descending guarantees the periods this page can select are present.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("trades")
    .select("*")
    .eq("journal_id", journal.id)
    .not("pnl_absolute", "is", null)
    .order("entry_time", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("[TRDR] Posters trades error:", error.message);
  }

  return (
    <PostersClient
      trades={(data ?? []) as Trade[]}
      journalId={journal.id}
      journalName={journal.name}
      loadError={error ? error.message : null}
    />
  );
}
