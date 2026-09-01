import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyRenderToken } from "@/lib/reports/render-token";
import { getTemplate } from "@/lib/posters/templates";
import { getTheme, POSTER_DISCLAIMER } from "@/lib/posters/theme";
import { POSTER_SIZE } from "@/lib/posters/templates/types";
import { combinedDisclaimerNote } from "@/lib/posters/scope";
import { formatPeriodLabel } from "@/lib/reports/periods-tz";
import type { ReportMetrics } from "@/lib/reports/metrics";
import type { Cadence } from "@/lib/reports/periods-tz";

/**
 * One poster, drawn from a frozen snapshot, for a headless browser to
 * screenshot.
 *
 * Deliberately OUTSIDE the (app) route group: it inherits the root layout —
 * which is where the poster fonts are loaded, and they must be — but none of
 * the sidebar or shell. The page is the poster and nothing else, so a
 * screenshot of the viewport is the artefact.
 *
 * Authorised by a signed, short-lived token in the path rather than a session:
 * the browser doing the screenshotting carries no cookies. See
 * lib/reports/render-token.ts.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SnapshotRow {
  readonly id: string;
  readonly cadence: Cadence;
  readonly period_start: string;
  readonly period_end: string;
  readonly metrics: ReportMetrics;
  readonly report_desks: {
    readonly name: string;
    readonly journal_ids: readonly string[];
  } | null;
}

export default async function RenderPosterPage({
  params,
}: {
  readonly params: Promise<{ readonly token: string }>;
}) {
  const { token } = await params;
  const claims = verifyRenderToken(decodeURIComponent(token));
  // 404 for every rejection — bad signature, expired, unconfigured. The page
  // should not confirm that a snapshot id exists to someone without a token.
  if (!claims) notFound();

  const admin = createAdminClient();
  const { data } = await admin
    .from("report_snapshots")
    .select("id, cadence, period_start, period_end, metrics, report_desks(name, journal_ids)")
    .eq("id", claims.snapshotId)
    .maybeSingle();

  const snapshot = data as SnapshotRow | null;
  if (!snapshot?.report_desks) notFound();

  const template = getTemplate(claims.style);
  const Template = template.Component;
  const theme = getTheme("obsidian-gold");

  // A desk spanning several journals must SAY so on the artefact. The
  // on-screen breakdown is not published, and a reader would otherwise take
  // two traders' combined figures for one person's record.
  const combined = combinedDisclaimerNote(
    snapshot.report_desks.journal_ids.length,
  );
  const disclaimer = [combined, POSTER_DISCLAIMER]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      // Exactly the poster, at its true size, pinned to the origin so the
      // screenshot needs no clipping maths.
      style={{
        width: POSTER_SIZE,
        height: POSTER_SIZE,
        overflow: "hidden",
        position: "absolute",
        top: 0,
        left: 0,
      }}
      data-testid="render-canvas"
    >
      <Template
        stats={snapshot.metrics.stats}
        theme={theme}
        group={snapshot.report_desks.name}
        logo={null}
        periodKind={snapshot.cadence.toUpperCase()}
        dateLabel={formatPeriodLabel({
          cadence: snapshot.cadence,
          start: snapshot.period_start,
          end: snapshot.period_end,
        })}
        disclaimer={disclaimer}
      />
    </div>
  );
}
