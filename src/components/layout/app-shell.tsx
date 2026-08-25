"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette } from "@/components/layout/command-palette";
import { MyfxbookAutoSync } from "@/components/myfxbook/auto-sync";
import { FirstRunTour } from "@/components/tour/first-run-tour";
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
  /** True for an established user — suppresses the first-run tour. */
  alreadyOnboarded?: boolean;
  children: React.ReactNode;
}

export function AppShell({
  profile,
  journals,
  activeJournalId,
  alreadyOnboarded = true,
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

      {/*
        First-run tour. Mounted in the shell rather than on a page because its
        spotlights point at the sidebar and topbar — the chrome the shell owns.
        Renders nothing unless this is a new user who hasn't seen it.
      */}
      <FirstRunTour alreadyOnboarded={alreadyOnboarded} />
    </div>
  );
}
