"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Receipt, LayoutDashboard, Settings, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface CrmShellProps {
  readonly children: React.ReactNode;
  readonly isAdmin: boolean;
  readonly displayName: string;
}

const NAV = [
  { href: "/crm", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/crm/affiliates", label: "Affiliates", icon: Users, exact: false },
  { href: "/crm/commissions", label: "Commissions", icon: Receipt, exact: false },
  { href: "/crm/settings", label: "Settings", icon: Settings, exact: false },
] as const;

/**
 * CRM section shell — a deliberately distinct identity from the journal so the
 * CRM reads as its own app, not a journal screen (R4). The app-switcher link
 * takes IBs back to the Trade Journal.
 */
export function CrmShell({ children, displayName }: CrmShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href="/crm" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-sky-500 to-blue-700 text-white">
              <Users className="h-4 w-4" />
            </span>
            <span>Affiliate CRM</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="CRM sections">
            {NAV.map(({ href, label, icon: Icon, exact }) => {
              const active = exact ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden max-w-[180px] truncate text-sm text-muted-foreground sm:inline">
              {displayName}
            </span>
            <Link
              href="/apps"
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Your apps
            </Link>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t px-3 py-2 md:hidden" aria-label="CRM sections">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                  active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
