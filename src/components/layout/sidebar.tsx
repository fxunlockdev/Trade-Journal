"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isTrader } from "@/lib/constants/roles";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard,
  BookOpen,
  Radio,
  Upload,
  Settings,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";

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
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredRole?: "trader" | "admin";
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Journal", href: "/journal", icon: BookOpen },
  { label: "Signals", href: "/signals", icon: Radio, requiredRole: "trader" },
  { label: "Import", href: "/import", icon: Upload },
  { label: "Settings", href: "/settings", icon: Settings },
] as const;

function getInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0]?.toUpperCase() ?? "U";
}

function getRoleBadgeColor(role: string): string {
  switch (role) {
    case "admin":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "trader":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    default:
      return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
}

function SidebarContent({ profile }: { profile: UserProfile }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.requiredRole) return true;
    return isTrader(profile.role);
  });

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out.");
      return;
    }
    router.push("/login");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center px-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="text-xl font-bold tracking-tight text-white">
            TRDR
          </span>
          <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
            beta
          </span>
        </Link>
      </div>

      <Separator className="bg-zinc-800" />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {visibleItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
              )}
            >
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  isActive ? "text-emerald-400" : "text-zinc-500",
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <Separator className="bg-zinc-800" />

      {/* User info */}
      <div className="shrink-0 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-9 border border-zinc-700">
            <AvatarImage src={profile.avatar_url ?? undefined} />
            <AvatarFallback className="bg-zinc-800 text-xs text-zinc-300">
              {getInitials(profile.full_name, profile.email)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 truncate">
            <p className="truncate text-sm font-medium text-zinc-200">
              {profile.full_name ?? profile.email}
            </p>
            <Badge
              variant="outline"
              className={cn(
                "mt-0.5 border px-1.5 py-0 text-[10px] font-semibold uppercase",
                getRoleBadgeColor(profile.role),
              )}
            >
              {profile.role}
            </Badge>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="shrink-0 text-zinc-500 hover:text-zinc-300"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ profile, open, onOpenChange }: SidebarProps) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 md:block">
        <SidebarContent profile={profile} />
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="w-64 border-zinc-800 bg-zinc-950 p-0"
        >
          <SidebarContent profile={profile} />
        </SheetContent>
      </Sheet>
    </>
  );
}
