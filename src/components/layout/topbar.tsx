"use client";

import { usePathname, useRouter } from "next/navigation";
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
import { Menu, User, Settings, LogOut, Search, Moon } from "lucide-react";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface TopbarProps {
  profile: UserProfile;
  onMenuClick: () => void;
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/journal": "Journal",
  "/signals": "Signals",
  "/import": "Import",
  "/settings": "Settings",
  "/ai-chat": "AI Chat",
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

export function Topbar({ profile, onMenuClick }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const pageTitle = getPageTitle(pathname);

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to sign out.");
      return;
    }
    router.push("/login");
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/60 bg-zinc-950/80 px-4 backdrop-blur-sm md:px-6">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="text-zinc-400 hover:text-zinc-200 md:hidden"
          onClick={onMenuClick}
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
        <h1 className="text-lg font-semibold text-zinc-100">{pageTitle}</h1>
      </div>

      {/* Center: Search bar (placeholder) */}
      <div className="hidden max-w-md flex-1 px-8 md:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search..."
            disabled
            className="w-full rounded-lg border border-zinc-800/60 bg-zinc-900/50 py-1.5 pl-9 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {/* Dark mode toggle (placeholder) */}
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-zinc-500 hover:text-zinc-300"
          aria-label="Toggle dark mode"
          disabled
        >
          <Moon className="size-4" />
        </Button>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="relative flex size-8 items-center justify-center rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Avatar className="size-8 border border-zinc-700">
              <AvatarImage src={profile.avatar_url ?? undefined} />
              <AvatarFallback className="bg-zinc-800 text-xs text-zinc-300">
                {getInitials(profile.full_name, profile.email)}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56 border-zinc-800 bg-zinc-900"
          >
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium text-zinc-200">
                {profile.full_name ?? "User"}
              </p>
              <p className="text-xs text-zinc-500">{profile.email}</p>
            </div>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuItem
              className="cursor-pointer text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100"
              onClick={() => router.push("/settings")}
            >
              <User className="mr-2 size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-zinc-300 focus:bg-zinc-800 focus:text-zinc-100"
              onClick={() => router.push("/settings")}
            >
              <Settings className="mr-2 size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuItem
              className="cursor-pointer text-red-400 focus:bg-zinc-800 focus:text-red-300"
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
