import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { IbInviteAccept } from "./IbInviteAccept";
import "@/app/_home/fxu-home.css";

type PageProps = { params: Promise<{ token: string }> };

/**
 * /ib-invite/[token] — accept an IB invitation.
 *
 * Signed out, we send them through the normal FXU sign-in and come back here
 * (relative ?next). The account that accepts is whoever is signed in, so a
 * forwarded link binds the person who actually uses it.
 */
export default async function IbInvitePage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = encodeURIComponent(`/ib-invite/${token}`);
    return (
      <div className="fxu-home auth-page">
        <div className="orbs" aria-hidden="true">
          <span className="orb o1" />
          <span className="orb o2" />
        </div>
        <div className="auth-inner">
          <h1 className="auth-title">You&apos;ve been invited as an <span className="grad-text">IB.</span></h1>
          <p className="auth-sub">
            Sign in or create your FXU account to accept. You&apos;ll get the Trade Journal
            and the Affiliate CRM.
          </p>
          <div className="hero-ctas" style={{ justifyContent: "center" }}>
            <Link className="btn-primary" href={`/login?mode=signup&next=${next}`}>
              Create account
            </Link>
            <Link className="btn-ghost" href={`/login?next=${next}`}>
              Sign in <span className="chev">›</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <IbInviteAccept token={token} />;
}
