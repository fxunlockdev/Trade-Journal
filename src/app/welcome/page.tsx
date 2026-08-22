import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/entitlements";
import { WelcomeGate } from "./WelcomeGate";
import "@/app/_home/fxu-home.css";

/**
 * The gate every account passes through exactly once.
 *
 * Both product entry points redirect here while signup_intent is null: FXU Home
 * and the app layout. This page is the other half of that contract, redirecting
 * straight back out once the answer exists, so the pair can never loop. Both
 * sides read the same column, which is what keeps them agreed.
 *
 * Existing accounts predate the column and so are null too. They get asked once
 * on their next visit, which is the point: the whole reason for this step is to
 * know who introduces clients, and that was never recorded before.
 */
export const metadata: Metadata = {
  title: "Welcome to FXU",
};

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fwelcome");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("users")
    .select("full_name, signup_intent")
    .eq("id", user.id)
    .single<{ full_name: string | null; signup_intent: string | null }>();

  // Already answered: nothing to gate.
  if (profile?.signup_intent != null) redirect("/");

  const displayName = profile?.full_name?.trim() || user.email?.split("@")[0] || "there";

  return (
    <div className="fxu-home welcome-page">
      <div className="orbs" aria-hidden="true">
        <span className="orb o1" />
        <span className="orb o2" />
        <span className="orb o3" />
      </div>

      <div className="welcome-inner">
        <a className="auth-brand" href="/" aria-label="FXU home">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect width="24" height="24" rx="6" className="logo-bg" />
            <path d="M7 7h10M7 12h7M7 17h4" className="logo-fg" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <span>FXU Apps</span>
        </a>

        <h1 className="welcome-title">
          Welcome to <span className="grad-text">FXU.</span>
        </h1>

        <WelcomeGate firstName={displayName.split(" ")[0]} />
      </div>
    </div>
  );
}
