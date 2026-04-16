"use client";

import type { ReactNode } from "react";
import { useUser } from "@/hooks/use-user";

interface RoleGateProps {
  allowedRoles: readonly string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({
  allowedRoles,
  children,
  fallback = null,
}: RoleGateProps) {
  const { profile, loading } = useUser();

  if (loading) {
    return null;
  }

  if (!profile) {
    return <>{fallback}</>;
  }

  if (!allowedRoles.includes(profile.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
