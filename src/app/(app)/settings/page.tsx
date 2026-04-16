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
import { isAdmin } from "@/lib/constants/roles";
import { createClient } from "@/lib/supabase/client";
import type { User, UserRole } from "@/types/database";
import {
  User as UserIcon,
  Shield,
  Bot,
  Webhook,
  Copy,
  Loader2,
} from "lucide-react";

interface ManagedUser {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly role: UserRole;
}

export default function SettingsPage() {
  const { profile, loading } = useUser();
  const [users, setUsers] = useState<readonly ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);

  const supabase = createClient();
  const isUserAdmin = profile ? isAdmin(profile.role) : false;

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/mt5`
      : "/api/mt5";

  useEffect(() => {
    if (!isUserAdmin) return;

    const fetchUsers = async () => {
      setLoadingUsers(true);
      const { data } = await supabase
        .from("users")
        .select("id, email, full_name, role")
        .order("created_at", { ascending: true });

      if (data) {
        setUsers(data as ManagedUser[]);
      }
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

  const handleCopyWebhook = useCallback(() => {
    navigator.clipboard.writeText(webhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  }, [webhookUrl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Manage your profile and application settings
        </p>
      </div>

      {/* Profile Section */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <div className="flex items-center gap-2">
            <UserIcon className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">
              Profile
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={profile?.avatar_url ?? undefined} />
              <AvatarFallback className="bg-zinc-800 text-lg text-zinc-300">
                {profile?.full_name
                  ?.split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div>
              <h3 className="text-lg font-semibold text-zinc-100">
                {profile?.full_name ?? "Unnamed User"}
              </h3>
              <p className="text-sm text-zinc-500">{profile?.email}</p>
              <Badge
                variant="outline"
                className="mt-1 border-zinc-700 text-zinc-300 capitalize"
              >
                {profile?.role}
              </Badge>
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-400">Full Name</Label>
              <Input
                value={profile?.full_name ?? ""}
                readOnly
                className="border-zinc-800 bg-zinc-900 text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-400">Email</Label>
              <Input
                value={profile?.email ?? ""}
                readOnly
                className="border-zinc-800 bg-zinc-900 text-zinc-400"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User Management (Admin only) */}
      {isUserAdmin && (
        <Card className="border-zinc-800 bg-zinc-950">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-zinc-400" />
              <CardTitle className="text-base font-semibold text-zinc-100">
                User Management
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-zinc-800">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-zinc-400">User</TableHead>
                      <TableHead className="text-zinc-400">Email</TableHead>
                      <TableHead className="text-zinc-400">Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <TableRow
                        key={user.id}
                        className="border-zinc-800/50 hover:bg-zinc-900/30"
                      >
                        <TableCell className="font-medium text-zinc-200">
                          {user.full_name ?? "Unnamed"}
                        </TableCell>
                        <TableCell className="text-sm text-zinc-400">
                          {user.email}
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
                            <SelectTrigger className="w-28 border-zinc-700 bg-zinc-900 text-zinc-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-zinc-700 bg-zinc-900">
                              <SelectItem
                                value="user"
                                className="text-zinc-200"
                              >
                                User
                              </SelectItem>
                              <SelectItem
                                value="trader"
                                className="text-zinc-200"
                              >
                                Trader
                              </SelectItem>
                              <SelectItem
                                value="admin"
                                className="text-zinc-200"
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

      {/* Telegram Settings */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">
              Telegram Integration
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            Configure your Telegram bot to send trading signals. These values
            must be set as environment variables on the server.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-400">Bot Token</Label>
              <Input
                value={
                  process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN
                    ? "Configured"
                    : "Not configured"
                }
                readOnly
                className="border-zinc-800 bg-zinc-900 text-zinc-500"
              />
              <p className="text-xs text-zinc-600">
                Set TELEGRAM_BOT_TOKEN in your .env file
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-400">Chat ID</Label>
              <Input
                value={
                  process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID
                    ? "Configured"
                    : "Not configured"
                }
                readOnly
                className="border-zinc-800 bg-zinc-900 text-zinc-500"
              />
              <p className="text-xs text-zinc-600">
                Set TELEGRAM_CHAT_ID in your .env file
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MT5 Webhook */}
      <Card className="border-zinc-800 bg-zinc-950">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-zinc-400" />
            <CardTitle className="text-base font-semibold text-zinc-100">
              MT5 Webhook
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm text-zinc-400">Webhook URL</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-200">
                {webhookUrl}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyWebhook}
                className="border-zinc-700 text-zinc-300"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                {webhookCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm text-zinc-400">Webhook Secret</Label>
            <Input
              value="Set via MT5_WEBHOOK_SECRET environment variable"
              readOnly
              className="border-zinc-800 bg-zinc-900 text-zinc-500"
            />
          </div>

          {profile && (
            <div className="space-y-1.5">
              <Label className="text-sm text-zinc-400">Your User ID</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-300">
                  {profile.id}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(profile.id)}
                  className="border-zinc-700 text-zinc-300"
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>
              <p className="text-xs text-zinc-600">
                Pass this as the x-user-id header in your MT5 EA webhook
                requests
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
