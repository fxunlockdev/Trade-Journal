"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, User, Settings, LogOut, Search, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { JournalSwitcher } from "@/components/journals/journal-switcher";
import type { JournalWithRole } from "@/types/database";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface TopbarProps {
  profile: UserProfile;
  journals: readonly JournalWithRole[];
  activeJournalId: string;
  onMenuClick: () => void;
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/journal": "Journal",
  "/signals": "Signals",
  "/insights": "AI Insights",
  "/risk-calculator": "Risk Calculator",
  "/ai-chat": "AI Chat",
  "/import": "Import",
  "/mt5-sync": "MT5 Sync",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  for (const [path, title] of Object.entries(PAGE_TITLES)) {
    if (pathname === path || pathname.startsWith(`${path}/`)) {
      return title;
    }
  }
  return "Dashboard";
}

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

export function Topbar({
  profile,
  journals,
  activeJournalId,
  onMenuClick,
}: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { resolvedTheme, setTheme } = useTheme();

  const pageTitle = getPageTitle(pathname);
  const isDark = resolvedTheme === "dark";

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out.");
      return;
    }
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card px-4 md:px-6">
      {/* Left side */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-muted-foreground md:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
        <JournalSwitcher
          journals={journals}
          activeJournalId={activeJournalId}
        />
        <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" />
        <h1 className="hidden text-base font-semibold text-foreground sm:block">
          {pageTitle}
        </h1>
      </div>

      {/* Center: Command-palette trigger. Clicking or Cmd+K opens the
          palette (see CommandPalette in AppShell). We render it as a button
          styled like a search bar so the affordance is obvious even to
          non-keyboard users, while still communicating the shortcut. */}
      <div className="hidden max-w-md flex-1 px-8 md:block">
        <button
          type="button"
          aria-label="Open command palette"
          onClick={() =>
            window.dispatchEvent(new Event("trdr:open-command-palette"))
          }
          className="group relative flex w-full items-center rounded-lg border border-border bg-muted py-1.5 pl-9 pr-4 text-left text-sm text-muted-foreground transition-colors hover:border-ring/40 hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-ring/20"
        >
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span>Search or type @trade…</span>
          <kbd className="ml-auto hidden items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Dark / Light mode toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="relative flex size-8 items-center justify-center rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Avatar className="size-8 border border-border">
              <AvatarImage src={profile.avatar_url ?? undefined} />
              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                {getInitials(profile.full_name, profile.email)}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56 border-border bg-card"
          >
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium text-foreground">
                {profile.full_name ?? "User"}
              </p>
              <p className="text-xs text-muted-foreground">{profile.email}</p>
            </div>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              className="cursor-pointer text-foreground focus:bg-accent focus:text-accent-foreground"
              onClick={() => router.push("/settings")}
            >
              <User className="mr-2 size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-foreground focus:bg-accent focus:text-accent-foreground"
              onClick={() => router.push("/settings")}
            >
              <Settings className="mr-2 size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-border" />
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 size-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
