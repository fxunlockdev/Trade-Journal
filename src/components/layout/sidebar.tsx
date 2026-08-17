"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  Layers,
  Radio,
  Settings,
  MessageSquare,
  Brain,
  Calculator,
  Scale,
  ChevronLeft,
  ChevronRight,
  Plus,
  FileUp,
  Cable,
  LayoutGrid,
} from "lucide-react";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface SidebarProps {
  profile: UserProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredRole?: "trader" | "admin";
  section: "main" | "personal";
  /**
   * Parent href — renders this item indented as a child of another nav
   * entry. Used for "Add Trade" under "Journal".
   */
  parentHref?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  // Back to the FXU Home hub — the platform has more than one app now, so the
  // switcher has to be reachable from inside the journal.
  { label: "Your apps", href: "/apps", icon: LayoutGrid, section: "main" },
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    section: "main",
  },
  { label: "Journal", href: "/journal", icon: BookOpen, section: "main" },
  {
    label: "Add Trade",
    href: "/journal/new",
    icon: Plus,
    section: "main",
    parentHref: "/journal",
  },
  {
    label: "Import",
    href: "/import",
    icon: FileUp,
    section: "main",
    parentHref: "/journal",
  },
  {
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    section: "main",
  },
  {
    label: "Portfolio",
    href: "/portfolio",
    icon: Layers,
    section: "main",
  },
  {
    label: "MT5 Sync",
    href: "/mt5-sync",
    icon: Cable,
    section: "main",
  },
  {
    label: "Signals",
    href: "/signals",
    icon: Radio,
    requiredRole: "trader",
    section: "main",
  },
  {
    label: "AI Insights",
    href: "/insights",
    icon: Brain,
    section: "main",
  },
  {
    label: "Risk Calc",
    href: "/risk-calculator",
    icon: Calculator,
    section: "main",
  },
  {
    label: "Lot Size Calc",
    href: "/lot-calculator",
    icon: Scale,
    section: "main",
  },
  {
    label: "AI Chat",
    href: "/ai-chat",
    icon: MessageSquare,
    section: "personal",
  },
  { label: "Settings", href: "/settings", icon: Settings, section: "personal" },
] as const;

function SidebarContent({
  profile,
  collapsed,
  onCollapsedChange,
}: {
  profile: UserProfile;
  collapsed: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const pathname = usePathname();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.requiredRole) return true;
    return profile.role === item.requiredRole || profile.role === "admin";
  });

  const mainItems = visibleItems.filter((item) => item.section === "main");
  const personalItems = visibleItems.filter(
    (item) => item.section === "personal",
  );

  return (
    <div className="flex h-full flex-col">
      {/* Brand + Collapse toggle */}
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        {!collapsed && (
          <Link href="/dashboard" className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-sidebar-accent-foreground">
              FX Unlock
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-leaf">
              Trade Journal
            </span>
          </Link>
        )}
        {onCollapsedChange && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onCollapsedChange(!collapsed)}
            className={cn(
              "size-7 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "mx-auto",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <ChevronLeft className="size-4" />
            )}
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 px-3 py-4">
        {/* MAIN section */}
        <div className="space-y-1">
          {!collapsed && (
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">
              Main
            </p>
          )}
          {mainItems.map((item) => {
            // For sub-items (parentHref set), match only on exact path so
            // they don't light up when you're elsewhere under /journal.
            // For top-level items, match on prefix — BUT exclude pure
            // matches that belong to a declared sub-item (so /journal/new
            // highlights only "Add Trade", not "Journal").
            const isSubItem = Boolean(item.parentHref);
            const subItemHrefsForThisParent = NAV_ITEMS.filter(
              (i) => i.parentHref === item.href,
            ).map((i) => i.href);
            const isActive = isSubItem
              ? pathname === item.href
              : pathname === item.href ||
                (pathname.startsWith(`${item.href}/`) &&
                  !subItemHrefsForThisParent.some(
                    (sub) => pathname === sub,
                  ));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-2",
                  isSubItem && !collapsed && "ml-4 py-1.5 text-[13px]",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isSubItem && "size-3.5",
                    isActive ? "text-sidebar-primary" : "text-sidebar-foreground",
                  )}
                />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </div>

        {/* PERSONAL section */}
        <div className="space-y-1">
          {!collapsed && (
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-leaf">
              Personal
            </p>
          )}
          {personalItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-2",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-sidebar-primary" : "text-sidebar-foreground",
                  )}
                />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User card at bottom */}
      <div className="mt-auto shrink-0 border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
          <Avatar className="size-8 shrink-0 border border-sidebar-border">
            <AvatarImage src={profile.avatar_url ?? undefined} />
            <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
              {profile.full_name
                ? profile.full_name.split(" ").map((p: string) => p[0]).join("").toUpperCase().slice(0, 2)
                : profile.email[0]?.toUpperCase() ?? "U"}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-sidebar-accent-foreground">
                {profile.full_name ?? "User"}
              </p>
              <Badge
                variant="outline"
                className={cn(
                  "mt-0.5 h-4 border-sidebar-border px-1.5 text-[10px] capitalize",
                  profile.role === "admin" && "bg-[#ff897d]/15 text-[#ff897d]",
                  profile.role === "trader" && "bg-sidebar-primary/15 text-sidebar-primary",
                  profile.role === "user" && "bg-sidebar-accent text-sidebar-foreground",
                )}
              >
                {profile.role}
              </Badge>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  profile,
  open,
  onOpenChange,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out md:block",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <SidebarContent
          profile={profile}
          collapsed={collapsed}
          onCollapsedChange={onCollapsedChange}
        />
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="w-60 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SidebarContent profile={profile} collapsed={false} />
        </SheetContent>
      </Sheet>
    </>
  );
}
