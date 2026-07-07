"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { MyfxbookAutoSync } from "@/components/myfxbook/auto-sync";
import type { JournalWithRole } from "@/types/database";

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
}

interface AppShellProps {
  profile: UserProfile;
  journals: readonly JournalWithRole[];
  activeJournalId: string;
  children: React.ReactNode;
}

export function AppShell({
  profile,
  journals,
  activeJournalId,
  children,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        profile={profile}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          profile={profile}
          journals={journals}
          activeJournalId={activeJournalId}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Cmd+K palette — global keyboard shortcut, mounts once per shell */}
      <CommandPalette role={profile.role} />

      {/* Background freshness for Myfxbook-linked accounts (no-op without connections) */}
      <MyfxbookAutoSync />
    </div>
  );
}
