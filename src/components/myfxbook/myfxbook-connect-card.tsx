"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { cn, formatDateTime } from "@/lib/utils";
import { useJournals } from "@/hooks/use-journals";
import { COLOR_CLASS } from "@/components/journals/journal-switcher";
import type { JournalColor } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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

interface MyfxbookAccountOption {
  readonly id: string;
  readonly account_login: string;
  readonly name: string;
  readonly broker: string | null;
  readonly currency: string | null;
  readonly demo: boolean;
  readonly last_update: string | null;
}

interface ConnectionRow {
  readonly id: string;
  readonly journal_id: string;
  readonly myfxbook_account_id: string;
  readonly account_name: string | null;
  readonly broker: string | null;
  readonly broker_utc_offset_minutes: number;
  readonly last_sync_at: string | null;
  readonly last_error: string | null;
  readonly revoked_at: string | null;
  readonly journals: { readonly name: string; readonly color: JournalColor } | null;
}

const TZ_OPTIONS = [
  { value: "120", label: "GMT+2 (most brokers, winter)" },
  { value: "180", label: "GMT+3 (most brokers, summer)" },
  { value: "0", label: "GMT+0 / UTC" },
  { value: "60", label: "GMT+1" },
  { value: "-300", label: "GMT-5 (New York)" },
] as const;

