"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ImageIcon, Loader2, Upload, X } from "lucide-react";
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
import { logoStorageKey } from "@/lib/posters/logo";
import { posterDisclaimer } from "@/lib/posters/disclaimer";
import { usePosterLogo } from "@/hooks/use-poster-logo";
import { safeGet, safeRemove, safeSet } from "@/lib/safe-storage";
import {
  TelegramDestinationCard,
  type DestinationSummary,
} from "@/components/posters/telegram-destination-card";
import { FilterChips } from "@/components/analytics/filter-chips";
import { COLOR_CLASS } from "@/components/journals/journal-switcher";
import {
  contributingJournalCount,
  defaultGroupName,
  groupStorageKey,
  instrumentOptions,
  perJournalCounts,
  scopeByJournal,
  scopeTrades,
} from "@/lib/posters/scope";
import { findDeskForJournals, posterIdentity } from "@/lib/reports/desks";
import { PublishToTelegram } from "@/components/posters/publish-to-telegram";
import type { JournalWithRole, ReportDesk, Trade } from "@/types/database";

interface PostersClientProps {
  /** Every trade from every journal the user belongs to, within the lookback. */
  readonly trades: readonly Trade[];
  readonly journals: readonly JournalWithRole[];
  /** Saved, named journal combinations. A match here names the poster. */
  readonly desks: readonly ReportDesk[];
  /** Where marketing images publish, or null if not connected yet. */
  readonly destination: DestinationSummary | null;
  readonly activeJournalId: string | null;
  readonly loadError: string | null;
}

