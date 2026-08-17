import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements, type ProductKey } from "@/lib/auth/entitlements";
import { TIER_LABEL, TIER_BLURB } from "@/lib/copy/tiers";
import { Landing, type HomeUser } from "./_home/Landing";

/**
 * The FXU Home landing — the public front door AND the signed-in home.
 *
 * Signing in lands you back here, not inside a product: FXU Home is the
 * platform, the apps live behind it. When signed in the nav greets you by name
 * and "Explore the apps" opens the app chooser with your entitlements.
 */
export const metadata: Metadata = {
  title: "FXU · The toolkit for serious traders",
  description:
    "Journal every trade and grow every partnership. Trade Journal and Affiliate CRM, under one account.",
};

// Reads the session — must never be statically cached.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let homeUser: HomeUser | null = null;

  if (user) {
    const [{ data: profile }, entitlements] = await Promise.all([
      supabase
        .from("users")
        .select("full_name")
        .eq("id", user.id)
        .single<{ full_name: string | null }>(),
      getEntitlements(),
    ]);

    const displayName =
      profile?.full_name?.trim() || user.email?.split("@")[0] || "there";

    homeUser = {
      firstName: displayName.split(" ")[0],
      products: (entitlements?.products ?? []) as ProductKey[],
      tierLabel: entitlements ? TIER_LABEL[entitlements.platformRole] : "",
      tierBlurb: entitlements ? TIER_BLURB[entitlements.platformRole] : "",
    };
  }

  return <Landing user={homeUser} />;
}
