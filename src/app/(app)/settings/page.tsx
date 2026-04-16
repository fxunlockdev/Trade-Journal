"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/types/database";
import { toast } from "sonner";
import {
  User as UserIcon,
  Shield,
  Loader2,
  ArrowUpDown,
  Save,
} from "lucide-react";

type SortField = "full_name" | "email" | "role" | "trade_count";
type SortDir = "asc" | "desc";

interface ManagedUser {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly role: UserRole;
  readonly trade_count: number;
}

export default function SettingsPage() {
  const { user, profile, loading, refetch } = useUser();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  const [users, setUsers] = useState<readonly ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("full_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const supabase = createClient();
  const isUserAdmin = profile?.role === "admin";

  // Set form values when profile loads
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
    }
  }, [profile]);

  // Load users for admin
  useEffect(() => {
    if (!isUserAdmin) return;

    const fetchUsers = async () => {
      setLoadingUsers(true);
      const { data: usersData } = await supabase
        .from("users")
        .select("id, email, full_name, role")
        .order("created_at", { ascending: true });

      if (!usersData) {
        setLoadingUsers(false);
        return;
      }

      const { data: tradeCounts } = await supabase
        .from("trades")
        .select("user_id");

      const countMap = new Map<string, number>();
      if (tradeCounts) {
        for (const row of tradeCounts) {
          const uid = (row as { user_id: string }).user_id;
          countMap.set(uid, (countMap.get(uid) ?? 0) + 1);
        }
      }

      const enriched: ManagedUser[] = usersData.map(
        (u: {
          id: string;
          email: string;
          full_name: string | null;
          role: UserRole;
        }) => ({
          ...u,
          trade_count: countMap.get(u.id) ?? 0,
        }),
      );

      setUsers(enriched);
      setLoadingUsers(false);
    };

    fetchUsers();
  }, [isUserAdmin, supabase]);

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;
    setSaving(true);

    const { error } = await supabase
      .from("users")
      .update({ full_name: fullName.trim() || null })
      .eq("id", user.id);

    if (error) {
      toast.error("Failed to update profile");
    } else {
      toast.success("Profile updated");
      await refetch();
    }
    setSaving(false);
  }, [user, fullName, supabase, refetch]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: UserRole) => {
      setUpdatingUserId(userId);
      const { error } = await supabase
        .from("users")
        .update({ role: newRole })
        .eq("id", userId);

      if (error) {
        toast.error("Failed to update role");
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
        );
        toast.success("Role updated");
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

  const displayEmail = profile?.email || user?.email || "";
  const displayName = profile?.full_name || user?.user_metadata?.full_name || user?.user_metadata?.name || "User";
  const displayAvatar = profile?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "";

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
            <Avatar className="h-16 w-16 border border-slate-200">
              <AvatarImage src={displayAvatar} />
              <AvatarFallback className="bg-indigo-100 text-lg text-indigo-600">
                {displayName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {displayName}
              </h3>
              <p className="text-sm text-slate-500">{displayEmail}</p>
              <Badge
                variant="outline"
                className="mt-1 border-indigo-200 bg-indigo-50 capitalize text-indigo-700"
              >
                {profile?.role ?? "user"}
              </Badge>
            </div>
          </div>

          <Separator className="bg-slate-200" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-600">Full Name</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
                className="border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-slate-600">Email</Label>
              <Input
                value={displayEmail}
                readOnly
                className="border-slate-200 bg-slate-50 text-slate-500"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveProfile}
              disabled={saving}
              className="gap-2 bg-indigo-600 text-white hover:bg-indigo-500"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save Changes
            </Button>
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
              <Badge variant="outline" className="ml-2 border-red-200 bg-red-50 text-red-700">
                Admin
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-slate-500">No users found.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                      {(
                        [
                          ["full_name", "User"],
                          ["email", "Email"],
                          ["trade_count", "Trades"],
                          ["role", "Role"],
                        ] as [SortField, string][]
                      ).map(([field, label]) => (
                        <TableHead key={field}>
                          <button
                            onClick={() => toggleSort(field)}
                            className="flex items-center gap-1 text-slate-600 hover:text-slate-900"
                          >
                            {label}
                            <ArrowUpDown className="h-3 w-3" />
                          </button>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUsers.map((u) => (
                      <TableRow
                        key={u.id}
                        className="border-slate-100 hover:bg-slate-50"
                      >
                        <TableCell className="font-medium text-slate-900">
                          {u.full_name ?? "Unnamed"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-500">
                          {u.email}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-slate-700">
                          {u.trade_count}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(v) => {
                              if (v) handleRoleChange(u.id, v as UserRole);
                            }}
                            disabled={
                              u.id === profile?.id ||
                              updatingUserId === u.id
                            }
                          >
                            <SelectTrigger className="w-28 border-slate-200 bg-white text-slate-700">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-slate-200 bg-white">
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="trader">Trader</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
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
