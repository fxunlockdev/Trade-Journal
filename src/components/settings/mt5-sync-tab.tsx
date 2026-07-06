"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Cable,
  Copy,
  Download,
  Loader2,
  Plus,
  ShieldAlert,
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

/** Shape returned by GET /api/mt5/connections (journals joined for display). */
interface ConnectionRow {
  readonly id: string;
  readonly journal_id: string;
  readonly label: string | null;
  readonly token_prefix: string;
  readonly account_login: string | null;
  readonly broker: string | null;
  readonly last_sync_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
  readonly journals: {
    readonly name: string;
    readonly color: JournalColor;
  } | null;
}

interface FreshToken {
  readonly token: string;
  readonly journalName: string;
}

const EA_DOWNLOAD_PATH = "/mt5/FXUnlockConnector.mq5";

export function Mt5SyncTab() {
  const { journals, loading: journalsLoading } = useJournals();

  const [connections, setConnections] = useState<readonly ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [journalId, setJournalId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [freshToken, setFreshToken] = useState<FreshToken | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/mt5/connections");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load connections");
      setConnections(json.data ?? []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  // Default the journal picker to Personal (first journal) once loaded.
  useEffect(() => {
    if (!journalId && journals.length > 0) {
      setJournalId(journals[0].id);
    }
  }, [journals, journalId]);

  const handleCreate = useCallback(async () => {
    if (!journalId) {
      toast.error("Pick a journal first.");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/mt5/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journal_id: journalId,
          label: label.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create connection");
      setFreshToken({
        token: json.data.token,
        journalName: json.data.journal_name ?? "journal",
      });
      setLabel("");
      void loadConnections();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setCreating(false);
    }
  }, [journalId, label, loadConnections]);

  const handleCopyToken = useCallback(async () => {
    if (!freshToken) return;
    try {
      await navigator.clipboard.writeText(freshToken.token);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Couldn't copy — select the token manually");
    }
  }, [freshToken]);

  const handleRevoke = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/mt5/connections/${id}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to revoke");
        toast.success("Connection revoked — the EA will stop syncing.");
        void loadConnections();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Failed to revoke");
      }
    },
    [loadConnections],
  );

  return (
    <div className="space-y-6">
      {/* ── Connect a new MT5 account ── */}
      <Card className="border-border bg-card">
        <CardContent className="pt-6 space-y-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Cable className="h-4 w-4 text-primary" />
              Connect MetaTrader 5
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Trades placed in MT5 appear here automatically — opens, SL/TP
              changes, and closes with your broker&apos;s real P&amp;L. One
              token per MT5 account.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1.5 w-full sm:w-64">
              <Label className="text-xs text-muted-foreground">
                Journal to sync into
              </Label>
              <Select
                value={journalId}
                onValueChange={(v) => {
                  if (v) setJournalId(v);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={journalsLoading ? "Loading…" : "Pick a journal"}
                  />
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

            <div className="space-y-1.5 w-full sm:w-64">
              <Label className="text-xs text-muted-foreground">
                Label (optional)
              </Label>
              <Input
                placeholder="e.g. IC Markets live"
                value={label}
                maxLength={80}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>

            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Generate token
            </Button>
          </div>

          {/* One-time token reveal + setup steps */}
          {freshToken && (
            <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                <p className="text-sm text-foreground">
                  Copy this token now — for security it&apos;s shown{" "}
                  <span className="font-semibold">only once</span>. It links
                  MT5 to <span className="font-semibold">{freshToken.journalName}</span>.
                </p>
              </div>
              <div className="flex gap-2">
                <code className="flex-1 break-all rounded bg-muted px-3 py-2 font-mono text-xs text-foreground">
                  {freshToken.token}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleCopyToken()}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </Button>
              </div>

              <Separator />

              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Set up MT5 (once):</p>
                <ol className="list-decimal space-y-1.5 pl-5">
                  <li>
                    <a
                      href={EA_DOWNLOAD_PATH}
                      download
                      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download the FX Unlock Connector EA
                    </a>{" "}
                    and open it in MetaEditor (double-click), then press{" "}
                    <kbd className="rounded border border-border bg-muted px-1 text-[11px]">F7</kbd>{" "}
                    to compile.
                  </li>
                  <li>
                    In MT5: Tools → Options → Expert Advisors → tick{" "}
                    <em>Allow WebRequest for listed URL</em> and add{" "}
                    <code className="rounded bg-muted px-1 text-xs">
                      {typeof window !== "undefined" ? window.location.origin : "your app URL"}
                    </code>
                    .
                  </li>
                  <li>
                    Make sure the <em>Algo Trading</em> toolbar button is ON.
                  </li>
                  <li>
                    Drag <em>FXUnlockConnector</em> from the Navigator onto any
                    chart, paste this token into the <em>ApiToken</em> input,
                    and set <em>ServerUrl</em> to{" "}
                    <code className="rounded bg-muted px-1 text-xs">
                      {typeof window !== "undefined" ? window.location.origin : "your app URL"}
                    </code>
                    .
                  </li>
                  <li>
                    Check the Experts log — you should see{" "}
                    <em>&quot;Connected to journal&quot;</em>. Done: new trades
                    sync automatically (last 30 days backfill on first attach).
                  </li>
                </ol>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setFreshToken(null)}
              >
                I&apos;ve saved the token — hide it
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Existing connections ── */}
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <h3 className="text-base font-semibold text-foreground">
            Connected accounts
          </h3>

          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : connections.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No MT5 accounts connected yet.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
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
                        {c.label || c.account_login || c.token_prefix + "…"}
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
                        <Badge
                          variant="outline"
                          className="border-neg/30 bg-neg/10 text-xs text-neg"
                        >
                          Revoked
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-pos/30 bg-pos/10 text-xs text-pos"
                        >
                          Active
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{c.token_prefix}…</span>
                      {c.account_login && <> · {c.account_login}</>}
                      {c.broker && <> · {c.broker}</>}
                      {" · "}
                      {c.last_sync_at
                        ? `Last sync ${formatDateTime(c.last_sync_at)}`
                        : "Never synced"}
                    </p>
                  </div>

                  {!c.revoked_at && (
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            size="sm"
                            variant="destructive"
                            className="shrink-0"
                          />
                        }
                      >
                        Revoke
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Revoke this MT5 connection?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            The EA using this token will stop syncing
                            immediately. Trades already logged stay in your
                            journal. You can generate a new token anytime.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => void handleRevoke(c.id)}
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
