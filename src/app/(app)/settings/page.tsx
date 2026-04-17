"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Camera,
  Mail,
  Lock,
  Eye,
  EyeOff,
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

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case "admin":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "trader":
      return "border-primary/30 bg-primary/10 text-primary";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

const SORT_COLUMNS: [SortField, string][] = [
  ["full_name", "User"],
  ["email", "Email"],
  ["trade_count", "Trades"],
  ["role", "Role"],
];

export default function SettingsPage() {
  const { user, profile, loading, refetch } = useUser();
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);

  // Avatar upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null);

  // Email change
  const [newEmail, setNewEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Members tab
  const [users, setUsers] = useState<readonly ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("full_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const supabase = useMemo(() => createClient(), []);
  const isUserAdmin = profile?.role === "admin";

  useEffect(() => {
    if (profile) setFullName(profile.full_name ?? "");
  }, [profile]);

  useEffect(() => {
    if (!isUserAdmin) return;

    const fetchUsers = async () => {
      setLoadingUsers(true);
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          toast.error(err.error ?? "Failed to load members");
          return;
        }
        const json = (await res.json()) as { data: ManagedUser[] };
        setUsers(json.data ?? []);
      } catch {
        toast.error("Failed to load members");
      } finally {
        setLoadingUsers(false);
      }
    };

    fetchUsers();
  }, [isUserAdmin]);

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

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !user) return;

      setUploadingAvatar(true);
      try {
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(`${user.id}/avatar`, file, {
            upsert: true,
            contentType: file.type,
          });

        if (uploadError) {
          toast.error(uploadError.message);
          return;
        }

        const { data: urlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(`${user.id}/avatar`);

        const publicUrl = urlData.publicUrl;

        const { error: updateError } = await supabase
          .from("users")
          .update({ avatar_url: publicUrl })
          .eq("id", user.id);

        if (updateError) {
          toast.error(updateError.message);
          return;
        }

        setLocalAvatarUrl(publicUrl);
        toast.success("Avatar updated");
        await refetch();
      } catch {
        toast.error("Failed to upload avatar");
      } finally {
        setUploadingAvatar(false);
        // Reset input so selecting the same file triggers onChange again
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [user, supabase, refetch],
  );

  const handleEmailChange = useCallback(async () => {
    const trimmed = newEmail.trim();
    if (!trimmed) return;

    setChangingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: trimmed });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Check your new email for a confirmation link");
        setNewEmail("");
      }
    } catch {
      toast.error("Failed to update email");
    } finally {
      setChangingEmail(false);
    }
  }, [newEmail, supabase]);

  const handlePasswordChange = useCallback(async () => {
    if (newPassword !== confirmPassword || newPassword.length < 8) return;

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Password updated successfully");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      toast.error("Failed to update password");
    } finally {
      setChangingPassword(false);
    }
  }, [newPassword, confirmPassword, supabase]);

  const handleRoleChange = useCallback(
    async (userId: string, newRole: UserRole) => {
      setUpdatingUserId(userId);
      try {
        const res = await fetch("/api/admin/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, role: newRole }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          toast.error(err.error ?? "Failed to update role");
          return;
        }
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
        );
        toast.success("Role updated");
      } catch {
        toast.error("Failed to update role");
      } finally {
        setUpdatingUserId(null);
      }
    },
    [],
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

  const passwordMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  const passwordUpdateDisabled =
    changingPassword ||
    newPassword.length < 8 ||
    confirmPassword.length === 0 ||
    newPassword !== confirmPassword;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const displayEmail = profile?.email ?? user?.email ?? "";
  const displayName =
    profile?.full_name ??
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    "User";
  const displayAvatar =
    localAvatarUrl ??
    profile?.avatar_url ??
    user?.user_metadata?.avatar_url ??
    user?.user_metadata?.picture ??
    "";
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="space-y-6 p-4 md:p-6 lg:p-8">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your profile and application settings
        </p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="mb-4">
          <TabsTrigger value="profile" className="flex items-center gap-1.5">
            <UserIcon className="h-3.5 w-3.5" />
            Profile
          </TabsTrigger>
          {isUserAdmin && (
            <TabsTrigger value="members" className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5" />
              Members
            </TabsTrigger>
          )}
        </TabsList>

        {/* ── Profile tab ── */}
        <TabsContent value="profile">
          <Card className="border-border bg-card">
            <CardContent className="pt-6 space-y-6">
              {/* Avatar upload + identity */}
              <div className="flex items-center gap-5">
                {/* Clickable avatar with camera overlay */}
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  disabled={uploadingAvatar}
                  className="relative h-20 w-20 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Upload profile photo"
                >
                  <Avatar className="h-20 w-20 border border-border">
                    <AvatarImage src={displayAvatar} />
                    <AvatarFallback className="bg-primary/10 text-primary text-2xl font-semibold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  {/* Overlay */}
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 hover:opacity-100 transition-opacity">
                    {uploadingAvatar ? (
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    ) : (
                      <Camera className="h-5 w-5 text-white" />
                    )}
                  </div>

                  {/* Loading ring when uploading */}
                  {uploadingAvatar && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40">
                      <Loader2 className="h-5 w-5 animate-spin text-white" />
                    </div>
                  )}
                </button>

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFileChange}
                />

                <div className="space-y-1 min-w-0">
                  <h3 className="text-lg font-semibold text-foreground truncate">
                    {displayName}
                  </h3>
                  <p className="text-sm text-muted-foreground truncate">
                    {displayEmail}
                  </p>
                  <Badge
                    variant="outline"
                    className={`mt-0.5 capitalize text-xs ${roleBadgeClass((profile?.role ?? "user") as UserRole)}`}
                  >
                    {profile?.role ?? "user"}
                  </Badge>
                </div>
              </div>

              <Separator className="bg-border" />

              {/* Full Name field */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm text-foreground">Full Name</Label>
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your name"
                  />
                </div>
              </div>

              {/* Save name */}
              <div className="flex justify-end">
                <Button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              </div>

              <Separator className="bg-border" />

              {/* ── Change Email ── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Change Email
                  </h3>
                </div>
                <div className="space-y-1.5 max-w-sm">
                  <Label className="text-sm text-foreground">New Email</Label>
                  <Input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Enter new email address"
                  />
                  <p className="text-xs text-muted-foreground">
                    A confirmation link will be sent to your new email address
                  </p>
                </div>
                <div className="flex justify-start">
                  <Button
                    onClick={handleEmailChange}
                    disabled={changingEmail || newEmail.trim().length === 0}
                    variant="outline"
                    className="gap-2"
                  >
                    {changingEmail ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Update Email
                  </Button>
                </div>
              </div>

              <Separator className="bg-border" />

              {/* ── Change Password ── */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Change Password
                  </h3>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* New Password */}
                  <div className="space-y-1.5">
                    <Label className="text-sm text-foreground">
                      New Password
                    </Label>
                    <div className="relative">
                      <Input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={
                          showNewPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showNewPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Minimum 8 characters
                    </p>
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1.5">
                    <Label className="text-sm text-foreground">
                      Confirm Password
                    </Label>
                    <div className="relative">
                      <Input
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className={`pr-10 ${passwordMismatch ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={
                          showConfirmPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {passwordMismatch && (
                      <p className="text-xs text-destructive">
                        Passwords do not match
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-start">
                  <Button
                    onClick={handlePasswordChange}
                    disabled={passwordUpdateDisabled}
                    variant="outline"
                    className="gap-2"
                  >
                    {changingPassword ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    Update Password
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Members tab (admin only) ── */}
        {isUserAdmin && (
          <TabsContent value="members">
            <Card className="border-border bg-card">
              <CardContent className="pt-6 space-y-4">
                {/* Header row */}
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-foreground">
                    All Members
                  </h2>
                  <Badge
                    variant="outline"
                    className="border-border bg-muted text-muted-foreground"
                  >
                    {users.length}
                  </Badge>
                </div>

                {loadingUsers ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : users.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No members found.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50 hover:bg-muted/50 border-border">
                          {SORT_COLUMNS.map(([field, label]) => (
                            <TableHead
                              key={field}
                              className="text-muted-foreground"
                            >
                              <button
                                onClick={() => toggleSort(field)}
                                className="flex items-center gap-1 hover:text-foreground transition-colors"
                              >
                                {label}
                                <ArrowUpDown
                                  className={`h-3 w-3 transition-opacity ${
                                    sortField === field
                                      ? "opacity-100 text-primary"
                                      : "opacity-40"
                                  }`}
                                />
                              </button>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedUsers.map((u) => {
                          const memberName = u.full_name ?? "Unnamed";
                          const memberInitials =
                            memberName.charAt(0).toUpperCase();
                          const isSelf = u.id === profile?.id;

                          return (
                            <TableRow
                              key={u.id}
                              className="border-border hover:bg-accent/40 transition-colors"
                            >
                              {/* User + avatar */}
                              <TableCell>
                                <div className="flex items-center gap-2.5">
                                  <Avatar className="h-8 w-8 shrink-0 border border-border">
                                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                                      {memberInitials}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="font-medium text-foreground">
                                    {memberName}
                                    {isSelf && (
                                      <span className="ml-1.5 text-xs text-muted-foreground">
                                        (you)
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </TableCell>

                              <TableCell className="text-sm text-muted-foreground">
                                {u.email}
                              </TableCell>

                              <TableCell className="text-sm font-medium text-foreground">
                                {u.trade_count}
                              </TableCell>

                              <TableCell>
                                {isSelf ? (
                                  <Badge
                                    variant="outline"
                                    className={`capitalize text-xs ${roleBadgeClass(u.role)}`}
                                  >
                                    {u.role}
                                  </Badge>
                                ) : (
                                  <Select
                                    value={u.role}
                                    onValueChange={(v) => {
                                      if (v)
                                        handleRoleChange(
                                          u.id,
                                          v as UserRole,
                                        );
                                    }}
                                    disabled={updatingUserId === u.id}
                                  >
                                    <SelectTrigger className="w-28 border-border bg-card text-foreground">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="border-border bg-card">
                                      <SelectItem value="user">User</SelectItem>
                                      <SelectItem value="trader">
                                        Trader
                                      </SelectItem>
                                      <SelectItem value="admin">
                                        Admin
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