export function MyfxbookConnectCard() {
  const { journals, loading: journalsLoading } = useJournals();

  const [connections, setConnections] = useState<readonly ConnectionRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [journalId, setJournalId] = useState("");
  const [tzOffset, setTzOffset] = useState("120");
  const [accounts, setAccounts] = useState<readonly MyfxbookAccountOption[] | null>(null);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [busy, setBusy] = useState<"validate" | "connect" | string | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/myfxbook/connections");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setConnections(json.data ?? []);
    } catch {
      // list is non-critical; the card still works
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (!journalId && journals.length > 0) setJournalId(journals[0].id);
  }, [journals, journalId]);

  const submit = useCallback(
    async (accountId?: string) => {
      if (!email || !password) {
        toast.error("Enter your Myfxbook email and password.");
        return;
      }
      if (!journalId) {
        toast.error("Pick a journal first.");
        return;
      }
      setBusy(accountId ? "connect" : "validate");
      try {
        const res = await fetch("/api/myfxbook/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            journal_id: journalId,
            broker_utc_offset_minutes: Number(tzOffset),
            ...(accountId ? { myfxbook_account_id: accountId } : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          // Include Myfxbook's verbatim reply (detail) when present — turns
          // "it failed" screenshots into diagnosable reports.
          const message = json.detail
            ? `${json.error ?? "Connection failed"} [${json.detail}]`
            : (json.error ?? "Connection failed");
          throw new Error(message);
        }

        if (!accountId) {
          const list = json.data.accounts as readonly MyfxbookAccountOption[];
          if (list.length === 1) {
            // Single account — connect it without an extra click.
            await submit(list[0].id);
            return;
          }
          setAccounts(list);
          setSelectedAccount(list[0]?.id ?? "");
        } else {
          const first = json.data.first_sync as
            | { processed?: number; error?: string }
            | undefined;
          toast.success(
            first?.error
              ? "Connected — first sync pending (see status below)."
              : `Connected! Synced ${first?.processed ?? 0} trades from ${json.data.account_name ?? "your account"}.`,
          );
          setEmail("");
          setPassword("");
          setAccounts(null);
          setSelectedAccount("");
          void loadConnections();
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Connection failed");
      } finally {
        setBusy(null);
      }
    },
    [email, password, journalId, tzOffset, loadConnections],
  );

  const syncNow = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const res = await fetch(`/api/myfxbook/connections/${id}/sync`, {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Sync failed");
        toast.success(
          `Synced — ${json.data.processed ?? 0} trades processed.`,
        );
        void loadConnections();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Sync failed");
      } finally {
        setBusy(null);
      }
    },
    [loadConnections],
  );

  const revoke = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/myfxbook/connections/${id}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to disconnect");
        toast.success("Disconnected.");
        void loadConnections();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to disconnect");
      }
    },
    [loadConnections],
  );

  return (
    <Card className="border-primary/25 bg-card">
      <CardContent className="pt-6 space-y-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Auto-sync via Myfxbook
            <Badge variant="lime" className="text-[10px] uppercase">
              Free · no desktop needed
            </Badge>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your MT4/MT5 account on{" "}
            <a
              href="https://www.myfxbook.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              myfxbook.com
            </a>{" "}
            (free, uses your read-only investor password), then link it here —
            trades sync automatically 24/7, even with MT5 closed.
          </p>
        </div>

        {/* Connect form */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
          <div className="space-y-1.5 w-full sm:w-56">
            <Label className="text-xs text-muted-foreground">Myfxbook email</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 w-full sm:w-48">
            <Label className="text-xs text-muted-foreground">Myfxbook password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 w-full sm:w-48">
            <Label className="text-xs text-muted-foreground">Journal</Label>
            <Select value={journalId} onValueChange={(v) => v && setJournalId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={journalsLoading ? "Loading…" : "Pick"} />
              </SelectTrigger>
              <SelectContent>
                {journals.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-block h-2 w-2 rounded-full",
                          COLOR_CLASS[j.color],
                        )}
                      />
                      {j.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 w-full sm:w-56">
            <Label className="text-xs text-muted-foreground">Broker timezone</Label>
            <Select value={tzOffset} onValueChange={(v) => v && setTzOffset(v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TZ_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => void submit()}
            disabled={busy !== null}
          >
            {busy === "validate" || busy === "connect" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Connect
          </Button>
        </div>

        {/* Account picker (profiles with several accounts) */}
        {accounts && accounts.length > 1 && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium text-foreground">
              Which account should sync into this journal?
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 w-full sm:w-80">
                <Select
                  value={selectedAccount}
                  onValueChange={(v) => v && setSelectedAccount(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pick an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · #{a.account_login}
                        {a.broker ? ` · ${a.broker}` : ""}
                        {a.demo ? " · demo" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => void submit(selectedAccount)}
                disabled={busy !== null || !selectedAccount}
              >
                {busy === "connect" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Link account
              </Button>
            </div>
          </div>
        )}

        {/* Linked accounts */}
        {!loadingList && connections.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between",
                    c.revoked_at && "opacity-60",
                  )}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {c.account_name ?? `Myfxbook #${c.myfxbook_account_id}`}
                      </span>
                      {c.journals && (
                        <Badge variant="outline" className="gap-1.5 text-xs">
                          <span
                            className={cn(
                              "inline-block h-1.5 w-1.5 rounded-full",
                              COLOR_CLASS[c.journals.color],
                            )}
                          />
                          {c.journals.name}
                        </Badge>
                      )}
                      {c.revoked_at ? (
                        <Badge variant="outline" className="border-neg/30 bg-neg/10 text-xs text-neg">
                          Disconnected
                        </Badge>
                      ) : c.last_error ? (
                        <Badge variant="outline" className="border-warn/30 bg-warn/10 text-xs text-warn">
                          Needs attention
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-pos/30 bg-pos/10 text-xs text-pos">
                          Active
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.broker && <>{c.broker} · </>}
                      {c.last_sync_at
                        ? `Last sync ${formatDateTime(c.last_sync_at)}`
                        : "Never synced"}
                    </p>
                    {c.last_error && !c.revoked_at && (
                      <p className="flex items-start gap-1 text-xs text-warn">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        {c.last_error}
                      </p>
                    )}
                  </div>

                  {!c.revoked_at && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void syncNow(c.id)}
                      >
                        {busy === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Sync now
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={<Button size="sm" variant="destructive" />}
                        >
                          Disconnect
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Disconnect this Myfxbook account?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Auto-sync stops and the stored credentials are
                              wiped. Trades already in the journal stay. You
                              can reconnect anytime.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void revoke(c.id)}>
                              Disconnect
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
