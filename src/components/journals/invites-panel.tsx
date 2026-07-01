"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, Link as LinkIcon, Trash2 } from "lucide-react";

import type { JournalRole } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

interface Invite {
  readonly id: string;
  readonly token: string;
  readonly role: Exclude<JournalRole, "owner">;
  readonly expires_at: string;
  readonly created_at: string;
  readonly created_by_user_id: string;
  readonly accepted_at: string | null;
  readonly revoked_at: string | null;
}

interface InvitesPanelProps {
  readonly journalId: string;
  readonly journalName: string;
}

function inviteUrl(token: string): string {
  if (typeof window === "undefined") return `/invite/${token}`;
  return `${window.location.origin}/invite/${token}`;
}

function formatExpiry(iso: string): string {
  const expiresAt = new Date(iso).getTime();
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= 1) return `expires in ${days}d`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 1) return `expires in ${hours}h`;
  const mins = Math.max(1, Math.floor(diff / (1000 * 60)));
  return `expires in ${mins}m`;
}

/**
 * Invites tab — link-based invite generation for the active journal.
 *
 * Flow:
 *   1. Owner picks role + validity window
 *   2. Clicks Generate → POST /api/journals/[id]/invites returns {token, ...}
 *   3. UI shows the URL with a Copy button
 *   4. Owner sends the link via Slack/WhatsApp/etc. — no email infra needed
 *   5. Recipient visits /invite/[token], signs in, clicks Accept → joined
 *   6. Owner can revoke any unused invite from the active list below
 */
export function InvitesPanel({ journalId, journalName }: InvitesPanelProps) {
  const [invites, setInvites] = useState<readonly Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<Exclude<JournalRole, "owner">>("member");
  const [expiresDays, setExpiresDays] = useState<number>(7);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/journals/${journalId}/invites`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to load invites");
        return;
      }
      setInvites(body.data ?? []);
    } catch {
      toast.error("Network error loading invites");
    } finally {
      setLoading(false);
    }
  }, [journalId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async (): Promise<void> => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/journals/${journalId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, expires_in_days: expiresDays }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to generate invite");
        return;
      }
      toast.success("Invite link generated — copy and share");
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select the link manually");
    }
  };

  const handleRevoke = async (inviteId: string): Promise<void> => {
    try {
      const res = await fetch(
        `/api/journals/${journalId}/invites/${inviteId}`,
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Failed to revoke invite");
        return;
      }
      toast.success("Invite revoked");
      await load();
    } catch {
      toast.error("Network error");
    }
  };

  const validInvites = useMemo(
    () =>
      invites.filter(
        (i) =>
          !i.accepted_at &&
          !i.revoked_at &&
          new Date(i.expires_at).getTime() > Date.now(),
      ),
    [invites],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate invite link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Generate a shareable link that lets a colleague join{" "}
            <span className="font-medium text-foreground">{journalName}</span>.
            Send the link via Slack, WhatsApp, or email — no email integration
            required. Each link is single-use and expires automatically.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Role for new member</Label>
              <Select
                value={role}
                onValueChange={(v) => {
                  if (v === "member" || v === "viewer") setRole(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">
                    Member — can log + edit trades
                  </SelectItem>
                  <SelectItem value="viewer">
                    Viewer — read-only access
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Expires in</Label>
              <Select
                value={String(expiresDays)}
                onValueChange={(v) => {
                  if (v) setExpiresDays(Number(v));
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleCreate}
                disabled={creating}
                className="w-full"
              >
                <LinkIcon className="mr-2 size-4" />
                {creating ? "Generating…" : "Generate invite link"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Active invites ({validInvites.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : validInvites.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No active invites. Generate one above to share.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {validInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {inv.role}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatExpiry(inv.expires_at)}
                      </span>
                    </div>
                    <code className="mt-1 block truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                      {inviteUrl(inv.token)}
                    </code>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCopy(inv.token)}
                    >
                      <Copy className="mr-1.5 size-3.5" />
                      Copy
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-neg hover:bg-neg/10 hover:text-neg"
                          />
                        }
                      >
                        <Trash2 className="size-4" />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke this invite?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The link will stop working immediately. Anyone who
                            hasn&apos;t accepted yet will see &quot;This invite
                            has been revoked&quot; when they visit it.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-neg text-white hover:bg-neg/90"
                            onClick={() => void handleRevoke(inv.id)}
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
