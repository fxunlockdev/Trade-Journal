"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Users, UserCheck, Wallet, Clock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  formatCurrency, MONTHS, type Affiliate, type Commission,
} from "@/lib/crm/types";

export default function CrmDashboardPage() {
  const supabase = createClient();
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, c] = await Promise.all([
      supabase.from("affiliates").select("*"),
      supabase.from("commissions").select("*"),
    ]);
    setLoading(false);
    if (a.error) return toast.error(a.error.message);
    if (c.error) return toast.error(c.error.message);
    setAffiliates((a.data ?? []) as Affiliate[]);
    setCommissions((c.data ?? []) as Commission[]);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const year = new Date().getFullYear();
    const active = affiliates.filter((a) => a.status === "ACTIVE").length;
    const paidThisYear = commissions
      .filter((c) => c.year === year && c.status === "PAID")
      .reduce((s, c) => s + Number(c.amount), 0);
    const pending = commissions
      .filter((c) => c.status === "PENDING")
      .reduce((s, c) => s + Number(c.amount), 0);
    return { total: affiliates.length, active, paidThisYear, pending };
  }, [affiliates, commissions]);

  const recent = [...affiliates]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);

  const cards = [
    { label: "Affiliates", value: String(stats.total), icon: Users, hint: "total on roster" },
    { label: "Active", value: String(stats.active), icon: UserCheck, hint: "status ACTIVE" },
    { label: "Paid this year", value: formatCurrency(stats.paidThisYear), icon: Wallet, hint: `${new Date().getFullYear()} commissions` },
    { label: "Pending", value: formatCurrency(stats.pending), icon: Clock, hint: "awaiting payout" },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your affiliate program at a glance.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, hint }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-semibold tabular-nums">{value}</div>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent affiliates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No affiliates yet. <Link href="/crm/affiliates" className="text-primary underline">Add your first one.</Link>
            </p>
          ) : (
            <ul className="divide-y">
              {recent.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">{a.email ?? a.country ?? "—"}</p>
                  </div>
                  <Badge variant="secondary">{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