export function PostersClient({
  trades,
  journals,
  desks,
  destination,
  activeJournalId,
  loadError,
}: PostersClientProps) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);
  const [period, setPeriod] = useState<PeriodId>("today");
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Defaults to the active journal alone, so anyone who just wants their own
  // poster sees exactly what they saw before journals could be combined.
  const [journalSel, setJournalSel] = useState<ReadonlySet<string>>(
    () => new Set(activeJournalId ? [activeJournalId] : []),
  );
  const [instrumentSel, setInstrumentSel] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Journals first, then the instruments those journals actually traded —
  // the same two-stage narrowing the Portfolio view uses.
  const journalScoped = useMemo(
    () => scopeByJournal(trades, journalSel),
    [trades, journalSel],
  );
  const scoped = useMemo(
    () => scopeTrades(trades, journalSel, instrumentSel),
    [trades, journalSel, instrumentSel],
  );
  const assetOptions = useMemo(
    () => instrumentOptions(journalScoped),
    [journalScoped],
  );

  // A journal change can invalidate the asset selection — Chris may not trade
  // the pair picked while Yohan was scoped. Left alone, the poster silently
  // reports "no closed trades" with no visible filter to blame, and if the new
  // scope has a single instrument the whole row (including "All") unmounts, so
  // there is no way back without a reload.
  useEffect(() => {
    setInstrumentSel((prev) => {
      if (prev.size === 0) return prev;
      const valid = new Set(assetOptions.map((o) => o.value));
      const next = new Set([...prev].filter((v) => valid.has(v)));
      return next.size === prev.size ? prev : next;
    });
  }, [assetOptions]);

  const selectedJournals = useMemo(
    () =>
      journalSel.size === 0
        ? journals
        : journals.filter((j) => journalSel.has(j.id)),
    [journals, journalSel],
  );

  // A saved desk names the poster; otherwise the name is derived from the
  // journals as before. This is what lets two gold journals publish as "Gold
  // Intraday" rather than "TTC GOLD | CHRIS + TTC GOLD | YOHAN", and it is the
  // same value a scheduled render will use, because it comes from the database
  // rather than from this browser.
  const identity = useMemo(
    () => posterIdentity(desks, selectedJournals.map((j) => j.id), journals),
    [desks, selectedJournals, journals],
  );
  const defaultGroup = identity.name || defaultGroupName(selectedJournals);
  const deskId = useMemo(
    () => findDeskForJournals(desks, selectedJournals.map((j) => j.id))?.id ?? null,
    [desks, selectedJournals],
  );
  const [group, setGroup] = useState(defaultGroup);

  // Remembered per COMBINATION, sorted so ticking Yohan-then-Chris and
  // Chris-then-Yohan share one entry. For a single journal this is byte-for-byte
  // the key the single-journal version used, so saved names survive.
  const groupKey = useMemo(
    () => groupStorageKey(selectedJournals.map((j) => j.id)),
    [selectedJournals],
  );

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

  // The logo is scoped to the same journal combination as the name it replaces,
  // so switching journals swaps both together rather than printing one team's
  // mark over another's numbers.
  const logoKey = useMemo(
    () => logoStorageKey(selectedJournals.map((j) => j.id)),
    [selectedJournals],
  );
  const {
    logo,
    busy: logoBusy,
    inputRef: logoInputRef,
    onPicked: onLogoPicked,
    onRemove: onLogoRemove,
  } = usePosterLogo(logoKey);

  useEffect(() => {
    // A saved desk WINS over anything in this browser. The desk is what a
    // scheduled render will use, so honouring a stale localStorage override
    // here would show one name on screen and publish a different one at 06:00
    // — the exact disagreement moving branding into the database removes.
    if (identity.fromDesk) {
      // Only adopt the desk's name when the field has not been edited since
      // the last sync. router.refresh() lands asynchronously after a save, and
      // without this it would overwrite anything typed in the meantime.
      if (!groupEditedRef.current) setGroup(identity.name);
      return;
    }
    // Guarded like the logo's: this effect runs FIRST, so an unprotected read
    // here would throw in private mode before the logo's guard ever helped.
    const saved = groupKey ? safeGet(groupKey) : null;
    setGroup(saved ?? defaultGroup);
  }, [groupKey, defaultGroup, identity.fromDesk, identity.name]);

  useEffect(() => {
    // Re-resolved when the period changes AND when `nonce` is bumped just
    // before an export, so a tab left open across midnight can't hand you
    // yesterday's window under a "Today" label.
    setRange(resolvePeriod(period, new Date()));
  }, [period, nonce]);

  const inRange = useMemo(
    () => (range ? tradesInRange(scoped, range) : []),
    [scoped, range],
  );
  const stats = useMemo(
    () => (range ? computePosterStats(inRange, localTimeZone()) : null),
    [inRange, range],
  );
  const breakdown = useMemo(
    () => perJournalCounts(inRange, journals),
    [inRange, journals],
  );
  // The poster's headline names the journals the user SELECTED, so the note
  // that qualifies it must count the same set. Counting only the journals that
  // happened to trade would let "YOHAN + CHRIS" print Yohan's numbers alone
  // with nothing on the artefact admitting it.
  const journalsClaimed = selectedJournals.length;
  const journalsContributing = contributingJournalCount(inRange);

  const theme = getTheme(themeId);
  const template = getTemplate(templateId);
  const kind = periodKind(period);
  const Template = template.Component;
  const fallbackCount = stats ? stats.tradeCount - stats.closeTimeKnown : 0;

  // Whether the on-screen name matches what a scheduled render would publish.
  //   "none"    - no desk for this combination yet
  //   "saved"   - a desk exists and the name matches it
  //   "changed" - a desk exists but the name has been edited since
  const deskState: "none" | "saved" | "changed" = !identity.fromDesk
    ? "none"
    : group.trim() === identity.name
      ? "saved"
      : "changed";
  const [deskBusy, setDeskBusy] = useState(false);
  // True once the user types, cleared when a save completes. Guards the
  // desk-name sync against clobbering an in-progress edit.
  const groupEditedRef = useRef(false);

  /**
   * Save the current selection and name as a desk, or rename an existing one.
   *
   * Deliberately POSTs the CURRENT journal selection rather than the desk's
   * stored ids: the button is only offered while a selection is active, and
   * sending anything else would let a rename quietly re-point a desk at
   * journals the user is not looking at.
   */
  /**
   * Send the logo to the server so it outlives this browser.
   *
   * The stored value is already a validated, downscaled PNG data URL, so it is
   * converted back to bytes rather than re-reading and re-checking the original
   * file. Best-effort: a failed upload leaves the name on the poster, which is
   * the pre-logo behaviour, and says so rather than failing the whole save.
   */
  const uploadLogo = async (id: string, dataUrl: string): Promise<void> => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const body = new FormData();
      body.append("file", blob, "logo.png");
      const res = await fetch(`/api/desks/${id}/logo`, { method: "POST", body });
      if (!res.ok) {
        const json: { error?: string } = await res.json().catch(() => ({}));
        toast.warning(
          json.error ?? "Saved, but the logo could not be uploaded.",
        );
      }
    } catch {
      toast.warning("Saved, but the logo could not be uploaded.");
    }
  };

  const onSaveDesk = async (): Promise<void> => {
    const name = group.trim();
    const journalIds = selectedJournals.map((j) => j.id);
    if (!name || journalIds.length === 0) return;

    const existing = desks.find((d) => d.id === deskId);
    setDeskBusy(true);
    try {
      const res = await fetch(
        existing ? `/api/desks/${existing.id}` : "/api/desks",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          // The theme travels WITH the save. Without it the row keeps whatever
          // it had and the published poster silently differs from this preview,
          // which is the exact divergence saving is meant to remove.
          body: JSON.stringify({
            name,
            journal_ids: journalIds,
            theme_id: themeId,
          }),
        },
      );
      const json: { error?: string; data?: { id?: string } } =
        await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Couldn't save this setup.");
        return;
      }

      // A logo picked in this browser is uploaded now that there is a row to
      // attach it to. Until this existed the logo stayed in localStorage and
      // every scheduled poster printed the name instead.
      const savedId = existing?.id ?? json.data?.id;
      if (savedId && logo) await uploadLogo(savedId, logo);

      toast.success(
        existing
          ? "Saved. Reports will publish this."
          : "Saved. Reports will publish this name and look.",
      );
      // The desks list came from the server component, so re-render the route
      // rather than patching local state and letting the two drift. AWAITED:
      // releasing the button first would leave `desks` stale, `deskId` null,
      // and a second click would POST a second desk over the same journals.
      groupEditedRef.current = false;
      await router.refresh();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setDeskBusy(false);
    }
  };

  const onGroupChange = (value: string) => {
    groupEditedRef.current = true;
    setGroup(value);
    if (!groupKey) return;
    if (value.trim() === "" || value === defaultGroup) {
      safeRemove(groupKey);
    } else {
      // Fires on every keystroke, so a quota failure here must not throw out of
      // an onChange handler and unmount the page mid-edit.
      safeSet(groupKey, value);
    }
  };

  /**
   * The caveats that qualify the numbers travel ON the poster, not just in the
   * app. A downloaded PNG is what gets published, and an unqualified "1.1R"
   * beside "12 TRADES" reads as a 12-trade average even when only three trades
   * had a stop.
   */
  // ONE builder, shared with the scheduled render. It was two, and only this
  // one carried the qualifications, so every automatically published poster
  // went out without them.
  const disclaimer = useMemo(
    () => posterDisclaimer(stats, journalsClaimed),
    [stats, journalsClaimed],
  );

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

  /**
   * Exports are blocked while a logo is decoding.
   *
   * Decoding a 2 MB source takes hundreds of milliseconds, and the poster shows
   * the group NAME throughout. Without this gate, clicking Download inside that
   * window rasterises the unbranded poster, reports success, and lands the
   * "Logo added" toast afterwards, so the user publishes a poster they believe
   * carries their mark.
   */
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
          Share your results. Every figure comes from your journals&apos; closed
          trades. The only things you supply are the name and your logo.
        </p>
      </div>

      {loadError && (
        <Card className="border-neg/40 bg-neg/5">
          <CardContent className="pt-6 text-sm text-neg">
            Couldn&apos;t load trades: {loadError}. Reload before generating, because
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
              {/*
                Journals first: everything below is scoped by this choice, and
                the asset list is derived from whatever is ticked here.
              */}
              {journals.length > 1 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Journals
                  </p>
                  <FilterChips
                    options={journals.map((j) => ({
                      value: j.id,
                      label: j.name,
                    }))}
                    selected={journalSel}
                    testIdPrefix="poster-journal"
                    renderDot={(id) => {
                      const j = journals.find((x) => x.id === id);
                      return j ? COLOR_CLASS[j.color] : null;
                    }}
                    onToggle={(id) =>
                      setJournalSel((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                    onAll={() => setJournalSel(new Set())}
                  />
                </div>
              )}

              {assetOptions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Assets
                  </p>
                  <FilterChips
                    options={assetOptions}
                    selected={instrumentSel}
                    testIdPrefix="poster-asset"
                    onToggle={(v) =>
                      setInstrumentSel((prev) => {
                        const next = new Set(prev);
                        if (next.has(v)) next.delete(v);
                        else next.add(v);
                        return next;
                      })
                    }
                    onAll={() => setInstrumentSel(new Set())}
                  />
                </div>
              )}

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
                  placeholder={defaultGroup}
                />
                <p className="text-xs text-muted-foreground">
                  The only editable text. Every statistic comes from your trades.
                </p>

                {/*
                  Saving is what makes this survive the browser. A saved setup
                  is read from the database, so a scheduled render publishes the
                  same name, theme and logo this page shows; anything typed here
                  and left unsaved exists only on this machine.

                  Written as independent conditions rather than one ternary
                  because two of these can be true at once: a saved desk whose
                  logo is still device-local needs both lines.
                */}
                {deskState === "saved" && (
                  <p
                    className="text-xs text-pos"
                    data-testid="poster-desk-status"
                  >
                    Saved. Scheduled reports publish this name, theme and logo.
                  </p>
                )}

                {/*
                  The canvas renders the EDITED name, so here the PNG you
                  download says one thing and a scheduled render says another.
                  That is the divergence desks exist to remove, so it is stated
                  outright rather than left to a button label changing.
                */}
                {deskState === "changed" && (
                  <p
                    className="text-xs text-warn"
                    data-testid="poster-desk-status"
                  >
                    Not saved yet. Scheduled reports still publish
                    &ldquo;{identity.name}&rdquo;.
                  </p>
                )}

                {/*
                  This used to warn that the logo was device-local and would not
                  appear on a scheduled poster. It now uploads when the setup is
                  saved, so the warning applies only to a logo picked since the
                  last save: still on this machine, not yet on the row.
                */}
                {deskState === "changed" && logo && (
                  <p
                    className="text-xs text-warn"
                    data-testid="poster-desk-logo-note"
                  >
                    Save to upload this logo. Until then a scheduled report
                    prints the name instead.
                  </p>
                )}

                {deskState !== "saved" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={deskBusy || !group.trim() || journalSel.size === 0}
                    onClick={() => void onSaveDesk()}
                    data-testid="poster-desk-save"
                  >
                    {deskBusy ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    {deskState === "changed" ? "Update this setup" : "Save this setup"}
                  </Button>
                )}
              </div>

              {/*
                A logo REPLACES the group name on the poster; the name field
                above stays live because it still names the downloaded file and
                is what the poster reverts to when the logo is removed.
              */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Logo
                </Label>
                {logo ? (
                  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a
                        data URL must stay a literal <img>. */}
                    <img
                      src={logo}
                      alt="Your logo"
                      data-testid="poster-logo-preview"
                      // Checkerboard, so a logo with a white fill is visibly
                      // distinguishable from one with real transparency.
                      className="h-10 w-auto max-w-[140px] object-contain"
                      style={{
                        backgroundImage:
                          "linear-gradient(45deg,rgba(128,128,128,.25) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.25) 75%),linear-gradient(45deg,rgba(128,128,128,.25) 25%,transparent 25%,transparent 75%,rgba(128,128,128,.25) 75%)",
                        backgroundSize: "12px 12px",
                        backgroundPosition: "0 0, 6px 6px",
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={onLogoRemove}
                      data-testid="poster-logo-remove"
                      className="ml-auto text-muted-foreground"
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-center"
                    disabled={logoBusy}
                    onClick={() => logoInputRef.current?.click()}
                    data-testid="poster-logo-upload"
                  >
                    {logoBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Upload logo
                  </Button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png"
                  className="hidden"
                  data-testid="poster-logo-input"
                  onChange={(e) => void onLogoPicked(e.target.files?.[0])}
                />
                <p className="text-xs text-muted-foreground">
                  Must be a PNG file with no background (transparent). It
                  replaces the group name on the poster.
                </p>
              </div>
            </CardContent>
          </Card>

          {/*
            Publishing sits ABOVE the connection card because that is the order
            it is used in: connect once, publish often. It renders nothing at
            all until a desk is saved and a group is connected, so the card
            below stays the single place that explains how to get there.
          */}
          <Card className="border-border bg-card">
            <CardContent className="space-y-3 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Publish
              </p>
              {deskId && destination?.chat_title ? (
                <PublishToTelegram
                  deskId={deskId}
                  deskName={identity.name}
                  chatTitle={destination.chat_title}
                  templateIds={
                    desks.find((d) => d.id === deskId)?.template_ids ?? []
                  }
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {!deskId
                    ? "Save this selection to publish it."
                    : "Connect a Telegram group below to publish."}
                </p>
              )}
            </CardContent>
          </Card>

          <TelegramDestinationCard destination={destination} />

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
                    {/*
                      Per-journal split, so a combined poster can be checked
                      against each journal before it is published.
                    */}
                    {breakdown.length > 1 &&
                      breakdown.map((j) => (
                        <Row
                          key={j.id}
                          label={`  ${j.name}`}
                          value={j.count}
                        />
                      ))}
                  </dl>

                  {journalsClaimed > 1 && (
                    <p
                      data-testid="poster-combine-caution"
                      className="rounded-md border border-warn/30 bg-warn/10 p-2 text-warn"
                    >
                      Combining {journalsClaimed} journals
                      {journalsContributing < journalsClaimed &&
                        `, only ${journalsContributing} of which traded in this period`}
                      . If any of them track the same account, those trades are
                      counted twice, and only you can tell.
                    </p>
                  )}

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
              disabled={
                busy !== null || logoBusy || !stats || stats.tradeCount === 0
              }
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
              disabled={
                busy !== null || logoBusy || !stats || stats.tradeCount === 0
              }
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
                  group={group.trim() || defaultGroup}
                  logo={logo}
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
              No closed trades in this period. Pick another one.
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
