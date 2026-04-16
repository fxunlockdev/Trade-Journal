"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUser } from "@/hooks/use-user";
import { isAdmin } from "@/lib/constants/roles";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";
import { User as UserIcon, Shield, Loader2, ArrowUpDown } from "lucide-react";

type SortField = "full_name" | "email" | "role" | "trade_count";
type SortDirection = "asc" | "desc";

interface ManagedUser {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly role: UserRole;
  readonly trade_count: number;
  readonly last_sign_in_at: string | null;
}

export default function SettingsPage() {
  const { profile, loading } = useUser();
  const [users, setUsers] = useState<readonly ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("full_name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const supabase = createClient();
  const isUserAdmin = profile ? isAdmin(profile.role) : false;

  useEffect(() => {
    if (!isUserAdmin) return;

    const fetchUsers = async () => {
      setLoadingUsers(true);

      // Fetch users
      const { data: usersData } = await supabase
        .from("users")
        .select("id, email, full_name, role")
        .order("created_at", { ascending: true });

      if (!usersData) {
        setLoadingUsers(false);
        return;
      }

      // Fetch trade counts per user
      const { data: tradeCounts } = await supabase
        .from("trades")
        .select("user_id");

      const countMap = new Map<string, number>();
      if (tradeCounts) {
        for (const row of tradeCounts) {
          const userId = (row as { user_id: string }).user_id;
          countMap.set(userId, (countMap.get(userId) ?? 0) + 1);
        }
      }

      const enriched: readonly ManagedUser[] = usersData.map(
        (u: { id: string; email: string; full_name: string | null; role: UserRole }) => ({
          ...u,
          trade_count: countMap.get(u.id) ?? 0,
          last_sign_in_at: null,
        }),
      );

      setUsers(enriched);
      setLoadingUsers(false);
    };

    fetchUsers();
  }, [isUserAdmin, supabase]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: UserRole) => {
      setUpdatingUserId(userId);

      const { error } = await supabase
        .from("users")
        .update({ role: newRole })
        .eq("id", userId);

      if (!error) {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
        );
      }

      setUpdatingUserId(null);
    },
    [supabase],
  );

  const toggleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const sortedUsers = [...users].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "full_name":
        return dir * (a.full_name ?? "").localeCompare(b.full_name ?? "");
      case "email":
        return dir * a.email.localeCompare(b.email);
      case "role":
        return dir * a.role.localeCompare(b.role);
      case "trade_count":
        return dir * (a.trade_count - b.trade_count);
      default:
        return 0;
    }
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your profile and application settings
        </p>
      </div>

      {/* Profile Section */}
      <Card className="border-slate-200 bg-white">
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserIcon className="h-5 w-5 text-slate-400" />
            <CardTitle className="text-base font-semibold text-slate-900">
              Profile
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-indigo-100 text-lg text-indigo-600">
                {profile?.full_name
                  ?.split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {profile?.full_name ?? "Unnamed User"}
              </h3>
              <p className="text-sm text-slate-500">{profile?.email}</p>
              <Badge
                variant="outline"
                className="mt-1 border-slate-200 text-slate-700 capitalize"
              >
                {profile?.role}
              </Badge>
            </div>
          </div>

          <Separator className="bg-slate-200" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-500">Full Name</Label>
              <Input
                value={profile?.full_name ?? ""}
                readOnly
                className="border-slate-200 bg-slate-50 text-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-500">Email</Label>
              <Input
                value={profile?.email ?? ""}
                readOnly
                className="border-slate-200 bg-slate-50 text-slate-500"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Management (Admin only) */}
      {isUserAdmin && (
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-slate-400" />
              <CardTitle className="text-base font-semibold text-slate-900">
                User Management
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 hover:bg-transparent">
                      <TableHead>
                        <button
                          onClick={() => toggleSort("full_name")}
                          className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
                        >
                          User
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => toggleSort("email")}
                          className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
                        >
                          Email
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => toggleSort("trade_count")}
                          className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
                        >
                          Trades
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          onClick={() => toggleSort("role")}
                          className="flex items-center gap-1 text-slate-500 hover:text-slate-700"
                        >
                          Role
                          <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUsers.map((user) => (
                      <TableRow
                        key={user.id}
                        className="border-slate-100 hover:bg-slate-50/50"
                      >
                        <TableCell className="font-medium text-slate-900">
                          {user.full_name ?? "Unnamed"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {user.email}
                        </TableCell>
                        <TableCell className="text-sm text-slate-700">
                          {user.trade_count}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={user.role}
                            onValueChange={(value) => {
                              if (value !== null) {
                                handleRoleChange(user.id, value as UserRole);
                              }
                            }}
                            disabled={
                              user.id === profile?.id ||
                              updatingUserId === user.id
                            }
                          >
                            <SelectTrigger className="w-28 border-slate-200 bg-white text-slate-700">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white">
                              <SelectItem
                                value="user"
                                className="text-slate-700"
                              >
                                User
                              </SelectItem>
                              <SelectItem
                                value="trader"
                                className="text-slate-700"
                              >
                                Trader
                              </SelectItem>
                              <SelectItem
                                value="admin"
                                className="text-slate-700"
                              >
                                Admin
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
