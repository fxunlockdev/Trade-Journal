"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  LayoutDashboard,
  BookOpen,
  Radio,
  Settings,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
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
}

const NAV_ITEMS: readonly NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    section: "main",
  },
  { label: "Journal", href: "/journal", icon: BookOpen, section: "main" },
  {
    label: "Signals",
    href: "/signals",
    icon: Radio,
    requiredRole: "trader",
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
            <span className="text-lg font-bold tracking-tight text-white">
              FX Unlock
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
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
              "size-7 text-zinc-500 hover:text-zinc-300",
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
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Main
            </p>
          )}
          {mainItems.map((item) => {
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
                    ? "bg-zinc-800/50 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200",
                  collapsed && "justify-center px-2",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-emerald-400" : "text-zinc-500",
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
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
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
                    ? "bg-zinc-800/50 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200",
                  collapsed && "justify-center px-2",
                )}
              >
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    isActive ? "text-emerald-400" : "text-zinc-500",
                  )}
                />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </div>
      </nav>
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
          "hidden shrink-0 border-r border-zinc-800/60 bg-zinc-950 transition-all duration-200 ease-in-out md:block",
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
          className="w-60 border-zinc-800 bg-zinc-950 p-0"
        >
          <SidebarContent profile={profile} collapsed={false} />
        </SheetContent>
      </Sheet>
    </>
  );
}
