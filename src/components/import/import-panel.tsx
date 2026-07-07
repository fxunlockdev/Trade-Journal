"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  Upload,
} from "lucide-react";

import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { useJournals } from "@/hooks/use-journals";
import { COLOR_CLASS } from "@/components/journals/journal-switcher";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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

interface PreviewTrade {
  readonly ticket: number;
  readonly symbol: string;
  readonly direction: "buy" | "sell";
  readonly volume: number;
  readonly entry_price: number;
  readonly exit_price: number | null;
  readonly open_time: number;
  readonly close_time: number | null;
  readonly profit: number;
  readonly status: "new" | "duplicate";
}

interface PreviewData {
  readonly platform: "mt5" | "mt4";
  readonly account_login: string | null;
  readonly journal_name: string;
  readonly total: number;
  readonly new_count: number;
  readonly duplicate_count: number;
  readonly skipped_rows: number;
  readonly warnings: readonly string[];
  readonly trades: readonly PreviewTrade[];
}

/** Common broker time zones — MT5 reports carry no TZ info. */
const TZ_OPTIONS = [
  { value: "120", label: "GMT+2 (most brokers, winter)" },
  { value: "180", label: "GMT+3 (most brokers, summer)" },
  { value: "0", label: "GMT+0 / UTC" },
  { value: "60", label: "GMT+1" },
  { value: "-300", label: "GMT-5 (New York)" },
] as const;

/**
 * Report-import UI (upload → preview → commit). Header-less so it can be
 * embedded in both the /import page and the /mt5-sync page.
 */
export function ImportPanel() {
  const router = useRouter();
  const { journals, loading: journalsLoading } = useJournals();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [journalId, setJournalId] = useState("");
  const [utcOffset, setUtcOffset] = useState("120");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    if (!journalId && journals.length > 0) setJournalId(journals[0].id);
  }, [journals, journalId]);

  const runRequest = useCallback(
    async (mode: "preview" | "commit") => {
      if (!file) {
        toast.error("Choose your MT5/MT4 HTML report first.");
        return;
      }
      if (!journalId) {
        toast.error("Pick a journal first.");
        return;
      }
      setBusy(mode);
      try {
        const form = new FormData();
        form.set("file", file);
        form.set("journal_id", journalId);
        form.set("utc_offset", utcOffset);
        form.set("mode", mode);

        const res = await fetch("/api/import/mt5-report", {
          method: "POST",
          body: form,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Import failed");

        if (mode === "preview") {
          setPreview(json.data as PreviewData);
        } else {
          const d = json.data as { imported: number; skipped: number };
          toast.success(
            `Imported ${d.imported} trade${d.imported === 1 ? "" : "s"}.`,
          );
          setPreview(null);
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          router.push("/journal");
        }
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      } finally {
        setBusy(null);
      }
    },
    [file, journalId, utcOffset, router],
  );

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardContent className="pt-6 space-y-5">
          {/* How to export */}
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Export from MT5:</span>{" "}
            Toolbox → History tab → right-click → Period: <em>All History</em> →
            Report → <em>HTML</em>. (MT4: Account History → <em>Save as
            Report</em>.) Export in <span className="font-medium text-foreground">English</span>.
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
            <div className="space-y-1.5 w-full sm:w-56">
              <Label className="text-xs text-muted-foreground">Import into</Label>
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
                Report timezone (broker time)
              </Label>
              <Select value={utcOffset} onValueChange={(v) => v && setUtcOffset(v)}>
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

            <div className="space-y-1.5 w-full sm:w-auto sm:flex-1">
              <Label className="text-xs text-muted-foreground">Report file</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm"
                className="block w-full cursor-pointer rounded-lg border border-input bg-transparent text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:rounded-l-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setPreview(null);
                }}
              />
            </div>

            <Button
              onClick={() => void runRequest("preview")}
              disabled={busy !== null || !file}
            >
              {busy === "preview" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="h-4 w-4" />
              )}
              Preview
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preview */}
      {preview && (
        <Card className="border-border bg-card">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="uppercase">
                {preview.platform}
              </Badge>
              {preview.account_login && (
                <span className="text-sm text-muted-foreground">
                  Account {preview.account_login}
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                → {preview.journal_name}
              </span>
              <span className="ml-auto text-sm">
                <span className="font-semibold text-pos">{preview.new_count} new</span>
                {" · "}
                <span className="text-muted-foreground">
                  {preview.duplicate_count} already imported
                </span>
                {preview.skipped_rows > 0 && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {preview.skipped_rows} skipped
                  </span>
                )}
              </span>
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-lg border border-warn/30 bg-warn/10 p-2 text-xs text-warn">
                {preview.warnings.join(" ")}
              </div>
            )}

            <div className="max-h-96 overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px] uppercase tracking-wider">Ticket</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider">Symbol</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider">Side</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-wider">Lots</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider">Closed</TableHead>
                    <TableHead className="text-right text-[11px] uppercase tracking-wider">P&L</TableHead>
                    <TableHead className="text-[11px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.trades.map((t) => (
                    <TableRow key={t.ticket} className={cn(t.status === "duplicate" && "opacity-50")}>
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {t.ticket}
                      </TableCell>
                      <TableCell className="font-medium">{t.symbol}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs font-semibold uppercase",
                            t.direction === "buy"
                              ? "border-pos/30 text-pos bg-pos/10"
                              : "border-neg/30 text-neg bg-neg/10",
                          )}
                        >
                          {t.direction}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{t.volume}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {t.close_time ? formatDateTime(new Date(t.close_time * 1000)) : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-medium tabular-nums",
                          t.profit > 0 ? "text-pos" : t.profit < 0 ? "text-neg" : "text-muted-foreground",
                        )}
                      >
                        {formatCurrency(t.profit)}
                      </TableCell>
                      <TableCell>
                        {t.status === "new" ? (
                          <Badge variant="outline" className="border-pos/30 bg-pos/10 text-xs text-pos">
                            New
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Duplicate
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => setPreview(null)}
                disabled={busy !== null}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void runRequest("commit")}
                disabled={busy !== null || preview.new_count === 0}
              >
                {busy === "commit" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : preview.new_count === 0 ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {preview.new_count === 0
                  ? "Everything already imported"
                  : `Import ${preview.new_count} trade${preview.new_count === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
