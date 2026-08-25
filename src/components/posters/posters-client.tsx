"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  computePosterStats,
  localTimeZone,
  tradesInRange,
  type PosterStats,
} from "@/lib/posters/poster-data";
import {
  formatPeriodLabel,
  periodKind,
  PERIODS,
  resolvePeriod,
  type DateRange,
  type PeriodId,
} from "@/lib/posters/periods";
import {
  DEFAULT_THEME_ID,
  getTheme,
  POSTER_DISCLAIMER,
  POSTER_THEMES,
} from "@/lib/posters/theme";
import {
  DEFAULT_TEMPLATE_ID,
  getTemplate,
  POSTER_TEMPLATES,
} from "@/lib/posters/templates";
import { POSTER_SIZE } from "@/lib/posters/templates/types";
import {
  copyPosterToClipboard,
  downloadBlob,
  posterFilename,
  posterToBlob,
} from "@/lib/posters/export";
import type { Trade } from "@/types/database";

interface PostersClientProps {
  readonly trades: readonly Trade[];
  readonly journalId: string;
  readonly journalName: string;
  readonly loadError: string | null;
}

export function PostersClient({
  trades,
  journalId,
  journalName,
  loadError,
}: PostersClientProps) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [period, setPeriod] = useState<PeriodId>("today");
  const [group, setGroup] = useState(journalName);
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);

  // Scoped per journal: a single global key would brand one journal's poster
  // with another journal's group name after switching.
  const groupKey = `trdr_poster_group:${journalId}`;

  // Day boundaries depend on the VIEWER'S timezone, which the server doesn't
  // know — on Vercel it is UTC. Resolving the range during render would compute
  // one window on the server and a different one in the browser: a trader in
  // Sydney at 08:00 local (22:00 UTC the previous day) would watch the server's
  // numbers paint and then visibly change.
  //
  // So the range is state, set only in an effect. Until it exists there is
  // nothing timezone-dependent to render, which keeps the server's HTML and the
  // first client render identical.
  const [range, setRange] = useState<DateRange | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const saved = window.localStorage.getItem(groupKey);
    setGroup(saved ?? journalName);
  }, [groupKey, journalName]);

  useEffect(() => {
    // Re-resolved when the period changes AND when `nonce` is bumped just
    // before an export, so a tab left open across midnight can't hand you
    // yesterday's window under a "Today" label.
    setRange(resolvePeriod(period, new Date()));
  }, [period, nonce]);

  const stats = useMemo(
    () =>
      range
        ? computePosterStats(tradesInRange(trades, range), localTimeZone())
        : null,
    [trades, range],
  );

  const theme = getTheme(themeId);
  const template = getTemplate(templateId);
  const kind = periodKind(period);
  const Template = template.Component;
  const fallbackCount = stats ? stats.tradeCount - stats.closeTimeKnown : 0;

  const onGroupChange = (value: string) => {
    setGroup(value);
    if (value.trim() === "" || value === journalName) {
      window.localStorage.removeItem(groupKey);
    } else {
      window.localStorage.setItem(groupKey, value);
    }
  };

  /**
   * The caveats that qualify the numbers travel ON the poster, not just in the
   * app. A downloaded PNG is what gets published, and an unqualified "1.1R"
   * beside "12 TRADES" reads as a 12-trade average even when only three trades
   * had a stop.
   */
  const disclaimer = useMemo(() => {
    if (!stats) return POSTER_DISCLAIMER;
    const notes: string[] = [];
    if (stats.rCovered > 0 && stats.rCovered < stats.tradeCount) {
      notes.push(
        `Avg R covers the ${stats.rCovered} of ${stats.tradeCount} trades that had a stop loss.`,
      );
    }
    if (stats.breakeven > 0) {
      notes.push(
        `Win rate excludes ${stats.breakeven} breakeven ${stats.breakeven === 1 ? "trade" : "trades"}.`,
      );
    }
    if (fallbackCount > 0) {
      notes.push(
        `${fallbackCount} ${fallbackCount === 1 ? "trade" : "trades"} placed by entry date (no close time recorded).`,
      );
    }
    return [...notes, POSTER_DISCLAIMER].join(" ");
  }, [stats, fallbackCount]);

  const render = useCallback(
    async (mode: "download" | "copy") => {
      const node = posterRef.current;
      if (!node || !range) return;
      setBusy(mode);
      try {
        if (mode === "download") {
          const blob = await posterToBlob(node, theme.tBg);
          downloadBlob(blob, posterFilename(group, kind, range.firstDay));
          toast.success("Poster downloaded");
        } else {
          // The blob PROMISE is handed to the clipboard, not an awaited blob:
          // Safari requires the write to happen inside the user gesture, and
          // rasterising first exhausts that activation.
          await copyPosterToClipboard(() => posterToBlob(node, theme.tBg));
          toast.success("Poster copied to clipboard");
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Couldn't render the poster";
        toast.error(message);
      } finally {
        setBusy(null);
      }
    },
    [group, kind, range, theme.tBg],
  );

  /** Refresh the window first, so an export always reflects "now". */
  const exportPoster = (mode: "download" | "copy") => {
    setNonce((n) => n + 1);
    void render(mode);
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <ImageIcon className="h-6 w-6 text-primary" />
          Posters
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your results. Every figure comes from this journal&apos;s closed
          trades — nothing on a poster is typed in except the group name.
        </p>
      </div>

      {loadError && (
        <Card className="border-neg/40 bg-neg/5">
          <CardContent className="pt-6 text-sm text-neg">
            Couldn&apos;t load trades: {loadError}. Reload before generating —
            these numbers may be incomplete.
          </CardContent>
        </Card>
      )}

      {/*
        Both tracks are minmax(0, …): a grid column defaults to a min-content
        floor, and the poster inside is intrinsically 1080px wide, so a plain
        `1fr` would refuse to shrink below 1080 — blowing out the page and
        crushing the controls column.
      */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardContent className="space-y-5 pt-6">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Template
                </p>
                <div className="grid gap-2">
                  {POSTER_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTemplateId(t.id)}
                      aria-pressed={templateId === t.id}
                      data-testid={`poster-template-${t.id}`}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        templateId === t.id
                          ? "border-primary/40 bg-primary/10"
                          : "border-border hover:border-border/80 hover:bg-muted/40",
                      )}
                    >
                      <div className="text-sm font-medium text-foreground">
                        {t.label}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t.blurb}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Period
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PERIODS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPeriod(p.id)}
                      aria-pressed={period === p.id}
                      data-testid={`poster-period-${p.id}`}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        period === p.id
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Theme
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {POSTER_THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemeId(t.id)}
                      aria-pressed={themeId === t.id}
                      data-testid={`poster-theme-${t.id}`}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        themeId === t.id
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <span
                        aria-hidden
                        className="h-3 w-3 rounded-full border border-black/20"
                        style={{ background: t.tAccent }}
                      />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="poster-group"
                  className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Group name
                </Label>
                <Input
                  id="poster-group"
                  data-testid="poster-group"
                  value={group}
                  onChange={(e) => onGroupChange(e.target.value)}
                  maxLength={40}
                  placeholder={journalName}
                />
                <p className="text-xs text-muted-foreground">
                  The only editable text — every statistic comes from your trades.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="space-y-2 pt-6 text-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What&apos;s on this poster
              </p>
              {stats === null ? (
                <Skeleton className="h-24 w-full rounded-md bg-muted" />
              ) : (
                <>
                  <dl
                    className="space-y-1.5 text-muted-foreground"
                    data-testid="poster-receipt"
                  >
                    <Row label="Closed trades in range" value={stats.tradeCount} />
                    <Row
                      label={`Wins / losses${stats.breakeven > 0 ? " / BE" : ""}`}
                      value={`${stats.wins} / ${stats.losses}${stats.breakeven > 0 ? ` / ${stats.breakeven}` : ""}`}
                    />
                    <Row
                      label="Avg R covers"
                      value={`${stats.rCovered} of ${stats.tradeCount}`}
                    />
                    <Row label="Day boundary" value={stats.timeZone} />
                  </dl>

                  {stats.breakeven > 0 && (
                    <p className="pt-1 text-muted-foreground">
                      Win rate excludes {stats.breakeven} breakeven{" "}
                      {stats.breakeven === 1 ? "trade" : "trades"}.
                    </p>
                  )}

                  {fallbackCount > 0 && (
                    <p
                      data-testid="poster-fallback-note"
                      className="rounded-md border border-warn/30 bg-warn/10 p-2 text-warn"
                    >
                      {fallbackCount} of {stats.tradeCount} trades{" "}
                      {fallbackCount === 1 ? "has" : "have"} no recorded close
                      time, so {fallbackCount === 1 ? "its" : "their"} entry date
                      was used to place {fallbackCount === 1 ? "it" : "them"} in
                      this period.
                    </p>
                  )}

                  {stats.rCovered < stats.tradeCount && stats.tradeCount > 0 && (
                    <p className="text-muted-foreground">
                      Avg R only counts trades that had a stop loss.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              onClick={() => exportPoster("download")}
              disabled={busy !== null || !stats || stats.tradeCount === 0}
              data-testid="poster-download"
              className="flex-1"
            >
              {busy === "download" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download PNG
            </Button>
            <Button
              variant="outline"
              onClick={() => exportPoster("copy")}
              disabled={busy !== null || !stats || stats.tradeCount === 0}
              data-testid="poster-copy"
            >
              {busy === "copy" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <PosterPreview>
            {stats && range ? (
              <div ref={posterRef} data-testid="poster-canvas">
                <Template
                  stats={stats}
                  theme={theme}
                  group={group.trim() || journalName}
                  periodKind={kind}
                  dateLabel={formatPeriodLabel(period, range)}
                  disclaimer={disclaimer}
                />
              </div>
            ) : (
              <div
                style={{ width: POSTER_SIZE, height: POSTER_SIZE }}
                className="bg-muted"
              />
            )}
          </PosterPreview>

          {stats?.tradeCount === 0 && (
            <p className="text-center text-sm text-muted-foreground">
              No closed trades in this period — pick another one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | number;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt>{label}</dt>
      <dd className="font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Scales the 1080×1080 poster down to fit without changing its real size — the
 * rasteriser needs the node at true dimensions, so this transforms rather than
 * resizes.
 */
function PosterPreview({ children }: { readonly children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) setScale(Math.min(1, width / POSTER_SIZE));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-border"
        style={{ height: POSTER_SIZE * scale }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: POSTER_SIZE,
            height: POSTER_SIZE,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export type { PosterStats };
