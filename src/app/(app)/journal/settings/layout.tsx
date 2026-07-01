import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveJournal } from "@/lib/journals/active-journal";
import { cn } from "@/lib/utils";
import { COLOR_CLASS_SERVER } from "./color-class";

// Journal name / archive-badge / role-badge must reflect the DB after the
// archive toggle or rename — without force-dynamic Next.js may serve a
// stale render of this header.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Settings-section layout. Shows the active journal's name + tab nav, then
 * renders the active tab's page. Every tab is scoped to the **active
 * journal** (from the cookie) — switching journals via the top-nav switcher
 * automatically re-scopes all settings pages.
 *
 * Non-owners see a limited tab set: General (read-only), Members (read-only),
 * Activity. Owners see everything including Archive controls.
 */

interface SettingsLayoutProps {
  readonly children: React.ReactNode;
}

export default async function JournalSettingsLayout({
  children,
}: SettingsLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { journal, role } = await getActiveJournal(supabase, user.id);
  const isOwner = role === "owner";

  const tabs: ReadonlyArray<{
    readonly href: string;
    readonly label: string;
    readonly ownerOnly?: boolean;
  }> = [
    { href: "/journal/settings/general", label: "General" },
    { href: "/journal/settings/members", label: "Members" },
    { href: "/journal/settings/invites", label: "Invites", ownerOnly: true },
    { href: "/journal/settings/activity", label: "Activity" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6 lg:p-8">
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "size-3 shrink-0 rounded-full",
              COLOR_CLASS_SERVER[journal.color],
            )}
          />
          <h1 className="text-2xl font-bold tracking-tight">{journal.name}</h1>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {role}
          </span>
          {journal.is_archived && (
            <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn ring-1 ring-warn/30">
              Archived
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Manage this journal&apos;s settings, members, invites, and activity.
        </p>
      </header>

      {/* Tab strip */}
      <nav className="flex flex-wrap items-center gap-1 border-b border-border">
        {tabs
          .filter((t) => isOwner || !t.ownerOnly)
          .map((t) => (
            <SettingsTabLink key={t.href} href={t.href} label={t.label} />
          ))}
      </nav>

      {children}
    </div>
  );
}

/**
 * Client-free active-tab highlight via `data-active` would need usePathname.
 * Kept server-rendered for now — hover state is enough to guide the eye, and
 * the tab router.refresh refetches everything on click anyway.
 */
function SettingsTabLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  return (
    <Link
      href={href}
      className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground"
    >
      {label}
    </Link>
  );
}
