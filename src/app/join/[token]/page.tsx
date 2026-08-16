import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { JoinAccept } from "./JoinAccept";

type PageProps = { params: Promise<{ token: string }> };

/**
 * /join/[token] — an affiliate accepts an IB's invite to the Trade Journal.
 *
 * If signed out, we send them to sign in / sign up and return here (relative
 * next). If signed in, the client posts the token to /api/crm/join, which runs
 * the SECURITY DEFINER accept function. The accepting account is whoever is
 * signed in — a forwarded link binds the person who actually accepts.
 */
export default async function JoinPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = encodeURIComponent(`/join/${token}`);
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;ve been invited</h1>
        <p className="text-muted-foreground">
          Sign in or create your free FXU account to accept this invitation and start
          journaling your trades.
        </p>
        <div className="flex gap-3">
          <Link
            href={`/login?mode=signup&next=${next}`}
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Create account
          </Link>
          <Link
            href={`/login?next=${next}`}
            className="rounded-md border px-5 py-2.5 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return <JoinAccept token={token} />;
}
