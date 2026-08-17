import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements, type ProductKey } from "@/lib/auth/entitlements";
import { TIER_LABEL, TIER_BLURB } from "@/lib/copy/tiers";
import { EDUCATION_URL, isExternalEducation } from "@/lib/education-url";

export const metadata: Metadata = { title: "Your apps · FXU Home" };

// Personalized surface — never cache.
export const dynamic = "force-dynamic";

/**
 * /apps — the post-sign-in hub.
 *
 * This is where SSO pays off: one sign-in, then you pick the app. It shows the
 * user's access level and which products it unlocks, so tiering is visible
 * rather than implied. Locked products are shown deliberately (greyed, with how
 * to get access) instead of hidden — hiding them makes the platform feel broken.
 *
 * Entitlements are read from the database (never the JWT claim), so this
 * reflects a promotion/demotion immediately.
 */
export default async function AppsHubPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/apps");

  const entitlements = await getEntitlements();
  if (!entitlements) redirect("/login?next=/apps");

  const { data: profile } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", user.id)
    .single<{ full_name: string | null }>();

  const firstName = (profile?.full_name ?? user.email ?? "").split(" ")[0];
  const has = (p: ProductKey) => entitlements.products.includes(p);
  const eduExternal = isExternalEducation();

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <p className="text-sm text-muted-foreground">
          {firstName ? `Welcome back, ${firstName}.` : "Welcome back."}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your apps</h1>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium">{TIER_LABEL[entitlements.platformRole]}</span>
          <span className="text-muted-foreground">· {TIER_BLURB[entitlements.platformRole]}</span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <AppCard
          href="/dashboard"
          title="Trade Journal"
          desc="Log trades, review your equity curve, and let the patterns surface."
          unlocked={has("journal")}
        />
        <AppCard
          href="/crm"
          title="Affiliate CRM"
          desc="Track your affiliates, log commissions, and see who's active."
          unlocked={has("crm")}
          lockedNote="Included with IB access. Ask an admin to upgrade your account."
        />
        <AppCard
          href={EDUCATION_URL}
          title="Live Education"
          desc="Live, practical sessions for partner communities."
          unlocked
          external={eduExternal}
        />
        {has("admin") && (
          <AppCard
            href="/admin"
            title="Platform Admin"
            desc="Manage members and access levels across FXU Home."
            unlocked
          />
        )}
      </div>

      <p className="mt-10 text-center text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">Back to FXU Home</Link>
      </p>
    </div>
  );
}

interface AppCardProps {
  readonly href: string;
  readonly title: string;
  readonly desc: string;
  readonly unlocked: boolean;
  readonly lockedNote?: string;
  readonly external?: boolean;
}

function AppCard({ href, title, desc, unlocked, lockedNote, external }: AppCardProps) {
  if (!unlocked) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-6 opacity-70">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">{title}</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Locked
          </span>
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
        {lockedNote && <p className="mt-3 text-xs text-muted-foreground">{lockedNote}</p>}
      </div>
    );
  }

  const inner = (
    <>
      <h2 className="font-semibold group-hover:underline underline-offset-4">{title}</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
      <span className="mt-4 inline-block text-sm text-primary">Open →</span>
    </>
  );

  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="group rounded-xl border bg-background p-6 transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      {inner}
    </a>
  ) : (
    <Link
      href={href}
      className="group rounded-xl border bg-background p-6 transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      {inner}
    </Link>
  );
}
