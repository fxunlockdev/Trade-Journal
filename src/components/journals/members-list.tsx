"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, UserX } from "lucide-react";

import type { JournalRole } from "@/types/database";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

interface Member {
  readonly user_id: string;
  readonly email: string;
  readonly full_name: string;
  readonly avatar_url: string;
  readonly role: JournalRole;
  readonly joined_at: string;
  readonly invited_by_user_id: string | null;
}

interface MembersListProps {
  readonly journalId: string;
  readonly currentUserId: string;
  readonly currentUserRole: JournalRole;
}

function getInitials(name: string, email: string): string {
  if (name.trim()) {
    return name
      .split(" ")
      .map((p) => p[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return email[0]?.toUpperCase() ?? "?";
}

function formatRelativeJoined(iso: string): string {
  const joined = new Date(iso);
  const days = Math.floor((Date.now() - joined.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return joined.toLocaleDateString();
}

export function MembersList({
  journalId,
  currentUserId,
  currentUserRole,
}: MembersListProps) {
  const router = useRouter();
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOwner = currentUserRole === "owner";

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/journals/${journalId}/members`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to load members");
        return;
      }
      setMembers(body.data ?? []);
      setError(null);
    } catch {
      setError("Network error loading members");
    } finally {
      setLoading(false);
    }
  }, [journalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRoleChange = async (
    userId: string,
    role: JournalRole,
  ): Promise<void> => {
    try {
      const res = await fetch(
        `/api/journals/${journalId}/members/${userId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to change role");
        return;
      }
      toast.success("Role updated");
      await load();
    } catch {
      toast.error("Network error");
    }
  };

  const handleRemove = async (
    userId: string,
    isSelf: boolean,
  ): Promise<void> => {
    try {
      const res = await fetch(
        `/api/journals/${journalId}/members/${userId}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to remove member");
        return;
      }
      toast.success(isSelf ? "Left journal" : "Member removed");
      if (isSelf) {
        // Self-leave → redirect to dashboard (active journal will fall back
        // to a journal they still belong to)
        router.push("/dashboard");
        router.refresh();
      } else {
        await load();
      }
    } catch {
      toast.error("Network error");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardContent className="pt-6 text-sm text-red-400">{error}</CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Members ({members.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {members.map((m) => {
            const isSelf = m.user_id === currentUserId;
            const isOwnerRow = m.role === "owner";
            const canEditThisRow = isOwner && !isSelf && !isOwnerRow;

            return (
              <div
                key={m.user_id}
                className="flex items-center gap-4 px-5 py-3"
              >
                <Avatar className="size-9 shrink-0 border border-border">
                  {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                  <AvatarFallback className="bg-primary/10 text-xs text-primary">
                    {getInitials(m.full_name, m.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {m.full_name || m.email}
                    </p>
                    {isSelf && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        You
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email} · joined {formatRelativeJoined(m.joined_at)}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {canEditThisRow ? (
                    <Select
                      value={m.role}
                      onValueChange={(role) => {
                        if (role && role !== m.role) {
                          void handleRoleChange(m.user_id, role as JournalRole);
                        }
                      }}
                    >
                      <SelectTrigger className="h-8 w-[110px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        isOwnerRow
                          ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {m.role}
                    </span>
                  )}

                  {canEditThisRow && (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          />
                        }
                      >
                        <UserX className="size-4" />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove this member?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {m.full_name || m.email} will lose access to this
                            journal and its trades. They can be re-invited
                            later.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-500 text-white hover:bg-red-500/90"
                            onClick={() => void handleRemove(m.user_id, false)}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}

                  {isSelf && !isOwnerRow && (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                          />
                        }
                      >
                        <LogOut className="size-3.5" />
                        Leave
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Leave this journal?</AlertDialogTitle>
                          <AlertDialogDescription>
                            You&apos;ll lose access to this journal&apos;s
                            trades. The owner will need to re-invite you to
                            rejoin.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-500 text-white hover:bg-red-500/90"
                            onClick={() => void handleRemove(m.user_id, true)}
                          >
                            Leave
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
