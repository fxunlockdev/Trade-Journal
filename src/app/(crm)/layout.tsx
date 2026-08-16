import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/auth/entitlements";
import { CrmShell } from "@/components/crm/crm-shell";

/**
 * Server layout for the Affiliate CRM section.
 *
 * This is an *authoritative* entitlement re-check (§3.3): middleware already
 * gates /crm from the JWT claim, but middleware is UX, not authority. Here we
 * read the live database via getEntitlements() — so a demoted IB is bounced
 * even while holding a still-valid token. RLS remains the final backstop.
 */
export default async function CrmLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    redirect("/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/crm");

  const entitlements = await getEntitlements();
  if (!entitlements || !entitlements.products.includes("crm")) {
    // Not a bug and not a 404 — a real user who simply lacks the product.
    // The locked screen explains how to get access.
    redirect("/locked?product=crm");
  }

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, email, company_name")
    .eq("id", user.id)
    .single<{ full_name: string | null; email: string | null; company_name: string | null }>();

  return (
    <CrmShell
      isAdmin={entitlements.platformRole === "admin"}
      displayName={profile?.company_name || profile?.full_name || profile?.email || "Your workspace"}
    >
      {children}
    </CrmShell>
  );
}
