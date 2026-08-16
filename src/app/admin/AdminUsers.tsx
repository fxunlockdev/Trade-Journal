"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformRole } from "@/lib/auth/entitlements";

interface AdminUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  company_name: string | null;
  platform_role: PlatformRole;
  last_active_at: string | null;
  created_at: string;
}

const ROLE_LABEL: Record<PlatformRole, string> = {
  affiliate: "Affiliate — Journal only",
  ib: "IB — Journal + CRM",
  admin: "Admin — full access",
};

export function AdminUsers({ selfId }: { selfId: string }) {
  const supabase = createClient();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_users");
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((data ?? []) as AdminUserRow[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function changeRole(target: AdminUserRow, role: PlatformRole) {
    if (role === target.platform_role) return;
    setBusyId(target.id);
    try {
      const res = await fetch("/api/admin/platform-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUserId: target.id, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not change role.");
        return;
      }
      toast.success(`${target.email ?? "User"} is now ${role}.`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-lg border bg-background">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="hidden md:table-cell">Last active</TableHead>
            <TableHead className="w-[280px]">Access tier</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ))
          ) : (
            rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.full_name ?? u.email ?? u.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {u.email}
                    {u.id === selfId && <Badge variant="outline" className="ml-2">You</Badge>}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">
                  {u.last_active_at ? new Date(u.last_active_at).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell>
                  <Select
                    value={u.platform_role}
                    onValueChange={(v) => v && changeRole(u, v as PlatformRole)}
                    disabled={u.id === selfId || busyId === u.id}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROLE_LABEL) as PlatformRole[]).map((r) => (
                        <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
