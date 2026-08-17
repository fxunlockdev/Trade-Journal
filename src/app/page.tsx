import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { Landing } from "./_home/Landing";

/**
 * The FXU Home landing — the public front door of the platform.
 *
 * Signed-out visitors get the marketing page. Signed-in visitors get the same
 * page with CTAs pointing at the /apps hub instead of /login, so returning
 * users are one click from their apps rather than being asked to sign in again.
 */
export const metadata: Metadata = {
  title: "FXU · The toolkit for serious traders",
  description:
    "Journal every trade and grow every partnership. Trade Journal and Affiliate CRM, under one account.",
};

// Reads the session, so it must never be statically cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <Landing signedIn={user !== null} />;
}
