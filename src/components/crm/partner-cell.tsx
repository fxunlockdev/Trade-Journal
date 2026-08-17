"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Link2, Copy, Loader2, Activity, Unlink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Affiliate, MemberActivity } from "@/lib/crm/types";

/**
 * Partner-tracking cell. For an un-linked roster row it mints a join link; for
 * a linked one it shows join status + activity counts (via get_member_activity
 * — counts only, never the member's trades) and an unlink control.
 */
export function PartnerCell({ affiliate, onChanged }: { affiliate: Affiliate; onChanged: () => void }) {
  const supabase = createClient();
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [activity, setActivity] = useState<MemberActivity | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const linked = affiliate.member_user_id !== null;

  const loadActivity = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_member_activity", {
      p_affiliate_id: affiliate.id,
    });
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setActivity(row as MemberActivity);
  }, [supabase, affiliate.id]);

  useEffect(() => {
    if (linked) void loadActivity();
    else setActivity(null);
  }, [linked, loadActivity]);

  async function createInvite() {
    setInviting(true);
    try {
      const res = await fetch(`/api/crm/affiliates/${affiliate.id}/invite`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(data.error ?? "Could not create invite.");
        return;
      }
      setInviteUrl(data.url);
    } finally {
      setInviting(false);
    }
  }

  async function doUnlink() {
    setUnlinking(true);
    try {
      const res = await fetch(`/api/crm/affiliates/${affiliate.id}/unlink`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not unlink.");
        return;
      }
      toast.success("Access revoked.");
      onChanged();
    } finally {
      setUnlinking(false);
      setConfirmUnlink(false);
    }
  }

  if (!linked) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={createInvite} disabled={inviting}>
          {inviting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
          Invite
        </Button>

        <Dialog open={inviteUrl !== null} onOpenChange={(o) => !o && setInviteUrl(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite {affiliate.name} to the Journal</DialogTitle>
              <DialogDescription>
                Share this single-use link. It expires in 72 hours, and whoever accepts it is
                linked to you. They&apos;ll get their own private journal, and you&apos;ll only ever see their
                activity, never their trades.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteUrl ?? ""} onFocus={(e) => e.currentTarget.select()} />
              <Button
                size="icon"
                variant="outline"
                onClick={() => {
                  if (inviteUrl) {
                    void navigator.clipboard.writeText(inviteUrl);
                    toast.success("Link copied.");
                  }
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setInviteUrl(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" />}>
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
            Joined
          </Badge>
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          <div className="space-y-2 text-sm">
            <p className="font-medium">Journal activity</p>
            {activity === null ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : (
              <dl className="space-y-1 text-muted-foreground">
                <Row label="Last active" value={fmtDate(activity.last_active_at)} />
                <Row label="Trades (7d)" value={String(activity.trades_7d)} />
                <Row label="Trades (30d)" value={String(activity.trades_30d)} />
                <Row label="Last trade" value={fmtDate(activity.last_trade_at)} />
              </dl>
            )}
            <p className="pt-1 text-xs text-muted-foreground">
              Counts only. Their trades and P&amp;L stay private.
            </p>
          </div>
        </PopoverContent>
      </Popover>

      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setConfirmUnlink(true)} aria-label="Revoke access">
        <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {affiliate.name}&apos;s link?</AlertDialogTitle>
            <AlertDialogDescription>
              This unlinks their account from your roster and stops tracking. It does not delete or
              affect their own journal, which stays theirs. You can re-invite them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doUnlink} disabled={unlinking}>
              {unlinking ? "Revoking…" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt>{label}</dt>
      <dd className="font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
